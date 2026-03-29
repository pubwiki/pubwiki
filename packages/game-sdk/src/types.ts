/**
 * Core types for the game-sdk — low-level wire format only.
 *
 * Structured game entity types (Creature, Region, etc.) live in @pubwiki/game-ui.
 */

export type Value = string | number | boolean | Record<string, unknown> | unknown[]

export interface Triple {
  subject: string
  predicate: string
  object: Value
  graph?: string
}

export interface MatchPattern {
  subject?: string
  predicate?: string
  object?: Value
  graph?: string
}

export interface ChangeEvent {
  type: 'insert' | 'delete'
  triple: Triple
}

/** Subscription event pushed from the backend. */
export type SubscriptionEvent =
  | { type: 'snapshot'; triples: Triple[] }
  | { type: 'changes'; events: ChangeEvent[] }
