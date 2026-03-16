/**
 * Public interfaces for the TripleStore.
 */

import type {
  Triple,
  Value,
  MatchPattern,
  CheckpointInfo,
  CheckpointOptions,
  SerializedState,
  SerializedCheckpointEntry,
  StoreEvents,
} from '../types'

export interface LiveQuery<T> {
  readonly value: T
  subscribe(listener: (value: T) => void): () => void
  dispose(): void
}

export interface StorageBackend {
  saveSnapshot(checkpointId: string, data: Uint8Array): Promise<void>
  loadSnapshot(checkpointId: string): Promise<Uint8Array | null>
  deleteSnapshot(checkpointId: string): Promise<void>
  listSnapshots(): Promise<string[]>
  saveMetadata(checkpointId: string, meta: CheckpointInfo): Promise<void>
  loadMetadata(checkpointId: string): Promise<CheckpointInfo | null>
  listMetadata(): Promise<CheckpointInfo[]>
  deleteMetadata(checkpointId: string): Promise<void>
}

export interface TripleStoreInterface {
  // CRUD
  insert(s: string, p: string, o: Value, g?: string): void
  delete(s: string, p: string, o?: Value, g?: string): void

  // Query
  match(pattern: MatchPattern): Triple[]
  get(s: string, p: string, g?: string): Value | undefined
  getAll(): Triple[]

  // Batch
  batchInsert(triples: Triple[]): void
  clear(): void
  batch(fn: (writer: TripleStoreInterface) => void): void

  // Live Query
  liveMatch(pattern: MatchPattern): LiveQuery<Triple[]>
  liveGet(s: string, p: string, g?: string): LiveQuery<Value | undefined>

  // Version control
  checkpoint(options: CheckpointOptions): CheckpointInfo
  checkout(checkpointId: string): void
  listCheckpoints(): CheckpointInfo[]
  getCheckpoint(id: string): CheckpointInfo | undefined
  deleteCheckpoint(id: string): void

  // Persistence
  persist(checkpointId?: string): Promise<void>
  restore(checkpointId: string): Promise<void>
  persistAll(): Promise<void>
  restoreLatest(): Promise<void>

  // Serialization
  exportState(options?: { keyframeInterval?: number }): SerializedState
  importState(state: SerializedState): void
  exportCheckpoints(ids: string[], options?: { mode?: 'full' | 'delta' }): SerializedCheckpointEntry[]

  // Events
  on<K extends keyof StoreEvents>(event: K, cb: (data: StoreEvents[K]) => void): () => void

  // Lifecycle
  readonly isOpen: boolean
  close(): void
}
