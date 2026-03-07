import { describe, it, expect, beforeEach } from 'vitest';
import { buildCache } from '@pubwiki/db';
import { sendRequest, getTestDb, getTestR2Bucket, type TestDb } from './helpers';

describe('Build Cache API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await db.delete(buildCache);
  });

  // --------------------------------------------------------------------------
  // GET /api/build-cache/:cacheKey
  // --------------------------------------------------------------------------

  describe('GET /api/build-cache/:cacheKey', () => {
    it('returns 404 for non-existent cache key', async () => {
      const res = await sendRequest(
        new Request('http://localhost/api/build-cache/nonexistent-key')
      );
      expect(res.status).toBe(404);
    });

    it('returns metadata for existing cache entry', async () => {
      await db.insert(buildCache).values({
        cacheKey: 'test-key',
        releaseHash: 'release-abc',
        fileHashes: { 'index.js': 'hash-1', 'index.css': 'hash-2' },
      });

      const res = await sendRequest(
        new Request('http://localhost/api/build-cache/test-key')
      );
      expect(res.status).toBe(200);

      const body = await res.json<{
        cacheKey: string;
        releaseHash: string;
        fileHashes: Record<string, string>;
      }>();
      expect(body.cacheKey).toBe('test-key');
      expect(body.releaseHash).toBe('release-abc');
      expect(body.fileHashes).toEqual({
        'index.js': 'hash-1',
        'index.css': 'hash-2',
      });
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/build-cache/:cacheKey/archive
  // --------------------------------------------------------------------------

  describe('GET /api/build-cache/:cacheKey/archive', () => {
    it('returns 404 when cache entry does not exist', async () => {
      const res = await sendRequest(
        new Request('http://localhost/api/build-cache/no-entry/archive')
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when R2 object does not exist', async () => {
      // Insert DB entry but don't put anything in R2
      await db.insert(buildCache).values({
        cacheKey: 'orphan-key',
        releaseHash: 'orphan-release',
        fileHashes: { 'index.js': 'hash-orphan' },
      });

      const res = await sendRequest(
        new Request('http://localhost/api/build-cache/orphan-key/archive')
      );
      expect(res.status).toBe(404);
    });

    it('returns archive from R2 with correct headers', async () => {
      const releaseHash = 'release-with-archive';
      const archiveContent = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // fake gzip header

      // Put in DB
      await db.insert(buildCache).values({
        cacheKey: 'archive-key',
        releaseHash,
        fileHashes: { 'index.js': 'hash-archive' },
      });

      // Put in R2
      const r2 = getTestR2Bucket();
      await r2.put(`builds/${releaseHash}`, archiveContent);

      const res = await sendRequest(
        new Request('http://localhost/api/build-cache/archive-key/archive')
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/gzip');
      expect(res.headers.get('Cache-Control')).toContain('immutable');

      const body = new Uint8Array(await res.arrayBuffer());
      expect(body).toEqual(archiveContent);
    });
  });
});
