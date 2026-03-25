/**
 * GM Chat Storage — IndexedDB-backed with in-memory cache
 *
 * Stores GM Mode chat messages per game session.
 * Follows the same pattern as localSaveStorage.ts.
 */

import type { GMMessage } from '../games/ink/types'

const DB_NAME = 'gm-chat-history'
const DB_VERSION = 1
const MESSAGES_STORE = 'messages'

let _messages: GMMessage[] = []
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
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        db.createObjectStore(MESSAGES_STORE)
      }
    }

    request.onsuccess = () => {
      _dbInstance = request.result
      resolve(_dbInstance)
    }

    request.onerror = () => {
      console.error('[GMChat] Failed to open IndexedDB:', request.error)
      reject(request.error)
    }
  })
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDB().then(db => {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, 'readonly')
      const request = tx.objectStore(MESSAGES_STORE).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error)
    })
  })
}

function idbPut(key: string, value: unknown): void {
  openDB().then(db => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    tx.objectStore(MESSAGES_STORE).put(value, key)
  }).catch(e => {
    console.error('[GMChat] Failed to persist:', e)
  })
}

function idbDelete(key: string): void {
  openDB().then(db => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    tx.objectStore(MESSAGES_STORE).delete(key)
  }).catch(e => {
    console.error('[GMChat] Failed to delete:', e)
  })
}

// ============================================================================
// Initialization
// ============================================================================

async function loadFromDB(): Promise<void> {
  if (_cacheInitialized) return

  try {
    await openDB()
    const stored = await idbGet<GMMessage[]>('default')
    if (stored && Array.isArray(stored)) {
      _messages = stored
    }
    _cacheInitialized = true
  } catch (e) {
    console.error('[GMChat] Failed to load from IndexedDB:', e)
    _cacheInitialized = true
  }
}

/**
 * Initialize GM chat storage. Call once at app startup.
 * Safe to call multiple times — only the first call does work.
 */
export function initGMChatStorage(): Promise<void> {
  if (!_initPromise) {
    _initPromise = loadFromDB()
  }
  return _initPromise
}

// ============================================================================
// Public API
// ============================================================================

export function getGMMessages(): GMMessage[] {
  return _messages
}

export function saveGMMessages(messages: GMMessage[]): void {
  // Strip non-serializable fields (retryAction closures etc.)
  const serializable = messages.map(m => ({
    ...m,
    // Keep only serializable data
  }))
  _messages = serializable
  idbPut('default', serializable)
}

export function clearGMMessages(): void {
  _messages = []
  idbDelete('default')
}
