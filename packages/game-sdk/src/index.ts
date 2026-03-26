/**
 * @pubwiki/game-sdk — Reactive Game State SDK
 *
 * Provides React hooks for reactive game state management based on
 * TripleStore change events pushed from the Lua backend.
 *
 * Usage:
 *   import { GameProvider, useCreatures, usePlayer, useDispatch } from '../lib/game-sdk'
 */

export { GameProvider, useGameStore } from './provider'
export { useTripleQuery, useCreatures, usePlayer, useRegions, useField } from './hooks'
export { useDispatch } from './dispatch'
export type { Triple, MatchPattern, ChangeEvent, Value } from './types'
