import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, BuildCacheService, buildCache } from '@pubwiki/db';

describe('BuildCacheService', () => {
  let db: ReturnType<typeof createDb>;
  let service: BuildCacheService;

  beforeEach(async () => {
    db = createDb(env.DB);
    // Clear the build_cache table before each test
    await db.delete(buildCache);
    service = new BuildCacheService(db);
  });

  describe('get', () => {
    it('returns null for non-existent cacheKey', async () => {
      const result = await service.get('nonexistent-key');
      expect(result).toBeNull();
    });

    it('returns metadata for existing entry', async () => {
      // Insert directly into DB
      await db.insert(buildCache).values({
        cacheKey: 'test-key-1',
        releaseHash: 'release-hash-1',
        fileHashes: { 'index.js': 'abc123', 'index.css': 'def456' },
      });

      const result = await service.get('test-key-1');
      expect(result).not.toBeNull();
      expect(result!.cacheKey).toBe('test-key-1');
      expect(result!.releaseHash).toBe('release-hash-1');
      expect(result!.fileHashes).toEqual({
        'index.js': 'abc123',
        'index.css': 'def456',
      });
    });
  });

  describe('put', () => {
    it('inserts a new entry', async () => {
      const result = await service.put({
        cacheKey: 'new-key',
        releaseHash: 'new-release',
        fileHashes: { 'main.js': 'hash-main' },
      });

      expect(result.cacheKey).toBe('new-key');
      expect(result.releaseHash).toBe('new-release');
      expect(result.fileHashes).toEqual({ 'main.js': 'hash-main' });

      // Verify it's in the DB
      const fetched = await service.get('new-key');
      expect(fetched).not.toBeNull();
      expect(fetched!.releaseHash).toBe('new-release');
    });

    it('returns existing entry on duplicate (first-write-wins)', async () => {
      // First write
      await service.put({
        cacheKey: 'dup-key',
        releaseHash: 'first-release',
        fileHashes: { 'index.js': 'first-hash' },
      });

      // Second write with different data — should be a no-op
      const result = await service.put({
        cacheKey: 'dup-key',
        releaseHash: 'second-release',
        fileHashes: { 'index.js': 'second-hash' },
      });

      // Should return the first entry, not the second
      expect(result.releaseHash).toBe('first-release');
      expect(result.fileHashes).toEqual({ 'index.js': 'first-hash' });
    });

    it('does not overwrite existing entry', async () => {
      await service.put({
        cacheKey: 'stable-key',
        releaseHash: 'original-release',
        fileHashes: { 'app.js': 'orig-hash' },
      });

      // Attempt to overwrite
      await service.put({
        cacheKey: 'stable-key',
        releaseHash: 'new-release',
        fileHashes: { 'app.js': 'new-hash' },
      });

      // Verify DB still has original
      const fetched = await service.get('stable-key');
      expect(fetched!.releaseHash).toBe('original-release');
      expect(fetched!.fileHashes).toEqual({ 'app.js': 'orig-hash' });
    });

    it('handles empty fileHashes', async () => {
      const result = await service.put({
        cacheKey: 'empty-hashes',
        releaseHash: 'release-empty',
        fileHashes: {},
      });

      expect(result.fileHashes).toEqual({});

      const fetched = await service.get('empty-hashes');
      expect(fetched!.fileHashes).toEqual({});
    });

    it('handles complex fileHashes with multiple files', async () => {
      const fileHashes = {
        'index.js': 'aaa111',
        'index.css': 'bbb222',
        'vendor.js': 'ccc333',
        'styles/main.css': 'ddd444',
      };

      const result = await service.put({
        cacheKey: 'complex-key',
        releaseHash: 'complex-release',
        fileHashes,
      });

      expect(result.fileHashes).toEqual(fileHashes);
    });
  });

  describe('multiple entries', () => {
    it('stores and retrieves multiple independent entries', async () => {
      await service.put({
        cacheKey: 'key-a',
        releaseHash: 'release-a',
        fileHashes: { 'a.js': 'hash-a' },
      });

      await service.put({
        cacheKey: 'key-b',
        releaseHash: 'release-b',
        fileHashes: { 'b.js': 'hash-b' },
      });

      const a = await service.get('key-a');
      const b = await service.get('key-b');

      expect(a!.releaseHash).toBe('release-a');
      expect(b!.releaseHash).toBe('release-b');
    });
  });
});
