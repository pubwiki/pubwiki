/**
 * TripleStore — synchronous, in-memory triple store with event support.
 *
 * Built on a persistent HAMT-based TripleIndex. Mutations are synchronous
 * and fire change events.
 *
 * Phase 2: basic CRUD + batch + events.
 * Phase 3 adds version control (checkpoint / checkout).
 * Phase 4 adds LiveQuery.
 * Phase 5 adds persistence (StorageBackend).
 */

import { TripleIndex } from '../index/triple-index'
import { EventEmitter } from '../utils/events'
import type {
  Triple,
  Value,
  MatchPattern,
  ChangeEvent,
  CheckpointInfo,
  CheckpointOptions,
  SerializedState,
  SerializedCheckpointEntry,
  StoreEvents,
} from '../types'
import type { LiveQuery, StorageBackend, TripleStoreInterface } from './interfaces'
import { VersionManager } from '../version/manager'
import { ChangeTracker, LiveQueryImpl } from '../query/live-query'
import { serialize, deserialize } from '../version/serializer'
import { computeDelta, applyDelta } from '../version/delta'
import { AsyncMutex } from '../utils/async-mutex'

export class TripleStoreImpl implements TripleStoreInterface {
  private index: TripleIndex
  private emitter = new EventEmitter<StoreEvents>()
  private versionManager: VersionManager
  private changeTracker = new ChangeTracker()
  private _isOpen = true
  private backend: StorageBackend | undefined
  /** Accumulated changes since last checkpoint, for delta computation */
  private pendingDelta: { inserts: Triple[]; deletes: Triple[] } = { inserts: [], deletes: [] }
  /** Mutex for serializing async persistence operations */
  private persistenceMutex = new AsyncMutex()

  constructor(backend?: StorageBackend) {
    this.index = TripleIndex.empty()
    this.versionManager = new VersionManager()
    this.backend = backend
  }

  // ──── CRUD (synchronous, pure memory) ────

  insert(s: string, p: string, o: Value, g?: string): void {
    this.assertOpen()
    const prev = this.index
    this.index = this.index.insert(s, p, o, g)
    if (this.index !== prev) {
      const triple: Triple = { subject: s, predicate: p, object: o, ...(g !== undefined ? { graph: g } : {}) }
      const change: ChangeEvent = { type: 'insert', triple }
      this.changeTracker.record(change)
      this.pendingDelta.inserts.push(triple)
      this.flushChanges()
    }
  }

  delete(s: string, p: string, o?: Value, g?: string): void {
    this.assertOpen()
    // Collect triples being deleted for change events
    const toDelete = o !== undefined
      ? this.index.match({ subject: s, predicate: p, object: o, graph: g })
      : this.index.match({ subject: s, predicate: p, graph: g })

    const prev = this.index
    this.index = this.index.delete(s, p, o, g)
    if (this.index !== prev) {
      for (const t of toDelete) {
        this.changeTracker.record({ type: 'delete', triple: t })
        this.pendingDelta.deletes.push(t)
      }
      this.flushChanges()
    }
  }

  // ──── Query (synchronous) ────

  match(pattern: MatchPattern): Triple[] {
    this.assertOpen()
    return this.index.match(pattern)
  }

  get(s: string, p: string, g?: string): Value | undefined {
    this.assertOpen()
    return this.index.get(s, p, g)
  }

  getAll(): Triple[] {
    this.assertOpen()
    return this.index.getAll()
  }

  // ──── Batch ────

  batchInsert(triples: Triple[]): void {
    this.assertOpen()
    this.changeTracker.beginBatch()
    for (const t of triples) {
      const prev = this.index
      this.index = this.index.insert(t.subject, t.predicate, t.object, t.graph)
      if (this.index !== prev) {
        this.changeTracker.record({ type: 'insert', triple: t })
        this.pendingDelta.inserts.push(t)
      }
    }
    this.changeTracker.endBatch()
    this.flushChanges()
  }

  clear(): void {
    this.assertOpen()
    const all = this.index.getAll()
    this.index = TripleIndex.empty()
    for (const t of all) {
      this.changeTracker.record({ type: 'delete', triple: t })
      this.pendingDelta.deletes.push(t)
    }
    this.flushChanges()
  }

  batch(fn: (writer: TripleStoreInterface) => void): void {
    this.assertOpen()
    this.changeTracker.beginBatch()
    fn(this)
    this.changeTracker.endBatch()
    // Changes were already recorded by insert/delete calls within fn.
    // Flush is a no-op if already flushed, otherwise flush now.
    this.flushChanges()
  }

  // ──── Live Query ────

  liveMatch(pattern: MatchPattern): LiveQuery<Triple[]> {
    this.assertOpen()
    const lq = new LiveQueryImpl<Triple[]>(
      pattern,
      () => this.index.match(pattern),
    )
    this.changeTracker.addLiveQuery(lq)
    return lq
  }

  liveGet(s: string, p: string, g?: string): LiveQuery<Value | undefined> {
    this.assertOpen()
    const pattern: MatchPattern = { subject: s, predicate: p, graph: g }
    const lq = new LiveQueryImpl<Value | undefined>(
      pattern,
      () => this.index.get(s, p, g),
    )
    this.changeTracker.addLiveQuery(lq)
    return lq
  }

  // ──── Version Control (synchronous O(1) pointer operations) ────

  checkpoint(options: CheckpointOptions): CheckpointInfo {
    this.assertOpen()
    const delta = { ...this.pendingDelta }
    const info = this.versionManager.checkpoint(this.index, options, delta)
    this.pendingDelta = { inserts: [], deletes: [] }
    this.emitter.emit('checkpointCreated', info)
    return info
  }

  checkout(checkpointId: string): void {
    this.assertOpen()
    const result = this.versionManager.checkout(checkpointId)
    this.index = result.index
    // Reset pending delta — previous accumulation is invalid after switching versions
    this.pendingDelta = { inserts: [], deletes: [] }
    this.emitter.emit('checkpointLoaded', result.info)
    // Recompute all live queries
    this.changeTracker.recomputeAll()
  }

  listCheckpoints(): CheckpointInfo[] {
    this.assertOpen()
    return this.versionManager.listCheckpoints()
  }

  getCheckpoint(id: string): CheckpointInfo | undefined {
    this.assertOpen()
    return this.versionManager.getCheckpoint(id)
  }

  deleteCheckpoint(id: string): void {
    this.assertOpen()
    this.versionManager.deleteCheckpoint(id)
  }

  // ──── Persistence (async, StorageBackend I/O) ────

  async persist(checkpointId?: string): Promise<void> {
    this.assertOpen()
    if (!this.backend) return

    await this.persistenceMutex.run(async () => {
      const id = checkpointId ?? 'current'
      const snapshot = this.versionManager.getSnapshot(id) ?? {
        index: this.index,
        info: { id, title: 'current', timestamp: Date.now(), tripleCount: this.index.count },
      }
      const data = serialize(snapshot.index)
      await this.backend!.saveSnapshot(id, data)
      if (snapshot.info) {
        await this.backend!.saveMetadata(id, snapshot.info as CheckpointInfo)
      }
    })
  }

  async restore(checkpointId: string): Promise<void> {
    this.assertOpen()
    if (!this.backend) return

    await this.persistenceMutex.run(async () => {
      const data = await this.backend!.loadSnapshot(checkpointId)
      if (!data) throw new Error(`Snapshot not found: ${checkpointId}`)
      const triples = deserialize(data)
      let idx = TripleIndex.empty()
      for (const t of triples) {
        idx = idx.insert(t.subject, t.predicate, t.object, t.graph)
      }
      this.index = idx

      const meta = await this.backend!.loadMetadata(checkpointId)
      if (meta) {
        this.versionManager.restoreCheckpoint(meta, idx)
        this.emitter.emit('checkpointLoaded', meta)
      }
      this.pendingDelta = { inserts: [], deletes: [] }
      this.changeTracker.recomputeAll()
    })
  }

  async persistAll(): Promise<void> {
    this.assertOpen()
    if (!this.backend) return

    await this.persistenceMutex.run(async () => {
      // Persist current state
      const currentData = serialize(this.index)
      await this.backend!.saveSnapshot('current', currentData)
      await this.backend!.saveMetadata('current', {
        id: 'current', title: 'current', timestamp: Date.now(), tripleCount: this.index.count,
      })

      // Persist all checkpoints
      for (const cp of this.versionManager.listCheckpoints()) {
        const snapshot = this.versionManager.getSnapshot(cp.id)
        if (snapshot) {
          const data = serialize(snapshot.index)
          await this.backend!.saveSnapshot(cp.id, data)
          await this.backend!.saveMetadata(cp.id, cp)
        }
      }
    })
  }

  async restoreLatest(): Promise<void> {
    this.assertOpen()
    if (!this.backend) return

    await this.persistenceMutex.run(async () => {
      const metas = await this.backend!.listMetadata()
      if (metas.length === 0) return

      // Sort by timestamp descending, pick the latest
      metas.sort((a, b) => b.timestamp - a.timestamp)

      // Restore all checkpoints
      for (const meta of metas) {
        if (meta.id === 'current') continue
        const data = await this.backend!.loadSnapshot(meta.id)
        if (data) {
          const triples = deserialize(data)
          let idx = TripleIndex.empty()
          for (const t of triples) {
            idx = idx.insert(t.subject, t.predicate, t.object, t.graph)
          }
          this.versionManager.restoreCheckpoint(meta, idx)
        }
      }

      // Restore current state
      const currentData = await this.backend!.loadSnapshot('current')
      if (currentData) {
        const triples = deserialize(currentData)
        let idx = TripleIndex.empty()
        for (const t of triples) {
          idx = idx.insert(t.subject, t.predicate, t.object, t.graph)
        }
        this.index = idx
      }

      this.pendingDelta = { inserts: [], deletes: [] }
      this.changeTracker.recomputeAll()
    })
  }

  // ──── Serialization ────

  /** Default keyframe interval for delta encoding */
  static readonly DEFAULT_KEYFRAME_INTERVAL = 50

  exportState(options?: { keyframeInterval?: number }): SerializedState {
    this.assertOpen()
    const keyframeInterval = options?.keyframeInterval ?? TripleStoreImpl.DEFAULT_KEYFRAME_INTERVAL
    const orderedIds = this.versionManager.getOrderedIds()
    const entries: SerializedCheckpointEntry[] = []

    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]
      const snapshot = this.versionManager.getSnapshot(id)
      if (!snapshot) continue

      const isKeyframe = i % keyframeInterval === 0

      if (isKeyframe) {
        entries.push({
          info: snapshot.info,
          type: 'keyframe',
          triples: snapshot.index.getAll(),
        })
      } else {
        // Use cached delta from checkpoint time (fast path)
        const cached = this.versionManager.getDelta(id)
        if (cached) {
          entries.push({
            info: snapshot.info,
            type: 'delta',
            parentId: cached.prevId,
            delta: cached.delta,
          })
        } else {
          // Fallback: compute delta from previous entry (restored checkpoints)
          const prevId = orderedIds[i - 1]
          const prevSnapshot = this.versionManager.getSnapshot(prevId)
          if (prevSnapshot) {
            const delta = computeDelta(prevSnapshot.index, snapshot.index)
            entries.push({
              info: snapshot.info,
              type: 'delta',
              parentId: prevId,
              delta,
            })
          } else {
            // Can't compute delta, fall back to keyframe
            entries.push({
              info: snapshot.info,
              type: 'keyframe',
              triples: snapshot.index.getAll(),
            })
          }
        }
      }
    }

    return {
      version: 2,
      triples: this.index.getAll(),
      checkpoints: entries,
      keyframeInterval,
    }
  }

  importState(state: SerializedState): void {
    this.assertOpen()

    // Rebuild current index
    let idx = TripleIndex.empty()
    for (const t of state.triples) {
      idx = idx.insert(t.subject, t.predicate, t.object, t.graph)
    }
    this.index = idx

    // Rebuild checkpoints from ordered entries (keyframes + deltas)
    this.versionManager = new VersionManager()
    const indexById = new Map<string, TripleIndex>()

    for (const entry of state.checkpoints) {
      let cpIdx: TripleIndex

      if (entry.type === 'keyframe') {
        cpIdx = TripleIndex.empty()
        for (const t of entry.triples) {
          cpIdx = cpIdx.insert(t.subject, t.predicate, t.object, t.graph)
        }
      } else {
        // Delta — apply to parent
        const parentIdx = indexById.get(entry.parentId)
        if (!parentIdx) {
          throw new Error(`Delta parent not found: ${entry.parentId}`)
        }
        cpIdx = applyDelta(parentIdx, entry.delta)
      }

      indexById.set(entry.info.id, cpIdx)
      this.versionManager.restoreCheckpoint(entry.info, cpIdx)
    }

    this.changeTracker.recomputeAll()
  }

  exportCheckpoints(ids: string[], options?: { mode?: 'full' | 'delta' }): SerializedCheckpointEntry[] {
    this.assertOpen()
    const mode = options?.mode ?? 'full'
    const entries: SerializedCheckpointEntry[] = []

    for (let i = 0; i < ids.length; i++) {
      const snapshot = this.versionManager.getSnapshot(ids[i])
      if (!snapshot) {
        throw new Error(`Checkpoint not found: ${ids[i]}`)
      }

      if (mode === 'full' || i === 0) {
        entries.push({
          info: snapshot.info,
          type: 'keyframe',
          triples: snapshot.index.getAll(),
        })
      } else {
        // Delta relative to the previous checkpoint in this batch
        const prevSnapshot = this.versionManager.getSnapshot(ids[i - 1])!
        const delta = computeDelta(prevSnapshot.index, snapshot.index)
        entries.push({
          info: snapshot.info,
          type: 'delta',
          parentId: ids[i - 1],
          delta,
        })
      }
    }

    return entries
  }

  // ──── Events ────

  on<K extends keyof StoreEvents>(event: K, cb: (data: StoreEvents[K]) => void): () => void {
    return this.emitter.on(event, cb)
  }

  // ──── Lifecycle ────

  get isOpen(): boolean {
    return this._isOpen
  }

  close(): void {
    this._isOpen = false
    this.changeTracker.dispose()
    this.emitter.removeAllListeners()
  }

  // ──── Internal ────

  private assertOpen(): void {
    if (!this._isOpen) throw new Error('TripleStore is closed')
  }

  private flushChanges(): void {
    const changes = this.changeTracker.flush()
    if (changes.length > 0) {
      this.emitter.emit('change', changes)
    }
  }
}
