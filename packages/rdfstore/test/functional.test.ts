/**
 * Tests for functional API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryLevel } from 'memory-level'
import {
  loadSnapshot,
  applyOperation,
  applyOperations,
  createEmptySnapshot,
  createSnapshot,
  createSnapshotView,
  serializeTriples,
  deserializeTriples,
} from '../src/functional/index.js'
import { createBackend, StoreBackend } from '../src/backend/index.js'
import type { Triple, Operation, LevelInstance } from '../src/types.js'
import { triple, namedNode, literal } from './helpers.js'

describe('Functional API', () => {
  let backend: StoreBackend
  let level: LevelInstance

  beforeEach(async () => {
    level = new MemoryLevel({ valueEncoding: 'utf8' })
    await level.open()
    backend = await createBackend(level)
  })

  afterEach(async () => {
    if (backend?.isOpen) {
      await backend.close()
    }
    if (level.status === 'open') {
      await level.close()
    }
  })

  describe('createEmptySnapshot', () => {
    it('should create an empty snapshot', async () => {
      const ref = await createEmptySnapshot(backend)
      
      expect(ref).toBeDefined()
      expect(typeof ref).toBe('string')
      expect(ref.startsWith('empty-')).toBe(true)
    })

    it('should clear any existing data', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      
      await createEmptySnapshot(backend)
      
      const count = await backend.count()
      expect(count).toBe(0)
    })
  })

  describe('createSnapshot', () => {
    it('should create a snapshot with triples', async () => {
      const triples: Triple[] = [
        triple('ex:s1', 'ex:p1', 'v1'),
        triple('ex:s2', 'ex:p2', 'v2'),
      ]

      const ref = await createSnapshot(backend, triples)
      
      expect(ref).toBeDefined()
      expect(ref.startsWith('snap-')).toBe(true)
      
      const count = await backend.count()
      expect(count).toBe(2)
    })

    it('should replace existing data', async () => {
      await backend.insert(triple('ex:old', 'ex:p', 'old'))
      
      const triples: Triple[] = [
        triple('ex:new', 'ex:p', 'new'),
      ]
      
      await createSnapshot(backend, triples)
      
      const results = await backend.getAllTriples()
      expect(results).toHaveLength(1)
      expect(results[0].subject.value).toBe('ex:new')
    })

    it('should handle empty triple array', async () => {
      const ref = await createSnapshot(backend, [])
      
      expect(ref).toBeDefined()
      const count = await backend.count()
      expect(count).toBe(0)
    })
  })

  describe('loadSnapshot', () => {
    it('should load a snapshot view', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      
      const view = await loadSnapshot(backend, 'test-ref')
      
      expect(view).toBeDefined()
      expect(view.ref).toBe('test-ref')
    })

    it('should query through snapshot view', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      await backend.insert(triple('ex:s2', 'ex:p2', 'v2'))
      
      const view = await loadSnapshot(backend, 'test-ref')
      const results = await view.query({ subject: namedNode('ex:s1') })
      
      expect(results).toHaveLength(1)
      expect(results[0].subject.value).toBe('ex:s1')
    })

    it('should count through snapshot view', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      await backend.insert(triple('ex:s2', 'ex:p2', 'v2'))
      
      const view = await loadSnapshot(backend, 'test-ref')
      const count = await view.count()
      
      expect(count).toBe(2)
    })

    it('should getAllTriples through snapshot view', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      
      const view = await loadSnapshot(backend, 'test-ref')
      const triples = await view.getAllTriples()
      
      expect(triples).toHaveLength(1)
    })
  })

  describe('applyOperation', () => {
    it('should apply insert operation', async () => {
      const ref = await createEmptySnapshot(backend)
      const op: Operation = {
        type: 'insert',
        triple: triple('ex:s1', 'ex:p1', 'v1'),
      }
      
      const newRef = await applyOperation(backend, ref, op)
      
      expect(newRef).toBeDefined()
      expect(newRef).not.toBe(ref)
      
      const count = await backend.count()
      expect(count).toBe(1)
    })

    it('should apply delete operation', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      
      const op: Operation = {
        type: 'delete',
        triple: triple('ex:s1', 'ex:p1', 'v1'),
      }
      
      await applyOperation(backend, 'old-ref', op)
      
      const count = await backend.count()
      expect(count).toBe(0)
    })

    it('should apply batch-insert operation', async () => {
      const ref = await createEmptySnapshot(backend)
      const op: Operation = {
        type: 'batch-insert',
        triples: [
          triple('ex:s1', 'ex:p1', 'v1'),
          triple('ex:s2', 'ex:p2', 'v2'),
        ],
      }
      
      await applyOperation(backend, ref, op)
      
      const count = await backend.count()
      expect(count).toBe(2)
    })

    it('should apply batch-delete operation', async () => {
      await backend.batchInsert([
        triple('ex:s1', 'ex:p1', 'v1'),
        triple('ex:s2', 'ex:p2', 'v2'),
        triple('ex:s3', 'ex:p3', 'v3'),
      ])
      
      const op: Operation = {
        type: 'batch-delete',
        triples: [
          triple('ex:s1', 'ex:p1', 'v1'),
          triple('ex:s2', 'ex:p2', 'v2'),
        ],
      }
      
      await applyOperation(backend, 'old-ref', op)
      
      const count = await backend.count()
      expect(count).toBe(1)
    })
  })

  describe('applyOperations', () => {
    it('should apply multiple operations in sequence', async () => {
      const ref = await createEmptySnapshot(backend)
      const ops: Operation[] = [
        { type: 'insert', triple: triple('ex:s1', 'ex:p1', 'v1') },
        { type: 'insert', triple: triple('ex:s2', 'ex:p2', 'v2') },
        { type: 'delete', triple: triple('ex:s1', 'ex:p1', 'v1') },
      ]
      
      const newRef = await applyOperations(backend, ref, ops)
      
      expect(newRef).toBeDefined()
      
      const results = await backend.getAllTriples()
      expect(results).toHaveLength(1)
      expect(results[0].subject.value).toBe('ex:s2')
    })

    it('should handle empty operations array', async () => {
      await backend.insert(triple('ex:s1', 'ex:p1', 'v1'))
      const ref = 'old-ref'
      
      const newRef = await applyOperations(backend, ref, [])
      
      expect(newRef).toBe(ref)
      const count = await backend.count()
      expect(count).toBe(1)
    })
  })

  describe('createSnapshotView', () => {
    it('should create a view with correct ref', () => {
      const view = createSnapshotView(backend, 'my-ref')
      expect(view.ref).toBe('my-ref')
    })
  })

  describe('serializeTriples / deserializeTriples', () => {
    it('should roundtrip triples through serialization', () => {
      const triples: Triple[] = [
        triple('ex:s1', 'ex:p1', 'v1'),
        triple('ex:s2', 'ex:p2', '42'),
        triple('ex:s3', 'ex:p3', 'true'),
      ]
      
      const serialized = serializeTriples(triples)
      const deserialized = deserializeTriples(serialized)
      
      expect(deserialized).toHaveLength(3)
      expect(deserialized[0].subject.value).toBe('ex:s1')
    })

    it('should serialize to a string', () => {
      const triples: Triple[] = [
        triple('ex:s1', 'ex:p1', 'v1'),
      ]
      
      const serialized = serializeTriples(triples)
      expect(typeof serialized).toBe('string')
    })

    it('should handle empty array', () => {
      const serialized = serializeTriples([])
      const deserialized = deserializeTriples(serialized)
      expect(deserialized).toEqual([])
    })

    it('should handle complex string literals', () => {
      const triples: Triple[] = [
        triple('ex:s1', 'ex:data', '{"nested":{"value":"test"}}'),
      ]
      
      const serialized = serializeTriples(triples)
      const deserialized = deserializeTriples(serialized)
      
      expect(deserialized[0].object.value).toBe('{"nested":{"value":"test"}}')
    })
  })
})

describe('StoreBackend', () => {
  let backend: StoreBackend
  let level: LevelInstance

  beforeEach(async () => {
    level = new MemoryLevel({ valueEncoding: 'utf8' })
    await level.open()
    backend = await createBackend(level)
  })

  afterEach(async () => {
    if (backend?.isOpen) {
      await backend.close()
    }
    if (level.status === 'open') {
      await level.close()
    }
  })

  describe('insert and query', () => {
    it('should insert and query a triple', async () => {
      await backend.insert(triple('ex:s', 'ex:p', 'value'))
      
      const results = await backend.query({ subject: namedNode('ex:s') })
      expect(results).toHaveLength(1)
    })

    it('should handle URI objects', async () => {
      await backend.insert(triple('ex:s', 'ex:p', 'http://example.org/value'))
      
      const results = await backend.query({ subject: namedNode('ex:s') })
      expect(results[0].object.value).toBe('http://example.org/value')
    })

    it('should handle numeric literals', async () => {
      const numLiteral = literal('42', namedNode('http://www.w3.org/2001/XMLSchema#decimal'))
      await backend.insert({ subject: namedNode('ex:s'), predicate: namedNode('ex:count'), object: numLiteral })
      
      const results = await backend.query({ subject: namedNode('ex:s') })
      expect(results[0].object.value).toBe('42')
    })

    it('should handle boolean literals', async () => {
      const boolLiteral = literal('false', namedNode('http://www.w3.org/2001/XMLSchema#boolean'))
      await backend.insert({ subject: namedNode('ex:s'), predicate: namedNode('ex:active'), object: boolLiteral })
      
      const results = await backend.query({ subject: namedNode('ex:s') })
      expect(results[0].object.value).toBe('false')
    })

    it('should handle JSON string literals', async () => {
      const data = '{"key":"value","num":123}'
      await backend.insert(triple('ex:s', 'ex:data', data))
      
      const results = await backend.query({ subject: namedNode('ex:s') })
      expect(results[0].object.value).toBe(data)
    })
  })

  describe('delete', () => {
    it('should delete a triple', async () => {
      const t = triple('ex:s', 'ex:p', 'value')
      await backend.insert(t)
      await backend.delete(t)
      
      const results = await backend.query({ subject: namedNode('ex:s') })
      expect(results).toHaveLength(0)
    })
  })

  describe('batchInsert', () => {
    it('should insert multiple triples', async () => {
      await backend.batchInsert([
        triple('ex:s1', 'ex:p', 'v1'),
        triple('ex:s2', 'ex:p', 'v2'),
      ])
      
      const count = await backend.count()
      expect(count).toBe(2)
    })

    it('should handle empty array', async () => {
      await backend.batchInsert([])
      const count = await backend.count()
      expect(count).toBe(0)
    })
  })

  describe('batchDelete', () => {
    it('should delete matching triples', async () => {
      await backend.batchInsert([
        triple('ex:s1', 'ex:p1', 'v1'),
        triple('ex:s1', 'ex:p2', 'v2'),
        triple('ex:s2', 'ex:p1', 'v3'),
      ])
      
      const deleted = await backend.batchDelete({ subject: namedNode('ex:s1') })
      
      expect(deleted).toHaveLength(2)
      const remaining = await backend.count()
      expect(remaining).toBe(1)
    })
  })

  describe('clear', () => {
    it('should remove all triples', async () => {
      await backend.batchInsert([
        triple('ex:s1', 'ex:p', 'v1'),
        triple('ex:s2', 'ex:p', 'v2'),
      ])
      
      await backend.clear()
      
      const count = await backend.count()
      expect(count).toBe(0)
    })
  })

  describe('count and getAllTriples', () => {
    it('should count triples', async () => {
      await backend.batchInsert([
        triple('ex:s1', 'ex:p', 'v1'),
        triple('ex:s2', 'ex:p', 'v2'),
        triple('ex:s3', 'ex:p', 'v3'),
      ])
      
      const count = await backend.count()
      expect(count).toBe(3)
    })

    it('should get all triples', async () => {
      await backend.batchInsert([
        triple('ex:s1', 'ex:p', 'v1'),
        triple('ex:s2', 'ex:p', 'v2'),
      ])
      
      const all = await backend.getAllTriples()
      expect(all).toHaveLength(2)
    })
  })

  describe('close', () => {
    it('should close the backend', async () => {
      expect(backend.isOpen).toBe(true)
      await backend.close()
      expect(backend.isOpen).toBe(false)
    })

    it('should be safe to close twice', async () => {
      await backend.close()
      await expect(backend.close()).resolves.not.toThrow()
    })

    it('should throw when using closed backend', async () => {
      await backend.close()
      await expect(backend.insert(triple('ex:s', 'ex:p', 'v')))
        .rejects.toThrow()
    })
  })
})
