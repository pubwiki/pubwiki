import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, NodeVersionService, BatchContext } from '@pubwiki/db';
import type { GetNodeVersionsResponse } from '@pubwiki/api';

import { resourceAccessMiddleware } from '../middleware/resource-access';
import { checkResourceAccess } from '../lib/access-control';
import { serviceErrorResponse, badRequest, notFound, internalError } from '../lib/service-error';

const nodesRoute = new Hono<{ Bindings: Env }>();

// GET /nodes/:nodeId/versions - 获取节点版本（分页）
// Note: This is a listing operation, controlled by isListed (Discovery), NOT ACL
// Authors can see all their versions, others can only see listed versions
nodesRoute.get('/:nodeId/versions', resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);
  const user = c.get('user');
  const nodeId = c.req.param('nodeId');
  const cursor = c.req.query('cursor') || undefined;
  const limitStr = c.req.query('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const result = await nodeVersionService.getVersions(nodeId, { 
    cursor, 
    limit,
    viewerId: user?.id,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<GetNodeVersionsResponse>({
    versions: result.data.versions,
    nextCursor: result.data.nextCursor,
  });
});

// GET /nodes/commits/:commit - 获取特定版本详情（commit 全局唯一）
nodesRoute.get('/commits/:commit', resourceAccessMiddleware, async (c) => {
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
nodesRoute.get('/commits/:commit/children', resourceAccessMiddleware, async (c) => {
  const commit = c.req.param('commit');

  // ACL check: verify user can read this node version
  const accessError = await checkResourceAccess(c, { type: 'node', id: commit });
  if (accessError) return accessError;

  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);

  const result = await nodeVersionService.getChildren(commit);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json({ versions: result.data });
});

// GET /nodes/commits/:commit/archive - 下载 VFS 归档文件（commit 全局唯一）
nodesRoute.get('/commits/:commit/archive', resourceAccessMiddleware, async (c) => {
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
    return badRequest(c, 'Archive only available for VFS nodes');
  }

  // Get filesHash from VFS content
  const content = version.content as { filesHash: string };
  if (!content.filesHash) {
    return internalError(c, 'VFS node missing filesHash');
  }

  const r2Key = `vfs/${content.filesHash}/files.tar.gz`;
  const object = await c.env.R2_BUCKET.get(r2Key);

  if (!object) {
    return notFound(c, 'Archive not found in storage');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(object.size),
    },
  });
});

export { nodesRoute };
