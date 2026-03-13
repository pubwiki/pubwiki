/**
 * IdbBuildCacheStorage — IndexedDB-backed build cache layer.
 *
 * Drop-in replacement for OpfsBuildCacheStorage when OPFS is unavailable.
 * Uses the same logical layout via key prefixes:
 *   - "meta:<buildCacheKey>"     — BuildCacheMetadata
 *   - "dist-ptr:<buildCacheKey>" — distKey pointer (string)
 *   - "dist:<distKey>/__manifest__.json" — manifest
 *   - "dist:<distKey>/<filePath>"        — build output file
 *   - "http:<url-hash>"          — HTTP content cache (JSON)
 *   - "cdn:<pkg-hash>"           — CDN URL resolution (string)
 *   - "transform:<path-hash>"    — Transform cache (JSON)
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

const DB_NAME = '__build_cache__'
const DB_VERSION = 2
const META_STORE = 'meta'
const FILE_STORE = 'files'

// Key prefixes for the file store
const DIST_PREFIX = 'dist:'
const DIST_PTR_PREFIX = 'dist-ptr:'
const HTTP_PREFIX = 'http:'
const CDN_PREFIX = 'cdn:'
const TRANSFORM_PREFIX = 'transform:'

const MANIFEST_SUFFIX = '/__manifest__.json'

// ============================================================================
// Helpers
// ============================================================================

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'buildCacheKey' })
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Simple deterministic hash for storage keys. */
async function hashKey(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// IdbBuildCacheStorage
// ============================================================================

export class IdbBuildCacheStorage implements BuildCacheStorage {
  private db: IDBDatabase | null = null
  private index: Map<string, BuildCacheMetadata> = new Map()
  private indexLoaded = false

  // In-memory fast-path caches (singleton, survives across BundlerService instances)
  private httpMemCache = new Map<string, { content: string; contentType: string }>()
  private cdnMemCache = new Map<string, string>()
  private transformMemCache = new Map<string, unknown>()
  private readonly maxMemCacheSize = 200

  // ---- Lifecycle ----

  private async ensureInitialized(): Promise<IDBDatabase> {
    if (this.db && this.indexLoaded) return this.db
    this.db = await openDb()
    await this.loadIndex()
    return this.db
  }

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return
    const db = this.db!
    const tx = db.transaction(META_STORE, 'readonly')
    const store = tx.objectStore(META_STORE)
    const all = await idbReq<BuildCacheMetadata[]>(store.getAll())
    this.index = new Map(all.map(e => [e.buildCacheKey, e]))
    this.indexLoaded = true
  }

  private async flushMetadata(metadata: BuildCacheMetadata): Promise<void> {
    const db = this.db!
    const tx = db.transaction(META_STORE, 'readwrite')
    const store = tx.objectStore(META_STORE)
    await idbReq(store.put(metadata))
  }

  private async deleteMetadata(key: string): Promise<void> {
    const db = this.db!
    const tx = db.transaction(META_STORE, 'readwrite')
    const store = tx.objectStore(META_STORE)
    await idbReq(store.delete(key))
  }

  private trimMemCache<V>(cache: Map<string, V>): void {
    if (cache.size <= this.maxMemCacheSize) return
    const keysToDelete = [...cache.keys()].slice(0, cache.size - this.maxMemCacheSize)
    for (const k of keysToDelete) cache.delete(k)
  }

  // ---- File key helpers ----

  private distFileKey(distKey: string, filePath: string): string {
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
    return `${DIST_PREFIX}${distKey}/${normalized}`
  }

  private distManifestKey(distKey: string): string {
    return `${DIST_PREFIX}${distKey}${MANIFEST_SUFFIX}`
  }

  private distPtrKey(buildCacheKey: string): string {
    return `${DIST_PTR_PREFIX}${buildCacheKey}`
  }

  // ---- Build output cache (public API) ----

  async put(
    key: string,
    manifest: BuildManifest,
    files: BuildCacheFile[],
    metadata: BuildCacheMetadata,
  ): Promise<void> {
    const db = await this.ensureInitialized()

    // Generate random distKey
    const distKey = crypto.randomUUID()

    // Write dist files + manifest + pointer in a single transaction
    const tx = db.transaction(FILE_STORE, 'readwrite')
    const store = tx.objectStore(FILE_STORE)

    for (const file of files) {
      store.put(file.content, this.distFileKey(distKey, file.path))
    }
    // Manifest last (commit marker)
    store.put(JSON.stringify(manifest), this.distManifestKey(distKey))
    // Dist pointer: buildCacheKey → distKey
    store.put(distKey, this.distPtrKey(key))

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    // Update metadata index
    this.index.set(key, metadata)
    await this.flushMetadata(metadata)
  }

  async get(key: string): Promise<BuildCacheEntry | null> {
    const db = await this.ensureInitialized()

    const metadata = this.index.get(key)
    if (!metadata) return null

    try {
      const tx = db.transaction(FILE_STORE, 'readonly')
      const store = tx.objectStore(FILE_STORE)

      // Read dist pointer
      const distKey = await idbReq<string | undefined>(store.get(this.distPtrKey(key)))
      if (!distKey) {
        this.index.delete(key)
        this.deleteMetadata(key).catch(() => {})
        return null
      }

      // Read manifest
      const raw = await idbReq<string | undefined>(store.get(this.distManifestKey(distKey)))
      if (!raw) {
        this.index.delete(key)
        this.deleteMetadata(key).catch(() => {})
        return null
      }

      const manifest: BuildManifest = JSON.parse(raw)

      // Update last accessed time (fire-and-forget)
      metadata.lastAccessedAt = Date.now()
      this.index.set(key, metadata)
      this.flushMetadata(metadata).catch(() => {})

      return { manifest, metadata }
    } catch {
      this.index.delete(key)
      this.deleteMetadata(key).catch(() => {})
      return null
    }
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.index.has(key)
  }

  async delete(key: string): Promise<void> {
    const db = await this.ensureInitialized()

    // Delete dist pointer
    try {
      const tx = db.transaction(FILE_STORE, 'readwrite')
      const store = tx.objectStore(FILE_STORE)
      store.delete(this.distPtrKey(key))
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch { /* ignore */ }

    // Note: dist files are not deleted on individual build delete
    // (other builds may reference the same distKey). Orphaned dists
    // are cleaned during evict().

    this.index.delete(key)
    await this.deleteMetadata(key)
  }

  async list(): Promise<BuildCacheMetadata[]> {
    await this.ensureInitialized()
    return [...this.index.values()]
  }

  async readFile(key: string, filePath: string): Promise<Uint8Array | null> {
    const db = await this.ensureInitialized()

    try {
      const tx = db.transaction(FILE_STORE, 'readonly')
      const store = tx.objectStore(FILE_STORE)

      // Resolve buildCacheKey → distKey
      const distKey = await idbReq<string | undefined>(store.get(this.distPtrKey(key)))
      if (!distKey) return null

      const content = await idbReq<Uint8Array | undefined>(store.get(this.distFileKey(distKey, filePath)))
      return content ?? null
    } catch {
      return null
    }
  }

  async evict(options?: { maxTotalSize?: number; maxEntries?: number }): Promise<number> {
    await this.ensureInitialized()

    const maxSize = options?.maxTotalSize ?? 512 * 1024 * 1024
    const maxEntries = options?.maxEntries ?? 100

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

  async updateMetadata(key: string, updates: Partial<BuildCacheMetadata>): Promise<void> {
    await this.ensureInitialized()

    const existing = this.index.get(key)
    if (!existing) return

    const updated = { ...existing, ...updates, buildCacheKey: key }
    this.index.set(key, updated)
    await this.flushMetadata(updated)
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
    const db = this.db!
    for (const [existingKey, existingMeta] of this.index.entries()) {
      if (!existingMeta.dependencies || !existingMeta.fileHashes || !existingMeta.configKey) continue

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

      try {
        const tx = db.transaction(FILE_STORE, 'readonly')
        const store = tx.objectStore(FILE_STORE)
        const distKey = await idbReq<string | undefined>(store.get(this.distPtrKey(existingKey)))
        if (!distKey) continue

        // Create new pointer for the new buildCacheKey
        const writeTx = db.transaction(FILE_STORE, 'readwrite')
        const writeStore = writeTx.objectStore(FILE_STORE)
        writeStore.put(distKey, this.distPtrKey(buildCacheKey))
        await new Promise<void>((resolve, reject) => {
          writeTx.oncomplete = () => resolve()
          writeTx.onerror = () => reject(writeTx.error)
        })

        // Write metadata with updated fileHashes
        const newMetadata: BuildCacheMetadata = {
          ...existingMeta,
          buildCacheKey,
          fileHashes,
          lastAccessedAt: Date.now(),
        }
        this.index.set(buildCacheKey, newMetadata)
        await this.flushMetadata(newMetadata)

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
    const memCached = this.httpMemCache.get(url)
    if (memCached) return memCached

    try {
      const db = await this.ensureInitialized()
      const key = HTTP_PREFIX + await hashKey(url)
      const tx = db.transaction(FILE_STORE, 'readonly')
      const store = tx.objectStore(FILE_STORE)
      const raw = await idbReq<string | undefined>(store.get(key))
      if (!raw) return null

      const entry = JSON.parse(raw) as { content: string; contentType: string; expiresAt?: number }
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        // Expired — delete asynchronously
        const delTx = db.transaction(FILE_STORE, 'readwrite')
        delTx.objectStore(FILE_STORE).delete(key)
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
      const db = await this.ensureInitialized()
      const key = HTTP_PREFIX + await hashKey(url)
      const tx = db.transaction(FILE_STORE, 'readwrite')
      const store = tx.objectStore(FILE_STORE)
      store.put(JSON.stringify({
        content,
        contentType,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }), key)
    } catch {
      // Memory cache still works
    }
  }

  // ---- CDN URL resolution cache ----

  async getCdnUrl(packageName: string): Promise<string | null> {
    const memCached = this.cdnMemCache.get(packageName)
    if (memCached) return memCached

    try {
      const db = await this.ensureInitialized()
      const key = CDN_PREFIX + await hashKey(packageName)
      const tx = db.transaction(FILE_STORE, 'readonly')
      const store = tx.objectStore(FILE_STORE)
      const url = await idbReq<string | undefined>(store.get(key))
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
      const db = await this.ensureInitialized()
      const key = CDN_PREFIX + await hashKey(packageName)
      const tx = db.transaction(FILE_STORE, 'readwrite')
      const store = tx.objectStore(FILE_STORE)
      store.put(resolvedUrl, key)
    } catch {
      // Memory cache still works
    }
  }

  // ---- Transform cache ----

  async getTransform(key: string): Promise<unknown | null> {
    const memCached = this.transformMemCache.get(key)
    if (memCached !== undefined) return memCached

    try {
      const db = await this.ensureInitialized()
      const storeKey = TRANSFORM_PREFIX + await hashKey(key)
      const tx = db.transaction(FILE_STORE, 'readonly')
      const store = tx.objectStore(FILE_STORE)
      const raw = await idbReq<string | undefined>(store.get(storeKey))
      if (!raw) return null

      const value = JSON.parse(raw)
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
      const db = await this.ensureInitialized()
      const storeKey = TRANSFORM_PREFIX + await hashKey(key)
      const tx = db.transaction(FILE_STORE, 'readwrite')
      const store = tx.objectStore(FILE_STORE)
      store.put(JSON.stringify(value), storeKey)
    } catch {
      // Memory cache still works
    }
  }

  async deleteTransform(key: string): Promise<void> {
    this.transformMemCache.delete(key)

    try {
      const db = await this.ensureInitialized()
      const storeKey = TRANSFORM_PREFIX + await hashKey(key)
      const tx = db.transaction(FILE_STORE, 'readwrite')
      const store = tx.objectStore(FILE_STORE)
      store.delete(storeKey)
    } catch {
      // May not exist
    }
  }

  async clearTransformCache(): Promise<void> {
    this.transformMemCache.clear()

    try {
      const db = await this.ensureInitialized()
      const tx = db.transaction(FILE_STORE, 'readwrite')
      const store = tx.objectStore(FILE_STORE)
      const cursor = store.openCursor()

      await new Promise<void>((resolve, reject) => {
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) { resolve(); return }
          const k = c.key as string
          if (k.startsWith(TRANSFORM_PREFIX)) {
            c.delete()
          }
          c.continue()
        }
        cursor.onerror = () => reject(cursor.error)
      })
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _idbInstance: IdbBuildCacheStorage | null = null

/** Get the global singleton IdbBuildCacheStorage instance. */
export function getIdbBuildCacheStorage(): IdbBuildCacheStorage {
  if (!_idbInstance) {
    _idbInstance = new IdbBuildCacheStorage()
  }
  return _idbInstance
}
