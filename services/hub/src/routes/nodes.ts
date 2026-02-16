import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, NodeVersionService, BatchContext } from '@pubwiki/db';
import type { GetNodeVersionsResponse } from '@pubwiki/api';
import { authMiddleware } from '../middleware/auth';
import { serviceErrorResponse } from '../lib/service-error';

const nodesRoute = new Hono<{ Bindings: Env }>();

// GET /nodes/:nodeId/versions - 获取节点版本（分页）
nodesRoute.get('/:nodeId/versions', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);
  const nodeId = c.req.param('nodeId');
  const cursor = c.req.query('cursor') || undefined;
  const limitStr = c.req.query('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const result = await nodeVersionService.getVersions(nodeId, { cursor, limit });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<GetNodeVersionsResponse>({
    versions: result.data.versions,
    nextCursor: result.data.nextCursor,
  });
});



export { nodesRoute };
