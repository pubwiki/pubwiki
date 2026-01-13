/**
 * Delta calculation for RDF quads
 * 
 * Uses smart diff strategy:
 * - For single-value Literal changes: character-level patch
 * - For multi-value or non-Literal: set operations (delete + insert)
 */

import { DataFactory } from 'n3'
import type { Quad } from '@rdfjs/types'
import type { Operation } from '../types.js'
import { quadKey, spgKey, termKey, type Term } from '../utils/term.js'
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
 * Compute the delta (set of operations) between two sets of quads
 * 
 * Algorithm:
 * 1. Group quads by (subject, predicate, graph)
 * 2. For single-value Literal changes: generate text patch
 * 3. For multi-value or non-Literal: use set operations
 * 
 * @param oldQuads - The original set of quads
 * @param newQuads - The target set of quads
 * @returns Array of operations to transform old to new
 */
export function computeDelta(oldQuads: Quad[], newQuads: Quad[]): Operation[] {
  // Group by (subject, predicate, graph)
  const oldByKey = groupBy(oldQuads, spgKey)
  const newByKey = groupBy(newQuads, spgKey)
  
  const operations: Operation[] = []
  const processed = new Set<string>()

  for (const [key, oldGroup] of oldByKey) {
    processed.add(key)
    const newGroup = newByKey.get(key)

    if (!newGroup) {
      // Entire (s, p, g) was deleted
      operations.push(...oldGroup.map((q: Quad) => ({ type: 'delete' as const, quad: q })))
      continue
    }

    // Single value: try patch for Literal
    if (oldGroup.length === 1 && newGroup.length === 1) {
      const [oldQ] = oldGroup
      const [newQ] = newGroup
      
      // Already equal - skip
      if (quadKey(oldQ) === quadKey(newQ)) continue
      
      // Both Literals: use text patch
      if (oldQ.object.termType === 'Literal' && newQ.object.termType === 'Literal') {
        operations.push({
          type: 'patch',
          subject: oldQ.subject,
          predicate: oldQ.predicate,
          patch: createTextPatch(oldQ.object.value, newQ.object.value)
        })
        continue
      }
      
      // Different term types or non-Literal: delete + insert
      operations.push({ type: 'delete', quad: oldQ })
      operations.push({ type: 'insert', quad: newQ })
      continue
    }

    // Multi-value: set operations
    const oldSet = new Set(oldGroup.map((q: Quad) => termKey(q.object as Term)))
    const newSet = new Set(newGroup.map((q: Quad) => termKey(q.object as Term)))
    
    for (const q of oldGroup) {
      if (!newSet.has(termKey(q.object as Term))) {
        operations.push({ type: 'delete', quad: q })
      }
    }
    for (const q of newGroup) {
      if (!oldSet.has(termKey(q.object as Term))) {
        operations.push({ type: 'insert', quad: q })
      }
    }
  }

  // New (s, p, g) groups
  for (const [key, newGroup] of newByKey) {
    if (!processed.has(key)) {
      operations.push(...newGroup.map((q: Quad) => ({ type: 'insert' as const, quad: q })))
    }
  }

  return operations
}

/**
 * Apply a delta to a set of quads
 * 
 * @param quads - The starting set of quads
 * @param delta - The operations to apply
 * @returns The resulting set of quads
 */
export function applyDelta(quads: Quad[], delta: Operation[]): Quad[] {
  const map = new Map(quads.map(q => [quadKey(q), q]))

  for (const op of delta) {
    switch (op.type) {
      case 'insert':
        map.set(quadKey(op.quad), op.quad)
        break

      case 'delete':
        map.delete(quadKey(op.quad))
        break

      case 'batch-insert':
        for (const q of op.quads) {
          map.set(quadKey(q), q)
        }
        break

      case 'batch-delete':
        for (const q of op.quads) {
          map.delete(quadKey(q))
        }
        break

      case 'patch': {
        // Find the quad matching (subject, predicate) and apply patch
        const prefix = `${termKey(op.subject as Term)}\0${termKey(op.predicate as Term)}\0`
        for (const [k, q] of map) {
          if (k.startsWith(prefix) && q.object.termType === 'Literal') {
            const newVal = applyTextPatch(q.object.value, op.patch)
            const newObj = q.object.language
              ? DataFactory.literal(newVal, q.object.language)
              : DataFactory.literal(newVal, q.object.datatype)
            const newQuad = DataFactory.quad(q.subject, q.predicate, newObj, q.graph)
            map.delete(k)
            map.set(quadKey(newQuad), newQuad)
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
export function invertOperation(op: Operation, originalQuads?: Quad[]): Operation {
  switch (op.type) {
    case 'insert':
      return { type: 'delete', quad: op.quad }

    case 'delete':
      return { type: 'insert', quad: op.quad }

    case 'batch-insert':
      return { type: 'batch-delete', quads: op.quads }

    case 'batch-delete':
      return { type: 'batch-insert', quads: op.quads }

    case 'patch': {
      // Need original text to invert patch
      if (!originalQuads) {
        throw new Error('Cannot invert patch without original quads')
      }
      
      const prefix = `${termKey(op.subject as Term)}\0${termKey(op.predicate as Term)}\0`
      for (const q of originalQuads) {
        if (quadKey(q).startsWith(prefix) && q.object.termType === 'Literal') {
          return {
            type: 'patch',
            subject: op.subject,
            predicate: op.predicate,
            patch: invertTextPatch(q.object.value, op.patch)
          }
        }
      }
      throw new Error('Could not find original quad for patch inversion')
    }
  }
}

/**
 * Invert a sequence of operations (for undo)
 * Operations are reversed and each is inverted
 */
export function invertOperations(ops: Operation[], originalQuads?: Quad[]): Operation[] {
  // For patch operations, we need to track intermediate states
  if (ops.some(op => op.type === 'patch')) {
    if (!originalQuads) {
      throw new Error('Cannot invert operations containing patches without original quads')
    }
    
    // Build intermediate states
    const states: Quad[][] = [originalQuads]
    let current = originalQuads
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
  let pendingInserts: Quad[] = []
  let pendingDeletes: Quad[] = []

  const flushInserts = () => {
    if (pendingInserts.length === 1) {
      result.push({ type: 'insert', quad: pendingInserts[0] })
    } else if (pendingInserts.length > 1) {
      result.push({ type: 'batch-insert', quads: pendingInserts })
    }
    pendingInserts = []
  }

  const flushDeletes = () => {
    if (pendingDeletes.length === 1) {
      result.push({ type: 'delete', quad: pendingDeletes[0] })
    } else if (pendingDeletes.length > 1) {
      result.push({ type: 'batch-delete', quads: pendingDeletes })
    }
    pendingDeletes = []
  }

  for (const op of ops) {
    switch (op.type) {
      case 'insert':
        flushDeletes()
        pendingInserts.push(op.quad)
        break

      case 'delete':
        flushInserts()
        pendingDeletes.push(op.quad)
        break

      case 'batch-insert':
        flushDeletes()
        pendingInserts.push(...op.quads)
        break

      case 'batch-delete':
        flushInserts()
        pendingDeletes.push(...op.quads)
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
 * Check if two quads are equal
 */
export function quadsEqual(a: Quad, b: Quad): boolean {
  return quadKey(a) === quadKey(b)
}

/**
 * Get unique quads from an array
 */
export function uniqueQuads(quads: Quad[]): Quad[] {
  const seen = new Set<string>()
  const result: Quad[] = []

  for (const quad of quads) {
    const key = quadKey(quad)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(quad)
    }
  }

  return result
}
