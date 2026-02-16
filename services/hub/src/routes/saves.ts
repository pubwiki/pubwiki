import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, SaveService } from '@pubwiki/db';
import type { ApiError, Pagination } from '@pubwiki/api';
import { ListSavesQueryParams } from '@pubwiki/api/validate';
import { authMiddleware } from '../middleware/auth';
import { validateQuery, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';

export const savesRoute = new Hono<{ Bindings: Env }>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /saves — 创建存档（multipart: metadata JSON + quads.bin）
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

  // 解析 metadata JSON
  const metadataRaw = formData.get('metadata');
  if (!metadataRaw || typeof metadataRaw !== 'string') {
    return c.json<ApiError>({ error: 'metadata field is required and must be a JSON string' }, 400);
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return c.json<ApiError>({ error: 'metadata is not valid JSON' }, 400);
  }

  // 验证必填字段
  if (!metadata.stateNodeId || typeof metadata.stateNodeId !== 'string' || !UUID_RE.test(metadata.stateNodeId)) {
    return c.json<ApiError>({ error: 'stateNodeId is required and must be a valid UUID' }, 400);
  }
  if (!metadata.stateNodeCommit || typeof metadata.stateNodeCommit !== 'string') {
    return c.json<ApiError>({ error: 'stateNodeCommit is required and must be a string' }, 400);
  }
  if (!metadata.sourceArtifactCommit || typeof metadata.sourceArtifactCommit !== 'string') {
    return c.json<ApiError>({ error: 'sourceArtifactCommit is required and must be a string' }, 400);
  }
  if (!metadata.commit || typeof metadata.commit !== 'string') {
    return c.json<ApiError>({ error: 'commit is required and must be a string' }, 400);
  }
  if (!metadata.sourceArtifactId || typeof metadata.sourceArtifactId !== 'string' || !UUID_RE.test(metadata.sourceArtifactId)) {
    return c.json<ApiError>({ error: 'sourceArtifactId is required and must be a valid UUID' }, 400);
  }
  if (!metadata.contentHash || typeof metadata.contentHash !== 'string') {
    return c.json<ApiError>({ error: 'contentHash is required and must be a string' }, 400);
  }

  // 获取二进制文件
  const dataFile = formData.get('data');
  if (!dataFile || !(dataFile instanceof File)) {
    return c.json<ApiError>({ error: 'data field is required and must be a binary file' }, 400);
  }

  // 解析访问控制参数
  const isListed = metadata.isListed === 'true' || metadata.isListed === true;

  // 创建 save 记录（saveId 由服务端计算）
  const result = await saveService.createSave({
    stateNodeId: metadata.stateNodeId as string,
    stateNodeCommit: metadata.stateNodeCommit as string,
    sourceArtifactCommit: metadata.sourceArtifactCommit as string,
    commit: metadata.commit as string,
    parent: (metadata.parent as string) ?? null,
    authorId: user.id,
    sourceArtifactId: metadata.sourceArtifactId as string,
    contentHash: metadata.contentHash as string,
    title: metadata.title as string | undefined,
    description: metadata.description as string | undefined,
    isListed,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  // Upload quads.bin to R2 (commit is globally unique, used as key)
  const r2Key = saveService.getSaveDataKey(metadata.commit as string);
  const buffer = await dataFile.arrayBuffer();
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
savesRoute.get('/', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);

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
    ? { stateNodeId, stateNodeCommit, author, page, limit }
    : { saveId: saveId!, author, page, limit };

  const result = await saveService.listSaves(listParams);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<{ saves: typeof result.data.saves; pagination: Pagination }>(result.data);
});

// GET /saves/:commit — 获取存档详情（commit 全局唯一）
savesRoute.get('/:commit', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);

  const commit = c.req.param('commit');

  // 排除 commit 值看起来像 UUID 后面跟 /xxx 的情况（兼容旧路由）
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

  // 清理 R2
  try {
    await c.env.R2_BUCKET.delete(result.data.r2Key);
  } catch (err) {
    console.error('Failed to delete R2 object:', err);
    // 不阻塞响应，R2 清理失败不影响 DB 删除结果
  }

  return c.body(null, 204);
});

// GET /saves/:commit/data — 下载 quads.bin（commit 全局唯一）
savesRoute.get('/:commit/data', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const saveService = new SaveService(ctx);

  const commit = c.req.param('commit');

  // 先确认 save 存在并获取 saveId
  const saveResult = await saveService.getSave(commit);
  if (!saveResult.success) {
    return serviceErrorResponse(c, saveResult.error);
  }

  // 从 R2 获取
  const r2Key = saveService.getSaveDataKey(commit);
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
