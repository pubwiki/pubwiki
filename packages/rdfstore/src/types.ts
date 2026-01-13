/**
 * @pubwiki/rdfstore - Type Definitions
 * 
 * Core types for the RDF store with immutable version DAG
 * Uses standard RDF.js Quad types from @rdfjs/types
 */

import type { Quad, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph } from '@rdfjs/types'

// Re-export RDF.js types for convenience
export type { Quad, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph }

/**
 * Quad query pattern - all fields are optional for flexible matching
 */
export interface QuadPattern {
  subject?: Quad_Subject | null
  predicate?: Quad_Predicate | null
  object?: Quad_Object | null
  graph?: Quad_Graph | null
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
 * Operation types
 */
export type Operation =
  | { type: 'insert'; quad: Quad }
  | { type: 'delete'; quad: Quad }
  | { type: 'batch-insert'; quads: Quad[] }
  | { type: 'batch-delete'; quads: Quad[] }
  | { type: 'patch'; subject: Quad_Subject; predicate: Quad_Predicate; patch: TextPatch }

// ============ Version DAG Types ============

/**
 * Immutable state reference
 * Each operation creates a new ref
 */
export type Ref = string

/**
 * Special ref for empty/initial state
 */
export const ROOT_REF: Ref = 'root'

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
export type LevelInstance = import('abstract-level').AbstractLevel<
  Buffer | Uint8Array | string,
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
