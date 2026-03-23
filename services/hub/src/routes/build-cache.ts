import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, BuildCacheService } from '@pubwiki/db';
import { notFound } from '../lib/service-error';

const buildCacheRoute = new Hono<{ Bindings: Env }>();

// GET /build-cache/:cacheKey — return build cache metadata (releaseHash + fileHashes)
buildCacheRoute.get('/:cacheKey', async (c) => {
  const cacheKey = c.req.param('cacheKey');
  console.log(`[build-cache] GET /${cacheKey} — metadata request`);
  const db = createDb(c.env.DB);
  const buildCacheService = new BuildCacheService(db);

  const entry = await buildCacheService.get(cacheKey);
  if (!entry) {
    console.log(`[build-cache] GET /${cacheKey} — NOT FOUND`);
    return notFound(c, 'Build cache entry not found');
  }

  console.log(`[build-cache] GET /${cacheKey} — found: releaseHash=${entry.releaseHash}, fileHashes keys=${Object.keys(entry.fileHashes ?? {}).length}`);

  return c.json({
    cacheKey: entry.cacheKey,
    releaseHash: entry.releaseHash,
    fileHashes: entry.fileHashes,
  });
});

// GET /build-cache/:cacheKey/archive — download the build archive from R2
buildCacheRoute.get('/:cacheKey/archive', async (c) => {
  const cacheKey = c.req.param('cacheKey');
  console.log(`[build-cache] GET /${cacheKey}/archive — archive request`);
  const db = createDb(c.env.DB);
  const buildCacheService = new BuildCacheService(db);

  const entry = await buildCacheService.get(cacheKey);
  if (!entry) {
    console.log(`[build-cache] GET /${cacheKey}/archive — entry NOT FOUND in D1`);
    return notFound(c, 'Build cache entry not found');
  }

  // Fetch archive from R2 using the output-content-addressable releaseHash
  const r2Key = `builds/${entry.releaseHash}`;
  console.log(`[build-cache] GET /${cacheKey}/archive — fetching R2 key: ${r2Key}`);
  const object = await c.env.R2_BUCKET.get(r2Key);

  if (!object) {
    console.log(`[build-cache] GET /${cacheKey}/archive — R2 object NOT FOUND: ${r2Key}`);
    return notFound(c, 'Build archive not found in storage');
  }

  console.log(`[build-cache] GET /${cacheKey}/archive — serving ${object.size} bytes from R2`);

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
