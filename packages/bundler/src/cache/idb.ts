/**
 * IdbBuildCacheStorage — IndexedDB-backed build cache layer.
 *
 * Drop-in replacement for OpfsBuildCacheStorage when OPFS is unavailable.
 * Uses two object stores:
 *   - "meta"  — BuildCacheMetadata keyed by buildCacheKey
 *   - "files" — individual build output files keyed by `${buildCacheKey}/${filePath}`
 *
 * Manifest is stored as a regular file entry with the reserved key
 * `${buildCacheKey}/__manifest__.json`.
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
const DB_VERSION = 1
const META_STORE = 'meta'
const FILE_STORE = 'files'
const MANIFEST_KEY_SUFFIX = '/__manifest__.json'

// ============================================================================
// IDB helpers
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

// ============================================================================
// IdbBuildCacheStorage
// ============================================================================

export class IdbBuildCacheStorage implements BuildCacheStorage {
  private db: IDBDatabase | null = null
  private index: Map<string, BuildCacheMetadata> = new Map()
  private indexLoaded = false

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

  // ---- File helpers ----

  private fileKey(cacheKey: string, filePath: string): string {
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
    return `${cacheKey}/${normalized}`
  }

  private manifestKey(cacheKey: string): string {
    return cacheKey + MANIFEST_KEY_SUFFIX
  }

  // ---- Public API ----

  async put(
    key: string,
    manifest: BuildManifest,
    files: BuildCacheFile[],
    metadata: BuildCacheMetadata,
  ): Promise<void> {
    const db = await this.ensureInitialized()

    // Write files + manifest in a single transaction
    const tx = db.transaction(FILE_STORE, 'readwrite')
    const store = tx.objectStore(FILE_STORE)

    for (const file of files) {
      store.put(file.content, this.fileKey(key, file.path))
    }
    // Manifest last (commit marker)
    store.put(JSON.stringify(manifest), this.manifestKey(key))

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
      const raw = await idbReq<string | undefined>(store.get(this.manifestKey(key)))
      if (!raw) {
        // Stale index entry — no manifest
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

    // Delete all files with this key prefix
    const tx = db.transaction(FILE_STORE, 'readwrite')
    const store = tx.objectStore(FILE_STORE)
    const cursor = store.openCursor()
    const prefix = key + '/'

    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) { resolve(); return }
        const k = c.key as string
        if (k.startsWith(prefix) || k === this.manifestKey(key)) {
          c.delete()
        }
        c.continue()
      }
      cursor.onerror = () => reject(cursor.error)
    })

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
      const content = await idbReq<Uint8Array | undefined>(store.get(this.fileKey(key, filePath)))
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
