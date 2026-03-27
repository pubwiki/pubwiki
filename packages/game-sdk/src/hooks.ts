/**
 * Reactive hooks for game state — built on zustand selectors.
 *
 * These hooks automatically re-render when the matched triples change.
 */

import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useGameStore } from './provider.tsx'
import { matchTriples } from './store.ts'
import type { Triple, MatchPattern, Value } from './types.ts'

// ── Low-level hook ──

/**
 * Subscribe to a triple pattern and transform the results.
 * Only re-renders when the selected result changes (shallow).
 */
export function useTripleQuery<T>(
  pattern: MatchPattern,
  transform: (triples: Triple[]) => T
): T {
  const store = useGameStore()

  const selector = useMemo(
    () => (state: { triples: Triple[] }) => transform(matchTriples(state.triples, pattern)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pattern.subject, pattern.predicate, pattern.object, pattern.graph]
  )

  return useStore(store, selector)
}

// ── High-level hooks ──

function materializeEntities(triples: Triple[]): Record<string, Record<string, Value>> {
  const entities: Record<string, Record<string, Value>> = {}
  for (const t of triples) {
    if (!entities[t.subject]) entities[t.subject] = {}
    entities[t.subject][t.predicate] = t.object
  }
  return entities
}

export function useCreatures(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: 'graph:creature' },
    (triples) => {
      const entities = materializeEntities(triples)
      return Object.entries(entities).map(([id, props]) => ({ id, ...props }))
    }
  )
}

export function usePlayer(): ({ id: string } & Record<string, Value>) | undefined {
  const store = useGameStore()

  return useStore(store, (state) => {
    const playerTriple = state.triples.find(
      (t) => t.predicate === 'pw:is_player' && t.object === true
    )
    if (!playerTriple) return undefined
    const playerId = playerTriple.subject
    const props: Record<string, Value> = {}
    for (const t of state.triples) {
      if (t.subject === playerId) props[t.predicate] = t.object
    }
    return { id: playerId, ...props }
  })
}

export function useRegions(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: 'graph:region' },
    (triples) => {
      const entities = materializeEntities(triples)
      return Object.entries(entities).map(([id, props]) => ({ id, ...props }))
    }
  )
}

export function useField(subject: string, predicate: string): Value | undefined {
  return useTripleQuery(
    { subject, predicate },
    (triples) => triples[0]?.object
  )
}
