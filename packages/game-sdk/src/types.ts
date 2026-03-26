/**
 * Core types mirroring @pubwiki/rdfstore for the game-sdk.
 * These match the types used by the backend TripleStore.
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

/**
 * Subscription event pushed from the backend.
 */
export type SubscriptionEvent =
  | { type: 'snapshot'; triples: Triple[] }
  | { type: 'changes'; events: ChangeEvent[] }
