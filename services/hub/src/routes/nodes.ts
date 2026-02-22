import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, NodeVersionService, BatchContext } from '@pubwiki/db';
import type { GetNodeVersionsResponse, ApiError } from '@pubwiki/api';
import { optionalAuthMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { checkResourceAccess } from '../lib/access-control';
import { serviceErrorResponse } from '../lib/service-error';

const nodesRoute = new Hono<{ Bindings: Env }>();

// GET /nodes/:nodeId/versions - 获取节点版本（分页）
// Note: This is a listing operation, controlled by isListed (Discovery), NOT ACL
nodesRoute.get('/:nodeId/versions', optionalAuthMiddleware, async (c) => {
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

// GET /nodes/commits/:commit - 获取特定版本详情（commit 全局唯一）
nodesRoute.get('/commits/:commit', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const commit = c.req.param('commit');

  // ACL check: verify user can read this node version
  const accessError = await checkResourceAccess(c, { type: 'node', id: commit });
  if (accessError) return accessError;

  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);

  const result = await nodeVersionService.getVersion(commit);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json(result.data);
});

// GET /nodes/commits/:commit/children - 获取子版本（commit 全局唯一）
nodesRoute.get('/commits/:commit/children', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const commit = c.req.param('commit');

  // ACL check: verify user can read this node version
  const accessError = await checkResourceAccess(c, { type: 'node', id: commit });
  if (accessError) return accessError;

  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);

  const result = await nodeVersionService.getChildren(commit);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json({ versions: result.data });
});

// GET /nodes/commits/:commit/archive - 下载 VFS 归档文件（commit 全局唯一）
nodesRoute.get('/commits/:commit/archive', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const commit = c.req.param('commit');

  // ACL check: verify user can read this node version
  const accessError = await checkResourceAccess(c, { type: 'node', id: commit });
  if (accessError) return accessError;

  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);
  const versionResult = await nodeVersionService.getVersion(commit);

  if (!versionResult.success) {
    return serviceErrorResponse(c, versionResult.error);
  }

  const version = versionResult.data;
  
  // Only VFS nodes have archives
  if (version.type !== 'VFS') {
    return c.json<ApiError>({ error: 'Archive only available for VFS nodes' }, 400);
  }

  // Get filesHash from VFS content
  const content = version.content as { filesHash: string };
  if (!content.filesHash) {
    return c.json<ApiError>({ error: 'VFS node missing filesHash' }, 500);
  }

  const r2Key = `vfs/${content.filesHash}/files.tar.gz`;
  const object = await c.env.R2_BUCKET.get(r2Key);

  if (!object) {
    return c.json<ApiError>({ error: 'Archive not found in storage' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(object.size),
    },
  });
});

export { nodesRoute };
