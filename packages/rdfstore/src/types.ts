/**
 * @pubwiki/rdfstore - Type Definitions
 * 
 * Core types for the RDF store with immutable version DAG
 * 基础类型从 @pubwiki/rdfsync 导入
 */

import type { TextPatch, Operation as SyncOperation } from '@pubwiki/rdfsync'
import { fromRdfQuad, toRdfQuad, serializeTerm, deserializeSubject, deserializePredicate } from '@pubwiki/rdfsync'
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
 * 将简化版 SyncOperation 转换为 RDF.js Operation
 * @throws Error if the operation data is invalid or corrupted
 */
export function fromSyncOperation(op: SyncOperation): Operation {
  switch (op.type) {
    case 'insert':
    case 'delete':
      if (!op.quad || typeof op.quad.subject !== 'string') {
        throw new Error(`Invalid ${op.type} operation: missing or invalid quad data`)
      }
      return { type: op.type, quad: toRdfQuad(op.quad) }
    case 'batch-insert':
    case 'batch-delete':
      if (!Array.isArray(op.quads)) {
        throw new Error(`Invalid ${op.type} operation: quads is not an array`)
      }
      return { type: op.type, quads: op.quads.map(toRdfQuad) }
    case 'patch':
      if (typeof op.subject !== 'string' || typeof op.predicate !== 'string') {
        throw new Error(`Invalid patch operation: missing subject or predicate`)
      }
      return { 
        type: op.type, 
        subject: deserializeSubject(op.subject), 
        predicate: deserializePredicate(op.predicate), 
        patch: op.patch 
      }
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
 * Used to accelerate checkout operations and for manual saves
 */
export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string
  /** The ref this checkpoint is for */
  ref: Ref
  /** User-provided title for the checkpoint */
  title: string
  /** Optional description */
  description?: string
  /** When the checkpoint was created */
  timestamp: number
  /** Number of quads in this checkpoint */
  quadCount: number
}

/**
 * Options for creating a checkpoint
 */
export interface CheckpointOptions {
  /** Optional custom ID (defaults to crypto.randomUUID()) */
  id?: string
  /** User-provided title for the checkpoint */
  title: string
  /** Optional description */
  description?: string
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
