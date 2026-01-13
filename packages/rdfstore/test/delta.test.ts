/**
 * Tests for delta computation module
 */

import { describe, it, expect } from 'vitest'
import {
  computeDelta,
  applyDelta,
  invertOperation,
  invertOperations,
  optimizeOperations,
  quadsEqual,
  uniqueQuads,
} from '../src/delta/diff.js'
import type { Quad } from '@rdfjs/types'
import type { Operation } from '../src/types.js'
import { quad, namedNode, literal, defaultGraph, n3Quad } from './helpers.js'

describe('computeDelta', () => {
  it('should return empty array for identical quad sets', () => {
    const quads: Quad[] = [
      quad('ex:s1', 'ex:p1', 'v1'),
      quad('ex:s2', 'ex:p2', 'v2'),
    ]

    const delta = computeDelta(quads, quads)
    expect(delta).toEqual([])
  })

  it('should detect single insertion', () => {
    const oldQuads: Quad[] = []
    const newQuads: Quad[] = [
      quad('ex:s1', 'ex:p1', 'v1'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    expect(delta).toHaveLength(1)
    expect(delta[0].type).toBe('insert')
  })

  it('should detect single deletion', () => {
    const oldQuads: Quad[] = [
      quad('ex:s1', 'ex:p1', 'v1'),
    ]
    const newQuads: Quad[] = []

    const delta = computeDelta(oldQuads, newQuads)
    expect(delta).toHaveLength(1)
    expect(delta[0].type).toBe('delete')
  })

  it('should detect multiple insertions', () => {
    const oldQuads: Quad[] = []
    const newQuads: Quad[] = [
      quad('ex:s1', 'ex:p1', 'v1'),
      quad('ex:s2', 'ex:p2', 'v2'),
      quad('ex:s3', 'ex:p3', 'v3'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    // Since these have different (s,p,g) groups, they will be separate inserts
    expect(delta.length).toBe(3)
    expect(delta.every(op => op.type === 'insert')).toBe(true)
  })

  it('should detect mixed insertions and deletions', () => {
    const oldQuads: Quad[] = [
      quad('ex:s1', 'ex:p1', 'v1'),
      quad('ex:s2', 'ex:p2', 'v2'),
    ]
    const newQuads: Quad[] = [
      quad('ex:s2', 'ex:p2', 'v2'),
      quad('ex:s3', 'ex:p3', 'v3'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    // Should have delete for (s1,p1) and insert for (s3,p3)
    expect(delta.length).toBeGreaterThanOrEqual(1)
    
    const hasDelete = delta.some(op => op.type === 'delete')
    const hasInsert = delta.some(op => op.type === 'insert')
    
    expect(hasDelete).toBe(true)
    expect(hasInsert).toBe(true)
  })

  it('should handle Literal value changes with patch', () => {
    const oldQuads: Quad[] = [
      quad('ex:s1', 'ex:content', 'Hello World'),
    ]
    const newQuads: Quad[] = [
      quad('ex:s1', 'ex:content', 'Hello Beautiful World'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    expect(delta.length).toBe(1)
    expect(delta[0].type).toBe('patch')
  })

  it('should handle NamedNode object changes with delete+insert', () => {
    const oldQuads: Quad[] = [
      quad('ex:s1', 'ex:ref', 'http://example.org/old'),
    ]
    const newQuads: Quad[] = [
      quad('ex:s1', 'ex:ref', 'http://example.org/new'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    expect(delta.length).toBe(2)
    expect(delta.some(op => op.type === 'delete')).toBe(true)
    expect(delta.some(op => op.type === 'insert')).toBe(true)
  })
})

describe('applyDelta', () => {
  it('should apply insert operation', () => {
    const quads: Quad[] = []
    const newQuad = quad('ex:s1', 'ex:p1', 'v1')
    const delta: Operation[] = [
      { type: 'insert', quad: newQuad },
    ]

    const result = applyDelta(quads, delta)
    expect(result).toHaveLength(1)
    expect(quadsEqual(result[0], newQuad)).toBe(true)
  })

  it('should apply delete operation', () => {
    const q = quad('ex:s1', 'ex:p1', 'v1')
    const quads: Quad[] = [q]
    const delta: Operation[] = [
      { type: 'delete', quad: q },
    ]

    const result = applyDelta(quads, delta)
    expect(result).toHaveLength(0)
  })

  it('should apply batch-insert operation', () => {
    const quads: Quad[] = []
    const delta: Operation[] = [
      { 
        type: 'batch-insert', 
        quads: [
          quad('ex:s1', 'ex:p1', 'v1'),
          quad('ex:s2', 'ex:p2', 'v2'),
        ]
      },
    ]

    const result = applyDelta(quads, delta)
    expect(result).toHaveLength(2)
  })

  it('should apply batch-delete operation', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s2', 'ex:p2', 'v2')
    const q3 = quad('ex:s3', 'ex:p3', 'v3')
    const quads: Quad[] = [q1, q2, q3]
    const delta: Operation[] = [
      { 
        type: 'batch-delete', 
        quads: [q1, q2]
      },
    ]

    const result = applyDelta(quads, delta)
    expect(result).toHaveLength(1)
    expect(quadsEqual(result[0], q3)).toBe(true)
  })

  it('should apply patch operation', () => {
    const oldQuad = quad('ex:s1', 'ex:content', 'Hello World')
    const quads: Quad[] = [oldQuad]
    const delta: Operation[] = [
      { 
        type: 'patch',
        subject: namedNode('ex:s1'),
        predicate: namedNode('ex:content'),
        patch: { originalLength: 11, hunks: [{ start: 6, deleteCount: 0, insert: 'Beautiful ' }] }
      },
    ]

    const result = applyDelta(quads, delta)
    expect(result).toHaveLength(1)
    expect(result[0].object.termType).toBe('Literal')
    if (result[0].object.termType === 'Literal') {
      expect(result[0].object.value).toBe('Hello Beautiful World')
    }
  })

  it('should roundtrip: computeDelta then applyDelta', () => {
    const oldQuads: Quad[] = [
      quad('ex:s1', 'ex:p1', 'v1'),
      quad('ex:s2', 'ex:p2', 'v2'),
    ]
    const newQuads: Quad[] = [
      quad('ex:s2', 'ex:p2', 'v2'),
      quad('ex:s3', 'ex:p3', 'v3'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    const result = applyDelta(oldQuads, delta)

    // Result should match newQuads (order may differ)
    expect(result).toHaveLength(newQuads.length)
    for (const q of newQuads) {
      expect(result.some(r => quadsEqual(r, q))).toBe(true)
    }
  })

  it('should roundtrip: computeDelta then applyDelta with patch', () => {
    const oldQuads: Quad[] = [
      quad('ex:s1', 'ex:content', 'Hello World'),
    ]
    const newQuads: Quad[] = [
      quad('ex:s1', 'ex:content', 'Hello Beautiful World'),
    ]

    const delta = computeDelta(oldQuads, newQuads)
    const result = applyDelta(oldQuads, delta)

    expect(result).toHaveLength(1)
    expect(result[0].object.termType).toBe('Literal')
    if (result[0].object.termType === 'Literal') {
      expect(result[0].object.value).toBe('Hello Beautiful World')
    }
  })
})

describe('invertOperation', () => {
  it('should invert insert to delete', () => {
    const q = quad('ex:s1', 'ex:p1', 'v1')
    const op: Operation = { type: 'insert', quad: q }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('delete')
    if (inverted.type === 'delete') {
      expect(quadsEqual(inverted.quad, q)).toBe(true)
    }
  })

  it('should invert delete to insert', () => {
    const q = quad('ex:s1', 'ex:p1', 'v1')
    const op: Operation = { type: 'delete', quad: q }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('insert')
    if (inverted.type === 'insert') {
      expect(quadsEqual(inverted.quad, q)).toBe(true)
    }
  })

  it('should invert batch-insert to batch-delete', () => {
    const quads = [
      quad('ex:s1', 'ex:p1', 'v1'),
      quad('ex:s2', 'ex:p2', 'v2'),
    ]
    const op: Operation = { type: 'batch-insert', quads }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('batch-delete')
    if (inverted.type === 'batch-delete') {
      expect(inverted.quads).toHaveLength(2)
    }
  })

  it('should invert batch-delete to batch-insert', () => {
    const quads = [
      quad('ex:s1', 'ex:p1', 'v1'),
      quad('ex:s2', 'ex:p2', 'v2'),
    ]
    const op: Operation = { type: 'batch-delete', quads }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('batch-insert')
    if (inverted.type === 'batch-insert') {
      expect(inverted.quads).toHaveLength(2)
    }
  })

  it('should invert patch operation', () => {
    const originalQuads = [quad('ex:s1', 'ex:content', 'Hello World')]
    const op: Operation = { 
      type: 'patch',
      subject: namedNode('ex:s1'),
      predicate: namedNode('ex:content'),
      patch: { originalLength: 11, hunks: [{ start: 6, deleteCount: 0, insert: 'Beautiful ' }] }
    }
    const inverted = invertOperation(op, originalQuads)
    expect(inverted.type).toBe('patch')
    if (inverted.type === 'patch') {
      expect(inverted.patch.originalLength).toBe(21) // 'Hello Beautiful World'.length
    }
  })
})

describe('invertOperations', () => {
  it('should invert and reverse operation sequence', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s2', 'ex:p2', 'v2')
    const ops: Operation[] = [
      { type: 'insert', quad: q1 },
      { type: 'insert', quad: q2 },
    ]
    
    const inverted = invertOperations(ops)
    
    expect(inverted).toHaveLength(2)
    expect(inverted[0].type).toBe('delete')
    expect(inverted[1].type).toBe('delete')
    // Order should be reversed
    if (inverted[0].type === 'delete') {
      expect(quadsEqual(inverted[0].quad, q2)).toBe(true)
    }
    if (inverted[1].type === 'delete') {
      expect(quadsEqual(inverted[1].quad, q1)).toBe(true)
    }
  })
})

describe('optimizeOperations', () => {
  it('should merge consecutive inserts into batch', () => {
    const ops: Operation[] = [
      { type: 'insert', quad: quad('ex:s1', 'ex:p1', 'v1') },
      { type: 'insert', quad: quad('ex:s2', 'ex:p2', 'v2') },
      { type: 'insert', quad: quad('ex:s3', 'ex:p3', 'v3') },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(1)
    expect(optimized[0].type).toBe('batch-insert')
    if (optimized[0].type === 'batch-insert') {
      expect(optimized[0].quads).toHaveLength(3)
    }
  })

  it('should merge consecutive deletes into batch', () => {
    const ops: Operation[] = [
      { type: 'delete', quad: quad('ex:s1', 'ex:p1', 'v1') },
      { type: 'delete', quad: quad('ex:s2', 'ex:p2', 'v2') },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(1)
    expect(optimized[0].type).toBe('batch-delete')
    if (optimized[0].type === 'batch-delete') {
      expect(optimized[0].quads).toHaveLength(2)
    }
  })

  it('should keep separate groups for different operation types', () => {
    const ops: Operation[] = [
      { type: 'insert', quad: quad('ex:s1', 'ex:p1', 'v1') },
      { type: 'delete', quad: quad('ex:s2', 'ex:p2', 'v2') },
      { type: 'insert', quad: quad('ex:s3', 'ex:p3', 'v3') },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(3)
  })

  it('should return empty array for empty input', () => {
    const optimized = optimizeOperations([])
    expect(optimized).toEqual([])
  })

  it('should return single operation unchanged', () => {
    const q = quad('ex:s1', 'ex:p1', 'v1')
    const ops: Operation[] = [
      { type: 'insert', quad: q },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(1)
    expect(optimized[0].type).toBe('insert')
  })
})

describe('quadsEqual', () => {
  it('should return true for identical quads', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s1', 'ex:p1', 'v1')
    expect(quadsEqual(q1, q2)).toBe(true)
  })

  it('should return false for different subjects', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s2', 'ex:p1', 'v1')
    expect(quadsEqual(q1, q2)).toBe(false)
  })

  it('should return false for different predicates', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s1', 'ex:p2', 'v1')
    expect(quadsEqual(q1, q2)).toBe(false)
  })

  it('should return false for different objects', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s1', 'ex:p1', 'v2')
    expect(quadsEqual(q1, q2)).toBe(false)
  })

  it('should handle URI vs Literal objects', () => {
    const q1 = quad('ex:s1', 'ex:ref', 'http://example.org/value')
    const q2 = n3Quad(
      namedNode('ex:s1'),
      namedNode('ex:ref'),
      literal('http://example.org/value'),
      defaultGraph()
    )
    expect(quadsEqual(q1, q2)).toBe(false)
  })
})

describe('uniqueQuads', () => {
  it('should remove duplicate quads', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s2', 'ex:p2', 'v2')
    const quads: Quad[] = [q1, q1, q2]

    const unique = uniqueQuads(quads)
    expect(unique).toHaveLength(2)
  })

  it('should preserve order (first occurrence)', () => {
    const q1 = quad('ex:s1', 'ex:p1', 'v1')
    const q2 = quad('ex:s2', 'ex:p2', 'v2')
    const quads: Quad[] = [q1, q2, q1]

    const unique = uniqueQuads(quads)
    expect(quadsEqual(unique[0], q1)).toBe(true)
    expect(quadsEqual(unique[1], q2)).toBe(true)
  })

  it('should return empty array for empty input', () => {
    const unique = uniqueQuads([])
    expect(unique).toEqual([])
  })
})
