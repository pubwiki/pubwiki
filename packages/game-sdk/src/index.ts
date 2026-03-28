/**
 * @pubwiki/game-sdk — Reactive Game State SDK
 *
 * Provides React hooks for reactive game state management based on
 * TripleStore change events pushed from the Lua backend.
 *
 * Usage:
 *   import { GameProvider, useCreatures, usePlayer, usePub } from '../lib/game-sdk'
 *   import { PW_PRED, PWC_PRED, GRAPH } from '../lib/game-sdk'
 */

export { GameProvider, useGameStore } from './provider.tsx'
export { useTripleQuery, useCreatures, usePlayer, useRegions, useOrganizations, useField } from './hooks.ts'
export { usePub } from './backend.ts'
export type { PubBackend, ServiceCallable } from './backend.ts'
export type { Triple, MatchPattern, ChangeEvent, Value } from './types.ts'

// RDF vocabulary constants
export {
  SUBJECT,
  GRAPH,
  PW_PRED,
  PW_WORLD,
  PWC_PRED,
  PWR_PRED,
  PWO_PRED,
  PWS_PRED,
  PWI_PRED,
  PW_STATUS,
  PW_STORY,
  JSON_PREDICATES,
  extractId,
  subjectPrefix,
} from './vocabulary.ts'
