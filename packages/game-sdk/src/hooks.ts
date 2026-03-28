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
import { GRAPH, PWC_PRED, JSON_PREDICATES, extractId } from './vocabulary.ts'

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

// ── Entity materialization ──

/** Try to parse a JSON string; return the original value on failure. */
function tryParseJson(value: Value): Value {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as Value
  } catch {
    return value
  }
}

/**
 * Materialize a flat triple array into entity objects.
 *
 * - Groups triples by subject
 * - Extracts pure entity ID (e.g. "creature:npc_01" → "npc_01")
 * - Auto-parses known JSON-serialized predicates
 */
function materializeEntities(triples: Triple[]): Array<{ id: string } & Record<string, Value>> {
  const bySubject = new Map<string, Record<string, Value>>()

  for (const t of triples) {
    let entity = bySubject.get(t.subject)
    if (!entity) {
      entity = { id: extractId(t.subject) }
      bySubject.set(t.subject, entity)
    }
    entity[t.predicate] = JSON_PREDICATES.has(t.predicate) ? tryParseJson(t.object) : t.object
  }

  return Array.from(bySubject.values()) as Array<{ id: string } & Record<string, Value>>
}

// ── High-level hooks ──

export function useCreatures(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: GRAPH.creature },
    materializeEntities
  )
}

export function usePlayer(): ({ id: string } & Record<string, Value>) | undefined {
  const store = useGameStore()

  return useStore(store, (state) => {
    const playerTriple = state.triples.find(
      (t) => t.predicate === PWC_PRED.is_player && t.object === true
    )
    if (!playerTriple) return undefined

    const playerId = playerTriple.subject
    const props: Record<string, Value> = { id: extractId(playerId) }
    for (const t of state.triples) {
      if (t.subject === playerId) {
        props[t.predicate] = JSON_PREDICATES.has(t.predicate) ? tryParseJson(t.object) : t.object
      }
    }
    return props as { id: string } & Record<string, Value>
  })
}

export function useRegions(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: GRAPH.region },
    materializeEntities
  )
}

export function useOrganizations(): Array<{ id: string } & Record<string, Value>> {
  return useTripleQuery(
    { graph: GRAPH.organization },
    materializeEntities
  )
}

export function useField(subject: string, predicate: string): Value | undefined {
  return useTripleQuery(
    { subject, predicate },
    (triples) => {
      const raw = triples[0]?.object
      if (raw === undefined) return undefined
      return JSON_PREDICATES.has(predicate) ? tryParseJson(raw) : raw
    }
  )
}
