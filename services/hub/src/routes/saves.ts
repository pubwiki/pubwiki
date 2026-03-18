import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, SaveService } from '@pubwiki/db';
import type { Pagination } from '@pubwiki/api';
import { computeSha256Hex, computeContentHash, computeNodeCommit } from '@pubwiki/api';
import { ListSavesQueryParams, CreateSaveBody, CreateSaveBatchBody } from '@pubwiki/api/validate';
import { authMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { validateQuery, validateFormDataJson, isValidationError } from '../lib/validate';
import { serviceErrorResponse, badRequest, forbidden, notFound, commitWithConflictHandling } from '../lib/service-error';
import { createAuditLogger } from '../lib/audit';

type Triple = { subject: string; predicate: string; object: string; graph?: string };

function applyDeltaToTriples(
  base: Triple[],
  delta: { inserts: Triple[]; deletes: Triple[] },
): Triple[] {
  const deleteSet = new Set(delta.deletes.map((t) => `${t.subject}\0${t.predicate}\0${t.object}\0${t.graph ?? ''}`));
  const filtered = base.filter((t) => !deleteSet.has(`${t.subject}\0${t.predicate}\0${t.object}\0${t.graph ?? ''}`));
  return [...filtered, ...delta.inserts];
}

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

  // Validate delta-specific constraints
  if (metadata.saveEncoding === 'delta') {
    if (!metadata.parentCommit) {
      return badRequest(c, 'parentCommit is required when saveEncoding is delta');
    }
    // Validate parent exists
    const detailCtxCheck = new BatchContext(createDb(c.env.DB));
    const checkService = new SaveService(detailCtxCheck);
    const parentResult = await checkService.getSave(metadata.parentCommit);
    if (!parentResult.success) {
      return badRequest(c, 'parentCommit must reference an existing save');
    }
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
    saveEncoding: metadata.saveEncoding,
    parentCommit: metadata.parentCommit ?? null,
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

  const save = saveResult.data;

  if (save.saveEncoding === 'keyframe') {
    // Keyframe: return data directly from R2
    const r2Key = `saves/${save.quadsHash}/quads.bin`;
    const object = await c.env.R2_BUCKET.get(r2Key);

    if (!object) {
      return notFound(c, 'Save data not found in storage');
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(object.size),
        // Content-addressed by quadsHash (immutable) — safe to cache aggressively
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Delta resolve: walk the chain back to the keyframe
  interface ChainEntry { quadsHash: string; saveEncoding: string }
  const chain: ChainEntry[] = [save];
  let current = save;
  while (current.saveEncoding === 'delta') {
    if (!current.parentCommit) {
      return badRequest(c, 'Broken delta chain: missing parentCommit');
    }
    const parentResult = await saveService.getSave(current.parentCommit);
    if (!parentResult.success) {
      return notFound(c, 'Broken delta chain: parent save not found');
    }
    current = parentResult.data;
    chain.unshift(current);
  }
  // chain[0] = keyframe, chain[1..n] = ordered delta chain

  // Load keyframe data
  const baseObject = await c.env.R2_BUCKET.get(`saves/${chain[0].quadsHash}/quads.bin`);
  if (!baseObject) {
    return notFound(c, 'Keyframe data not found in storage');
  }
  let triples: Array<{ subject: string; predicate: string; object: string; graph?: string }> = JSON.parse(await baseObject.text());

  // Apply each delta in order
  for (let i = 1; i < chain.length; i++) {
    const deltaObject = await c.env.R2_BUCKET.get(`saves/${chain[i].quadsHash}/quads.bin`);
    if (!deltaObject) {
      return notFound(c, `Delta data not found for chain entry ${i}`);
    }
    const deltaPayload: { delta: { inserts: typeof triples; deletes: typeof triples } } = JSON.parse(await deltaObject.text());
    triples = applyDeltaToTriples(triples, deltaPayload.delta);
  }

  const resolvedJson = JSON.stringify(triples);
  const resolvedData = new TextEncoder().encode(resolvedJson);

  return new Response(resolvedData, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(resolvedData.byteLength),
      // Resolved delta data is deterministic - can cache immutably
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// POST /saves/batch — 批量上传存档链（主路径：一次请求上传整条 keyframe + delta 链）
savesRoute.post('/batch', authMiddleware, async (c) => {
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
  const metadata = validateFormDataJson(c, formData, 'metadata', CreateSaveBatchBody.shape.metadata);
  if (metadata instanceof Response) return metadata;

  const { entries } = metadata;

  // Validate entries[0] is keyframe
  if (entries[0].saveEncoding !== 'keyframe') {
    return badRequest(c, 'First entry must be a keyframe');
  }

  // Validate subsequent entries are delta
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].saveEncoding !== 'delta') {
      return badRequest(c, `Entry ${i} must be a delta (only first entry can be keyframe)`);
    }
  }

  const saves: Array<{
    saveId: string;
    commit: string;
    parent: string | null;
    authorId: string;
    authoredAt: string;
    stateNodeId: string;
    artifactId: string;
    artifactCommit: string;
    quadsHash: string;
    saveEncoding: 'keyframe' | 'delta';
    parentCommit: string | null;
    title: string | null;
    description: string | null;
    isListed: boolean;
    createdAt: string;
  }> = [];
  let prevCommit: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Get binary data part
    const dataFile = formData.get(`data_${i}`);
    if (!dataFile || !(dataFile instanceof File)) {
      return badRequest(c, `data_${i} field is required and must be a binary file`);
    }

    const buffer = await dataFile.arrayBuffer();

    // Verify quadsHash
    const computedHash = await computeSha256Hex(buffer);
    if (computedHash !== entry.quadsHash) {
      return badRequest(c, `quadsHash mismatch at entry ${i}: expected ${entry.quadsHash}, computed ${computedHash}`);
    }

    // Derive parentCommit from chain order
    const parentCommit = entry.saveEncoding === 'delta' ? prevCommit : null;
    const saveId = crypto.randomUUID();

    // Compute contentHash and commit server-side
    const contentHash = await computeContentHash({
      type: 'SAVE',
      stateNodeId: metadata.stateNodeId,
      artifactId: metadata.artifactId,
      artifactCommit: metadata.artifactCommit,
      quadsHash: entry.quadsHash,
      saveEncoding: entry.saveEncoding as 'keyframe' | 'delta',
      parentCommit,
      title: entry.title ?? null,
      description: entry.description ?? null,
    });

    const commit = await computeNodeCommit(saveId, null, contentHash, 'SAVE');

    // Create save record
    const result = await saveService.createRuntimeSave({
      saveId,
      stateNodeId: metadata.stateNodeId,
      commit,
      parent: null,
      authorId: user.id,
      artifactId: metadata.artifactId,
      artifactCommit: metadata.artifactCommit,
      contentHash,
      quadsHash: entry.quadsHash,
      saveEncoding: entry.saveEncoding as 'keyframe' | 'delta',
      parentCommit,
      title: entry.title,
      description: entry.description,
      isListed: metadata.isListed,
    });

    if (!result.success) {
      return serviceErrorResponse(c, result.error);
    }

    // Upload to R2
    const r2Key = `saves/${entry.quadsHash}/quads.bin`;
    await c.env.R2_BUCKET.put(r2Key, buffer, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });

    prevCommit = commit;

    // We'll query the full detail after committing
    saves.push({
      saveId,
      commit,
      parent: null,
      authorId: user.id,
      authoredAt: new Date().toISOString(),
      stateNodeId: metadata.stateNodeId,
      artifactId: metadata.artifactId,
      artifactCommit: metadata.artifactCommit,
      quadsHash: entry.quadsHash,
      saveEncoding: entry.saveEncoding as 'keyframe' | 'delta',
      parentCommit,
      title: entry.title ?? null,
      description: entry.description ?? null,
      isListed: metadata.isListed ?? false,
      createdAt: new Date().toISOString(),
    });
  }

  // Commit all saves in one batch
  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Batch save was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.create('save', saves[0]?.commit ?? '', { batch: true, count: saves.length, artifactId: metadata.artifactId });

  return c.json({ saves }, 201);
});
