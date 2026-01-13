/**
 * RDFStore tests - Version DAG functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryLevel } from 'memory-level'
import type { Quad } from '@rdfjs/types'
import { RDFStore, ROOT_REF } from '../src/index.js'
import { quad, namedNode, literal } from './helpers.js'

describe('RDFStore', () => {
  let level: MemoryLevel<string, string>
  let store: RDFStore

  beforeEach(async () => {
    level = new MemoryLevel()
    store = await RDFStore.create(level)
  })

  afterEach(async () => {
    if (store.isOpen) {
      await store.close()
    }
  })

  describe('Basic Operations', () => {
    it('should start with root ref', () => {
      expect(store.currentRef).toBe(ROOT_REF)
    })

    it('should insert a quad and return new ref', async () => {
      const ref = await store.insert(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('value')
      )

      expect(ref).not.toBe(ROOT_REF)
      expect(store.currentRef).toBe(ref)

      const quads = await store.query({})
      expect(quads).toHaveLength(1)
    })

    it('should delete a quad and return new ref', async () => {
      const ref1 = await store.insert(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('value')
      )

      const ref2 = await store.delete(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('value')
      )

      expect(ref2).not.toBe(ref1)
      expect(store.currentRef).toBe(ref2)

      const quads = await store.query({})
      expect(quads).toHaveLength(0)
    })

    it('should batch insert quads', async () => {
      const quads: Quad[] = [
        quad('ex:s1', 'ex:p', 'v1'),
        quad('ex:s2', 'ex:p', 'v2'),
        quad('ex:s3', 'ex:p', 'v3'),
      ]

      const ref = await store.batchInsert(quads)
      expect(ref).not.toBe(ROOT_REF)

      const result = await store.query({})
      expect(result).toHaveLength(3)
    })
  })

  describe('Version DAG - Checkout', () => {
    it('should checkout to previous state', async () => {
      // Insert first quad
      const ref1 = await store.insert(
        namedNode('ex:s1'),
        namedNode('ex:p'),
        literal('v1')
      )

      // Insert second quad
      const ref2 = await store.insert(
        namedNode('ex:s2'),
        namedNode('ex:p'),
        literal('v2')
      )

      expect(await store.query({})).toHaveLength(2)

      // Checkout to ref1
      await store.checkout(ref1)
      expect(store.currentRef).toBe(ref1)
      expect(await store.query({})).toHaveLength(1)

      // Checkout to ref2
      await store.checkout(ref2)
      expect(store.currentRef).toBe(ref2)
      expect(await store.query({})).toHaveLength(2)

      // Checkout to root
      await store.checkout(ROOT_REF)
      expect(store.currentRef).toBe(ROOT_REF)
      expect(await store.query({})).toHaveLength(0)
    })

    it('should support implicit branching', async () => {
      // State A: insert x
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('x'))
      const refA = store.currentRef

      // State B: delete x (from A)
      await store.delete(namedNode('ex:s'), namedNode('ex:p'), literal('x'))
      const refB = store.currentRef

      // Go back to A and create branch C
      await store.checkout(refA)
      expect(await store.query({})).toHaveLength(1)

      // State C: insert y (from A, branching)
      await store.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('y'))
      const refC = store.currentRef

      // C should have 2 quads (x and y)
      expect(await store.query({})).toHaveLength(2)

      // B should still have 0 quads
      await store.checkout(refB)
      expect(await store.query({})).toHaveLength(0)

      // C should still have 2 quads
      await store.checkout(refC)
      expect(await store.query({})).toHaveLength(2)
    })

    it('should track children (forks)', async () => {
      const ref1 = await store.insert(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('v1')
      )

      // Create two branches from ref1
      await store.checkout(ref1)
      const ref2a = await store.insert(
        namedNode('ex:s2'),
        namedNode('ex:p'),
        literal('a')
      )

      await store.checkout(ref1)
      const ref2b = await store.insert(
        namedNode('ex:s2'),
        namedNode('ex:p'),
        literal('b')
      )

      // ref1 should have two children
      const children = await store.getChildren(ref1)
      expect(children).toContain(ref2a)
      expect(children).toContain(ref2b)
      expect(children).toHaveLength(2)
    })
  })

  describe('Checkpoint', () => {
    it('should create checkpoint and return ref', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const ref = await store.checkpoint()

      expect(ref).toBe(store.currentRef)

      const checkpoints = await store.listCheckpoints()
      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].ref).toBe(ref)
    })

    it('should use checkpoint for faster checkout', async () => {
      // Create many operations
      for (let i = 0; i < 10; i++) {
        await store.insert(
          namedNode(`ex:s${i}`),
          namedNode('ex:p'),
          literal(`v${i}`)
        )
      }

      // Create checkpoint
      const checkpointRef = await store.checkpoint()

      // Add more operations
      for (let i = 10; i < 15; i++) {
        await store.insert(
          namedNode(`ex:s${i}`),
          namedNode('ex:p'),
          literal(`v${i}`)
        )
      }

      // Checkout to checkpoint should use saved data
      await store.checkout(checkpointRef)
      expect(await store.query({})).toHaveLength(10)
    })
  })

  describe('Log', () => {
    it('should return operation history', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('v2'))
      await store.insert(namedNode('ex:s3'), namedNode('ex:p'), literal('v3'))

      const history = await store.log()
      expect(history).toHaveLength(3)

      // Most recent first
      expect(history[0].operation.type).toBe('insert')
      expect(history[2].operation.type).toBe('insert')
    })

    it('should limit history entries', async () => {
      for (let i = 0; i < 10; i++) {
        await store.insert(
          namedNode(`ex:s${i}`),
          namedNode('ex:p'),
          literal(`v${i}`)
        )
      }

      const history = await store.log(3)
      expect(history).toHaveLength(3)
    })
  })

  describe('Events', () => {
    it('should emit change event on insert', async () => {
      const changes: { ref: string }[] = []
      store.on('change', (data) => changes.push(data))

      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))

      expect(changes).toHaveLength(1)
      expect(changes[0].ref).toBe(store.currentRef)
    })

    it('should emit checkout event', async () => {
      const ref1 = await store.insert(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('v')
      )

      const checkouts: { from: string; to: string }[] = []
      store.on('checkout', (data) => checkouts.push(data))

      await store.checkout(ROOT_REF)

      expect(checkouts).toHaveLength(1)
      expect(checkouts[0].from).toBe(ref1)
      expect(checkouts[0].to).toBe(ROOT_REF)
    })
  })

  describe('Import/Export', () => {
    it('should export and import data', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('v2'))

      const exported = await store.exportData({ format: 'jsonl' })

      // Create new store and import
      const level2 = new MemoryLevel<string, string>()
      const store2 = await RDFStore.create(level2)

      await store2.importData(exported)

      const quads = await store2.query({})
      expect(quads).toHaveLength(2)

      await store2.close()
    })
  })

  describe('SPARQL Query', () => {
    it('should execute basic SELECT query', async () => {
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('value1')
      )
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/p'),
        literal('value2')
      )

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery('SELECT * WHERE { ?s ?p ?o }')) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
      expect(results[0]).toHaveProperty('s')
      expect(results[0]).toHaveProperty('p')
      expect(results[0]).toHaveProperty('o')
    })

    it('should filter with WHERE clause', async () => {
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/type'),
        namedNode('http://example.org/Person')
      )
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/type'),
        namedNode('http://example.org/Animal')
      )

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s WHERE { 
          ?s <http://example.org/type> <http://example.org/Person> 
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(1)
      expect(results[0]).toHaveProperty('s')
    })

    it('should handle empty results', async () => {
      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery('SELECT * WHERE { ?s ?p ?o }')) {
        results.push(binding)
      }

      expect(results).toHaveLength(0)
    })

    it('should support OPTIONAL clause', async () => {
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/name'),
        literal('Alice')
      )
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/age'),
        literal('30')
      )
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/name'),
        literal('Bob')
      )

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?name ?age WHERE {
          ?s <http://example.org/name> ?name .
          OPTIONAL { ?s <http://example.org/age> ?age }
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
      // One should have age, one should not
      const withAge = results.filter(r => r.age !== undefined)
      const withoutAge = results.filter(r => r.age === undefined)
      expect(withAge).toHaveLength(1)
      expect(withoutAge).toHaveLength(1)
    })

    it('should support FILTER clause', async () => {
      await store.insert(
        namedNode('http://example.org/item1'),
        namedNode('http://example.org/price'),
        literal('10', namedNode('http://www.w3.org/2001/XMLSchema#integer'))
      )
      await store.insert(
        namedNode('http://example.org/item2'),
        namedNode('http://example.org/price'),
        literal('50', namedNode('http://www.w3.org/2001/XMLSchema#integer'))
      )
      await store.insert(
        namedNode('http://example.org/item3'),
        namedNode('http://example.org/price'),
        literal('100', namedNode('http://www.w3.org/2001/XMLSchema#integer'))
      )

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?item ?price WHERE {
          ?item <http://example.org/price> ?price .
          FILTER (?price > 20)
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
    })
  })
})
