/**
 * Tests for RDFStore stateful API
 * 
 * Uses memory-level for testing in Node.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryLevel } from 'memory-level'
import { RDFStore } from '../src/stateful/store.js'
import type { Triple, Operation, LogEntry, SnapshotInfo, LevelInstance } from '../src/types.js'
import { triple, namedNode, literal } from './helpers.js'

describe('RDFStore', () => {
  let store: RDFStore

  beforeEach(async () => {
    // Create a fresh store for each test with a new memory level
    const level: LevelInstance = new MemoryLevel({ valueEncoding: 'utf8' })
    store = await RDFStore.create(level, {
      autoCheckpointInterval: 10,
      enableAutoCheckpoint: true,
    })
  })

  afterEach(async () => {
    if (store?.isOpen) {
      await store.close()
    }
  })

  describe('create and open', () => {
    it('should create a new store', async () => {
      expect(store).toBeDefined()
      expect(store.isOpen).toBe(true)
    })

    it('should have initial snapshot', async () => {
      const snapshots = await store.listSnapshots()
      expect(snapshots.length).toBeGreaterThanOrEqual(1)
    })

    it('should have a current ref', () => {
      expect(store.currentRef).toBeDefined()
      expect(typeof store.currentRef).toBe('string')
    })
  })

  describe('basic CRUD operations', () => {
    it('should insert a triple', async () => {
      await store.insert(namedNode('ex:subject'), namedNode('ex:predicate'), literal('value'))
      
      const results = await store.query({ subject: namedNode('ex:subject') })
      expect(results).toHaveLength(1)
      expect(results[0].subject.value).toBe('ex:subject')
      expect(results[0].predicate.value).toBe('ex:predicate')
      expect(results[0].object.value).toBe('value')
    })

    it('should insert multiple triples', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      
      const all = await store.query({})
      expect(all).toHaveLength(2)
    })

    it('should delete a triple', async () => {
      await store.insert(namedNode('ex:subject'), namedNode('ex:predicate'), literal('value'))
      await store.delete(namedNode('ex:subject'), namedNode('ex:predicate'), literal('value'))
      
      const results = await store.query({ subject: namedNode('ex:subject') })
      expect(results).toHaveLength(0)
    })

    it('should delete by pattern (without object)', async () => {
      await store.insert(namedNode('ex:subject'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:subject'), namedNode('ex:p2'), literal('v2'))
      
      await store.delete(namedNode('ex:subject'), namedNode('ex:p1'))
      
      const results = await store.query({ subject: namedNode('ex:subject') })
      expect(results).toHaveLength(1)
      expect(results[0].predicate.value).toBe('ex:p2')
    })

    it('should query by subject', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s1'), namedNode('ex:p2'), literal('v2'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p1'), literal('v3'))
      
      const results = await store.query({ subject: namedNode('ex:s1') })
      expect(results).toHaveLength(2)
    })

    it('should query by predicate', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:type'), literal('Person'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:type'), literal('Organization'))
      await store.insert(namedNode('ex:s1'), namedNode('ex:name'), literal('Alice'))
      
      const results = await store.query({ predicate: namedNode('ex:type') })
      expect(results).toHaveLength(2)
    })

    it('should handle numeric objects', async () => {
      const numLiteral = literal('42', namedNode('http://www.w3.org/2001/XMLSchema#decimal'))
      await store.insert(namedNode('ex:subject'), namedNode('ex:count'), numLiteral)
      
      const results = await store.query({ subject: namedNode('ex:subject') })
      expect(results[0].object.value).toBe('42')
    })

    it('should handle boolean objects', async () => {
      const boolLiteral = literal('true', namedNode('http://www.w3.org/2001/XMLSchema#boolean'))
      await store.insert(namedNode('ex:subject'), namedNode('ex:active'), boolLiteral)
      
      const results = await store.query({ subject: namedNode('ex:subject') })
      expect(results[0].object.value).toBe('true')
    })
  })

  describe('batch operations', () => {
    it('should batch insert triples', async () => {
      const triples: Triple[] = [
        triple('ex:s1', 'ex:p1', 'v1'),
        triple('ex:s2', 'ex:p2', 'v2'),
        triple('ex:s3', 'ex:p3', 'v3'),
      ]
      
      await store.batchInsert(triples)
      
      const all = await store.query({})
      expect(all).toHaveLength(3)
    })

    it('should batch delete by patterns', async () => {
      await store.batchInsert([
        triple('ex:s1', 'ex:p1', 'v1'),
        triple('ex:s2', 'ex:p2', 'v2'),
        triple('ex:s3', 'ex:p3', 'v3'),
      ])
      
      await store.batchDelete([
        { subject: namedNode('ex:s1') },
        { subject: namedNode('ex:s2') },
      ])
      
      const remaining = await store.query({})
      expect(remaining).toHaveLength(1)
      expect(remaining[0].subject.value).toBe('ex:s3')
    })

    it('should handle empty batch insert', async () => {
      await store.batchInsert([])
      const all = await store.query({})
      expect(all).toHaveLength(0)
    })

    it('should handle empty batch delete', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.batchDelete([])
      
      const all = await store.query({})
      expect(all).toHaveLength(1)
    })
  })

  describe('version control', () => {
    it('should save a named snapshot', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      const snapshot = await store.saveSnapshot('test-snapshot')
      
      expect(snapshot.ref).toBeDefined()
      expect(snapshot.label).toBe('test-snapshot')
      expect(snapshot.tripleCount).toBe(1)
      expect(snapshot.isAutoCheckpoint).toBe(false)
    })

    it('should list all snapshots', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.saveSnapshot('snap-1')
      
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      await store.saveSnapshot('snap-2')
      
      const snapshots = await store.listSnapshots()
      // Initial + 2 manual snapshots
      expect(snapshots.length).toBeGreaterThanOrEqual(2)
    })

    it('should rollback to a snapshot', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      const snapshot = await store.saveSnapshot('before-change')
      
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      await store.insert(namedNode('ex:s3'), namedNode('ex:p3'), literal('v3'))
      
      let all = await store.query({})
      expect(all).toHaveLength(3)
      
      const undone = await store.rollbackTo(snapshot.ref)
      
      all = await store.query({})
      expect(all).toHaveLength(1)
      expect(all[0].subject.value).toBe('ex:s1')
    })

    it('should delete a snapshot', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      const snapshot = await store.saveSnapshot('to-delete')
      
      const beforeDelete = await store.listSnapshots()
      const beforeCount = beforeDelete.length
      
      await store.deleteSnapshot(snapshot.ref)
      
      const afterDelete = await store.listSnapshots()
      expect(afterDelete.length).toBe(beforeCount - 1)
    })
  })

  describe('undo/redo', () => {
    it('should undo last operation', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      
      let results = await store.query({})
      expect(results).toHaveLength(1)
      
      const undone = await store.undo()
      expect(undone).toHaveLength(1)
      expect(undone[0].type).toBe('insert')
      
      results = await store.query({})
      expect(results).toHaveLength(0)
    })

    it('should undo multiple operations', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      await store.insert(namedNode('ex:s3'), namedNode('ex:p3'), literal('v3'))
      
      const undone = await store.undo(2)
      expect(undone).toHaveLength(2)
      
      const results = await store.query({})
      expect(results).toHaveLength(1)
      expect(results[0].subject.value).toBe('ex:s1')
    })

    it('should redo undone operation', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.undo()
      
      let results = await store.query({})
      expect(results).toHaveLength(0)
      
      const redone = await store.redo()
      expect(redone).toHaveLength(1)
      
      results = await store.query({})
      expect(results).toHaveLength(1)
    })

    it('should redo multiple operations', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      await store.undo(2)
      
      const redone = await store.redo(2)
      expect(redone).toHaveLength(2)
      
      const results = await store.query({})
      expect(results).toHaveLength(2)
    })

    it('should clear redo stack on new operation', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.undo()
      
      // New operation should clear redo stack
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      
      const redone = await store.redo()
      expect(redone).toHaveLength(0)
    })

    it('should handle undo when nothing to undo', async () => {
      const undone = await store.undo()
      expect(undone).toHaveLength(0)
    })

    it('should handle redo when nothing to redo', async () => {
      const redone = await store.redo()
      expect(redone).toHaveLength(0)
    })
  })

  describe('history', () => {
    it('should get operation history', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      
      const history = await store.getHistory()
      expect(history.length).toBeGreaterThanOrEqual(2)
    })

    it('should limit history results', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      await store.insert(namedNode('ex:s3'), namedNode('ex:p3'), literal('v3'))
      
      const history = await store.getHistory({ limit: 2 })
      expect(history).toHaveLength(2)
    })

    it('should compact history', async () => {
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      
      await store.compactHistory()
      
      // Data should still be there
      const results = await store.query({})
      expect(results).toHaveLength(2)
    })
  })

  describe('events', () => {
    it('should emit change events', async () => {
      const changes: LogEntry[] = []
      const unsubscribe = store.on('change', (entry) => {
        changes.push(entry)
      })
      
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      
      expect(changes).toHaveLength(2)
      expect(changes[0].operation.type).toBe('insert')
      
      unsubscribe()
    })

    it('should emit snapshot events', async () => {
      const snapshots: SnapshotInfo[] = []
      const unsubscribe = store.on('snapshot', (info) => {
        snapshots.push(info)
      })
      
      await store.saveSnapshot('test')
      
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].label).toBe('test')
      
      unsubscribe()
    })

    it('should emit rollback events', async () => {
      let rollbackEvent: { from: string; to: string } | null = null
      const unsubscribe = store.on('rollback', (event) => {
        rollbackEvent = event
      })
      
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      const snapshot = await store.saveSnapshot('checkpoint')
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      
      await store.rollbackTo(snapshot.ref)
      
      expect(rollbackEvent).not.toBeNull()
      expect(rollbackEvent!.to).toBe(snapshot.ref)
      
      unsubscribe()
    })

    it('should unsubscribe from events', async () => {
      let callCount = 0
      const unsubscribe = store.on('change', () => {
        callCount++
      })
      
      await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
      expect(callCount).toBe(1)
      
      unsubscribe()
      
      await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('v2'))
      expect(callCount).toBe(1)
    })
  })

  describe('auto checkpoint', () => {
    it('should create auto checkpoint after interval', async () => {
      // Store was created with autoCheckpointInterval: 10
      const initialSnapshots = await store.listSnapshots()
      const initialCount = initialSnapshots.length
      
      // Insert 12 triples to trigger auto checkpoint
      for (let i = 0; i < 12; i++) {
        await store.insert(namedNode(`ex:s${i}`), namedNode('ex:p'), literal(`v${i}`))
      }
      
      const snapshots = await store.listSnapshots()
      expect(snapshots.length).toBeGreaterThan(initialCount)
      
      // Check that at least one is an auto checkpoint
      const hasAutoCheckpoint = snapshots.some(s => s.isAutoCheckpoint)
      expect(hasAutoCheckpoint).toBe(true)
    })
  })

  describe('close and reopen', () => {
    it('should close the store', async () => {
      expect(store.isOpen).toBe(true)
      await store.close()
      expect(store.isOpen).toBe(false)
    })

    it('should be safe to close multiple times', async () => {
      await store.close()
      await expect(store.close()).resolves.not.toThrow()
    })
  })
})
