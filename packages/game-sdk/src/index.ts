/**
 * @pubwiki/game-sdk — Connection & RPC Layer
 *
 * Provides the foundation for game frontends: WebSocket connection
 * to the backend, service proxy (usePub), and raw triple store access.
 *
 * For structured game data hooks and UI components, use @pubwiki/game-ui.
 *
 * Usage:
 *   import { GameProvider, usePub } from '@pubwiki/game-sdk'
 */

// Connection & store
export { GameProvider, useGameStore } from './provider.tsx'
export { connectStore } from './store.ts'

// RPC proxy
export { usePub } from './backend.ts'
export type { PubBackend, ServiceCallable } from './backend.ts'

// Low-level triple hooks
export { useTripleQuery, useField } from './hooks.ts'

// Wire-format types
export type { Triple, MatchPattern, ChangeEvent, Value, SubscriptionEvent } from './types.ts'
