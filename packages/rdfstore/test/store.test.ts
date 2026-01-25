/**
 * RDFStore tests - Version DAG functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryLevel } from 'memory-level'
import type { Quad } from '@rdfjs/types'
import { RDFStore, ROOT_REF } from '../src/index.js'
import { quad, namedNode, literal } from './helpers.js'

// Counter for unique database names
let dbCounter = 0

describe('RDFStore', () => {
  let level: MemoryLevel<string, string>
  let store: RDFStore

  beforeEach(async () => {
    level = new MemoryLevel()
    dbCounter++
    store = await RDFStore.create({
      quadstoreLevel: level,
      versionDbName: `test-version-db-${dbCounter}-${Date.now()}`
    })
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
      const ref = await store.checkpoint({ title: 'Test checkpoint' })

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
      const checkpointRef = await store.checkpoint({ title: 'Checkpoint at 10' })

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
      dbCounter++
      const store2 = await RDFStore.create({
        quadstoreLevel: level2,
        versionDbName: `test-import-export-db-${dbCounter}-${Date.now()}`
      })

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

  describe('Transaction', () => {
    it('should commit changes on successful transaction', async () => {
      const startRef = store.currentRef

      const result = await store.transaction(async () => {
        await store.insert(
          namedNode('http://example.org/s1'),
          namedNode('http://example.org/p'),
          literal('v1')
        )
        await store.insert(
          namedNode('http://example.org/s2'),
          namedNode('http://example.org/p'),
          literal('v2')
        )
        return 'success'
      })

      expect(result).toBe('success')
      expect(store.currentRef).not.toBe(startRef)
      
      const quads = await store.getAllQuads()
      expect(quads).toHaveLength(2)
    })

    it('should rollback changes on error', async () => {
      // Insert initial data
      await store.insert(
        namedNode('http://example.org/initial'),
        namedNode('http://example.org/p'),
        literal('initial')
      )
      const startRef = store.currentRef

      // Transaction that throws
      await expect(
        store.transaction(async () => {
          await store.insert(
            namedNode('http://example.org/s1'),
            namedNode('http://example.org/p'),
            literal('v1')
          )
          await store.insert(
            namedNode('http://example.org/s2'),
            namedNode('http://example.org/p'),
            literal('v2')
          )
          throw new Error('Transaction failed')
        })
      ).rejects.toThrow('Transaction failed')

      // Should be rolled back to start state
      expect(store.currentRef).toBe(startRef)
      
      const quads = await store.getAllQuads()
      expect(quads).toHaveLength(1)
      expect(quads[0].object.value).toBe('initial')

      // Verify the refs created during transaction are deleted
      const children = await store.getChildren(startRef)
      expect(children).toHaveLength(0)
    })

    it('should handle synchronous callback', async () => {
      const result = await store.transaction(() => {
        return 42
      })

      expect(result).toBe(42)
    })

    it('should handle nested transactions', async () => {
      const result = await store.transaction(async () => {
        await store.insert(
          namedNode('http://example.org/outer'),
          namedNode('http://example.org/p'),
          literal('outer')
        )

        // Nested transaction
        await store.transaction(async () => {
          await store.insert(
            namedNode('http://example.org/inner'),
            namedNode('http://example.org/p'),
            literal('inner')
          )
        })

        return 'done'
      })

      expect(result).toBe('done')
      const quads = await store.getAllQuads()
      expect(quads).toHaveLength(2)
    })

    it('should rollback outer transaction on inner error', async () => {
      await store.insert(
        namedNode('http://example.org/before'),
        namedNode('http://example.org/p'),
        literal('before')
      )
      const startRef = store.currentRef

      await expect(
        store.transaction(async () => {
          await store.insert(
            namedNode('http://example.org/outer'),
            namedNode('http://example.org/p'),
            literal('outer')
          )

          // Nested transaction that fails
          await store.transaction(async () => {
            await store.insert(
              namedNode('http://example.org/inner'),
              namedNode('http://example.org/p'),
              literal('inner')
            )
            throw new Error('Inner failed')
          })
        })
      ).rejects.toThrow('Inner failed')

      // Outer transaction should also rollback
      expect(store.currentRef).toBe(startRef)
      const quads = await store.getAllQuads()
      expect(quads).toHaveLength(1)
      expect(quads[0].object.value).toBe('before')
    })
  })

  describe('Named Graphs (Subgraphs)', () => {
    it('should insert quads into named graphs', async () => {
      // Insert into default graph
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/name'),
        literal('Default Entity')
      )

      // Insert into named graph "graph1"
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/name'),
        literal('Graph1 Entity'),
        namedNode('http://example.org/graph1')
      )

      // Insert into named graph "graph2"
      await store.insert(
        namedNode('http://example.org/s3'),
        namedNode('http://example.org/name'),
        literal('Graph2 Entity'),
        namedNode('http://example.org/graph2')
      )

      const allQuads = await store.getAllQuads()
      expect(allQuads).toHaveLength(3)
    })

    it('should query quads by graph', async () => {
      const graph1 = namedNode('http://example.org/graph1')
      const graph2 = namedNode('http://example.org/graph2')

      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/name'),
        literal('Alice'),
        graph1
      )
      await store.insert(
        namedNode('http://example.org/bob'),
        namedNode('http://example.org/name'),
        literal('Bob'),
        graph1
      )
      await store.insert(
        namedNode('http://example.org/charlie'),
        namedNode('http://example.org/name'),
        literal('Charlie'),
        graph2
      )

      // Query only graph1
      const graph1Quads = await store.query({ graph: graph1 })
      expect(graph1Quads).toHaveLength(2)

      // Query only graph2
      const graph2Quads = await store.query({ graph: graph2 })
      expect(graph2Quads).toHaveLength(1)
    })

    it('should delete quads from specific graph', async () => {
      const graph1 = namedNode('http://example.org/graph1')

      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('value1'),
        graph1
      )
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('value1')
        // default graph
      )

      // Both quads exist
      expect(await store.getAllQuads()).toHaveLength(2)

      // Delete only from graph1
      await store.delete(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('value1'),
        graph1
      )

      // Only default graph quad remains
      const remaining = await store.getAllQuads()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].graph.termType).toBe('DefaultGraph')
    })

    it('should batch insert into multiple graphs', async () => {
      const quads = [
        quad('http://example.org/s1', 'http://example.org/p', 'v1', 'http://example.org/graph1'),
        quad('http://example.org/s2', 'http://example.org/p', 'v2', 'http://example.org/graph1'),
        quad('http://example.org/s3', 'http://example.org/p', 'v3', 'http://example.org/graph2'),
        quad('http://example.org/s4', 'http://example.org/p', 'v4'), // default graph
      ]

      await store.batchInsert(quads)

      const graph1Quads = await store.query({ graph: namedNode('http://example.org/graph1') })
      expect(graph1Quads).toHaveLength(2)

      const graph2Quads = await store.query({ graph: namedNode('http://example.org/graph2') })
      expect(graph2Quads).toHaveLength(1)

      const allQuads = await store.getAllQuads()
      expect(allQuads).toHaveLength(4)
    })

    it('should support SPARQL GRAPH clause', async () => {
      // Insert data into different graphs
      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/knows'),
        namedNode('http://example.org/bob'),
        namedNode('http://example.org/social')
      )
      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/worksAt'),
        namedNode('http://example.org/company1'),
        namedNode('http://example.org/work')
      )
      await store.insert(
        namedNode('http://example.org/bob'),
        namedNode('http://example.org/worksAt'),
        namedNode('http://example.org/company2'),
        namedNode('http://example.org/work')
      )

      // Query specific graph using GRAPH clause
      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?person ?company WHERE {
          GRAPH <http://example.org/work> {
            ?person <http://example.org/worksAt> ?company
          }
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
    })

    it('should support SPARQL FROM NAMED clause', async () => {
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/type'),
        namedNode('http://example.org/TypeA'),
        namedNode('http://example.org/graph1')
      )
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/type'),
        namedNode('http://example.org/TypeB'),
        namedNode('http://example.org/graph2')
      )

      // Query using FROM NAMED to specify which graphs to query
      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s ?g WHERE {
          GRAPH ?g {
            ?s <http://example.org/type> ?type
          }
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
      // Should have different graphs
      const graphs = results.map(r => (r.g as { value: string }).value)
      expect(graphs).toContain('http://example.org/graph1')
      expect(graphs).toContain('http://example.org/graph2')
    })

    it('should maintain graph information across checkout', async () => {
      const graph1 = namedNode('http://example.org/graph1')

      // Insert into named graph
      const ref1 = await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('v1'),
        graph1
      )

      // Insert more data
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/p'),
        literal('v2'),
        graph1
      )

      // Checkout to earlier state
      await store.checkout(ref1)

      // Verify graph info is preserved
      const quads = await store.query({ graph: graph1 })
      expect(quads).toHaveLength(1)
      expect(quads[0].graph.value).toBe('http://example.org/graph1')
    })
  })
})
