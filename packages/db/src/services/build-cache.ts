import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { buildCache } from '../schema/build-cache';

/** Result of looking up build cache metadata */
export interface BuildCacheMetadata {
  cacheKey: string;
  releaseHash: string;
  fileHashes: Record<string, string>;
}

/**
 * BuildCacheService — manages the build_cache table.
 *
 * Uses a plain Database connection (not BatchContext) because:
 * - get() is a simple read that should execute immediately
 * - put() needs read-then-write atomicity with immediate execution
 *
 * Implements first-write-wins semantics:
 * - If a cache_key already exists, skip writing (the existing entry is equivalent).
 * - If it doesn't exist, insert a new row.
 *
 * This ensures all consumers see consistent fileHashes and releaseHash
 * without the risk of overwriting and invalidating already-cached data.
 */
export class BuildCacheService {
  constructor(private db: Database) {}

  /**
   * Look up build cache metadata by cacheKey.
   * Returns releaseHash + fileHashes if found, null otherwise.
   */
  async get(cacheKey: string): Promise<BuildCacheMetadata | null> {
    const rows = await this.db
      .select()
      .from(buildCache)
      .where(eq(buildCache.cacheKey, cacheKey))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      cacheKey: row.cacheKey,
      releaseHash: row.releaseHash,
      fileHashes: row.fileHashes,
    };
  }

  /**
   * Store build cache metadata (first-write-wins).
   *
   * If cacheKey already exists, this is a no-op and returns the existing entry.
   * If it doesn't exist, inserts a new row.
   *
   * Uses INSERT ... ON CONFLICT DO NOTHING to avoid TOCTOU race conditions
   * when concurrent requests attempt to write the same cacheKey.
   *
   * @returns The metadata that is now in the database (either existing or newly inserted).
   */
  async put(params: {
    cacheKey: string;
    releaseHash: string;
    fileHashes: Record<string, string>;
  }): Promise<BuildCacheMetadata> {
    // Atomic first-write-wins: INSERT ignores conflict on PK (cacheKey).
    // If a concurrent writer already inserted, this is a no-op.
    await this.db
      .insert(buildCache)
      .values({
        cacheKey: params.cacheKey,
        releaseHash: params.releaseHash,
        fileHashes: params.fileHashes,
      })
      .onConflictDoNothing();

    // Re-read to return the committed row (may be ours or a concurrent writer's).
    const row = await this.db
      .select()
      .from(buildCache)
      .where(eq(buildCache.cacheKey, params.cacheKey))
      .limit(1);

    // Should always exist after the INSERT above, but guard defensively.
    if (row.length === 0) {
      return { cacheKey: params.cacheKey, releaseHash: params.releaseHash, fileHashes: params.fileHashes };
    }

    return {
      cacheKey: row[0].cacheKey,
      releaseHash: row[0].releaseHash,
      fileHashes: row[0].fileHashes,
    };
  }
}
