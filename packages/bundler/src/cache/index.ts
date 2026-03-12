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

/** Metadata for a build cache entry, persisted in index.json. */
export interface BuildCacheMetadata {
  buildCacheKey: string
  filesHash: string
  totalSize: number           // sum of all file sizes (for LRU eviction)
  builtAt: number
  lastAccessedAt: number
  fileHashes?: Record<string, string>  // { [filePath]: sha256hex }
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
 */
export interface BuildCacheStorage {
  put(key: string, manifest: BuildManifest, files: BuildCacheFile[], metadata: BuildCacheMetadata): Promise<void>
  get(key: string): Promise<BuildCacheEntry | null>
  has(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  list(): Promise<BuildCacheMetadata[]>
  readFile(key: string, filePath: string): Promise<Uint8Array | null>
  evict(options?: { maxTotalSize?: number; maxEntries?: number }): Promise<number>
  updateMetadata(key: string, updates: Partial<BuildCacheMetadata>): Promise<void>
}
