/**
 * Reactive hooks for game state — built on TripleStore LiveQuery.
 *
 * These hooks automatically re-render when the matched triples change.
 * No manual refresh or getGameState() needed.
 */

import { useSyncExternalStore, useMemo } from 'react'
import { useGameStore } from './provider'
import type { Triple, MatchPattern, Value } from './types'

// ── Low-level hook ──

/**
 * Subscribe to a triple pattern and transform the results.
 * Only re-renders when triples matching the pattern change.
 */
export function useTripleQuery<T>(
  pattern: MatchPattern,
  transform: (triples: Triple[]) => T
): T {
  const store = useGameStore()

  // Memoize the LiveQuery to avoid re-creating on every render
  const liveQuery = useMemo(
    () => store.liveMatch(pattern),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, pattern.subject, pattern.predicate, pattern.object, pattern.graph]
  )

  return useSyncExternalStore(
    (onStoreChange) => liveQuery.subscribe(() => onStoreChange()),
    () => transform(liveQuery.value)
  )
}

// ── High-level hooks ──

/** All triples in a specific graph, materialized into entity records. */
function materializeEntities(triples: Triple[]): Record<string, Record<string, Value>> {
  const entities: Record<string, Record<string, Value>> = {}
  for (const t of triples) {
    if (!entities[t.subject]) entities[t.subject] = {}
    entities[t.subject][t.predicate] = t.object
  }
  return entities
}

/**
 * All creatures as a list of entity records.
 * Re-renders only when creature graph changes.
 */
export function useCreatures(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: 'graph:creature' },
    (triples) => {
      const entities = materializeEntities(triples)
      return Object.entries(entities).map(([id, props]) => ({ id, ...props }))
    }
  )
}

/**
 * The player entity (the creature with pw:is_player = true).
 * Re-renders only when player-related triples change.
 */
export function usePlayer(): ({ id: string } & Record<string, Value>) | undefined {
  // First find which entity is the player
  const playerTriples = useTripleQuery(
    { predicate: 'pw:is_player' },
    (triples) => triples.filter(t => t.object === true)
  )

  const playerId = playerTriples[0]?.subject

  // Then get all triples for that entity
  return useTripleQuery(
    playerId ? { subject: playerId } : { subject: '__game_sdk_never__' },
    (triples) => {
      if (!playerId || triples.length === 0) return undefined
      const props: Record<string, Value> = {}
      for (const t of triples) {
        props[t.predicate] = t.object
      }
      return { id: playerId, ...props }
    }
  )
}

/**
 * All regions as a list of entity records.
 * Re-renders only when region graph changes.
 */
export function useRegions(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: 'graph:region' },
    (triples) => {
      const entities = materializeEntities(triples)
      return Object.entries(entities).map(([id, props]) => ({ id, ...props }))
    }
  )
}

/**
 * Get a single field value for a specific entity.
 * Re-renders only when that specific triple changes.
 */
export function useField(subject: string, predicate: string): Value | undefined {
  return useTripleQuery(
    { subject, predicate },
    (triples) => triples[0]?.object
  )
}
