/**
 * Local Save Storage — IndexedDB-backed with in-memory cache
 *
 * Replaces localStorage for editor local saves.
 * Provides synchronous read API via in-memory cache,
 * with asynchronous persistence to IndexedDB (virtually unlimited storage).
 */

import type { StateData } from './types'
import { denormalizeLuaData, normalizeLuaData } from '../utils/normalizeLuaData'

export interface LocalSaveSlot {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  preview?: {
    creaturesCount: number
    regionsCount: number
    organizationsCount: number
  }
}

export interface LocalSavesIndex {
  slots: LocalSaveSlot[]
  lastUsedSlotId?: string
}

// ============================================================================
// IndexedDB constants
// ============================================================================

const DB_NAME = 'local-saves'
const DB_VERSION = 1
const INDEX_STORE = 'index'   // single record keyed by 'main'
const DATA_STORE = 'saves'    // keyed by slotId

// ============================================================================
// In-memory cache
// ============================================================================

let _index: LocalSavesIndex = { slots: [] }
const _dataCache = new Map<string, StateData>()
let _cacheInitialized = false
let _dbInstance: IDBDatabase | null = null
let _initPromise: Promise<void> | null = null

// ============================================================================
// IndexedDB helpers
// ============================================================================

function openDB(): Promise<IDBDatabase> {
  if (_dbInstance) return Promise.resolve(_dbInstance)

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(INDEX_STORE)) {
        db.createObjectStore(INDEX_STORE)
      }
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        db.createObjectStore(DATA_STORE)
      }
    }

    request.onsuccess = () => {
      _dbInstance = request.result
      resolve(_dbInstance)
    }

    request.onerror = () => {
      console.error('[LocalSaves] Failed to open IndexedDB:', request.error)
      reject(request.error)
    }
  })
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDB().then(db => {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error)
    })
  })
}

function idbPut(storeName: string, key: string, value: unknown): void {
  openDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
  }).catch(e => {
    console.error('[LocalSaves] Failed to persist:', e)
  })
}

function idbDelete(storeName: string, key: string): void {
  openDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
  }).catch(e => {
    console.error('[LocalSaves] Failed to delete:', e)
  })
}

function idbGetAllKeys(storeName: string): Promise<string[]> {
  return openDB().then(db => {
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).getAllKeys()
      request.onsuccess = () => resolve(request.result as string[])
      request.onerror = () => reject(request.error)
    })
  })
}

// ============================================================================
// Migration from localStorage
// ============================================================================

const LEGACY_SAVES_KEY = 'state-data-editor-local-saves'
const LEGACY_INDEX_KEY = 'state-data-editor-local-saves-index'

function migrateFromLocalStorage(): void {
  try {
    // Migrate index
    const rawIndex = localStorage.getItem(LEGACY_INDEX_KEY)
    if (rawIndex) {
      const index: LocalSavesIndex = JSON.parse(rawIndex)
      _index = index
      idbPut(INDEX_STORE, 'main', index)

      // Migrate each save slot's data
      for (const slot of index.slots) {
        const rawData = localStorage.getItem(`${LEGACY_SAVES_KEY}-${slot.id}`)
        if (rawData) {
          const data = JSON.parse(rawData)
          // Store raw (denormalized) data in IDB, same as was in localStorage
          idbPut(DATA_STORE, slot.id, data)
          // Also populate cache with normalized version
          _dataCache.set(slot.id, normalizeLuaData(data))
        }
      }

      // Clean up localStorage
      localStorage.removeItem(LEGACY_INDEX_KEY)
      for (const slot of index.slots) {
        localStorage.removeItem(`${LEGACY_SAVES_KEY}-${slot.id}`)
      }

      console.log(`[LocalSaves] Migrated ${index.slots.length} saves from localStorage to IndexedDB`)
    }
  } catch (e) {
    console.error('[LocalSaves] localStorage migration failed:', e)
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function loadFromDB(): Promise<void> {
  if (_cacheInitialized) return

  try {
    const db = await openDB()

    // Load index
    const storedIndex = await idbGet<LocalSavesIndex>(INDEX_STORE, 'main')
    if (storedIndex) {
      _index = storedIndex
    }

    // Load all save data into cache
    const keys = await idbGetAllKeys(DATA_STORE)
    for (const key of keys) {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(DATA_STORE, 'readonly')
        const request = tx.objectStore(DATA_STORE).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (raw) {
        _dataCache.set(key, normalizeLuaData(raw))
      }
    }

    _cacheInitialized = true

    // If IDB was empty, try migrating from localStorage
    if (!storedIndex) {
      migrateFromLocalStorage()
    }
  } catch (e) {
    console.error('[LocalSaves] Failed to load from IndexedDB:', e)
    // Fallback: try migration
    migrateFromLocalStorage()
    _cacheInitialized = true
  }
}

/**
 * Initialize local save storage. Call once at app startup.
 * Safe to call multiple times — only the first call does work.
 */
export function initLocalSaveStorage(): Promise<void> {
  if (!_initPromise) {
    _initPromise = loadFromDB()
  }
  return _initPromise
}

// ============================================================================
// Public API (synchronous reads, async persistence)
// ============================================================================

export function getLocalSavesIndex(): LocalSavesIndex {
  return _index
}

export function getLocalSaveData(slotId: string): StateData | null {
  return _dataCache.get(slotId) ?? null
}

export function saveLocalSaveData(slotId: string, data: StateData, slotName: string): void {
  // Stamp v2 version flag
  const dataWithVersion = { ...data, _save_version: 'v2' as const }
  // Update data cache & persist
  _dataCache.set(slotId, dataWithVersion)
  idbPut(DATA_STORE, slotId, denormalizeLuaData(dataWithVersion))

  // Update index
  const now = new Date().toISOString()
  const preview = {
    creaturesCount: Array.isArray(data.Creatures) ? data.Creatures.length : 0,
    regionsCount: Array.isArray(data.Regions) ? data.Regions.length : 0,
    organizationsCount: Array.isArray(data.Organizations) ? data.Organizations.length : 0,
  }

  const existingIdx = _index.slots.findIndex(s => s.id === slotId)
  if (existingIdx >= 0) {
    _index.slots[existingIdx] = {
      ..._index.slots[existingIdx],
      name: slotName,
      updatedAt: now,
      preview,
    }
  } else {
    _index.slots.push({
      id: slotId,
      name: slotName,
      createdAt: now,
      updatedAt: now,
      preview,
    })
  }

  _index.lastUsedSlotId = slotId
  idbPut(INDEX_STORE, 'main', _index)
}

export function deleteLocalSave(slotId: string): void {
  _dataCache.delete(slotId)
  idbDelete(DATA_STORE, slotId)

  _index.slots = _index.slots.filter(s => s.id !== slotId)
  if (_index.lastUsedSlotId === slotId) {
    _index.lastUsedSlotId = _index.slots[0]?.id
  }
  idbPut(INDEX_STORE, 'main', _index)
}

export function generateSlotId(): string {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
