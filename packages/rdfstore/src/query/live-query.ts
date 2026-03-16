/**
 * LiveQuery and ChangeTracker for reactive queries.
 */

import type { ChangeEvent, MatchPattern } from '../types'

/** Internal interface for LiveQuery instances tracked by ChangeTracker */
export interface LiveQueryEntry {
  readonly pattern: MatchPattern
  recompute(): void
  isAffectedBy(change: ChangeEvent): boolean
  notifyListeners(): void
}

/**
 * ChangeTracker accumulates changes during mutations and notifies
 * affected LiveQuery instances when changes are flushed.
 */
export class ChangeTracker {
  private pending: ChangeEvent[] = []
  private liveQueries = new Set<LiveQueryEntry>()
  private batchDepth = 0

  record(change: ChangeEvent): void {
    this.pending.push(change)
  }

  beginBatch(): void {
    this.batchDepth++
  }

  endBatch(): void {
    this.batchDepth--
  }

  /**
   * Flush accumulated changes:
   * - Notify affected live queries
   * - Return the changes array (caller emits the 'change' event)
   */
  flush(): ChangeEvent[] {
    if (this.batchDepth > 0) return []
    if (this.pending.length === 0) return []

    const changes = this.pending
    this.pending = []

    // Notify affected live queries
    for (const lq of this.liveQueries) {
      let affected = false
      for (const change of changes) {
        if (lq.isAffectedBy(change)) {
          affected = true
          break
        }
      }
      if (affected) {
        lq.recompute()
        lq.notifyListeners()
      }
    }

    return changes
  }

  /** Force all live queries to recompute (e.g. after checkout) */
  recomputeAll(): void {
    for (const lq of this.liveQueries) {
      lq.recompute()
      lq.notifyListeners()
    }
  }

  addLiveQuery(lq: LiveQueryEntry & { _setTracker?: (tracker: ChangeTracker) => void }): void {
    this.liveQueries.add(lq)
    lq._setTracker?.(this)
  }

  removeLiveQuery(lq: LiveQueryEntry): void {
    this.liveQueries.delete(lq)
  }

  dispose(): void {
    this.liveQueries.clear()
    this.pending = []
  }
}

/**
 * LiveQuery implementation that caches a query result and recomputes
 * when affected by changes.
 */
export class LiveQueryImpl<T> implements LiveQueryEntry {
  readonly pattern: MatchPattern
  private computeFn: () => T
  private _value: T
  private listeners = new Set<(value: T) => void>()
  private _disposed = false
  private tracker: ChangeTracker | undefined

  constructor(pattern: MatchPattern, computeFn: () => T) {
    this.pattern = pattern
    this.computeFn = computeFn
    this._value = computeFn()
  }

  get value(): T {
    return this._value
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this._disposed = true
    this.listeners.clear()
    if (this.tracker) {
      this.tracker.removeLiveQuery(this)
    }
  }

  /** @internal Set the tracker reference for auto-removal on dispose */
  _setTracker(tracker: ChangeTracker): void {
    this.tracker = tracker
  }

  /** @internal Check if a change affects this query */
  isAffectedBy(change: ChangeEvent): boolean {
    if (this._disposed) return false
    const { subject, predicate, object, graph } = this.pattern
    const t = change.triple

    if (subject !== undefined && t.subject !== subject) return false
    if (predicate !== undefined && t.predicate !== predicate) return false
    if (object !== undefined && t.object !== object) return false
    if (graph !== undefined && t.graph !== graph) return false

    return true
  }

  /** @internal Recompute the cached value */
  recompute(): void {
    if (this._disposed) return
    this._value = this.computeFn()
  }

  /** @internal Notify all subscribers of the new value */
  notifyListeners(): void {
    if (this._disposed) return
    for (const listener of this.listeners) {
      try {
        listener(this._value)
      } catch (error) {
        console.error('Error in LiveQuery listener:', error)
      }
    }
  }
}
