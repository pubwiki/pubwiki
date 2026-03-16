/**
 * VersionManager — O(1) checkpoint / checkout via HAMT root pointer saving.
 *
 * Each checkpoint stores references to the current TripleIndex HAMT roots.
 * Because the HAMT is persistent (immutable), saving a reference is O(1).
 *
 * Also maintains an ordered list of checkpoint IDs for delta serialization.
 */

import type { TripleIndex } from '../index/triple-index'
import type { CheckpointInfo, CheckpointOptions, Delta } from '../types'
import { generateId } from '../utils/hash'
import { computeDelta } from './delta'

interface Snapshot {
  index: TripleIndex
  info: CheckpointInfo
  /** Delta from the previous checkpoint (undefined for the first checkpoint) */
  deltaFromPrev?: Delta
  /** ID of the previous checkpoint (undefined for the first checkpoint) */
  prevId?: string
}

export class VersionManager {
  private snapshots = new Map<string, Snapshot>()
  /** Ordered list of checkpoint IDs (insertion order) */
  private order: string[] = []

  /** Create a checkpoint by saving the current HAMT root references. O(1).
   *  Accepts a pre-computed delta from the store for efficient serialization. */
  checkpoint(index: TripleIndex, options: CheckpointOptions, accumulatedDelta?: Delta): CheckpointInfo {
    const id = options.id ?? generateId()
    const info: CheckpointInfo = {
      id,
      title: options.title,
      description: options.description,
      timestamp: Date.now(),
      tripleCount: index.count,
    }

    let deltaFromPrev: Delta | undefined
    let prevId: string | undefined
    if (this.order.length > 0) {
      prevId = this.order[this.order.length - 1]
      // Use the accumulated delta from the store if available
      if (accumulatedDelta && (accumulatedDelta.inserts.length > 0 || accumulatedDelta.deletes.length > 0)) {
        deltaFromPrev = accumulatedDelta
      } else {
        // Fallback: compute from indexes (e.g. first checkpoint after import)
        const prevSnapshot = this.snapshots.get(prevId)
        if (prevSnapshot) {
          deltaFromPrev = computeDelta(prevSnapshot.index, index)
        }
      }
    }

    this.snapshots.set(id, { index, info, deltaFromPrev, prevId })
    this.order.push(id)
    return info
  }

  /** Switch to a checkpoint's state. O(1) pointer swap. */
  checkout(checkpointId: string): { index: TripleIndex; info: CheckpointInfo } {
    const snapshot = this.snapshots.get(checkpointId)
    if (!snapshot) throw new Error(`Checkpoint not found: ${checkpointId}`)
    return snapshot
  }

  listCheckpoints(): CheckpointInfo[] {
    return Array.from(this.snapshots.values())
      .map(s => s.info)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  /** Return checkpoint IDs in insertion order */
  getOrderedIds(): string[] {
    return [...this.order]
  }

  getCheckpoint(id: string): CheckpointInfo | undefined {
    return this.snapshots.get(id)?.info
  }

  getSnapshot(id: string): Snapshot | undefined {
    return this.snapshots.get(id)
  }

  /** Get the cached delta and previous checkpoint ID for a snapshot */
  getDelta(id: string): { delta: Delta; prevId: string } | undefined {
    const snap = this.snapshots.get(id)
    if (!snap?.deltaFromPrev || !snap.prevId) return undefined
    return { delta: snap.deltaFromPrev, prevId: snap.prevId }
  }

  deleteCheckpoint(id: string): void {
    this.snapshots.delete(id)
    const idx = this.order.indexOf(id)
    if (idx !== -1) this.order.splice(idx, 1)
  }

  /** Restore a checkpoint from persisted data (used during restore/import). */
  restoreCheckpoint(info: CheckpointInfo, index: TripleIndex): void {
    this.snapshots.set(info.id, { index, info })
    // Only push to order if not already present
    if (!this.order.includes(info.id)) {
      this.order.push(info.id)
    }
  }

  clear(): void {
    this.snapshots.clear()
    this.order = []
  }
}
