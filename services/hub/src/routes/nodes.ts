import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, NodeVersionService } from '@pubwiki/db';
import type { ApiError, GetNodeVersionsResponse } from '@pubwiki/api';
import { authMiddleware } from '../middleware/auth';

const nodesRoute = new Hono<{ Bindings: Env }>();

// GET /nodes/:nodeId/versions - 获取节点版本（分页）
nodesRoute.get('/:nodeId/versions', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const nodeVersionService = new NodeVersionService(db);
  const nodeId = c.req.param('nodeId');
  const cursor = c.req.query('cursor') || undefined;
  const limitStr = c.req.query('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const result = await nodeVersionService.getVersions(nodeId, { cursor, limit });

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<GetNodeVersionsResponse>({
    versions: result.data.versions,
    nextCursor: result.data.nextCursor,
  });
});



export { nodesRoute };
