import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, SaveService } from '@pubwiki/db';
import type { ApiError, Pagination } from '@pubwiki/api';
import { computeSha256Hex } from '@pubwiki/api';
import { ListSavesQueryParams, CreateSaveBody } from '@pubwiki/api/validate';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { validateQuery, validateFormDataJson, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';

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
    return c.json<ApiError>({ error: 'Invalid multipart form data' }, 400);
  }

  // Validate metadata JSON with zod schema
  const metadata = validateFormDataJson(c, formData, 'metadata', CreateSaveBody.shape.metadata);
  if (metadata instanceof Response) return metadata;

  // Get binary file
  const dataFile = formData.get('data');
  if (!dataFile || !(dataFile instanceof File)) {
    return c.json<ApiError>({ error: 'data field is required and must be a binary file' }, 400);
  }

  // Read file content and verify quadsHash
  const buffer = await dataFile.arrayBuffer();
  const computedQuadsHash = await computeSha256Hex(buffer);
  if (computedQuadsHash !== metadata.quadsHash) {
    return c.json<ApiError>({
      error: `quadsHash mismatch: expected ${metadata.quadsHash}, computed ${computedQuadsHash}`,
    }, 400);
  }

  // Create user runtime save record
  const result = await saveService.createRuntimeSave({
    saveId: metadata.saveId,
    stateNodeId: metadata.stateNodeId,
    stateNodeCommit: metadata.stateNodeCommit,
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
  await ctx.commit();

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

  return c.json(detailResult.data, 201);
});

// GET /saves — 获取存档列表（按 stateNodeId+stateNodeCommit 或 saveId 查询）
savesRoute.get('/', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);
  const { userId } = c.get('resourceAccess');

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListSavesQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const { stateNodeId, stateNodeCommit, saveId, author, page, limit } = validated;

  const hasStateNodeParams = stateNodeId && stateNodeCommit;
  const hasSaveIdParam = !!saveId;

  // oneOf 验证：必须提供其中一组
  if (hasStateNodeParams && hasSaveIdParam) {
    return c.json<ApiError>({ error: 'Cannot specify both stateNodeId/stateNodeCommit and saveId. Use one or the other.' }, 400);
  }
  if (!hasStateNodeParams && !hasSaveIdParam) {
    return c.json<ApiError>({ error: 'Must specify either stateNodeId+stateNodeCommit or saveId' }, 400);
  }

  const listParams = hasStateNodeParams
    ? { stateNodeId, stateNodeCommit, author, page, limit, userId: userId ?? undefined }
    : { saveId: saveId!, author, page, limit, userId: userId ?? undefined };

  const result = await saveService.listSaves(listParams);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<{ saves: typeof result.data.saves; pagination: Pagination }>(result.data);
});

// GET /saves/:commit — 获取存档详情（commit 全局唯一）
savesRoute.get('/:commit', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
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
      return c.json<ApiError>({ error: 'Save not found' }, 404);
    }
    return c.json<ApiError>({ error: 'Access denied' }, 403);
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

  await ctx.commit();

  // Note: R2 cleanup is deferred. Since we use content-addressed storage (quadsHash),
  // the same quads data may be shared by multiple saves. R2 objects should only be
  // deleted when refCount reaches 0, which should be handled by a background job
  // that periodically cleans up orphaned content.

  return c.body(null, 204);
});

// GET /saves/:commit/data — 下载 quads.bin（commit 全局唯一）
savesRoute.get('/:commit/data', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
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
      return c.json<ApiError>({ error: 'Save not found' }, 404);
    }
    return c.json<ApiError>({ error: 'Access denied' }, 403);
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
    return c.json<ApiError>({ error: 'Save data not found in storage' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
    },
  });
});
