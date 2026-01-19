/**
 * @pubwiki/rdfstore - Type Definitions
 * 
 * Core types for the RDF store with immutable version DAG
 * 基础类型从 @pubwiki/rdfsync 导入
 */

import type { TextPatch, Operation as SyncOperation } from '@pubwiki/rdfsync'
import { fromRdfQuad, serializeTerm } from '@pubwiki/rdfsync'
import type { Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph } from '@rdfjs/types'
import { AbstractLevel } from 'abstract-level'
import type { Quad } from '@rdfjs/types'

// Re-export from rdfsync
export type {
  Quad,
  TextPatch,
  PatchHunk,
  Operation as SyncOperation,
} from '@pubwiki/rdfsync'

export { ROOT_REF } from '@pubwiki/rdfsync'

export type Operation =
  | { type: 'insert'; quad: Quad }
  | { type: 'delete'; quad: Quad }
  | { type: 'batch-insert'; quads: Quad[] }
  | { type: 'batch-delete'; quads: Quad[] }
  | { type: 'patch'; subject: Quad_Subject; predicate: Quad_Predicate; patch: TextPatch }


/**
 * 将 RDF.js Operation 转换为简化版 Operation
 */
export function toSyncOperation(op: Operation): SyncOperation {
  switch (op.type) {
    case 'insert':
    case 'delete':
      return { type: op.type, quad: fromRdfQuad(op.quad) }
    case 'batch-insert':
    case 'batch-delete':
      return { type: op.type, quads: op.quads.map(fromRdfQuad) }
    case 'patch':
      return { type: op.type, subject: serializeTerm(op.subject), predicate: serializeTerm(op.predicate), patch: op.patch }
  }
}

/**
 * Quad query pattern - all fields are optional for flexible matching
 */
export interface QuadPattern {
  subject?: Quad_Subject | null
  predicate?: Quad_Predicate | null
  object?: Quad_Object | null
  graph?: Quad_Graph | null
}

// ============ Version DAG Types ============

/**
 * Immutable state reference
 * Each operation creates a new ref
 */
export type Ref = string

/**
 * A node in the version DAG
 * Represents a state reached by applying an operation to a parent state
 */
export interface RefNode {
  /** This node's ref */
  ref: Ref
  /** Parent state (null for root) */
  parent: Ref | null
  /** Operation that transforms parent -> this state */
  operation: Operation
  /** When this node was created */
  timestamp: number
}

/**
 * Checkpoint - a saved snapshot of quad data at a specific ref
 * Used to accelerate checkout operations
 */
export interface Checkpoint {
  /** The ref this checkpoint is for */
  ref: Ref
  /** When the checkpoint was created */
  timestamp: number
  /** Number of quads in this checkpoint */
  quadCount: number
}

/**
 * Type for abstract-level instances compatible with the store.
 */
export type LevelInstance = AbstractLevel<
  any,
  string,
  string
>

/**
 * Store configuration options
 */
export interface StoreConfig {
  // Reserved for future options
}

/**
 * Default store configuration
 */
export const DEFAULT_STORE_CONFIG: StoreConfig = {}

/**
 * Event types emitted by the store
 */
export type StoreEventType = 'change' | 'checkout'

/**
 * Event payloads
 */
export interface StoreEvents {
  change: { ref: Ref; operation: Operation }
  checkout: { from: Ref; to: Ref }
}
