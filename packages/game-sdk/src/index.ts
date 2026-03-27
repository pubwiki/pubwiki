/**
 * @pubwiki/game-sdk — Reactive Game State SDK
 *
 * Provides React hooks for reactive game state management based on
 * TripleStore change events pushed from the Lua backend.
 *
 * Usage:
 *   import { GameProvider, useCreatures, usePlayer, usePub } from '../lib/game-sdk'
 */

export { GameProvider, useGameStore } from './provider.tsx'
export { useTripleQuery, useCreatures, usePlayer, useRegions, useField } from './hooks.ts'
export { usePub } from './backend.ts'
export type { PubBackend, ServiceCallable } from './backend.ts'
export type { Triple, MatchPattern, ChangeEvent, Value } from './types.ts'
