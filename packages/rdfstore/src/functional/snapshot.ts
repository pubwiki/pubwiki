/**
 * Snapshot operations for functional API
 */

import type { Triple, TriplePattern, SnapshotRef } from '../types.js'
import type { StoreBackend } from '../backend/quadstore.js'

/**
 * Snapshot view - read-only access to a snapshot's data
 */
export interface SnapshotView {
  /** The reference to this snapshot */
  readonly ref: SnapshotRef

  /**
   * Query triples matching a pattern
   */
  query(pattern: TriplePattern): Promise<Triple[]>

  /**
   * Count total triples
   */
  count(): Promise<number>

  /**
   * Get all triples
   */
  getAllTriples(): Promise<Triple[]>
}

/**
 * Create a snapshot view from the current backend state
 * 
 * Note: In the current implementation, this returns a view of the current state.
 * True immutable snapshots would require copying or versioning the underlying store.
 */
export function createSnapshotView(
  backend: StoreBackend,
  ref: SnapshotRef
): SnapshotView {
  return {
    ref,

    async query(pattern: TriplePattern): Promise<Triple[]> {
      return backend.query(pattern)
    },

    async count(): Promise<number> {
      return backend.count()
    },

    async getAllTriples(): Promise<Triple[]> {
      return backend.getAllTriples()
    }
  }
}

/**
 * Serialize triples to a storable format
 */
export function serializeTriples(triples: Triple[]): string {
  return JSON.stringify(triples)
}

/**
 * Deserialize triples from stored format
 */
export function deserializeTriples(data: string): Triple[] {
  return JSON.parse(data) as Triple[]
}
