/**
 * Snapshot Store
 * 
 * Global store for node snapshots with version control support.
 * Now backed by Dexie/IndexedDB for persistence with in-memory cache.
 */

import {
  db,
  addSnapshot as dbAddSnapshot,
  getSnapshot as dbGetSnapshot,
  getSnapshotsByNodeId as dbGetSnapshotsByNodeId,
  hasSnapshot as dbHasSnapshot,
  removeSnapshot as dbRemoveSnapshot,
  removeSnapshotsByNodeId as dbRemoveSnapshotsByNodeId,
  clearSnapshots as dbClearSnapshots,
  getAllSnapshots as dbGetAllSnapshots,
  importSnapshots as dbImportSnapshots,
  type StoredSnapshot
} from './db'

// ============================================================================
// Types
// ============================================================================

/**
 * Reference to a node at a specific version
 */
export interface NodeRef {
  /** Node ID */
  id: string
  /** Commit hash at time of reference */
  commit: string
}

/**
 * Simplified edge info for snapshot storage
 * Only stores what's needed to restore connections
 */
export interface SnapshotEdge {
  /** Source node ID */
  source: string
  /** Source handle ID (if any) */
  sourceHandle?: string | null
  /** Target handle ID (if any) */
  targetHandle?: string | null
}

/**
 * Node position at time of snapshot
 */
export interface SnapshotPosition {
  x: number
  y: number
}

/**
 * Snapshot stored in global store
 */
export interface NodeSnapshot<T = unknown> {
  /** Node ID this snapshot belongs to */
  nodeId: string
  /** Commit hash (content hash) */
  commit: string
  /** Node name at time of snapshot */
  name: string
  /** Snapshot content */
  content: T
  /** Timestamp when snapshot was created */
  timestamp: number
  /** Incoming edges at time of snapshot (connections TO this node) */
  incomingEdges?: SnapshotEdge[]
  /** Node position at time of snapshot */
  position?: SnapshotPosition
}

// ============================================================================
// Snapshot Store Class (with Dexie persistence)
// ============================================================================

/**
 * Global store for node snapshots with Dexie persistence.
 * Uses in-memory cache for fast synchronous access, with async persistence.
 * Key: `${nodeId}:${commit}` for fast lookup
 */
class SnapshotStore {
  private cache = new Map<string, NodeSnapshot>()
  private initialized = false
  private initPromise: Promise<void> | null = null

  private makeKey(nodeId: string, commit: string): string {
    return `${nodeId}:${commit}`
  }

  /**
   * Initialize the store by loading all snapshots from IndexedDB.
   * Called automatically on first access, but can be called explicitly.
   */
  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        const snapshots = await dbGetAllSnapshots()
        for (const snapshot of snapshots) {
          const key = this.makeKey(snapshot.nodeId, snapshot.commit)
          this.cache.set(key, snapshot as NodeSnapshot)
        }
        this.initialized = true
      } catch (err) {
        console.error('[SnapshotStore] Failed to load from IndexedDB:', err)
        // Still mark as initialized to allow operation with empty cache
        this.initialized = true
      }
    })()

    return this.initPromise
  }

  /** Add a snapshot to the store (sync cache + async persist) */
  add<T>(snapshot: NodeSnapshot<T>): void {
    const key = this.makeKey(snapshot.nodeId, snapshot.commit)
    this.cache.set(key, snapshot as NodeSnapshot)
    
    // Async persist to IndexedDB (fire and forget with error logging)
    dbAddSnapshot(snapshot as StoredSnapshot).catch(err => {
      console.error('[SnapshotStore] Failed to persist snapshot:', err)
    })
  }

  /** Get a snapshot by node ID and commit (sync from cache) */
  get<T>(nodeId: string, commit: string): NodeSnapshot<T> | undefined {
    const key = this.makeKey(nodeId, commit)
    return this.cache.get(key) as NodeSnapshot<T> | undefined
  }

  /** Get a snapshot by node ID and commit (async from DB if not in cache) */
  async getAsync<T>(nodeId: string, commit: string): Promise<NodeSnapshot<T> | undefined> {
    const cached = this.get<T>(nodeId, commit)
    if (cached) return cached

    const stored = await dbGetSnapshot(nodeId, commit)
    if (stored) {
      // Update cache
      const key = this.makeKey(nodeId, commit)
      this.cache.set(key, stored as NodeSnapshot)
      return stored as NodeSnapshot<T>
    }
    return undefined
  }

  /** Get all snapshots for a node, sorted by timestamp (sync from cache) */
  getByNodeId<T>(nodeId: string): NodeSnapshot<T>[] {
    const results: NodeSnapshot<T>[] = []
    for (const [key, snapshot] of this.cache) {
      if (key.startsWith(`${nodeId}:`)) {
        results.push(snapshot as NodeSnapshot<T>)
      }
    }
    return results.sort((a, b) => a.timestamp - b.timestamp)
  }

  /** Get all snapshots for a node (async from DB) */
  async getByNodeIdAsync<T>(nodeId: string): Promise<NodeSnapshot<T>[]> {
    const stored = await dbGetSnapshotsByNodeId(nodeId)
    // Update cache
    for (const snapshot of stored) {
      const key = this.makeKey(snapshot.nodeId, snapshot.commit)
      this.cache.set(key, snapshot as NodeSnapshot)
    }
    return stored as NodeSnapshot<T>[]
  }

  /** Check if a snapshot exists (sync from cache) */
  has(nodeId: string, commit: string): boolean {
    return this.cache.has(this.makeKey(nodeId, commit))
  }

  /** Check if a snapshot exists (async from DB) */
  async hasAsync(nodeId: string, commit: string): Promise<boolean> {
    if (this.has(nodeId, commit)) return true
    return dbHasSnapshot(nodeId, commit)
  }

  /** Remove a snapshot (sync cache + async persist) */
  remove(nodeId: string, commit: string): boolean {
    const key = this.makeKey(nodeId, commit)
    const existed = this.cache.delete(key)
    
    // Async persist to IndexedDB
    dbRemoveSnapshot(nodeId, commit).catch(err => {
      console.error('[SnapshotStore] Failed to remove snapshot:', err)
    })
    
    return existed
  }

  /** Remove all snapshots for a node (sync cache + async persist) */
  removeByNodeId(nodeId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${nodeId}:`)) {
        this.cache.delete(key)
      }
    }
    
    // Async persist to IndexedDB
    dbRemoveSnapshotsByNodeId(nodeId).catch(err => {
      console.error('[SnapshotStore] Failed to remove snapshots by nodeId:', err)
    })
  }

  /** Clear all snapshots (sync cache + async persist) */
  clear(): void {
    this.cache.clear()
    
    // Async persist to IndexedDB
    dbClearSnapshots().catch(err => {
      console.error('[SnapshotStore] Failed to clear snapshots:', err)
    })
  }

  /** Get total snapshot count (from cache) */
  get size(): number {
    return this.cache.size
  }

  /** Export all snapshots for persistence */
  export(): NodeSnapshot[] {
    return Array.from(this.cache.values())
  }

  /** Import snapshots from external source (replaces all) */
  import(snapshots: NodeSnapshot[]): void {
    this.cache.clear()
    for (const snapshot of snapshots) {
      const key = this.makeKey(snapshot.nodeId, snapshot.commit)
      this.cache.set(key, snapshot)
    }
    
    // Async persist to IndexedDB
    dbImportSnapshots(snapshots as StoredSnapshot[]).catch(err => {
      console.error('[SnapshotStore] Failed to import snapshots:', err)
    })
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Global snapshot store instance (with Dexie persistence) */
export const snapshotStore = new SnapshotStore()

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a content hash for version control using SHA-256
 * Returns first 16 hex characters of the hash for brevity
 */
export async function generateCommitHash(content: unknown): Promise<string> {
  const str = typeof content === 'string' ? content : JSON.stringify(content)
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex.slice(0, 16)
}

/**
 * Initialize the snapshot store by loading from IndexedDB.
 * Should be called at app startup for optimal performance.
 */
export async function initSnapshotStore(): Promise<void> {
  return snapshotStore.init()
}
