/**
 * Core types for the new TripleStore.
 */

/** Triple value: native types directly usable from Lua */
export type Value = string | number | boolean | Record<string, unknown> | unknown[]

/** A triple (subject, predicate, object, optional graph) */
export interface Triple {
  subject: string
  predicate: string
  object: Value
  graph?: string
}

/** Query pattern – all fields optional; absent fields are wildcards */
export interface MatchPattern {
  subject?: string
  predicate?: string
  object?: Value
  graph?: string
}

/** Checkpoint metadata */
export interface CheckpointInfo {
  id: string
  title: string
  description?: string
  timestamp: number
  tripleCount: number
}

/** Options for creating a checkpoint */
export interface CheckpointOptions {
  id?: string
  title: string
  description?: string
}

/** A delta between two versions — only the inserts and deletes */
export interface Delta {
  inserts: Triple[]
  deletes: Triple[]
}

/** Serialized state for import/export — delta encoding with periodic keyframes. */
export interface SerializedState {
  version: 2
  /** Current working state (full triple list) */
  triples: Triple[]
  /** Ordered checkpoint entries — either a keyframe or a delta */
  checkpoints: Array<SerializedCheckpointEntry>
  /** How often a keyframe is stored (e.g. 50 = every 50th checkpoint) */
  keyframeInterval: number
}

export type SerializedCheckpointEntry =
  | { info: CheckpointInfo; type: 'keyframe'; triples: Triple[] }
  | { info: CheckpointInfo; type: 'delta'; parentId: string; delta: Delta }

/** Change event emitted after mutations */
export interface ChangeEvent {
  type: 'insert' | 'delete'
  triple: Triple
}

/** Events emitted by the TripleStore */
export type StoreEvents = {
  [K in 'change']: ChangeEvent[]
} & {
  [K in 'checkpointCreated']: CheckpointInfo
} & {
  [K in 'checkpointLoaded']: CheckpointInfo
}
