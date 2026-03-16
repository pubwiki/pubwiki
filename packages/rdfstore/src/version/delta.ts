/**
 * Delta computation between two TripleIndex versions.
 *
 * Computes the minimal set of inserts and deletes needed to transform
 * one TripleIndex state into another.
 */

import type { TripleIndex } from '../index/triple-index'
import { objectKey } from '../index/triple-index'
import type { Delta, Triple } from '../types'

/** Compute a triple key for identity comparison */
function tripleId(t: Triple): string {
  return `${t.subject}\0${t.predicate}\0${objectKey(t.object)}\0${t.graph ?? ''}`
}

/**
 * Compute the delta between two TripleIndex versions.
 *
 * Returns the inserts and deletes needed to go from `from` to `to`.
 */
export function computeDelta(from: TripleIndex, to: TripleIndex): Delta {
  const fromTriples = from.getAll()
  const toTriples = to.getAll()

  const fromSet = new Set(fromTriples.map(tripleId))
  const toSet = new Set(toTriples.map(tripleId))

  const inserts: Triple[] = []
  const deletes: Triple[] = []

  // Triples in `to` but not in `from` → inserts
  for (const t of toTriples) {
    if (!fromSet.has(tripleId(t))) {
      inserts.push(t)
    }
  }

  // Triples in `from` but not in `to` → deletes
  for (const t of fromTriples) {
    if (!toSet.has(tripleId(t))) {
      deletes.push(t)
    }
  }

  return { inserts, deletes }
}

/**
 * Apply a delta to a TripleIndex, returning a new TripleIndex.
 */
export function applyDelta(base: TripleIndex, delta: Delta): TripleIndex {
  let index = base
  for (const t of delta.deletes) {
    index = index.delete(t.subject, t.predicate, t.object, t.graph)
  }
  for (const t of delta.inserts) {
    index = index.insert(t.subject, t.predicate, t.object, t.graph)
  }
  return index
}
