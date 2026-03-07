import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, BuildCacheService } from '@pubwiki/db';
import { notFound } from '../lib/service-error';

const buildCacheRoute = new Hono<{ Bindings: Env }>();

// GET /build-cache/:cacheKey — return build cache metadata (releaseHash + fileHashes)
buildCacheRoute.get('/:cacheKey', async (c) => {
  const cacheKey = c.req.param('cacheKey');
  const db = createDb(c.env.DB);
  const buildCacheService = new BuildCacheService(db);

  const entry = await buildCacheService.get(cacheKey);
  if (!entry) {
    return notFound(c, 'Build cache entry not found');
  }

  return c.json({
    cacheKey: entry.cacheKey,
    releaseHash: entry.releaseHash,
    fileHashes: entry.fileHashes,
  });
});

// GET /build-cache/:cacheKey/archive — download the build archive from R2
buildCacheRoute.get('/:cacheKey/archive', async (c) => {
  const cacheKey = c.req.param('cacheKey');
  const db = createDb(c.env.DB);
  const buildCacheService = new BuildCacheService(db);

  const entry = await buildCacheService.get(cacheKey);
  if (!entry) {
    return notFound(c, 'Build cache entry not found');
  }

  // Fetch archive from R2 using the output-content-addressable releaseHash
  const r2Key = `builds/${entry.releaseHash}`;
  const object = await c.env.R2_BUCKET.get(r2Key);

  if (!object) {
    return notFound(c, 'Build archive not found in storage');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(object.size),
      // Content-addressed and immutable — safe to cache aggressively
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

export { buildCacheRoute };
