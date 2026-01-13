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
  triplesEqual,
  uniqueTriples,
} from '../src/delta/diff.js'
import type { Triple, Operation } from '../src/types.js'
import { triple, namedNode, literal } from './helpers.js'

describe('computeDelta', () => {
  it('should return empty array for identical triple sets', () => {
    const triples: Triple[] = [
      triple('ex:s1', 'ex:p1', 'v1'),
      triple('ex:s2', 'ex:p2', 'v2'),
    ]

    const delta = computeDelta(triples, triples)
    expect(delta).toEqual([])
  })

  it('should detect single insertion', () => {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = [
      triple('ex:s1', 'ex:p1', 'v1'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    expect(delta).toHaveLength(1)
    expect(delta[0].type).toBe('insert')
  })

  it('should detect single deletion', () => {
    const oldTriples: Triple[] = [
      triple('ex:s1', 'ex:p1', 'v1'),
    ]
    const newTriples: Triple[] = []

    const delta = computeDelta(oldTriples, newTriples)
    expect(delta).toHaveLength(1)
    expect(delta[0].type).toBe('delete')
  })

  it('should detect multiple insertions', () => {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = [
      triple('ex:s1', 'ex:p1', 'v1'),
      triple('ex:s2', 'ex:p2', 'v2'),
      triple('ex:s3', 'ex:p3', 'v3'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    // Since these have different (s,p) pairs, they will be separate inserts
    expect(delta.length).toBe(3)
    expect(delta.every(op => op.type === 'insert')).toBe(true)
  })

  it('should detect mixed insertions and deletions', () => {
    const oldTriples: Triple[] = [
      triple('ex:s1', 'ex:p1', 'v1'),
      triple('ex:s2', 'ex:p2', 'v2'),
    ]
    const newTriples: Triple[] = [
      triple('ex:s2', 'ex:p2', 'v2'),
      triple('ex:s3', 'ex:p3', 'v3'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    // Should have delete for (s1,p1) and insert for (s3,p3)
    expect(delta.length).toBeGreaterThanOrEqual(1)
    
    const hasDelete = delta.some(op => op.type === 'delete')
    const hasInsert = delta.some(op => op.type === 'insert')
    
    expect(hasDelete).toBe(true)
    expect(hasInsert).toBe(true)
  })

  it('should handle Literal value changes with patch', () => {
    const oldTriples: Triple[] = [
      triple('ex:s1', 'ex:content', 'Hello World'),
    ]
    const newTriples: Triple[] = [
      triple('ex:s1', 'ex:content', 'Hello Beautiful World'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    expect(delta.length).toBe(1)
    expect(delta[0].type).toBe('patch')
  })

  it('should handle NamedNode object changes with delete+insert', () => {
    const oldTriples: Triple[] = [
      triple('ex:s1', 'ex:ref', 'http://example.org/old'),
    ]
    const newTriples: Triple[] = [
      triple('ex:s1', 'ex:ref', 'http://example.org/new'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    expect(delta.length).toBe(2)
    expect(delta.some(op => op.type === 'delete')).toBe(true)
    expect(delta.some(op => op.type === 'insert')).toBe(true)
  })
})

describe('applyDelta', () => {
  it('should apply insert operation', () => {
    const triples: Triple[] = []
    const newTriple = triple('ex:s1', 'ex:p1', 'v1')
    const delta: Operation[] = [
      { type: 'insert', triple: newTriple },
    ]

    const result = applyDelta(triples, delta)
    expect(result).toHaveLength(1)
    expect(triplesEqual(result[0], newTriple)).toBe(true)
  })

  it('should apply delete operation', () => {
    const t = triple('ex:s1', 'ex:p1', 'v1')
    const triples: Triple[] = [t]
    const delta: Operation[] = [
      { type: 'delete', triple: t },
    ]

    const result = applyDelta(triples, delta)
    expect(result).toHaveLength(0)
  })

  it('should apply batch-insert operation', () => {
    const triples: Triple[] = []
    const delta: Operation[] = [
      { 
        type: 'batch-insert', 
        triples: [
          triple('ex:s1', 'ex:p1', 'v1'),
          triple('ex:s2', 'ex:p2', 'v2'),
        ]
      },
    ]

    const result = applyDelta(triples, delta)
    expect(result).toHaveLength(2)
  })

  it('should apply batch-delete operation', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s2', 'ex:p2', 'v2')
    const t3 = triple('ex:s3', 'ex:p3', 'v3')
    const triples: Triple[] = [t1, t2, t3]
    const delta: Operation[] = [
      { 
        type: 'batch-delete', 
        triples: [t1, t2]
      },
    ]

    const result = applyDelta(triples, delta)
    expect(result).toHaveLength(1)
    expect(triplesEqual(result[0], t3)).toBe(true)
  })

  it('should apply patch operation', () => {
    const oldTriple = triple('ex:s1', 'ex:content', 'Hello World')
    const triples: Triple[] = [oldTriple]
    const delta: Operation[] = [
      { 
        type: 'patch',
        subject: namedNode('ex:s1'),
        predicate: namedNode('ex:content'),
        patch: { originalLength: 11, hunks: [{ start: 6, deleteCount: 0, insert: 'Beautiful ' }] }
      },
    ]

    const result = applyDelta(triples, delta)
    expect(result).toHaveLength(1)
    expect(result[0].object.termType).toBe('Literal')
    if (result[0].object.termType === 'Literal') {
      expect(result[0].object.value).toBe('Hello Beautiful World')
    }
  })

  it('should roundtrip: computeDelta then applyDelta', () => {
    const oldTriples: Triple[] = [
      triple('ex:s1', 'ex:p1', 'v1'),
      triple('ex:s2', 'ex:p2', 'v2'),
    ]
    const newTriples: Triple[] = [
      triple('ex:s2', 'ex:p2', 'v2'),
      triple('ex:s3', 'ex:p3', 'v3'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    const result = applyDelta(oldTriples, delta)

    // Result should match newTriples (order may differ)
    expect(result).toHaveLength(newTriples.length)
    for (const t of newTriples) {
      expect(result.some(r => triplesEqual(r, t))).toBe(true)
    }
  })

  it('should roundtrip: computeDelta then applyDelta with patch', () => {
    const oldTriples: Triple[] = [
      triple('ex:s1', 'ex:content', 'Hello World'),
    ]
    const newTriples: Triple[] = [
      triple('ex:s1', 'ex:content', 'Hello Beautiful World'),
    ]

    const delta = computeDelta(oldTriples, newTriples)
    const result = applyDelta(oldTriples, delta)

    expect(result).toHaveLength(1)
    expect(result[0].object.termType).toBe('Literal')
    if (result[0].object.termType === 'Literal') {
      expect(result[0].object.value).toBe('Hello Beautiful World')
    }
  })
})

describe('invertOperation', () => {
  it('should invert insert to delete', () => {
    const t = triple('ex:s1', 'ex:p1', 'v1')
    const op: Operation = { type: 'insert', triple: t }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('delete')
    if (inverted.type === 'delete') {
      expect(triplesEqual(inverted.triple, t)).toBe(true)
    }
  })

  it('should invert delete to insert', () => {
    const t = triple('ex:s1', 'ex:p1', 'v1')
    const op: Operation = { type: 'delete', triple: t }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('insert')
    if (inverted.type === 'insert') {
      expect(triplesEqual(inverted.triple, t)).toBe(true)
    }
  })

  it('should invert batch-insert to batch-delete', () => {
    const triples = [
      triple('ex:s1', 'ex:p1', 'v1'),
      triple('ex:s2', 'ex:p2', 'v2'),
    ]
    const op: Operation = { type: 'batch-insert', triples }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('batch-delete')
    if (inverted.type === 'batch-delete') {
      expect(inverted.triples).toHaveLength(2)
    }
  })

  it('should invert batch-delete to batch-insert', () => {
    const triples = [
      triple('ex:s1', 'ex:p1', 'v1'),
      triple('ex:s2', 'ex:p2', 'v2'),
    ]
    const op: Operation = { type: 'batch-delete', triples }
    const inverted = invertOperation(op)
    expect(inverted.type).toBe('batch-insert')
    if (inverted.type === 'batch-insert') {
      expect(inverted.triples).toHaveLength(2)
    }
  })

  it('should invert patch operation', () => {
    const originalTriples = [triple('ex:s1', 'ex:content', 'Hello World')]
    const op: Operation = { 
      type: 'patch',
      subject: namedNode('ex:s1'),
      predicate: namedNode('ex:content'),
      patch: { originalLength: 11, hunks: [{ start: 6, deleteCount: 0, insert: 'Beautiful ' }] }
    }
    const inverted = invertOperation(op, originalTriples)
    expect(inverted.type).toBe('patch')
    if (inverted.type === 'patch') {
      expect(inverted.patch.originalLength).toBe(21) // 'Hello Beautiful World'.length
    }
  })
})

describe('invertOperations', () => {
  it('should invert and reverse operation sequence', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s2', 'ex:p2', 'v2')
    const ops: Operation[] = [
      { type: 'insert', triple: t1 },
      { type: 'insert', triple: t2 },
    ]
    
    const inverted = invertOperations(ops)
    
    expect(inverted).toHaveLength(2)
    expect(inverted[0].type).toBe('delete')
    expect(inverted[1].type).toBe('delete')
    // Order should be reversed
    if (inverted[0].type === 'delete') {
      expect(triplesEqual(inverted[0].triple, t2)).toBe(true)
    }
    if (inverted[1].type === 'delete') {
      expect(triplesEqual(inverted[1].triple, t1)).toBe(true)
    }
  })
})

describe('optimizeOperations', () => {
  it('should merge consecutive inserts into batch', () => {
    const ops: Operation[] = [
      { type: 'insert', triple: triple('ex:s1', 'ex:p1', 'v1') },
      { type: 'insert', triple: triple('ex:s2', 'ex:p2', 'v2') },
      { type: 'insert', triple: triple('ex:s3', 'ex:p3', 'v3') },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(1)
    expect(optimized[0].type).toBe('batch-insert')
    if (optimized[0].type === 'batch-insert') {
      expect(optimized[0].triples).toHaveLength(3)
    }
  })

  it('should merge consecutive deletes into batch', () => {
    const ops: Operation[] = [
      { type: 'delete', triple: triple('ex:s1', 'ex:p1', 'v1') },
      { type: 'delete', triple: triple('ex:s2', 'ex:p2', 'v2') },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(1)
    expect(optimized[0].type).toBe('batch-delete')
    if (optimized[0].type === 'batch-delete') {
      expect(optimized[0].triples).toHaveLength(2)
    }
  })

  it('should keep separate groups for different operation types', () => {
    const ops: Operation[] = [
      { type: 'insert', triple: triple('ex:s1', 'ex:p1', 'v1') },
      { type: 'delete', triple: triple('ex:s2', 'ex:p2', 'v2') },
      { type: 'insert', triple: triple('ex:s3', 'ex:p3', 'v3') },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(3)
  })

  it('should return empty array for empty input', () => {
    const optimized = optimizeOperations([])
    expect(optimized).toEqual([])
  })

  it('should return single operation unchanged', () => {
    const t = triple('ex:s1', 'ex:p1', 'v1')
    const ops: Operation[] = [
      { type: 'insert', triple: t },
    ]

    const optimized = optimizeOperations(ops)
    expect(optimized).toHaveLength(1)
    expect(optimized[0].type).toBe('insert')
  })
})

describe('triplesEqual', () => {
  it('should return true for identical triples', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s1', 'ex:p1', 'v1')
    expect(triplesEqual(t1, t2)).toBe(true)
  })

  it('should return false for different subjects', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s2', 'ex:p1', 'v1')
    expect(triplesEqual(t1, t2)).toBe(false)
  })

  it('should return false for different predicates', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s1', 'ex:p2', 'v1')
    expect(triplesEqual(t1, t2)).toBe(false)
  })

  it('should return false for different objects', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s1', 'ex:p1', 'v2')
    expect(triplesEqual(t1, t2)).toBe(false)
  })

  it('should handle URI vs Literal objects', () => {
    const t1 = triple('ex:s1', 'ex:ref', 'http://example.org/value')
    const t2: Triple = { 
      subject: namedNode('ex:s1'),
      predicate: namedNode('ex:ref'),
      object: literal('http://example.org/value')
    }
    expect(triplesEqual(t1, t2)).toBe(false)
  })
})

describe('uniqueTriples', () => {
  it('should remove duplicate triples', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s2', 'ex:p2', 'v2')
    const triples: Triple[] = [t1, t1, t2]

    const unique = uniqueTriples(triples)
    expect(unique).toHaveLength(2)
  })

  it('should preserve order (first occurrence)', () => {
    const t1 = triple('ex:s1', 'ex:p1', 'v1')
    const t2 = triple('ex:s2', 'ex:p2', 'v2')
    const triples: Triple[] = [t1, t2, t1]

    const unique = uniqueTriples(triples)
    expect(triplesEqual(unique[0], t1)).toBe(true)
    expect(triplesEqual(unique[1], t2)).toBe(true)
  })

  it('should return empty array for empty input', () => {
    const unique = uniqueTriples([])
    expect(unique).toEqual([])
  })
})
