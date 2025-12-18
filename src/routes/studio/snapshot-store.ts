/**
 * Snapshot Store
 * 
 * Global store for node snapshots with version control support.
 * Designed for future persistence integration.
 */

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
// Snapshot Store Class
// ============================================================================

/**
 * Global store for node snapshots
 * Key: `${nodeId}:${commit}` for fast lookup
 */
class SnapshotStore {
  private snapshots = new Map<string, NodeSnapshot>()

  private makeKey(nodeId: string, commit: string): string {
    return `${nodeId}:${commit}`
  }

  /** Add a snapshot to the store */
  add<T>(snapshot: NodeSnapshot<T>): void {
    const key = this.makeKey(snapshot.nodeId, snapshot.commit)
    this.snapshots.set(key, snapshot as NodeSnapshot)
  }

  /** Get a snapshot by node ID and commit */
  get<T>(nodeId: string, commit: string): NodeSnapshot<T> | undefined {
    const key = this.makeKey(nodeId, commit)
    return this.snapshots.get(key) as NodeSnapshot<T> | undefined
  }

  /** Get all snapshots for a node, sorted by timestamp */
  getByNodeId<T>(nodeId: string): NodeSnapshot<T>[] {
    const results: NodeSnapshot<T>[] = []
    for (const [key, snapshot] of this.snapshots) {
      if (key.startsWith(`${nodeId}:`)) {
        results.push(snapshot as NodeSnapshot<T>)
      }
    }
    return results.sort((a, b) => a.timestamp - b.timestamp)
  }

  /** Check if a snapshot exists */
  has(nodeId: string, commit: string): boolean {
    return this.snapshots.has(this.makeKey(nodeId, commit))
  }

  /** Remove a snapshot */
  remove(nodeId: string, commit: string): boolean {
    return this.snapshots.delete(this.makeKey(nodeId, commit))
  }

  /** Remove all snapshots for a node */
  removeByNodeId(nodeId: string): void {
    for (const key of this.snapshots.keys()) {
      if (key.startsWith(`${nodeId}:`)) {
        this.snapshots.delete(key)
      }
    }
  }

  /** Clear all snapshots */
  clear(): void {
    this.snapshots.clear()
  }

  /** Get total snapshot count */
  get size(): number {
    return this.snapshots.size
  }

  /** Export all snapshots for persistence */
  export(): NodeSnapshot[] {
    return Array.from(this.snapshots.values())
  }

  /** Import snapshots from persistence */
  import(snapshots: NodeSnapshot[]): void {
    this.clear()
    for (const snapshot of snapshots) {
      this.add(snapshot)
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Global snapshot store instance */
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
