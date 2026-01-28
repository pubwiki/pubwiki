/**
 * Cloud Saves API Routes (纯 Checkpoint 存储模式)
 * 
 * gamesave DO 不维护当前状态，只存储 checkpoint 快照
 * createCheckpoint 直接传入完整的 quads 数组
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, cloudSaves, eq, and } from '@pubwiki/db';
import type { ApiError, CloudSave, CreateSaveRequest, CreateCheckpointRequest, Quad } from '@pubwiki/api';
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

// POST /saves/:saveId/checkpoints - 创建 checkpoint (直接传入 quads 快照)
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

  let body: CreateCheckpointRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证 quads 数组
  if (!body.quads || !Array.isArray(body.quads)) {
    return c.json<ApiError>({ error: 'quads is required and must be an array' }, 400);
  }

  // 验证 visibility 参数
  if (body.visibility && !['PRIVATE', 'UNLISTED', 'PUBLIC'].includes(body.visibility)) {
    return c.json<ApiError>({ error: 'Invalid visibility value. Must be one of: PRIVATE, UNLISTED, PUBLIC' }, 400);
  }

  try {
    const checkpointId = await c.env.GAMESAVE.createCheckpoint(saveId, body.quads, {
      id: body.id,
      name: body.name,
      description: body.description,
      visibility: body.visibility,
    });

    // 更新 D1 中的 updatedAt
    await db.update(cloudSaves)
      .set({
        updatedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      })
      .where(eq(cloudSaves.id, saveId));

    return c.json({ success: true, id: checkpointId }, 201);
  } catch (error) {
    console.error('Failed to create checkpoint:', error);
    const message = error instanceof Error ? error.message : 'Failed to create checkpoint';
    return c.json<ApiError>({ error: message }, 400);
  }
});

// GET /saves/:saveId/checkpoints/:checkpointId - 获取单个 checkpoint 信息
savesRoute.get('/:saveId/checkpoints/:checkpointId', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');
  const checkpointId = c.req.param('checkpointId');

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
    const checkpoint = await c.env.GAMESAVE.getCheckpoint(saveId, checkpointId);
    if (!checkpoint) {
      return c.json<ApiError>({ error: 'Checkpoint not found' }, 404);
    }

    // 非 owner 只能访问非 PRIVATE 的 checkpoint
    if (!isOwner && checkpoint.visibility === 'PRIVATE') {
      return c.json<ApiError>({ error: 'Access denied' }, 403);
    }

    return c.json(checkpoint);
  } catch (error) {
    console.error('Failed to get checkpoint:', error);
    return c.json<ApiError>({ error: 'Failed to get checkpoint' }, 500);
  }
});

// GET /saves/:saveId/checkpoints/:checkpointId/export - 导出 checkpoint 数据
savesRoute.get('/:saveId/checkpoints/:checkpointId/export', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const saveId = c.req.param('saveId');
  const checkpointId = c.req.param('checkpointId');

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
    // 先获取 checkpoint 信息检查权限
    const checkpoint = await c.env.GAMESAVE.getCheckpoint(saveId, checkpointId);
    if (!checkpoint) {
      return c.json<ApiError>({ error: 'Checkpoint not found' }, 404);
    }

    // 非 owner 只能访问非 PRIVATE 的 checkpoint
    if (!isOwner && checkpoint.visibility === 'PRIVATE') {
      return c.json<ApiError>({ error: 'Access denied' }, 403);
    }

    const exportResult = await c.env.GAMESAVE.exportCheckpoint(saveId, checkpointId);
    if (!exportResult) {
      return c.json<ApiError>({ error: 'Checkpoint not found' }, 404);
    }

    return c.json({
      quads: exportResult.quads,
      quadCount: exportResult.quadCount,
    });
  } catch (error) {
    console.error('Failed to export checkpoint:', error);
    return c.json<ApiError>({ error: 'Failed to export checkpoint' }, 500);
  }
});

// PATCH /saves/:saveId/checkpoints/:checkpointId/visibility - 更新 checkpoint 可见性
savesRoute.patch('/:saveId/checkpoints/:checkpointId/visibility', authMiddleware, async (c) => {
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

  let body: { visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC' };
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.visibility || !['PRIVATE', 'UNLISTED', 'PUBLIC'].includes(body.visibility)) {
    return c.json<ApiError>({ error: 'Invalid visibility value. Must be one of: PRIVATE, UNLISTED, PUBLIC' }, 400);
  }

  try {
    const success = await c.env.GAMESAVE.updateCheckpointVisibility(saveId, checkpointId, body.visibility);
    if (!success) {
      return c.json<ApiError>({ error: 'Checkpoint not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to update checkpoint visibility:', error);
    return c.json<ApiError>({ error: 'Failed to update checkpoint visibility' }, 500);
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
