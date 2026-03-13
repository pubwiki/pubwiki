/**
 * OpfsBuildCacheStorage — OPFS-backed build cache implementation.
 *
 * Stores build outputs and auxiliary caches (HTTP, CDN, transforms) in OPFS.
 *
 * OPFS layout:
 *   __build_cache__/
 *     dists/<distKey>/           — actual build output files + manifest.json
 *     builds/<buildCacheKey>/    — dist (pointer text) + meta.json (metadata)
 *     http/<url-hash>            — HTTP content cache (JSON)
 *     cdn/<pkg-hash>             — CDN URL resolution (plain text URL)
 *     transforms/<path-hash>     — Transform cache (JSON)
 */

import type { BuildManifest } from '../types/result'
import type {
  BuildCacheStorage,
  BuildCacheFile,
  BuildCacheMetadata,
  BuildCacheEntry,
} from './index'

// ============================================================================
// Constants
// ============================================================================

const BUILD_CACHE_DIR = '__build_cache__'
const DISTS_DIR = 'dists'
const BUILDS_DIR = 'builds'
const HTTP_DIR = 'http'
const CDN_DIR = 'cdn'
const TRANSFORMS_DIR = 'transforms'
const MANIFEST_FILE = 'manifest.json'
const DIST_POINTER_FILE = 'dist'
const META_FILE = 'meta.json'

// ============================================================================
// Helpers
// ============================================================================

/** Simple deterministic hash for storage keys (URL, package names, file paths). */
async function hashKey(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// OpfsBuildCacheStorage
// ============================================================================

export class OpfsBuildCacheStorage implements BuildCacheStorage {
  private rootHandle: FileSystemDirectoryHandle | null = null
  /** In-memory metadata index: buildCacheKey → metadata. Loaded from builds/ on init. */
  private index: Map<string, BuildCacheMetadata> = new Map()
  private indexLoaded = false

  // In-memory fast-path caches (singleton, survives across BundlerService instances)
  private httpMemCache = new Map<string, { content: string; contentType: string }>()
  private cdnMemCache = new Map<string, string>()
  private transformMemCache = new Map<string, unknown>()
  private readonly maxMemCacheSize = 200

  // ---- Lifecycle ----

  private async ensureInitialized(): Promise<FileSystemDirectoryHandle> {
    if (this.rootHandle && this.indexLoaded) return this.rootHandle

    const opfsRoot = await navigator.storage.getDirectory()
    this.rootHandle = await opfsRoot.getDirectoryHandle(BUILD_CACHE_DIR, { create: true })

    // Ensure subdirectories exist
    await this.rootHandle.getDirectoryHandle(DISTS_DIR, { create: true })
    await this.rootHandle.getDirectoryHandle(BUILDS_DIR, { create: true })
    await this.rootHandle.getDirectoryHandle(HTTP_DIR, { create: true })
    await this.rootHandle.getDirectoryHandle(CDN_DIR, { create: true })
    await this.rootHandle.getDirectoryHandle(TRANSFORMS_DIR, { create: true })

    await this.loadIndex()
    return this.rootHandle
  }

  /** Scan builds/ directory to populate in-memory index. */
  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return
    try {
      const root = this.rootHandle!
      const buildsDir = await root.getDirectoryHandle(BUILDS_DIR, { create: true })
      for await (const [name, handle] of buildsDir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind !== 'directory') continue
        try {
          const buildDir = handle as FileSystemDirectoryHandle
          const metaHandle = await buildDir.getFileHandle(META_FILE)
          const metaFile = await metaHandle.getFile()
          const metadata: BuildCacheMetadata = JSON.parse(await metaFile.text())
          this.index.set(name, metadata)
        } catch {
          // Corrupt or incomplete build entry — skip
        }
      }
    } catch {
      // builds/ doesn't exist yet — start fresh
    }
    this.indexLoaded = true
  }

  /**
   * Resolve a file path that may contain `/` separators by recursively
   * creating intermediate directories, then returning the leaf file handle.
   */
  private async resolveFilePath(
    base: FileSystemDirectoryHandle,
    filePath: string,
    create: boolean
  ): Promise<FileSystemFileHandle> {
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
    const segments = normalized.split('/')
    const fileName = segments.pop()!

    let current = base
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create })
    }
    return current.getFileHandle(fileName, { create })
  }

  /** Read the distKey pointer from a build entry. */
  private async readDistPointer(buildDir: FileSystemDirectoryHandle): Promise<string | null> {
    try {
      const pointerHandle = await buildDir.getFileHandle(DIST_POINTER_FILE)
      const file = await pointerHandle.getFile()
      const distKey = (await file.text()).trim()
      return distKey || null
    } catch {
      return null
    }
  }

  /** Read manifest from a dist directory. */
  private async readDistManifest(distKey: string): Promise<BuildManifest | null> {
    try {
      const root = this.rootHandle!
      const distsDir = await root.getDirectoryHandle(DISTS_DIR)
      const distDir = await distsDir.getDirectoryHandle(distKey)
      const manifestHandle = await distDir.getFileHandle(MANIFEST_FILE)
      const manifestFile = await manifestHandle.getFile()
      return JSON.parse(await manifestFile.text())
    } catch {
      return null
    }
  }

  private trimMemCache<V>(cache: Map<string, V>): void {
    if (cache.size <= this.maxMemCacheSize) return
    const keysToDelete = [...cache.keys()].slice(0, cache.size - this.maxMemCacheSize)
    for (const k of keysToDelete) cache.delete(k)
  }

  // ---- Build output cache (public API) ----

  async put(
    key: string,
    manifest: BuildManifest,
    files: BuildCacheFile[],
    metadata: BuildCacheMetadata
  ): Promise<void> {
    const root = await this.ensureInitialized()

    // Generate random distKey
    const distKey = crypto.randomUUID()

    // 1. Write output files under dists/<distKey>/
    const distsDir = await root.getDirectoryHandle(DISTS_DIR)
    const distDir = await distsDir.getDirectoryHandle(distKey, { create: true })

    for (const file of files) {
      const fileHandle = await this.resolveFilePath(distDir, file.path, true)
      const writable = await fileHandle.createWritable()
      await writable.write(file.content.buffer as ArrayBuffer)
      await writable.close()
    }

    // Write manifest LAST — acts as the commit marker
    const manifestHandle = await distDir.getFileHandle(MANIFEST_FILE, { create: true })
    const manifestWritable = await manifestHandle.createWritable()
    await manifestWritable.write(JSON.stringify(manifest))
    await manifestWritable.close()

    // 2. Write builds/<buildCacheKey>/ with pointer + metadata
    const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
    const buildDir = await buildsDir.getDirectoryHandle(key, { create: true })

    const pointerHandle = await buildDir.getFileHandle(DIST_POINTER_FILE, { create: true })
    const pointerWritable = await pointerHandle.createWritable()
    await pointerWritable.write(distKey)
    await pointerWritable.close()

    const metaHandle = await buildDir.getFileHandle(META_FILE, { create: true })
    const metaWritable = await metaHandle.createWritable()
    await metaWritable.write(JSON.stringify(metadata))
    await metaWritable.close()

    // 3. Update in-memory index
    this.index.set(key, metadata)
  }

  async get(key: string): Promise<BuildCacheEntry | null> {
    const root = await this.ensureInitialized()

    const metadata = this.index.get(key)
    if (!metadata) return null

    try {
      const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
      const buildDir = await buildsDir.getDirectoryHandle(key)

      // Read distKey pointer
      const distKey = await this.readDistPointer(buildDir)
      if (!distKey) {
        this.index.delete(key)
        return null
      }

      // Read manifest from dists/<distKey>/
      const manifest = await this.readDistManifest(distKey)
      if (!manifest) {
        this.index.delete(key)
        return null
      }

      // Update last accessed time
      metadata.lastAccessedAt = Date.now()
      this.index.set(key, metadata)
      // Fire-and-forget metadata flush
      this.writeMetaJson(key, metadata).catch(() => {})

      return { manifest, metadata }
    } catch {
      this.index.delete(key)
      return null
    }
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.index.has(key)
  }

  async delete(key: string): Promise<void> {
    const root = await this.ensureInitialized()

    // Remove builds/<key>/
    try {
      const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
      await buildsDir.removeEntry(key, { recursive: true })
    } catch { /* may not exist */ }

    this.index.delete(key)

    // Orphaned dists (no longer referenced by any build) are cleaned up during evict().
  }

  async list(): Promise<BuildCacheMetadata[]> {
    await this.ensureInitialized()
    return [...this.index.values()]
  }

  async readFile(key: string, filePath: string): Promise<Uint8Array | null> {
    const root = await this.ensureInitialized()

    try {
      // Resolve buildCacheKey → distKey
      const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
      const buildDir = await buildsDir.getDirectoryHandle(key)
      const distKey = await this.readDistPointer(buildDir)
      if (!distKey) return null

      // Read file from dists/<distKey>/
      const distsDir = await root.getDirectoryHandle(DISTS_DIR)
      const distDir = await distsDir.getDirectoryHandle(distKey)
      const fileHandle = await this.resolveFilePath(distDir, filePath, false)
      const file = await fileHandle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      return null
    }
  }

  async evict(options?: { maxTotalSize?: number; maxEntries?: number }): Promise<number> {
    const root = await this.ensureInitialized()

    const maxSize = options?.maxTotalSize ?? 512 * 1024 * 1024
    const maxEntries = options?.maxEntries ?? 100

    const sorted = [...this.index.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

    let totalSize = sorted.reduce((sum, e) => sum + e.totalSize, 0)
    let count = sorted.length
    let evicted = 0

    // Collect distKeys that are still referenced after eviction
    const referencedDistKeys = new Set<string>()

    for (const entry of sorted) {
      if (totalSize <= maxSize && count <= maxEntries) {
        // Read distKey for remaining entries to know what's still referenced
        try {
          const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
          const buildDir = await buildsDir.getDirectoryHandle(entry.buildCacheKey)
          const dk = await this.readDistPointer(buildDir)
          if (dk) referencedDistKeys.add(dk)
        } catch { /* skip */ }
        continue
      }

      await this.delete(entry.buildCacheKey)
      totalSize -= entry.totalSize
      count--
      evicted++
    }

    // Also read distKeys for entries we didn't evict
    for (const entry of this.index.values()) {
      try {
        const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
        const buildDir = await buildsDir.getDirectoryHandle(entry.buildCacheKey)
        const dk = await this.readDistPointer(buildDir)
        if (dk) referencedDistKeys.add(dk)
      } catch { /* skip */ }
    }

    // Clean up orphaned dists
    try {
      const distsDir = await root.getDirectoryHandle(DISTS_DIR)
      for await (const [name, handle] of distsDir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'directory' && !referencedDistKeys.has(name)) {
          await distsDir.removeEntry(name, { recursive: true }).catch(() => {})
        }
      }
    } catch { /* ignore */ }

    return evicted
  }

  async updateMetadata(key: string, updates: Partial<BuildCacheMetadata>): Promise<void> {
    await this.ensureInitialized()

    const existing = this.index.get(key)
    if (!existing) return

    const updated = { ...existing, ...updates, buildCacheKey: key }
    this.index.set(key, updated)
    await this.writeMetaJson(key, updated)
  }

  private async writeMetaJson(key: string, metadata: BuildCacheMetadata): Promise<void> {
    try {
      const root = this.rootHandle!
      const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
      const buildDir = await buildsDir.getDirectoryHandle(key, { create: true })
      const metaHandle = await buildDir.getFileHandle(META_FILE, { create: true })
      const writable = await metaHandle.createWritable()
      await writable.write(JSON.stringify(metadata))
      await writable.close()
    } catch {
      // Non-critical — in-memory index is authoritative for the session
    }
  }

  // ---- resolve() — Smart cache resolution ----

  async resolve(
    buildCacheKey: string,
    fileHashes: Record<string, string>
  ): Promise<BuildCacheEntry | null> {
    await this.ensureInitialized()

    // 1. Direct hit
    const direct = await this.get(buildCacheKey)
    if (direct) return direct

    // 2. Dependency match: scan all builds for a compatible entry
    for (const [existingKey, existingMeta] of this.index.entries()) {
      // Skip entries without dependency info (legacy format)
      if (!existingMeta.dependencies || !existingMeta.fileHashes) continue
      // configKey must match (same entry files + build options)
      if (!existingMeta.configKey) continue

      // Check all dependency files: their hashes must be identical
      let allDepsMatch = true
      for (const dep of existingMeta.dependencies) {
        if (fileHashes[dep] !== existingMeta.fileHashes[dep]) {
          allDepsMatch = false
          break
        }
      }

      if (!allDepsMatch) continue

      // All deps match — reuse this entry's distKey
      const existingEntry = await this.get(existingKey)
      if (!existingEntry) continue

      // Read the distKey from the existing build
      const root = this.rootHandle!
      try {
        const buildsDir = await root.getDirectoryHandle(BUILDS_DIR)
        const existingBuildDir = await buildsDir.getDirectoryHandle(existingKey)
        const distKey = await this.readDistPointer(existingBuildDir)
        if (!distKey) continue

        // Create new builds/<buildCacheKey>/ pointing to same distKey
        const newBuildDir = await buildsDir.getDirectoryHandle(buildCacheKey, { create: true })

        const pointerHandle = await newBuildDir.getFileHandle(DIST_POINTER_FILE, { create: true })
        const pointerWritable = await pointerHandle.createWritable()
        await pointerWritable.write(distKey)
        await pointerWritable.close()

        // Write meta.json with updated fileHashes (current VFS state)
        const newMetadata: BuildCacheMetadata = {
          ...existingMeta,
          buildCacheKey,
          fileHashes,
          lastAccessedAt: Date.now(),
        }
        const metaHandle = await newBuildDir.getFileHandle(META_FILE, { create: true })
        const metaWritable = await metaHandle.createWritable()
        await metaWritable.write(JSON.stringify(newMetadata))
        await metaWritable.close()

        this.index.set(buildCacheKey, newMetadata)

        return { manifest: existingEntry.manifest, metadata: newMetadata }
      } catch {
        continue
      }
    }

    // 3. Miss
    return null
  }

  // ---- HTTP content cache ----

  async getHttp(url: string): Promise<{ content: string; contentType: string } | null> {
    // Memory fast path
    const memCached = this.httpMemCache.get(url)
    if (memCached) return memCached

    try {
      const root = await this.ensureInitialized()
      const httpDir = await root.getDirectoryHandle(HTTP_DIR)
      const key = await hashKey(url)
      const fileHandle = await httpDir.getFileHandle(key)
      const file = await fileHandle.getFile()
      const entry = JSON.parse(await file.text()) as { content: string; contentType: string; expiresAt?: number }

      // Check expiration
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        httpDir.removeEntry(key).catch(() => {})
        return null
      }

      this.httpMemCache.set(url, { content: entry.content, contentType: entry.contentType })
      this.trimMemCache(this.httpMemCache)
      return { content: entry.content, contentType: entry.contentType }
    } catch {
      return null
    }
  }

  async setHttp(url: string, content: string, contentType: string): Promise<void> {
    this.httpMemCache.set(url, { content, contentType })
    this.trimMemCache(this.httpMemCache)

    try {
      const root = await this.ensureInitialized()
      const httpDir = await root.getDirectoryHandle(HTTP_DIR)
      const key = await hashKey(url)
      const fileHandle = await httpDir.getFileHandle(key, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(JSON.stringify({
        content,
        contentType,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h TTL
      }))
      await writable.close()
    } catch {
      // OPFS write failure — memory cache still works
    }
  }

  // ---- CDN URL resolution cache ----

  async getCdnUrl(packageName: string): Promise<string | null> {
    const memCached = this.cdnMemCache.get(packageName)
    if (memCached) return memCached

    try {
      const root = await this.ensureInitialized()
      const cdnDir = await root.getDirectoryHandle(CDN_DIR)
      const key = await hashKey(packageName)
      const fileHandle = await cdnDir.getFileHandle(key)
      const file = await fileHandle.getFile()
      const url = (await file.text()).trim()
      if (url) {
        this.cdnMemCache.set(packageName, url)
        return url
      }
      return null
    } catch {
      return null
    }
  }

  async setCdnUrl(packageName: string, resolvedUrl: string): Promise<void> {
    this.cdnMemCache.set(packageName, resolvedUrl)

    try {
      const root = await this.ensureInitialized()
      const cdnDir = await root.getDirectoryHandle(CDN_DIR)
      const key = await hashKey(packageName)
      const fileHandle = await cdnDir.getFileHandle(key, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(resolvedUrl)
      await writable.close()
    } catch {
      // Memory cache still works
    }
  }

  // ---- Transform cache ----

  async getTransform(key: string): Promise<unknown | null> {
    const memCached = this.transformMemCache.get(key)
    if (memCached !== undefined) return memCached

    try {
      const root = await this.ensureInitialized()
      const transformsDir = await root.getDirectoryHandle(TRANSFORMS_DIR)
      const hashedKey = await hashKey(key)
      const fileHandle = await transformsDir.getFileHandle(hashedKey)
      const file = await fileHandle.getFile()
      const value = JSON.parse(await file.text())
      this.transformMemCache.set(key, value)
      this.trimMemCache(this.transformMemCache)
      return value
    } catch {
      return null
    }
  }

  async setTransform(key: string, value: unknown): Promise<void> {
    this.transformMemCache.set(key, value)
    this.trimMemCache(this.transformMemCache)

    try {
      const root = await this.ensureInitialized()
      const transformsDir = await root.getDirectoryHandle(TRANSFORMS_DIR)
      const hashedKey = await hashKey(key)
      const fileHandle = await transformsDir.getFileHandle(hashedKey, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(JSON.stringify(value))
      await writable.close()
    } catch {
      // Memory cache still works
    }
  }

  async deleteTransform(key: string): Promise<void> {
    this.transformMemCache.delete(key)

    try {
      const root = await this.ensureInitialized()
      const transformsDir = await root.getDirectoryHandle(TRANSFORMS_DIR)
      const hashedKey = await hashKey(key)
      await transformsDir.removeEntry(hashedKey)
    } catch {
      // May not exist
    }
  }

  async clearTransformCache(): Promise<void> {
    this.transformMemCache.clear()

    try {
      const root = await this.ensureInitialized()
      // Remove and recreate transforms directory
      await root.removeEntry(TRANSFORMS_DIR, { recursive: true }).catch(() => {})
      await root.getDirectoryHandle(TRANSFORMS_DIR, { create: true })
    } catch {
      // Ignore
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
