/**
 * @pubwiki/rdfstore - Type Definitions
 * 
 * Core types for the RDF store with WAL-based versioning
 */

import type { NamedNode, Literal, BlankNode } from '@rdfjs/types'

/**
 * RDF Term type aliases (from RDF.js specification)
 */
export type SubjectNode = NamedNode | BlankNode
export type PredicateNode = NamedNode
export type ObjectNode = NamedNode | Literal | BlankNode

/**
 * RDF Triple - using standard RDF.js types
 */
export interface Triple {
  subject: SubjectNode
  predicate: PredicateNode
  object: ObjectNode
}

/**
 * Triple query pattern - all fields are optional for flexible matching
 */
export interface TriplePattern {
  subject?: SubjectNode | null
  predicate?: PredicateNode | null
  object?: ObjectNode | null
}

/**
 * Text patch for Literal values
 */
export interface TextPatch {
  originalLength: number
  hunks: PatchHunk[]
}

export interface PatchHunk {
  start: number
  deleteCount: number
  insert: string
}

/**
 * Operation types for the write-ahead log
 */
export type Operation =
  | { type: 'insert'; triple: Triple }
  | { type: 'delete'; triple: Triple }
  | { type: 'batch-insert'; triples: Triple[] }
  | { type: 'batch-delete'; triples: Triple[] }
  | { type: 'patch'; subject: SubjectNode; predicate: PredicateNode; patch: TextPatch }

/**
 * Log entry - a single entry in the write-ahead log
 */
export interface LogEntry {
  /** Unique identifier for this log entry */
  id: string
  /** Unix timestamp when the operation was recorded */
  timestamp: number
  /** The operation that was performed */
  operation: Operation
  /** Reference to the snapshot before this operation */
  prevRef: SnapshotRef
}

/**
 * Snapshot reference - an opaque handle to a specific snapshot
 * Internally this is a content hash or sequence number
 */
export type SnapshotRef = string

/**
 * Information about a saved snapshot
 */
export interface SnapshotInfo {
  /** Reference to this snapshot */
  ref: SnapshotRef
  /** Unix timestamp when the snapshot was created */
  timestamp: number
  /** Number of triples in this snapshot */
  tripleCount: number
  /** Position in the log where this snapshot was created */
  logIndex: number
  /** Optional user-provided label for this snapshot */
  label?: string
  /** Whether this was automatically created by the checkpoint system */
  isAutoCheckpoint: boolean
}

/**
 * Type for abstract-level instances compatible with the store.
 * Uses a more permissive key type to be compatible with MemoryLevel, BrowserLevel, etc.
 */
export type LevelInstance = import('abstract-level').AbstractLevel<
  Buffer | Uint8Array | string,
  string,
  string
>

/**
 * Configuration options for the RDF store
 */
export interface StoreConfig {
  /** Number of operations between automatic checkpoints (default: 100) */
  autoCheckpointInterval: number
  /** Whether automatic checkpoints are enabled (default: true) */
  enableAutoCheckpoint: boolean
}

/**
 * Default store configuration
 */
export const DEFAULT_STORE_CONFIG: StoreConfig = {
  autoCheckpointInterval: 100,
  enableAutoCheckpoint: true,
}

/**
 * Internal log record types
 */
export type LogRecord =
  | { type: 'checkpoint'; ref: SnapshotRef; logIndex: number; timestamp: number }
  | { type: 'operation'; entry: LogEntry }

/**
 * Snapshot metadata stored in the database
 */
export interface StoredSnapshotMeta {
  ref: SnapshotRef
  timestamp: number
  tripleCount: number
  logIndex: number
  label?: string
  isAutoCheckpoint: boolean
}

/**
 * Options for querying history
 */
export interface HistoryOptions {
  /** Maximum number of entries to return */
  limit?: number
  /** Start from this snapshot reference */
  since?: SnapshotRef
  /** End at this snapshot reference */
  until?: SnapshotRef
}

/**
 * Event types emitted by the store
 */
export type StoreEventType = 'change' | 'snapshot' | 'rollback'

/**
 * Event payloads
 */
export interface StoreEvents {
  change: LogEntry
  snapshot: SnapshotInfo
  rollback: { from: SnapshotRef; to: SnapshotRef }
}
