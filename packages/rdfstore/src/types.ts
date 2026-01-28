/**
 * @pubwiki/rdfstore - Type Definitions
 * 
 * Core types for the RDF store with checkpoint-based versioning
 * 
 * 重构后：移除了 Ref、RefNode、Operation 等区块链式版本控制概念
 * 简化为纯 Checkpoint 快照模式
 */

import { AbstractLevel } from 'abstract-level'
import type { Quad } from '@rdfjs/types'

// Re-export Quad type from @rdfjs/types
export type { Quad } from '@rdfjs/types'

/**
 * Quad query pattern - all fields are optional for flexible matching
 */
export interface QuadPattern {
  subject?: Quad['subject'] | null
  predicate?: Quad['predicate'] | null
  object?: Quad['object'] | null
  graph?: Quad['graph'] | null
}

// ============ Checkpoint Types ============

/**
 * Checkpoint - a saved snapshot of quad data
 * Used for version saves and cloud sync
 */
export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string
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
 * Event types emitted by the store
 */
export type StoreEventType = 'checkpointCreated' | 'checkpointLoaded'

/**
 * Event payloads
 */
export interface StoreEvents {
  checkpointCreated: { checkpointId: string }
  checkpointLoaded: { checkpointId: string }
}
