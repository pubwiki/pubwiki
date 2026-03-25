/**
 * WBNSessionStore — IndexedDB-backed persistence for WorldBuilder sessions.
 *
 * Stores one WBNSession per projectId. Sessions are saved as plain JSON.
 */

import type { WBNSession } from './types'

// ============================================================================
// Constants
// ============================================================================

const DB_NAME = 'world-editor-wbn-sessions'
const DB_VERSION = 1
const STORE_NAME = 'sessions'

// ============================================================================
// Stored Record
// ============================================================================

interface StoredSession {
  projectId: string
  session: WBNSession
  updatedAt: number
}

// ============================================================================
// WBNSessionStore
// ============================================================================

export class WBNSessionStore {
  private dbPromise: Promise<IDBDatabase>
  private readonly projectId: string

  constructor(projectId: string) {
    this.projectId = projectId
    this.dbPromise = this.openDB()
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private async getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.dbPromise
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
  }

  /**
   * Save the current session for this project.
   */
  async save(session: WBNSession): Promise<void> {
    const store = await this.getStore('readwrite')
    const record: StoredSession = {
      projectId: this.projectId,
      session,
      updatedAt: Date.now(),
    }
    return new Promise((resolve, reject) => {
      const request = store.put(record)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Load the saved session for this project, if any.
   */
  async load(): Promise<WBNSession | null> {
    const store = await this.getStore('readonly')
    return new Promise((resolve, reject) => {
      const request = store.get(this.projectId)
      request.onsuccess = () => {
        const result = request.result as StoredSession | undefined
        resolve(result?.session ?? null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Delete the saved session for this project.
   */
  async delete(): Promise<void> {
    const store = await this.getStore('readwrite')
    return new Promise((resolve, reject) => {
      const request = store.delete(this.projectId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
