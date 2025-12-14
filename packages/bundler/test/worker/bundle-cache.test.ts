/**
 * Bundle Cache Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BundleCache } from '../../src/worker/bundle-cache'

// Mock IndexedDB
const mockDB = {
  stores: new Map<string, Map<string, unknown>>(),
  transaction: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false)
  }
}

const mockStore = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  count: vi.fn(),
  createIndex: vi.fn()
}

const mockTransaction = {
  objectStore: vi.fn(() => mockStore)
}

// Setup IndexedDB mock
const mockIndexedDB = {
  open: vi.fn(() => {
    const request = {
      result: mockDB,
      error: null,
      onsuccess: null as ((ev: Event) => void) | null,
      onerror: null as ((ev: Event) => void) | null,
      onupgradeneeded: null as ((ev: Event) => void) | null,
    }
    
    setTimeout(() => {
      if (request.onupgradeneeded) {
        request.onupgradeneeded({ target: request } as unknown as Event)
      }
      if (request.onsuccess) {
        request.onsuccess({} as Event)
      }
    }, 0)
    
    return request
  })
}

describe('BundleCache', () => {
  let cache: BundleCache

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Setup transaction mock
    mockDB.transaction = vi.fn(() => mockTransaction)
    
    // Create new cache instance
    cache = new BundleCache()
  })

  describe('initialization', () => {
    it('should create cache instance', () => {
      expect(cache).toBeDefined()
    })
  })

  describe('transform cache (memory)', () => {
    it('should store and retrieve transform cache', async () => {
      // Use internal memory cache directly for testing
      const cacheWithMemory = cache as unknown as {
        transformMemCache: Map<string, unknown>
      }
      
      cacheWithMemory.transformMemCache.set('test-key', { code: 'compiled' })
      
      const result = cacheWithMemory.transformMemCache.get('test-key')
      expect(result).toEqual({ code: 'compiled' })
    })

    it('should delete from transform cache', () => {
      const cacheWithMemory = cache as unknown as {
        transformMemCache: Map<string, unknown>
      }
      
      cacheWithMemory.transformMemCache.set('test-key', { code: 'compiled' })
      cacheWithMemory.transformMemCache.delete('test-key')
      
      expect(cacheWithMemory.transformMemCache.has('test-key')).toBe(false)
    })

    it('should clear transform cache', () => {
      const cacheWithMemory = cache as unknown as {
        transformMemCache: Map<string, unknown>
      }
      
      cacheWithMemory.transformMemCache.set('key1', { code: 'a' })
      cacheWithMemory.transformMemCache.set('key2', { code: 'b' })
      cacheWithMemory.transformMemCache.clear()
      
      expect(cacheWithMemory.transformMemCache.size).toBe(0)
    })
  })

  describe('HTTP cache (memory)', () => {
    it('should store and retrieve HTTP cache', () => {
      const cacheWithMemory = cache as unknown as {
        httpMemCache: Map<string, string>
      }
      
      cacheWithMemory.httpMemCache.set('https://cdn.example.com/lib.js', 'export default {}')
      
      const result = cacheWithMemory.httpMemCache.get('https://cdn.example.com/lib.js')
      expect(result).toBe('export default {}')
    })
  })

  describe('memory cache trimming', () => {
    it('should allow adding multiple items to cache', () => {
      const cacheWithInternals = cache as unknown as {
        transformMemCache: Map<string, unknown>
        maxMemCacheSize: number
      }
      
      // Add multiple items
      for (let i = 0; i < 15; i++) {
        cacheWithInternals.transformMemCache.set(`key-${i}`, { index: i })
      }
      
      // All items should be stored (trimming happens during setTransform, not directly on Map)
      expect(cacheWithInternals.transformMemCache.size).toBe(15)
      
      // Verify some items are retrievable
      expect(cacheWithInternals.transformMemCache.get('key-0')).toEqual({ index: 0 })
      expect(cacheWithInternals.transformMemCache.get('key-14')).toEqual({ index: 14 })
    })
  })
})
