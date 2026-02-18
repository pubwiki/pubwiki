import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, NodeVersionService, BatchContext } from '@pubwiki/db';
import type { ApiError } from '@pubwiki/api';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { serviceErrorResponse } from '../lib/service-error';

const versionsRoute = new Hono<{ Bindings: Env }>();

// GET /versions/:commit - 获取特定版本详情（commit 全局唯一）
versionsRoute.get('/:commit', authMiddleware, async (c) => {
  const commit = c.req.param('commit');
  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);

  const result = await nodeVersionService.getVersion(commit);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json(result.data);
});

// GET /versions/:commit/children - 获取子版本（commit 全局唯一）
versionsRoute.get('/:commit/children', authMiddleware, async (c) => {
  const commit = c.req.param('commit');
  const ctx = new BatchContext(createDb(c.env.DB));
  const nodeVersionService = new NodeVersionService(ctx);

  const result = await nodeVersionService.getChildren(commit);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json({ versions: result.data });
});

// GET /versions/:commit/archive - 下载 VFS 归档文件（commit 全局唯一）
versionsRoute.get('/:commit/archive', optionalAuthMiddleware, async (c) => {
  const commit = c.req.param('commit');

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

export { versionsRoute };
