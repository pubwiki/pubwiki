/**
 * Cloud Saves API Routes
 * 
 * 处理云端存档的 CRUD 操作，通过 Service Binding 调用 gamesave Worker
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, cloudSaves, eq, and } from '@pubwiki/db';
import type {
  ApiError,
  CloudSave,
  CreateSaveRequest,
  SyncOperationsRequest,
  SyncOperationsResponse,
} from '@pubwiki/api';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';

export const savesRoute = new Hono<{ Bindings: Env }>();

// UUID 验证正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 验证用户对存档的访问权限
 */
async function verifySaveAccess(
  db: ReturnType<typeof createDb>,
  saveId: string,
  userId: string
): Promise<{ save: typeof cloudSaves.$inferSelect | null; error?: string }> {
  const [save] = await db.select().from(cloudSaves)
    .where(eq(cloudSaves.id, saveId))
    .limit(1);

  if (!save) {
    return { save: null, error: 'Save not found' };
  }

  if (save.userId !== userId) {
    return { save: null, error: 'Access denied' };
  }

  return { save };
}

// ============ 存档列表和创建 ============

// GET /saves - 获取用户的所有存档列表
savesRoute.get('/', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');

  const saves = await db.select().from(cloudSaves)
    .where(eq(cloudSaves.userId, user.id))
    .orderBy(cloudSaves.updatedAt);

  const result: CloudSave[] = saves.map(save => ({
    id: save.id,
    userId: save.userId,
    stateNodeId: save.stateNodeId,
    name: save.name,
    description: save.description,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    lastSyncedAt: save.lastSyncedAt,
  }));

  return c.json({ saves: result });
});

// GET /saves/by-state/:stateNodeId - 根据 stateNodeId 获取 saveId
savesRoute.get('/by-state/:stateNodeId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const stateNodeId = c.req.param('stateNodeId');

  if (!UUID_REGEX.test(stateNodeId)) {
    return c.json<ApiError>({ error: 'Invalid stateNodeId format' }, 400);
  }

  const [save] = await db.select()
    .from(cloudSaves)
    .where(and(
      eq(cloudSaves.userId, user.id),
      eq(cloudSaves.stateNodeId, stateNodeId)
    ))
    .limit(1);

  if (!save) {
    return c.json<ApiError>({ error: 'Save not found' }, 404);
  }

  return c.json({ id: save.id });
});

// POST /saves - 创建新存档
savesRoute.post('/', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');

  let body: CreateSaveRequest;
  try {
    body = await c.req.json<CreateSaveRequest>();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证必填字段
  if (!body.name || typeof body.name !== 'string') {
    return c.json<ApiError>({ error: 'name is required and must be a string' }, 400);
  }
  if (body.name.length < 1 || body.name.length > 200) {
    return c.json<ApiError>({ error: 'name must be between 1 and 200 characters' }, 400);
  }

  // 验证 stateNodeId（必需）
  if (!body.stateNodeId || typeof body.stateNodeId !== 'string') {
    return c.json<ApiError>({ error: 'stateNodeId is required' }, 400);
  }
  if (!UUID_REGEX.test(body.stateNodeId)) {
    return c.json<ApiError>({ error: 'Invalid stateNodeId format' }, 400);
  }

  // 生成存档 ID
  const saveId = crypto.randomUUID();

  // 在 D1 中创建索引记录
  try {
    const [newSave] = await db.insert(cloudSaves).values({
      id: saveId,
      userId: user.id,
      stateNodeId: body.stateNodeId,
      name: body.name,
      description: body.description ?? null,
    }).returning();

    // 初始化 Durable Object
    try {
      await c.env.GAMESAVE.initializeSave(
        saveId,
        user.id,
        body.stateNodeId
      );
    } catch (error) {
      // 如果 DO 初始化失败，删除索引记录
      await db.delete(cloudSaves).where(eq(cloudSaves.id, saveId));
      console.error('Failed to initialize save DO:', error);
      return c.json<ApiError>({ error: 'Failed to create save' }, 500);
    }

    const result: CloudSave = {
      id: newSave.id,
      userId: newSave.userId,
      stateNodeId: newSave.stateNodeId,
      name: newSave.name,
      description: newSave.description,
      createdAt: newSave.createdAt,
      updatedAt: newSave.updatedAt,
      lastSyncedAt: newSave.lastSyncedAt,
    };

    return c.json(result, 201);
  } catch (error: unknown) {
    // 处理唯一约束冲突
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json<ApiError>({ error: 'Save already exists for this stateNodeId' }, 409);
    }
    throw error;
  }
});

// ============ 单个存档操作 ============

// DELETE /saves/:saveId - 删除存档
savesRoute.delete('/:saveId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const { save, error } = await verifySaveAccess(db, saveId, user.id);
  if (!save) {
    if (error === 'Access denied') {
      return c.json<ApiError>({ error }, 403);
    }
    return c.json<ApiError>({ error: error || 'Save not found' }, 404);
  }

  // 清空 DO 数据
  try {
    await c.env.GAMESAVE.clearSave(saveId);
  } catch (error) {
    console.error('Failed to clear save DO:', error);
  }

  // 删除 D1 索引记录
  await db.delete(cloudSaves).where(eq(cloudSaves.id, saveId));

  return c.body(null, 204);
});

// ============ 可验证同步 ============

// POST /saves/:saveId/sync - 可验证的批量同步操作
savesRoute.post('/:saveId/sync', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const { save, error } = await verifySaveAccess(db, saveId, user.id);
  if (!save) {
    if (error === 'Access denied') {
      return c.json<ApiError>({ error }, 403);
    }
    return c.json<ApiError>({ error: error || 'Save not found' }, 404);
  }

  let body: SyncOperationsRequest;
  try {
    body = await c.req.json<SyncOperationsRequest>();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.baseRef || typeof body.baseRef !== 'string') {
    return c.json<ApiError>({ error: 'baseRef is required' }, 400);
  }

  if (!body.operations || !Array.isArray(body.operations)) {
    return c.json<ApiError>({ error: 'operations must be an array' }, 400);
  }

  try {
    const syncResult = await c.env.GAMESAVE.syncOperations(
      saveId,
      body.baseRef,
      body.operations
    );

    // 如果成功，更新 D1 中的 updatedAt 和 lastSyncedAt（不再更新 currentRef）
    if (syncResult.success && syncResult.finalRef) {
      await db.update(cloudSaves)
        .set({
          updatedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
        })
        .where(eq(cloudSaves.id, saveId));
    }

    // 返回状态码：成功返回 200，验证失败返回 400
    const statusCode = syncResult.success ? 200 : 400;
    return c.json(syncResult as SyncOperationsResponse, statusCode);
  } catch (error) {
    console.error('Failed to sync operations:', error);
    const result: SyncOperationsResponse = {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to sync operations',
    };
    return c.json(result, 500);
  }
});

// ============ 版本历史 ============

// GET /saves/:saveId/history - 获取版本历史
savesRoute.get('/:saveId/history', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const { save, error } = await verifySaveAccess(db, saveId, user.id);
  if (!save) {
    if (error === 'Access denied') {
      return c.json<ApiError>({ error }, 403);
    }
    return c.json<ApiError>({ error: error || 'Save not found' }, 404);
  }

  const query = c.req.query();
  const limit = query.limit ? Math.min(Math.max(parseInt(query.limit, 10), 1), 200) : 50;

  try {
    const versions = await c.env.GAMESAVE.getHistory(saveId, limit);

    return c.json({
      versions,
    });
  } catch (error) {
    console.error('Failed to get history:', error);
    return c.json<ApiError>({ error: 'Failed to get history' }, 500);
  }
});

// ============ 导出历史版本 ============

// GET /saves/:saveId/export/:ref - 导出任意 ref 处的数据
// 支持非 owner 访问：需要 ref 有对应的非 PRIVATE checkpoint
savesRoute.get('/:saveId/export/:ref', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');
  const ref = c.req.param('ref');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const [save] = await db.select().from(cloudSaves)
    .where(eq(cloudSaves.id, saveId))
    .limit(1);

  if (!save) {
    return c.json<ApiError>({ error: 'Save not found' }, 404);
  }

  const isOwner = user?.id === save.userId;

  // 非 owner 需要验证：ref 必须有非 PRIVATE 的 checkpoint
  if (!isOwner) {
    const isPubliclyAccessible = await c.env.GAMESAVE.isRefPubliclyAccessible(saveId, ref);
    if (!isPubliclyAccessible) {
      return c.json<ApiError>({ error: 'Access denied' }, 403);
    }
  }

  try {
    const exportResult = await c.env.GAMESAVE.exportAtRef(saveId, ref);
    return c.json({
      data: exportResult.data,
      ref: exportResult.ref,
      quadCount: exportResult.quadCount,
    });
  } catch (error) {
    console.error('Failed to export at ref:', error);
    const message = error instanceof Error ? error.message : 'Failed to export at ref';
    return c.json<ApiError>({ error: message }, 400);
  }
});

// ============ Checkpoint API ============

// GET /saves/:saveId/checkpoints - 获取 checkpoints
// 支持非 owner 访问：非 owner 只能看到 PUBLIC 的 checkpoints
savesRoute.get('/:saveId/checkpoints', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const [save] = await db.select().from(cloudSaves)
    .where(eq(cloudSaves.id, saveId))
    .limit(1);

  if (!save) {
    return c.json<ApiError>({ error: 'Save not found' }, 404);
  }

  const isOwner = user?.id === save.userId;

  try {
    const checkpoints = await c.env.GAMESAVE.listCheckpoints(
      saveId,
      isOwner ? 'owner' : 'public'
    );
    return c.json({ checkpoints });
  } catch (error) {
    console.error('Failed to list checkpoints:', error);
    return c.json<ApiError>({ error: 'Failed to list checkpoints' }, 500);
  }
});

// POST /saves/:saveId/checkpoints - 创建 checkpoint
savesRoute.post('/:saveId/checkpoints', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const { save, error } = await verifySaveAccess(db, saveId, user.id);
  if (!save) {
    if (error === 'Access denied') {
      return c.json<ApiError>({ error }, 403);
    }
    return c.json<ApiError>({ error: error || 'Save not found' }, 404);
  }

  let body: { ref: string; id?: string; name?: string; description?: string; visibility?: 'PRIVATE' | 'UNLISTED' | 'PUBLIC' };
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.ref || typeof body.ref !== 'string') {
    return c.json<ApiError>({ error: 'ref is required' }, 400);
  }

  // 验证 visibility 参数
  if (body.visibility && !['PRIVATE', 'UNLISTED', 'PUBLIC'].includes(body.visibility)) {
    return c.json<ApiError>({ error: 'Invalid visibility value. Must be one of: PRIVATE, UNLISTED, PUBLIC' }, 400);
  }

  try {
    const checkpointId = await c.env.GAMESAVE.createCheckpoint(saveId, body.ref, {
      id: body.id,
      name: body.name,
      description: body.description,
      visibility: body.visibility,
    });
    return c.json({ success: true, id: checkpointId }, 201);
  } catch (error) {
    console.error('Failed to create checkpoint:', error);
    const message = error instanceof Error ? error.message : 'Failed to create checkpoint';
    return c.json<ApiError>({ error: message }, 400);
  }
});

// DELETE /saves/:saveId/checkpoints/:checkpointId - 删除 checkpoint
savesRoute.delete('/:saveId/checkpoints/:checkpointId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');
  const checkpointId = c.req.param('checkpointId');

  if (!UUID_REGEX.test(saveId)) {
    return c.json<ApiError>({ error: 'Invalid save ID format' }, 400);
  }

  const { save, error } = await verifySaveAccess(db, saveId, user.id);
  if (!save) {
    if (error === 'Access denied') {
      return c.json<ApiError>({ error }, 403);
    }
    return c.json<ApiError>({ error: error || 'Save not found' }, 404);
  }

  try {
    const deleted = await c.env.GAMESAVE.deleteCheckpoint(saveId, checkpointId);
    if (!deleted) {
      return c.json<ApiError>({ error: 'Checkpoint not found' }, 404);
    }
    return c.body(null, 204);
  } catch (error) {
    console.error('Failed to delete checkpoint:', error);
    return c.json<ApiError>({ error: 'Failed to delete checkpoint' }, 500);
  }
});