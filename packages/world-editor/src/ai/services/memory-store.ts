/**
 * MemoryStore — IndexedDB-backed working memory for the AI copilot.
 *
 * Provides persistent key-value storage for AI plans, progress notes,
 * and other working context. Scoped by projectId.
 */

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Constants
// ============================================================================

const DB_NAME = 'world-editor-ai-memory'
const DB_VERSION = 1
const STORE_NAME = 'memories'

// ============================================================================
// MemoryStore
// ============================================================================

export class MemoryStore {
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
          const store = db.createObjectStore(STORE_NAME, { keyPath: ['projectId', 'id'] })
          store.createIndex('byProject', 'projectId', { unique: false })
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
   * List all memory entries for this project.
   */
  async list(): Promise<MemoryEntry[]> {
    const store = await this.getStore('readonly')
    const index = store.index('byProject')
    return new Promise((resolve, reject) => {
      const request = index.getAll(this.projectId)
      request.onsuccess = () => resolve(request.result as MemoryEntry[])
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get a single memory entry by ID.
   */
  async get(id: string): Promise<MemoryEntry | null> {
    const store = await this.getStore('readonly')
    return new Promise((resolve, reject) => {
      const request = store.get([this.projectId, id])
      request.onsuccess = () => resolve((request.result as MemoryEntry) ?? null)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Save (upsert) a memory entry.
   */
  async save(id: string, title: string, content: string): Promise<void> {
    const existing = await this.get(id)
    const now = Date.now()
    const entry = {
      projectId: this.projectId,
      id,
      title,
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const store = await this.getStore('readwrite')
    return new Promise((resolve, reject) => {
      const request = store.put(entry)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Delete a memory entry.
   */
  async delete(id: string): Promise<void> {
    const store = await this.getStore('readwrite')
    return new Promise((resolve, reject) => {
      const request = store.delete([this.projectId, id])
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
