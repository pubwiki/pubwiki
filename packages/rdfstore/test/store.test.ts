/**
 * RDFStore tests - Checkpoint-based versioning
 * 
 * 重构后：移除了区块链式版本控制，简化为纯 Checkpoint 快照模式
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryLevel } from 'memory-level'
import type { Quad } from '@rdfjs/types'
import { RDFStore } from '../src/index.js'
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
      checkpointDbName: `test-checkpoint-db-${dbCounter}-${Date.now()}`
    })
  })

  afterEach(async () => {
    if (store.isOpen) {
      await store.close()
    }
  })

  describe('Basic Operations', () => {
    it('should start empty', async () => {
      const quads = await store.query({})
      expect(quads).toHaveLength(0)
    })

    it('should insert a quad', async () => {
      await store.insert(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('value')
      )

      const quads = await store.query({})
      expect(quads).toHaveLength(1)
    })

    it('should delete a quad', async () => {
      await store.insert(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('value')
      )

      await store.delete(
        namedNode('ex:s'),
        namedNode('ex:p'),
        literal('value')
      )

      const quads = await store.query({})
      expect(quads).toHaveLength(0)
    })

    it('should batch insert quads', async () => {
      const quads: Quad[] = [
        quad('ex:s1', 'ex:p', 'v1'),
        quad('ex:s2', 'ex:p', 'v2'),
        quad('ex:s3', 'ex:p', 'v3'),
      ]

      await store.batchInsert(quads)

      const result = await store.query({})
      expect(result).toHaveLength(3)
    })

    it('should query with pattern', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s1'), namedNode('ex:p2'), literal('v2'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p1'), literal('v3'))

      const result = await store.query({ subject: namedNode('ex:s1') })
      expect(result).toHaveLength(2)

      const result2 = await store.query({ predicate: namedNode('ex:p1') })
      expect(result2).toHaveLength(2)
    })

    it('should clear all quads', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('v2'))

      await store.clear()

      const quads = await store.query({})
      expect(quads).toHaveLength(0)
    })
  })

  describe('Checkpoint', () => {
    it('should create checkpoint and return checkpoint info', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ title: 'Test checkpoint' })

      expect(checkpoint.id).toBeTruthy()
      expect(checkpoint.title).toBe('Test checkpoint')
      expect(checkpoint.quadCount).toBe(1)
      expect(checkpoint.timestamp).toBeGreaterThan(0)

      const checkpoints = await store.listCheckpoints()
      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].id).toBe(checkpoint.id)
    })

    it('should create checkpoint with custom id', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ 
        id: 'custom-checkpoint-id',
        title: 'Custom ID checkpoint' 
      })

      expect(checkpoint.id).toBe('custom-checkpoint-id')
    })

    it('should create checkpoint with description', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ 
        title: 'Test',
        description: 'Test description'
      })

      expect(checkpoint.description).toBe('Test description')
    })

    it('should load checkpoint and restore data', async () => {
      // Create initial state
      await store.insert(namedNode('ex:s1'), namedNode('ex:p'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('v2'))
      
      const checkpoint = await store.checkpoint({ title: 'Checkpoint 1' })
      expect(checkpoint.quadCount).toBe(2)

      // Add more data
      await store.insert(namedNode('ex:s3'), namedNode('ex:p'), literal('v3'))
      expect(await store.query({})).toHaveLength(3)

      // Load checkpoint - should restore to 2 quads
      await store.loadCheckpoint(checkpoint.id)
      expect(await store.query({})).toHaveLength(2)
    })

    it('should handle multiple checkpoints', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p'), literal('v1'))
      const cp1 = await store.checkpoint({ title: 'Checkpoint 1' })

      await store.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('v2'))
      const cp2 = await store.checkpoint({ title: 'Checkpoint 2' })

      await store.insert(namedNode('ex:s3'), namedNode('ex:p'), literal('v3'))
      const cp3 = await store.checkpoint({ title: 'Checkpoint 3' })

      expect(cp1.quadCount).toBe(1)
      expect(cp2.quadCount).toBe(2)
      expect(cp3.quadCount).toBe(3)

      const checkpoints = await store.listCheckpoints()
      expect(checkpoints).toHaveLength(3)

      // Load middle checkpoint
      await store.loadCheckpoint(cp2.id)
      expect(await store.query({})).toHaveLength(2)
    })

    it('should get checkpoint by id', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ title: 'Test' })

      const retrieved = await store.getCheckpoint(checkpoint.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(checkpoint.id)
      expect(retrieved!.title).toBe('Test')
    })

    it('should return null for non-existent checkpoint', async () => {
      const retrieved = await store.getCheckpoint('non-existent-id')
      expect(retrieved).toBeNull()
    })

    it('should delete checkpoint', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ title: 'Test' })

      await store.deleteCheckpoint(checkpoint.id)

      const checkpoints = await store.listCheckpoints()
      expect(checkpoints).toHaveLength(0)
    })

    it('should check if checkpoint exists', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ title: 'Test' })

      expect(await store.hasCheckpoint(checkpoint.id)).toBe(true)
      expect(await store.hasCheckpoint('non-existent')).toBe(false)
    })

    it('should throw when loading non-existent checkpoint', async () => {
      await expect(store.loadCheckpoint('non-existent-id')).rejects.toThrow('Checkpoint not found')
    })
  })

  describe('Events', () => {
    it('should emit checkpointCreated event', async () => {
      const events: { checkpointId: string }[] = []
      store.on('checkpointCreated', (data) => events.push(data))

      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ title: 'Test' })

      expect(events).toHaveLength(1)
      expect(events[0].checkpointId).toBe(checkpoint.id)
    })

    it('should emit checkpointLoaded event', async () => {
      await store.insert(namedNode('ex:s'), namedNode('ex:p'), literal('v'))
      const checkpoint = await store.checkpoint({ title: 'Test' })

      const events: { checkpointId: string }[] = []
      store.on('checkpointLoaded', (data) => events.push(data))

      await store.loadCheckpoint(checkpoint.id)

      expect(events).toHaveLength(1)
      expect(events[0].checkpointId).toBe(checkpoint.id)
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
        checkpointDbName: `test-import-export-db-${dbCounter}-${Date.now()}`
      })

      await store2.importData(exported)

      const quads = await store2.query({})
      expect(quads).toHaveLength(2)

      await store2.close()
    })

    it('should replace data with import', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p'), literal('original'))

      const newData = await (async () => {
        const tempLevel = new MemoryLevel<string, string>()
        dbCounter++
        const tempStore = await RDFStore.create({
          quadstoreLevel: tempLevel,
          checkpointDbName: `test-temp-db-${dbCounter}-${Date.now()}`
        })
        await tempStore.insert(namedNode('ex:s2'), namedNode('ex:p'), literal('new'))
        const data = await tempStore.exportData({ format: 'jsonl' })
        await tempStore.close()
        return data
      })()

      await store.replaceWithImport(newData, { format: 'jsonl' })

      const quads = await store.query({})
      expect(quads).toHaveLength(1)
      expect(quads[0].subject.value).toBe('ex:s2')
    })
  })

  describe('SPARQL Query', () => {
    it('should execute basic SELECT query', async () => {
      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/name'),
        literal('Alice')
      )
      await store.insert(
        namedNode('http://example.org/bob'),
        namedNode('http://example.org/name'),
        literal('Bob')
      )

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s ?name WHERE {
          ?s <http://example.org/name> ?name .
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
    })

    it('should filter with WHERE clause', async () => {
      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/age'),
        literal('30', namedNode('http://www.w3.org/2001/XMLSchema#integer'))
      )
      await store.insert(
        namedNode('http://example.org/bob'),
        namedNode('http://example.org/age'),
        literal('25', namedNode('http://www.w3.org/2001/XMLSchema#integer'))
      )

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s ?age WHERE {
          ?s <http://example.org/age> ?age .
          FILTER (?age > 27)
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(1)
    })

    it('should handle empty results', async () => {
      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s WHERE {
          ?s <http://example.org/nonexistent> ?o .
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(0)
    })

    it('should support OPTIONAL clause', async () => {
      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/name'),
        literal('Alice')
      )
      await store.insert(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/age'),
        literal('30')
      )
      await store.insert(
        namedNode('http://example.org/bob'),
        namedNode('http://example.org/name'),
        literal('Bob')
      )
      // Bob has no age

      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s ?name ?age WHERE {
          ?s <http://example.org/name> ?name .
          OPTIONAL { ?s <http://example.org/age> ?age }
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(2)
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

      const graph1Results = await store.query({ graph: graph1 })
      expect(graph1Results).toHaveLength(2)

      const graph2Results = await store.query({ graph: graph2 })
      expect(graph2Results).toHaveLength(1)
    })

    it('should delete quads from specific graph', async () => {
      const graph1 = namedNode('http://example.org/graph1')

      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('v1'),
        graph1
      )
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('v1')
        // default graph
      )

      // Delete only from graph1
      await store.delete(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('v1'),
        graph1
      )

      const allQuads = await store.getAllQuads()
      expect(allQuads).toHaveLength(1)
      // Remaining quad should be in default graph
    })

    it('should batch insert into multiple graphs', async () => {
      const graph1 = namedNode('http://example.org/graph1')
      const graph2 = namedNode('http://example.org/graph2')

      const quads: Quad[] = [
        quad('http://example.org/s1', 'http://example.org/p', 'v1', graph1.value),
        quad('http://example.org/s2', 'http://example.org/p', 'v2', graph2.value),
      ]

      await store.batchInsert(quads)

      expect(await store.query({ graph: graph1 })).toHaveLength(1)
      expect(await store.query({ graph: graph2 })).toHaveLength(1)
    })

    it('should support SPARQL GRAPH clause', async () => {
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

      // Query only from graph1
      const results: Record<string, unknown>[] = []
      for await (const binding of store.sparqlQuery(`
        SELECT ?s ?type WHERE {
          GRAPH <http://example.org/graph1> {
            ?s <http://example.org/type> ?type
          }
        }
      `)) {
        results.push(binding)
      }

      expect(results).toHaveLength(1)
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

    it('should maintain graph information in checkpoints', async () => {
      const graph1 = namedNode('http://example.org/graph1')

      // Insert into named graph
      await store.insert(
        namedNode('http://example.org/s1'),
        namedNode('http://example.org/p'),
        literal('v1'),
        graph1
      )

      const checkpoint = await store.checkpoint({ title: 'Graph checkpoint' })

      // Insert more data
      await store.insert(
        namedNode('http://example.org/s2'),
        namedNode('http://example.org/p'),
        literal('v2'),
        graph1
      )

      // Load checkpoint
      await store.loadCheckpoint(checkpoint.id)

      // Verify graph info is preserved
      const quads = await store.query({ graph: graph1 })
      expect(quads).toHaveLength(1)
      expect(quads[0].graph.value).toBe('http://example.org/graph1')
    })
  })
})
