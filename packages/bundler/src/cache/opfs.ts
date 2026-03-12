/**
 * OpfsBuildCacheStorage — OPFS-backed build cache implementation.
 *
 * Stores build outputs (JS/CSS files) individually in OPFS for zero-decompression
 * reads. Each build is keyed by `buildCacheKey` (input-content-addressable SHA-256).
 *
 * OPFS layout:
 *   __build_cache__/
 *     index.json              — metadata index (all entries)
 *     <buildCacheKey>/
 *       manifest.json         — build manifest with entry→output mapping
 *       src/                  — mirrors source directory structure
 *         index.js            — compiled JS
 *         index.css           — compiled CSS (optional)
 */

import type { BuildManifest } from '../types/result'
import type {
  BuildCacheStorage,
  BuildCacheFile,
  BuildCacheMetadata,
  BuildCacheEntry,
} from './index'

// ============================================================================
// OpfsBuildCacheStorage
// ============================================================================

const BUILD_CACHE_DIR = '__build_cache__'
const INDEX_FILE = 'index.json'
const MANIFEST_FILE = 'manifest.json'

export class OpfsBuildCacheStorage implements BuildCacheStorage {
  private rootHandle: FileSystemDirectoryHandle | null = null
  /** In-memory copy of the metadata index, loaded once per session. */
  private index: Map<string, BuildCacheMetadata> = new Map()
  private indexLoaded = false

  // ---- Lifecycle ----

  /** Ensure OPFS root + index are loaded. Idempotent — safe to call multiple times. */
  private async ensureInitialized(): Promise<FileSystemDirectoryHandle> {
    if (this.rootHandle && this.indexLoaded) return this.rootHandle

    const opfsRoot = await navigator.storage.getDirectory()
    this.rootHandle = await opfsRoot.getDirectoryHandle(BUILD_CACHE_DIR, { create: true })
    await this.loadIndex()
    return this.rootHandle
  }

  /** Load metadata index from OPFS index.json into memory. */
  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return
    try {
      const root = this.rootHandle!
      const fileHandle = await root.getFileHandle(INDEX_FILE)
      const file = await fileHandle.getFile()
      const text = await file.text()
      const entries: BuildCacheMetadata[] = JSON.parse(text)
      this.index = new Map(entries.map(e => [e.buildCacheKey, e]))
    } catch {
      // index.json doesn't exist yet or is corrupt — start fresh
      this.index = new Map()
    }
    this.indexLoaded = true
  }

  /**
   * Resolve a file path that may contain `/` separators by recursively
   * creating intermediate directories, then returning the leaf file handle.
   *
   * e.g. resolveFilePath(dir, 'src/index.js', true) will:
   *   1. getDirectoryHandle('src', { create: true })
   *   2. getFileHandle('index.js', { create: true })
   */
  private async resolveFilePath(
    base: FileSystemDirectoryHandle,
    filePath: string,
    create: boolean
  ): Promise<FileSystemFileHandle> {
    // Strip leading slash
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
    const segments = normalized.split('/')
    const fileName = segments.pop()!

    let current = base
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create })
    }
    return current.getFileHandle(fileName, { create })
  }

  /** Flush the in-memory index to OPFS index.json. */
  private async flushIndex(): Promise<void> {
    const root = this.rootHandle!
    const fileHandle = await root.getFileHandle(INDEX_FILE, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify([...this.index.values()]))
    await writable.close()
  }

  // ---- Public API ----

  /**
   * Store build outputs as individual files in OPFS.
   *
   * @param key - buildCacheKey (SHA-256)
   * @param manifest - build manifest (entry→output mapping)
   * @param files - compiled output files (JS, CSS, etc.)
   * @param metadata - index metadata (filesHash, builtAt, fileHashes, etc.)
   */
  async put(
    key: string,
    manifest: BuildManifest,
    files: BuildCacheFile[],
    metadata: BuildCacheMetadata
  ): Promise<void> {
    const root = await this.ensureInitialized()

    // Create directory for this cache entry
    const dirHandle = await root.getDirectoryHandle(key, { create: true })

    // Write individual output files FIRST (paths may contain '/' — create intermediate dirs).
    // Files must be fully written before the manifest, because manifest
    // presence is the "commit marker" — get() treats a readable manifest
    // as proof that the entry is complete.
    for (const file of files) {
      const fileHandle = await this.resolveFilePath(dirHandle, file.path, true)
      const writable = await fileHandle.createWritable()
      await writable.write(file.content.buffer as ArrayBuffer)
      await writable.close()
    }

    // Write manifest.json LAST — acts as the commit marker.
    // If a crash occurs before this point, get() will not find
    // a manifest and will discard the stale directory on next access.
    const manifestHandle = await dirHandle.getFileHandle(MANIFEST_FILE, { create: true })
    const manifestWritable = await manifestHandle.createWritable()
    await manifestWritable.write(JSON.stringify(manifest))
    await manifestWritable.close()

    // Update index
    this.index.set(key, metadata)
    await this.flushIndex()
  }

  /**
   * Get a cached build entry. Does NOT read file contents eagerly —
   * only reads the manifest and metadata.
   *
   * @returns entry with manifest + metadata, or null if not cached
   */
  async get(key: string): Promise<BuildCacheEntry | null> {
    const root = await this.ensureInitialized()

    const metadata = this.index.get(key)
    if (!metadata) return null

    try {
      const dirHandle = await root.getDirectoryHandle(key)

      // Read manifest
      const manifestFileHandle = await dirHandle.getFileHandle(MANIFEST_FILE)
      const manifestFile = await manifestFileHandle.getFile()
      const manifest: BuildManifest = JSON.parse(await manifestFile.text())

      // Update last accessed time
      metadata.lastAccessedAt = Date.now()
      this.index.set(key, metadata)
      // Fire-and-forget index flush (non-critical)
      this.flushIndex().catch(() => {})

      return { manifest, metadata }
    } catch {
      // Directory or manifest missing/corrupt — remove stale index entry
      this.index.delete(key)
      this.flushIndex().catch(() => {})
      return null
    }
  }

  /** Check if a build cache entry exists (in-memory index check only). */
  async has(key: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.index.has(key)
  }

  /** Delete a cache entry and its OPFS directory. */
  async delete(key: string): Promise<void> {
    const root = await this.ensureInitialized()

    // Remove directory
    try {
      await root.removeEntry(key, { recursive: true })
    } catch {
      // Directory may not exist — that's fine
    }

    // Remove from index
    this.index.delete(key)
    await this.flushIndex()
  }

  /** List all cache entries' metadata. */
  async list(): Promise<BuildCacheMetadata[]> {
    await this.ensureInitialized()
    return [...this.index.values()]
  }

  /**
   * Evict old cache entries using LRU strategy.
   *
   * @returns number of entries evicted
   */
  async evict(options?: { maxTotalSize?: number; maxEntries?: number }): Promise<number> {
    await this.ensureInitialized()

    const maxSize = options?.maxTotalSize ?? 512 * 1024 * 1024 // 512 MB default
    const maxEntries = options?.maxEntries ?? 100

    // Sort entries by lastAccessedAt (oldest first)
    const sorted = [...this.index.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

    let totalSize = sorted.reduce((sum, e) => sum + e.totalSize, 0)
    let count = sorted.length
    let evicted = 0

    for (const entry of sorted) {
      if (totalSize <= maxSize && count <= maxEntries) break

      await this.delete(entry.buildCacheKey)
      totalSize -= entry.totalSize
      count--
      evicted++
    }

    return evicted
  }

  /**
   * Update metadata fields without rewriting files.
   * Useful for marking entries as verified after integrity check.
   */
  async updateMetadata(key: string, updates: Partial<BuildCacheMetadata>): Promise<void> {
    await this.ensureInitialized()

    const existing = this.index.get(key)
    if (!existing) return

    this.index.set(key, { ...existing, ...updates, buildCacheKey: key })
    await this.flushIndex()
  }

  /**
   * Read a single file from a cached build entry.
   * Convenience method for BuildAwareVfs L1 resolution.
   *
   * @param key - buildCacheKey
   * @param filePath - path within the cache directory (e.g. 'index.js')
   * @returns file content as Uint8Array, or null if not found
   */
  async readFile(key: string, filePath: string): Promise<Uint8Array | null> {
    const root = await this.ensureInitialized()

    try {
      const dirHandle = await root.getDirectoryHandle(key)
      const fileHandle = await this.resolveFilePath(dirHandle, filePath, false)
      const file = await fileHandle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      return null
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: OpfsBuildCacheStorage | null = null

/** Get the global singleton OpfsBuildCacheStorage instance. */
export function getOpfsBuildCacheStorage(): OpfsBuildCacheStorage {
  if (!_instance) {
    _instance = new OpfsBuildCacheStorage()
  }
  return _instance
}
