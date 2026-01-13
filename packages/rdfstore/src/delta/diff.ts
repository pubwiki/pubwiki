/**
 * Delta calculation for RDF triples
 * 
 * Uses smart diff strategy:
 * - For single-value Literal changes: character-level patch
 * - For multi-value or non-Literal: set operations (delete + insert)
 */

import { DataFactory } from 'n3'
import type { Triple, Operation } from '../types.js'
import { tripleKey, spKey, termKey } from '../utils/term.js'
import { createTextPatch, applyTextPatch, invertTextPatch } from './patch.js'

// Re-export patch utilities for convenience
export { createTextPatch, applyTextPatch, invertTextPatch }

/**
 * Group array elements by key
 */
function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const group = map.get(key)
    if (group) {
      group.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

/**
 * Compute the delta (set of operations) between two sets of triples
 * 
 * Algorithm:
 * 1. Group triples by (subject, predicate)
 * 2. For single-value Literal changes: generate text patch
 * 3. For multi-value or non-Literal: use set operations
 * 
 * @param oldTriples - The original set of triples
 * @param newTriples - The target set of triples
 * @returns Array of operations to transform old to new
 */
export function computeDelta(oldTriples: Triple[], newTriples: Triple[]): Operation[] {
  // Group by (subject, predicate)
  const oldByKey = groupBy(oldTriples, spKey)
  const newByKey = groupBy(newTriples, spKey)
  
  const operations: Operation[] = []
  const processed = new Set<string>()

  for (const [key, oldGroup] of oldByKey) {
    processed.add(key)
    const newGroup = newByKey.get(key)

    if (!newGroup) {
      // Entire (s, p) was deleted
      operations.push(...oldGroup.map((t: Triple) => ({ type: 'delete' as const, triple: t })))
      continue
    }

    // Single value: try patch for Literal
    if (oldGroup.length === 1 && newGroup.length === 1) {
      const [oldT] = oldGroup
      const [newT] = newGroup
      
      // Already equal - skip
      if (tripleKey(oldT) === tripleKey(newT)) continue
      
      // Both Literals: use text patch
      if (oldT.object.termType === 'Literal' && newT.object.termType === 'Literal') {
        operations.push({
          type: 'patch',
          subject: oldT.subject,
          predicate: oldT.predicate,
          patch: createTextPatch(oldT.object.value, newT.object.value)
        })
        continue
      }
      
      // Different term types or non-Literal: delete + insert
      operations.push({ type: 'delete', triple: oldT })
      operations.push({ type: 'insert', triple: newT })
      continue
    }

    // Multi-value: set operations
    const oldSet = new Set(oldGroup.map((t: Triple) => termKey(t.object)))
    const newSet = new Set(newGroup.map((t: Triple) => termKey(t.object)))
    
    for (const t of oldGroup) {
      if (!newSet.has(termKey(t.object))) {
        operations.push({ type: 'delete', triple: t })
      }
    }
    for (const t of newGroup) {
      if (!oldSet.has(termKey(t.object))) {
        operations.push({ type: 'insert', triple: t })
      }
    }
  }

  // New (s, p) groups
  for (const [key, newGroup] of newByKey) {
    if (!processed.has(key)) {
      operations.push(...newGroup.map((t: Triple) => ({ type: 'insert' as const, triple: t })))
    }
  }

  return operations
}

/**
 * Apply a delta to a set of triples
 * 
 * @param triples - The starting set of triples
 * @param delta - The operations to apply
 * @returns The resulting set of triples
 */
export function applyDelta(triples: Triple[], delta: Operation[]): Triple[] {
  const map = new Map(triples.map(t => [tripleKey(t), t]))

  for (const op of delta) {
    switch (op.type) {
      case 'insert':
        map.set(tripleKey(op.triple), op.triple)
        break

      case 'delete':
        map.delete(tripleKey(op.triple))
        break

      case 'batch-insert':
        for (const t of op.triples) {
          map.set(tripleKey(t), t)
        }
        break

      case 'batch-delete':
        for (const t of op.triples) {
          map.delete(tripleKey(t))
        }
        break

      case 'patch': {
        // Find the triple matching (subject, predicate) and apply patch
        const prefix = `${termKey(op.subject)}\0${termKey(op.predicate)}\0`
        for (const [k, t] of map) {
          if (k.startsWith(prefix) && t.object.termType === 'Literal') {
            const newVal = applyTextPatch(t.object.value, op.patch)
            const newObj = t.object.language
              ? DataFactory.literal(newVal, t.object.language)
              : DataFactory.literal(newVal, t.object.datatype)
            const newTriple: Triple = { ...t, object: newObj }
            map.delete(k)
            map.set(tripleKey(newTriple), newTriple)
            break
          }
        }
        break
      }
    }
  }

  return [...map.values()]
}

/**
 * Invert an operation (for undo)
 * Note: patch inversion requires original text
 */
export function invertOperation(op: Operation, originalTriples?: Triple[]): Operation {
  switch (op.type) {
    case 'insert':
      return { type: 'delete', triple: op.triple }

    case 'delete':
      return { type: 'insert', triple: op.triple }

    case 'batch-insert':
      return { type: 'batch-delete', triples: op.triples }

    case 'batch-delete':
      return { type: 'batch-insert', triples: op.triples }

    case 'patch': {
      // Need original text to invert patch
      if (!originalTriples) {
        throw new Error('Cannot invert patch without original triples')
      }
      
      const prefix = `${termKey(op.subject)}\0${termKey(op.predicate)}\0`
      for (const t of originalTriples) {
        if (tripleKey(t).startsWith(prefix) && t.object.termType === 'Literal') {
          return {
            type: 'patch',
            subject: op.subject,
            predicate: op.predicate,
            patch: invertTextPatch(t.object.value, op.patch)
          }
        }
      }
      throw new Error('Could not find original triple for patch inversion')
    }
  }
}

/**
 * Invert a sequence of operations (for undo)
 * Operations are reversed and each is inverted
 */
export function invertOperations(ops: Operation[], originalTriples?: Triple[]): Operation[] {
  // For patch operations, we need to track intermediate states
  if (ops.some(op => op.type === 'patch')) {
    if (!originalTriples) {
      throw new Error('Cannot invert operations containing patches without original triples')
    }
    
    // Build intermediate states
    const states: Triple[][] = [originalTriples]
    let current = originalTriples
    for (const op of ops) {
      current = applyDelta(current, [op])
      states.push(current)
    }
    
    // Invert in reverse order
    const result: Operation[] = []
    for (let i = ops.length - 1; i >= 0; i--) {
      result.push(invertOperation(ops[i], states[i]))
    }
    return result
  }
  
  return ops.map(op => invertOperation(op)).reverse()
}

/**
 * Optimize a sequence of operations by merging consecutive same-type operations
 */
export function optimizeOperations(ops: Operation[]): Operation[] {
  if (ops.length <= 1) return ops

  const result: Operation[] = []
  let pendingInserts: Triple[] = []
  let pendingDeletes: Triple[] = []

  const flushInserts = () => {
    if (pendingInserts.length === 1) {
      result.push({ type: 'insert', triple: pendingInserts[0] })
    } else if (pendingInserts.length > 1) {
      result.push({ type: 'batch-insert', triples: pendingInserts })
    }
    pendingInserts = []
  }

  const flushDeletes = () => {
    if (pendingDeletes.length === 1) {
      result.push({ type: 'delete', triple: pendingDeletes[0] })
    } else if (pendingDeletes.length > 1) {
      result.push({ type: 'batch-delete', triples: pendingDeletes })
    }
    pendingDeletes = []
  }

  for (const op of ops) {
    switch (op.type) {
      case 'insert':
        flushDeletes()
        pendingInserts.push(op.triple)
        break

      case 'delete':
        flushInserts()
        pendingDeletes.push(op.triple)
        break

      case 'batch-insert':
        flushDeletes()
        pendingInserts.push(...op.triples)
        break

      case 'batch-delete':
        flushInserts()
        pendingDeletes.push(...op.triples)
        break

      case 'patch':
        // Patches cannot be batched
        flushInserts()
        flushDeletes()
        result.push(op)
        break
    }
  }

  flushInserts()
  flushDeletes()

  return result
}

/**
 * Check if two triples are equal
 */
export function triplesEqual(a: Triple, b: Triple): boolean {
  return tripleKey(a) === tripleKey(b)
}

/**
 * Get unique triples from an array
 */
export function uniqueTriples(triples: Triple[]): Triple[] {
  const seen = new Set<string>()
  const result: Triple[] = []

  for (const triple of triples) {
    const key = tripleKey(triple)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(triple)
    }
  }

  return result
}
