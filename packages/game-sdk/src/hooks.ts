/**
 * Low-level reactive hooks for the game store.
 *
 * High-level hooks (useCreatures, usePlayer, etc.) live in @pubwiki/game-ui.
 */

import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useGameStore } from './provider.tsx'
import { matchTriples } from './store.ts'
import type { Triple, MatchPattern, Value } from './types.ts'

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

/** Returns a single raw triple field value. */
export function useField(subject: string, predicate: string): Value | undefined {
  return useTripleQuery(
    { subject, predicate },
    (triples) => triples[0]?.object
  )
}
