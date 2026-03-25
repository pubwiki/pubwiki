/**
 * ChatMessageStore — IndexedDB-backed persistence for copilot chat messages.
 *
 * Stores the full DisplayMessage[] array per projectId.
 * Simple key-value pattern — no Dexie dependency.
 */

import type { DisplayMessage } from '@pubwiki/svelte-chat'

const DB_NAME = 'world-editor-chat-messages'
const DB_VERSION = 1
const STORE_NAME = 'conversations'

interface StoredConversation {
  projectId: string
  messages: DisplayMessage[]
  updatedAt: number
}

export class ChatMessageStore {
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

  async save(messages: DisplayMessage[]): Promise<void> {
    const store = await this.getStore('readwrite')
    const record: StoredConversation = {
      projectId: this.projectId,
      messages,
      updatedAt: Date.now(),
    }
    return new Promise((resolve, reject) => {
      const request = store.put(record)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async load(): Promise<DisplayMessage[]> {
    const store = await this.getStore('readonly')
    return new Promise((resolve, reject) => {
      const request = store.get(this.projectId)
      request.onsuccess = () => {
        const result = request.result as StoredConversation | undefined
        resolve(result?.messages ?? [])
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clear(): Promise<void> {
    const store = await this.getStore('readwrite')
    return new Promise((resolve, reject) => {
      const request = store.delete(this.projectId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
