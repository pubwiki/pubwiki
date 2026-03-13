/**
 * BuildCacheStorage — persistent build cache layer.
 *
 * Provides a storage-agnostic interface for caching build outputs (JS/CSS files)
 * keyed by `buildCacheKey` (input-content-addressable SHA-256).
 *
 * Implementations:
 *   - OpfsBuildCacheStorage  — OPFS-backed (best performance, modern browsers)
 *   - IdbBuildCacheStorage   — IndexedDB-backed (wide compatibility fallback)
 */

import type { BuildManifest } from '../types/result'

// ============================================================================
// Types
// ============================================================================

/** A single file to store in the build cache. */
export interface BuildCacheFile {
  path: string         // e.g. 'index.js', 'index.css'
  content: Uint8Array
}

/** Metadata for a build cache entry, persisted alongside each builds/<key>/meta.json. */
export interface BuildCacheMetadata {
  buildCacheKey: string
  filesHash: string
  totalSize: number           // sum of all file sizes (for LRU eviction)
  builtAt: number
  lastAccessedAt: number
  /** VFS file paths in the dependency graph — used for smart stale detection & cache matching. */
  dependencies: string[]
  /** Per-file hashes at build time — { [filePath]: oid }. Used by resolve() for dep matching. */
  fileHashes: Record<string, string>
  /** SHA-256 of build config (entryFiles + target + jsx + ...) — used to filter candidates in dep matching. */
  configKey: string
  verified?: boolean                    // whether local files passed integrity check (session-scoped)
}

/** Entry returned by get() — manifest + metadata, no storage-specific handles. */
export interface BuildCacheEntry {
  manifest: BuildManifest
  metadata: BuildCacheMetadata
}

// ============================================================================
// BuildCacheStorage Interface
// ============================================================================

/**
 * Storage-agnostic interface for build output caching.
 * Implemented by OpfsBuildCacheStorage (OPFS) and IdbBuildCacheStorage (IndexedDB).
 *
 * Storage layout (logical):
 *   dists/<distKey>/          — actual build output files + manifest.json
 *   builds/<buildCacheKey>/   — dist (pointer) + meta.json (metadata)
 *   http/<url-hash>           — HTTP content cache
 *   cdn/<pkg-hash>            — CDN URL resolution cache
 *   transforms/<path-hash>    — Transform cache
 */
export interface BuildCacheStorage {
  // ---- Build output cache ----
  put(key: string, manifest: BuildManifest, files: BuildCacheFile[], metadata: BuildCacheMetadata): Promise<void>
  get(key: string): Promise<BuildCacheEntry | null>
  has(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  list(): Promise<BuildCacheMetadata[]>
  readFile(key: string, filePath: string): Promise<Uint8Array | null>
  evict(options?: { maxTotalSize?: number; maxEntries?: number }): Promise<number>
  updateMetadata(key: string, updates: Partial<BuildCacheMetadata>): Promise<void>

  /**
   * Smart cache resolution with dependency-aware matching.
   *
   * 1. Direct hit: builds/<key>/dist exists → return cached entry
   * 2. Dep match: scan all builds/. For each with matching configKey,
   *    check if ALL dependency file hashes match → reuse existing distKey
   * 3. Miss: return null → caller must rebuild
   */
  resolve(buildCacheKey: string, fileHashes: Record<string, string>): Promise<BuildCacheEntry | null>

  // ---- HTTP content cache (replaces BundleCache) ----
  getHttp(url: string): Promise<{ content: string; contentType: string } | null>
  setHttp(url: string, content: string, contentType: string): Promise<void>

  // ---- CDN URL resolution cache (replaces DependencyResolver.cdnCache) ----
  getCdnUrl(packageName: string): Promise<string | null>
  setCdnUrl(packageName: string, resolvedUrl: string): Promise<void>

  // ---- Transform cache (replaces BundleCache transform cache) ----
  getTransform(key: string): Promise<unknown | null>
  setTransform(key: string, value: unknown): Promise<void>
  deleteTransform(key: string): Promise<void>
  clearTransformCache(): Promise<void>
}
