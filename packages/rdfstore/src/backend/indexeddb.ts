/**
 * IndexedDB StorageBackend using the raw IndexedDB API (no Dexie).
 * Browser-only module.
 */

import type { CheckpointInfo } from '../types'
import type { StorageBackend } from '../store/interfaces'

const SNAPSHOT_STORE = 'snapshots'
const METADATA_STORE = 'metadata'
const DB_VERSION = 1

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE)
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class IndexedDBBackend implements StorageBackend {
  private dbName: string
  private dbPromise: Promise<IDBDatabase> | undefined

  constructor(dbName: string) {
    this.dbName = dbName
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb(this.dbName)
    }
    return this.dbPromise
  }

  async saveSnapshot(checkpointId: string, data: Uint8Array): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite')
    await idbRequest(tx.objectStore(SNAPSHOT_STORE).put(data, checkpointId))
  }

  async loadSnapshot(checkpointId: string): Promise<Uint8Array | null> {
    const db = await this.getDb()
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly')
    const result = await idbRequest(tx.objectStore(SNAPSHOT_STORE).get(checkpointId))
    return (result as Uint8Array) ?? null
  }

  async deleteSnapshot(checkpointId: string): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite')
    await idbRequest(tx.objectStore(SNAPSHOT_STORE).delete(checkpointId))
  }

  async listSnapshots(): Promise<string[]> {
    const db = await this.getDb()
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly')
    const keys = await idbRequest(tx.objectStore(SNAPSHOT_STORE).getAllKeys())
    return keys as string[]
  }

  async saveMetadata(checkpointId: string, meta: CheckpointInfo): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction(METADATA_STORE, 'readwrite')
    await idbRequest(tx.objectStore(METADATA_STORE).put(meta, checkpointId))
  }

  async loadMetadata(checkpointId: string): Promise<CheckpointInfo | null> {
    const db = await this.getDb()
    const tx = db.transaction(METADATA_STORE, 'readonly')
    const result = await idbRequest(tx.objectStore(METADATA_STORE).get(checkpointId))
    return (result as CheckpointInfo) ?? null
  }

  async listMetadata(): Promise<CheckpointInfo[]> {
    const db = await this.getDb()
    const tx = db.transaction(METADATA_STORE, 'readonly')
    const values = await idbRequest(tx.objectStore(METADATA_STORE).getAll())
    return values as CheckpointInfo[]
  }

  async deleteMetadata(checkpointId: string): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction(METADATA_STORE, 'readwrite')
    await idbRequest(tx.objectStore(METADATA_STORE).delete(checkpointId))
  }
}
