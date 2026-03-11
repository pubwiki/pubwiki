import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, SaveService } from '@pubwiki/db';
import type { Pagination } from '@pubwiki/api';
import { computeSha256Hex } from '@pubwiki/api';
import { ListSavesQueryParams, CreateSaveBody } from '@pubwiki/api/validate';
import { authMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { validateQuery, validateFormDataJson, isValidationError } from '../lib/validate';
import { serviceErrorResponse, badRequest, forbidden, notFound, commitWithConflictHandling } from '../lib/service-error';
import { createAuditLogger } from '../lib/audit';

export const savesRoute = new Hono<{ Bindings: Env }>();

// POST /saves — 创建用户运行时存档（multipart: metadata JSON + data file）
// This is for user runtime saves - saves created independently of artifact commits.
// Official saves (participate in artifact commit) are created via artifact nodes.
savesRoute.post('/', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);
  const user = c.get('user');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return badRequest(c, 'Invalid multipart form data');
  }

  // Validate metadata JSON with zod schema
  const metadata = validateFormDataJson(c, formData, 'metadata', CreateSaveBody.shape.metadata);
  if (metadata instanceof Response) return metadata;

  // Get binary file
  const dataFile = formData.get('data');
  if (!dataFile || !(dataFile instanceof File)) {
    return badRequest(c, 'data field is required and must be a binary file');
  }

  // Read file content and verify quadsHash
  const buffer = await dataFile.arrayBuffer();
  const computedQuadsHash = await computeSha256Hex(buffer);
  if (computedQuadsHash !== metadata.quadsHash) {
    return badRequest(c, `quadsHash mismatch: expected ${metadata.quadsHash}, computed ${computedQuadsHash}`);
  }

  // Create user runtime save record
  const result = await saveService.createRuntimeSave({
    saveId: metadata.saveId,
    stateNodeId: metadata.stateNodeId,
    artifactCommit: metadata.artifactCommit,
    commit: metadata.commit,
    parent: metadata.parent ?? null,
    authorId: user.id,
    artifactId: metadata.artifactId,
    contentHash: metadata.contentHash,
    quadsHash: metadata.quadsHash,
    title: metadata.title,
    description: metadata.description,
    isListed: metadata.isListed,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Save was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Upload data file to R2 using quadsHash for deduplication
  const r2Key = `saves/${metadata.quadsHash}/quads.bin`;
  await c.env.R2_BUCKET.put(r2Key, buffer, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  // Query the full save detail
  const detailCtx = new BatchContext(createDb(c.env.DB));
  const detailService = new SaveService(detailCtx);
  const detailResult = await detailService.getSave(result.data.commit);

  if (!detailResult.success) {
    return serviceErrorResponse(c, detailResult.error);
  }

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.create('save', result.data.commit, { artifactId: metadata.artifactId });

  return c.json(detailResult.data, 201);
});

// GET /saves — 获取存档列表（按 stateNodeId 或 saveId 查询）
savesRoute.get('/', resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);
  const { userId } = c.get('resourceAccess');

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListSavesQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const { stateNodeId, saveId, author, page, limit } = validated;

  const hasStateNodeParams = !!stateNodeId;
  const hasSaveIdParam = !!saveId;

  // oneOf 验证：必须提供其中一组
  if (hasStateNodeParams && hasSaveIdParam) {
    return badRequest(c, 'Cannot specify both stateNodeId and saveId. Use one or the other.');
  }
  if (!hasStateNodeParams && !hasSaveIdParam) {
    return badRequest(c, 'Must specify either stateNodeId or saveId');
  }

  const listParams = hasStateNodeParams
    ? { stateNodeId: stateNodeId!, author, page, limit, userId: userId ?? undefined }
    : { saveId: saveId!, author, page, limit, userId: userId ?? undefined };

  const result = await saveService.listSaves(listParams);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<{ saves: typeof result.data.saves; pagination: Pagination }>(result.data);
});

// GET /saves/:commit — 获取存档详情（commit 全局唯一）
savesRoute.get('/:commit', resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);
  const { userId } = c.get('resourceAccess');

  const commit = c.req.param('commit');

  // Access control check: author or can read parent artifact
  const canRead = await saveService.canReadSave(commit, userId ?? undefined);
  if (!canRead) {
    // Check if save exists first to return proper error code
    const result = await saveService.getSave(commit);
    if (!result.success && result.error.code === 'NOT_FOUND') {
      return notFound(c, 'Save not found');
    }
    return forbidden(c, 'Access denied');
  }

  const result = await saveService.getSave(commit);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json(result.data);
});

// DELETE /saves/:commit — 删除存档（commit 全局唯一）
savesRoute.delete('/:commit', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);
  const user = c.get('user');

  const commit = c.req.param('commit');

  const result = await saveService.deleteSave(commit, user.id);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Save was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.delete('save', commit);

  // Note: R2 cleanup is deferred. Since we use content-addressed storage (quadsHash),
  // the same quads data may be shared by multiple saves. R2 objects should only be
  // deleted when refCount reaches 0, which should be handled by a background job
  // that periodically cleans up orphaned content.

  return c.body(null, 204);
});

// GET /saves/:commit/data — 下载 quads.bin（commit 全局唯一）
savesRoute.get('/:commit/data', resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);
  const { userId } = c.get('resourceAccess');

  const commit = c.req.param('commit');

  // Access control check: author or can read parent artifact
  const canRead = await saveService.canReadSave(commit, userId ?? undefined);
  if (!canRead) {
    // Check if save exists first to return proper error code
    const saveResult = await saveService.getSave(commit);
    if (!saveResult.success && saveResult.error.code === 'NOT_FOUND') {
      return notFound(c, 'Save not found');
    }
    return forbidden(c, 'Access denied');
  }

  // 获取 quadsHash
  const saveResult = await saveService.getSave(commit);
  if (!saveResult.success) {
    return serviceErrorResponse(c, saveResult.error);
  }

  const { quadsHash } = saveResult.data;

  // 从 R2 获取（使用 quadsHash 作为 key）
  const r2Key = `saves/${quadsHash}/quads.bin`;
  const object = await c.env.R2_BUCKET.get(r2Key);

  if (!object) {
    return notFound(c, 'Save data not found in storage');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
    },
  });
});
