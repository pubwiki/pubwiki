/**
 * Tests for log manager and persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryLevel } from 'memory-level'
import { LogManager, createLogManager } from '../src/log/manager.js'
import { LogPersistence, createLogPersistence } from '../src/log/persistence.js'
import type { Operation, LogEntry, LevelInstance } from '../src/types.js'
import { triple, namedNode, literal } from './helpers.js'

describe('LogPersistence', () => {
  let persistence: LogPersistence
  let level: LevelInstance

  beforeEach(async () => {
    level = new MemoryLevel({ valueEncoding: 'utf8' })
    await level.open()
    persistence = await createLogPersistence(level)
  })

  afterEach(async () => {
    if (persistence?.isOpen) {
      await persistence.close()
    }
    if (level.status === 'open') {
      await level.close()
    }
  })

  describe('open and close', () => {
    it('should open the persistence layer', async () => {
      expect(persistence.isOpen).toBe(true)
    })

    it('should close the persistence layer', async () => {
      await persistence.close()
      expect(persistence.isOpen).toBe(false)
    })
  })

  describe('log operations', () => {
    it('should append and retrieve a log entry', async () => {
      const entry: LogEntry = {
        id: 'test-1',
        timestamp: Date.now(),
        operation: { type: 'insert', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'empty',
      }

      const index = await persistence.appendLog(entry)
      expect(index).toBe(0)

      const retrieved = await persistence.getLogEntry(0)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.type).toBe('operation')
      if (retrieved?.type === 'operation') {
        expect(retrieved.entry.id).toBe('test-1')
      }
    })

    it('should get log length', async () => {
      expect(await persistence.getLogLength()).toBe(0)

      const entry: LogEntry = {
        id: 'test-1',
        timestamp: Date.now(),
        operation: { type: 'insert', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'empty',
      }

      await persistence.appendLog(entry)
      expect(await persistence.getLogLength()).toBe(1)

      await persistence.appendLog({ ...entry, id: 'test-2' })
      expect(await persistence.getLogLength()).toBe(2)
    })

    it('should get log range', async () => {
      for (let i = 0; i < 5; i++) {
        await persistence.appendLog({
          id: `test-${i}`,
          timestamp: Date.now(),
          operation: { type: 'insert', triple: triple(`ex:s${i}`, 'ex:p', `v${i}`) },
          prevRef: 'prev',
        })
      }

      const range = await persistence.getLogRange(1, 4)
      expect(range).toHaveLength(3)
    })

    it('should append checkpoint', async () => {
      await persistence.appendCheckpoint('ckpt-ref', 0)
      
      const record = await persistence.getLogEntry(0)
      expect(record?.type).toBe('checkpoint')
    })
  })

  describe('snapshot operations', () => {
    it('should save and retrieve snapshot meta', async () => {
      const meta = {
        ref: 'snap-test',
        timestamp: Date.now(),
        tripleCount: 10,
        logIndex: 5,
        label: 'test snapshot',
        isAutoCheckpoint: false,
      }

      await persistence.saveSnapshotMeta(meta)
      const retrieved = await persistence.getSnapshotMeta('snap-test')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.ref).toBe('snap-test')
      expect(retrieved?.label).toBe('test snapshot')
      expect(retrieved?.tripleCount).toBe(10)
    })

    it('should list all snapshots', async () => {
      await persistence.saveSnapshotMeta({
        ref: 'snap-1',
        timestamp: Date.now(),
        tripleCount: 5,
        logIndex: 1,
        isAutoCheckpoint: false,
      })
      await persistence.saveSnapshotMeta({
        ref: 'snap-2',
        timestamp: Date.now(),
        tripleCount: 10,
        logIndex: 2,
        isAutoCheckpoint: true,
      })

      const snapshots = await persistence.getAllSnapshots()
      expect(snapshots).toHaveLength(2)
    })

    it('should delete snapshot meta', async () => {
      await persistence.saveSnapshotMeta({
        ref: 'snap-to-delete',
        timestamp: Date.now(),
        tripleCount: 5,
        logIndex: 1,
        isAutoCheckpoint: false,
      })

      await persistence.deleteSnapshotMeta('snap-to-delete')
      const retrieved = await persistence.getSnapshotMeta('snap-to-delete')
      expect(retrieved).toBeNull()
    })
  })

  describe('meta operations', () => {
    it('should set and get meta values', async () => {
      await persistence.setMeta('testKey', { value: 42 })
      const retrieved = await persistence.getMeta<{ value: number }>('testKey')
      expect(retrieved?.value).toBe(42)
    })

    it('should return null for missing meta', async () => {
      const retrieved = await persistence.getMeta('nonexistent')
      expect(retrieved).toBeNull()
    })

    it('should handle current ref', async () => {
      expect(await persistence.getCurrentRef()).toBeNull()
      
      await persistence.setCurrentRef('new-ref')
      expect(await persistence.getCurrentRef()).toBe('new-ref')
    })
  })

  describe('undo/redo stacks', () => {
    it('should manage undo stack', async () => {
      const entry: LogEntry = {
        id: 'undo-1',
        timestamp: Date.now(),
        operation: { type: 'insert', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'prev',
      }

      await persistence.setUndoStack([entry])
      const stack = await persistence.getUndoStack()
      expect(stack).toHaveLength(1)
      expect(stack[0].id).toBe('undo-1')
    })

    it('should manage redo stack', async () => {
      const entry: LogEntry = {
        id: 'redo-1',
        timestamp: Date.now(),
        operation: { type: 'delete', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'prev',
      }

      await persistence.setRedoStack([entry])
      const stack = await persistence.getRedoStack()
      expect(stack).toHaveLength(1)

      await persistence.clearRedoStack()
      expect(await persistence.getRedoStack()).toHaveLength(0)
    })
  })

  describe('clear operations', () => {
    it('should clear logs', async () => {
      for (let i = 0; i < 3; i++) {
        await persistence.appendLog({
          id: `test-${i}`,
          timestamp: Date.now(),
          operation: { type: 'insert', triple: triple(`ex:s${i}`, 'ex:p', `v${i}`) },
          prevRef: 'prev',
        })
      }

      expect(await persistence.getLogLength()).toBe(3)
      
      await persistence.clearLogs()
      expect(await persistence.getLogLength()).toBe(0)
    })

    it('should clear all', async () => {
      await persistence.appendLog({
        id: 'test',
        timestamp: Date.now(),
        operation: { type: 'insert', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'prev',
      })
      await persistence.saveSnapshotMeta({
        ref: 'snap',
        timestamp: Date.now(),
        tripleCount: 1,
        logIndex: 0,
        isAutoCheckpoint: false,
      })

      await persistence.clearAll()

      expect(await persistence.getLogLength()).toBe(0)
      expect(await persistence.getAllSnapshots()).toHaveLength(0)
    })
  })
})

describe('LogManager', () => {
  let manager: LogManager
  let level: LevelInstance

  beforeEach(async () => {
    level = new MemoryLevel({ valueEncoding: 'utf8' })
    await level.open()
    manager = await createLogManager(level, 5, true)
  })

  afterEach(async () => {
    await manager.close()
    if (level.status === 'open') {
      await level.close()
    }
  })

  describe('record operations', () => {
    it('should record an operation', async () => {
      const op: Operation = {
        type: 'insert',
        triple: triple('ex:s', 'ex:p', 'v'),
      }

      const entry = await manager.recordOperation(op)

      expect(entry.id).toBeDefined()
      expect(entry.timestamp).toBeDefined()
      expect(entry.operation).toEqual(op)
    })

    it('should update current ref after operation', async () => {
      const initialRef = manager.currentRef
      
      await manager.recordOperation({
        type: 'insert',
        triple: triple('ex:s', 'ex:p', 'v'),
      })

      expect(manager.currentRef).not.toBe(initialRef)
    })
  })

  describe('checkpoints', () => {
    it('should save a checkpoint', async () => {
      const info = await manager.saveCheckpoint(10, 'test-checkpoint', false)

      expect(info.ref).toBeDefined()
      expect(info.label).toBe('test-checkpoint')
      expect(info.tripleCount).toBe(10)
      expect(info.isAutoCheckpoint).toBe(false)
    })

    it('should list snapshots', async () => {
      await manager.saveCheckpoint(5, 'snap-1')
      await manager.saveCheckpoint(10, 'snap-2')

      const snapshots = await manager.listSnapshots()
      expect(snapshots.length).toBeGreaterThanOrEqual(2)
    })

    it('should track operations since checkpoint', async () => {
      expect(manager.shouldAutoCheckpoint()).toBe(false)

      // Record 5 operations (our interval)
      for (let i = 0; i < 5; i++) {
        await manager.recordOperation({
          type: 'insert',
          triple: triple(`ex:s${i}`, 'ex:p', `v${i}`),
        })
      }

      expect(manager.shouldAutoCheckpoint()).toBe(true)
    })

    it('should reset counter after checkpoint', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.recordOperation({
          type: 'insert',
          triple: triple(`ex:s${i}`, 'ex:p', `v${i}`),
        })
      }

      expect(manager.shouldAutoCheckpoint()).toBe(true)
      
      manager.resetCheckpointCounter()
      expect(manager.shouldAutoCheckpoint()).toBe(false)
    })

    it('should delete a snapshot', async () => {
      const info = await manager.saveCheckpoint(5, 'to-delete')
      const before = await manager.listSnapshots()
      
      await manager.deleteSnapshot(info.ref)
      
      const after = await manager.listSnapshots()
      expect(after.length).toBe(before.length - 1)
    })
  })

  describe('history', () => {
    it('should get operation history', async () => {
      for (let i = 0; i < 3; i++) {
        await manager.recordOperation({
          type: 'insert',
          triple: triple(`ex:s${i}`, 'ex:p', `v${i}`),
        })
      }

      const history = await manager.getHistory()
      expect(history).toHaveLength(3)
    })

    it('should limit history', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.recordOperation({
          type: 'insert',
          triple: triple(`ex:s${i}`, 'ex:p', `v${i}`),
        })
      }

      const history = await manager.getHistory({ limit: 2 })
      expect(history).toHaveLength(2)
    })
  })

  describe('undo/redo stacks', () => {
    it('should push and pop from undo stack', async () => {
      const entry: LogEntry = {
        id: 'test',
        timestamp: Date.now(),
        operation: { type: 'insert', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'prev',
      }

      await manager.pushToUndoStack(entry)
      expect(await manager.getUndoStackLength()).toBe(1)

      const popped = await manager.popFromUndoStack()
      expect(popped?.id).toBe('test')
      expect(await manager.getUndoStackLength()).toBe(0)
    })

    it('should push and pop from redo stack', async () => {
      const entry: LogEntry = {
        id: 'test',
        timestamp: Date.now(),
        operation: { type: 'delete', triple: triple('ex:s', 'ex:p', 'v') },
        prevRef: 'prev',
      }

      await manager.pushToRedoStack(entry)
      expect(await manager.getRedoStackLength()).toBe(1)

      const popped = await manager.popFromRedoStack()
      expect(popped?.id).toBe('test')
      expect(await manager.getRedoStackLength()).toBe(0)
    })

    it('should return undefined when popping empty stack', async () => {
      const popped = await manager.popFromUndoStack()
      expect(popped).toBeUndefined()
    })
  })

  describe('clear history', () => {
    it('should clear operation history', async () => {
      for (let i = 0; i < 3; i++) {
        await manager.recordOperation({
          type: 'insert',
          triple: triple(`ex:s${i}`, 'ex:p', `v${i}`),
        })
      }

      await manager.clearHistory()
      
      const history = await manager.getHistory()
      expect(history).toHaveLength(0)
    })
  })
})
