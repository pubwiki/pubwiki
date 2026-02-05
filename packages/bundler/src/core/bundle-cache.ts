/**
 * Bundle Cache
 *
 * Manages caching for:
 * - Transform results (compiled code)
 * - HTTP/CDN content (npm packages)
 * - TypeScript definitions (.d.ts)
 *
 * Uses IndexedDB for persistent storage when available,
 * falls back to memory-only cache in environments without IndexedDB.
 */

const DB_NAME = 'bundler-worker-cache'
const DB_VERSION = 1

const STORES = {
  TRANSFORM: 'transform-cache',
  HTTP: 'http-cache',
  METADATA: 'metadata'
}

interface CacheEntry<T = unknown> {
  key: string
  value: T
  timestamp: number
  expiresAt?: number
  size: number
}

/**
 * HTTP cache entry with content and content-type
 */
export interface HttpCacheEntry {
  content: string
  contentType: string
}

/**
 * Bundle Cache Manager
 */
export class BundleCache {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  private useMemoryOnly = false

  // Memory caches for frequently accessed items
  private transformMemCache = new Map<string, unknown>()
  private httpMemCache = new Map<string, HttpCacheEntry>()

  // Cache limits
  private readonly maxMemCacheSize = 100
  private readonly httpCacheTTL = 24 * 60 * 60 * 1000 // 24 hours

  /**
   * Initialize IndexedDB (falls back to memory-only if unavailable)
   */
  async init(): Promise<void> {
    if (this.db || this.useMemoryOnly) {
      return
    }

    if (this.initPromise) {
      return this.initPromise
    }

    // Check if IndexedDB is available
    if (typeof indexedDB === 'undefined') {
      console.log('[BundleCache] IndexedDB not available, using memory-only cache')
      this.useMemoryOnly = true
      return
    }

    console.log('[BundleCache] Initializing IndexedDB...')

    this.initPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.warn('[BundleCache] Failed to open database, using memory-only cache:', request.error)
        this.useMemoryOnly = true
        this.initPromise = null
        resolve() // Don't reject, just fall back to memory cache
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log('[BundleCache] Database opened successfully')
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        console.log('[BundleCache] Upgrading database schema...')

        // Create transform cache store
        if (!db.objectStoreNames.contains(STORES.TRANSFORM)) {
          const store = db.createObjectStore(STORES.TRANSFORM, { keyPath: 'key' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }

        // Create HTTP cache store
        if (!db.objectStoreNames.contains(STORES.HTTP)) {
          const store = db.createObjectStore(STORES.HTTP, { keyPath: 'key' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('expiresAt', 'expiresAt', { unique: false })
        }

        // Create metadata store
        if (!db.objectStoreNames.contains(STORES.METADATA)) {
          db.createObjectStore(STORES.METADATA, { keyPath: 'key' })
        }
      }
      } catch (error) {
        console.warn('[BundleCache] Error initializing IndexedDB, using memory-only cache:', error)
        this.useMemoryOnly = true
        resolve()
      }
    })

    return this.initPromise
  }

  // ================== Transform Cache ==================

  /**
   * Get from transform cache
   */
  async getTransform(key: string): Promise<unknown | null> {
    // Check memory cache first
    if (this.transformMemCache.has(key)) {
      return this.transformMemCache.get(key)!
    }

    // If memory-only mode, nothing more to check
    if (this.useMemoryOnly) {
      return null
    }

    await this.init()
    const entry = await this.get<unknown>(STORES.TRANSFORM, key)

    if (entry) {
      // Update memory cache
      this.transformMemCache.set(key, entry.value)
      this.trimMemCache(this.transformMemCache)
      return entry.value
    }

    return null
  }

  /**
   * Set transform cache
   */
  async setTransform(key: string, value: unknown): Promise<void> {
    // Update memory cache
    this.transformMemCache.set(key, value)
    this.trimMemCache(this.transformMemCache)

    // If memory-only mode, done
    if (this.useMemoryOnly) {
      return
    }

    await this.init()

    const entry: CacheEntry = {
      key,
      value,
      timestamp: Date.now(),
      size: JSON.stringify(value).length
    }

    await this.set(STORES.TRANSFORM, entry)
  }

  /**
   * Delete from transform cache
   */
  async deleteTransform(key: string): Promise<void> {
    this.transformMemCache.delete(key)

    if (this.useMemoryOnly) {
      return
    }

    await this.init()
    await this.delete(STORES.TRANSFORM, key)
  }

  /**
   * Clear all transform cache
   */
  async clearTransformCache(): Promise<void> {
    this.transformMemCache.clear()

    if (this.useMemoryOnly) {
      return
    }

    await this.init()
    await this.clearStore(STORES.TRANSFORM)
  }

  // ================== HTTP Cache ==================

  /**
   * Get from HTTP cache
   */
  async getHttp(url: string): Promise<HttpCacheEntry | null> {
    // Check memory cache
    if (this.httpMemCache.has(url)) {
      return this.httpMemCache.get(url)!
    }

    // If memory-only mode, nothing more to check
    if (this.useMemoryOnly) {
      return null
    }

    await this.init()
    const entry = await this.get<HttpCacheEntry>(STORES.HTTP, url)

    if (entry) {
      // Check expiration
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        await this.delete(STORES.HTTP, url)
        return null
      }

      // Update memory cache
      this.httpMemCache.set(url, entry.value)
      this.trimMemCache(this.httpMemCache)
      return entry.value
    }

    return null
  }

  /**
   * Set HTTP cache
   */
  async setHttp(url: string, content: string, contentType: string): Promise<void> {
    const httpEntry: HttpCacheEntry = { content, contentType }

    // Update memory cache
    this.httpMemCache.set(url, httpEntry)
    this.trimMemCache(this.httpMemCache)

    // If memory-only mode, done
    if (this.useMemoryOnly) {
      return
    }

    await this.init()

    const entry: CacheEntry<HttpCacheEntry> = {
      key: url,
      value: httpEntry,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.httpCacheTTL,
      size: content.length
    }

    await this.set(STORES.HTTP, entry)
  }

  // ================== Statistics ==================

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    transformCache: number
    httpCache: number
    totalSize: number
  }> {
    // If memory-only mode, return memory stats
    if (this.useMemoryOnly) {
      return {
        transformCache: this.transformMemCache.size,
        httpCache: this.httpMemCache.size,
        totalSize: 0 // Can't easily compute
      }
    }

    await this.init()

    const transformCount = await this.count(STORES.TRANSFORM)
    const httpCount = await this.count(STORES.HTTP)

    // Estimate total size (rough approximation)
    const totalSize =
      this.transformMemCache.size * 10000 +
      this.httpMemCache.size * 50000

    return {
      transformCache: transformCount,
      httpCache: httpCount,
      totalSize
    }
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    await this.init()
    await this.clearStore(STORES.TRANSFORM)
    await this.clearStore(STORES.HTTP)

    this.transformMemCache.clear()
    this.httpMemCache.clear()

    console.log('[BundleCache] All caches cleared')
  }

  // ================== Private Helpers ==================

  private async get<T>(storeName: string, key: string): Promise<CacheEntry<T> | null> {
    if (!this.db) return null

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  private async set(storeName: string, entry: CacheEntry): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.put(entry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async delete(storeName: string, key: string): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async clearStore(storeName: string): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async count(storeName: string): Promise<number> {
    if (!this.db) return 0

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.count()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private trimMemCache(cache: Map<string, unknown>): void {
    if (cache.size > this.maxMemCacheSize) {
      // Remove oldest entries (first 20%)
      const toRemove = Math.floor(this.maxMemCacheSize * 0.2)
      const keys = Array.from(cache.keys())
      for (let i = 0; i < toRemove; i++) {
        cache.delete(keys[i])
      }
    }
  }
}
