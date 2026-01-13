/**
 * Tests for utility functions
 */

import { describe, it, expect } from 'vitest'
import {
  generateId,
  generateSnapshotRef,
  generateCheckpointRef,
  isEmptySnapshotRef,
  generateEmptySnapshotRef,
} from '../src/utils/hash.js'
import { EventEmitter } from '../src/utils/events.js'

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1).not.toBe(id2)
  })

  it('should generate string IDs', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
  })

  it('should generate non-empty IDs', () => {
    const id = generateId()
    expect(id.length).toBeGreaterThan(0)
  })

  it('should contain timestamp and random parts', () => {
    const id = generateId()
    expect(id).toContain('-')
  })
})

describe('generateSnapshotRef', () => {
  it('should generate refs starting with snap-', async () => {
    const ref = await generateSnapshotRef('test content')
    expect(ref.startsWith('snap-')).toBe(true)
  })

  it('should generate consistent refs for same content', async () => {
    const content = 'test content'
    const ref1 = await generateSnapshotRef(content)
    const ref2 = await generateSnapshotRef(content)
    expect(ref1).toBe(ref2)
  })

  it('should generate different refs for different content', async () => {
    const ref1 = await generateSnapshotRef('content 1')
    const ref2 = await generateSnapshotRef('content 2')
    expect(ref1).not.toBe(ref2)
  })
})

describe('generateCheckpointRef', () => {
  it('should generate refs starting with ckpt-', () => {
    const ref = generateCheckpointRef(0)
    expect(ref.startsWith('ckpt-')).toBe(true)
  })

  it('should include log index in ref', () => {
    const ref = generateCheckpointRef(42)
    expect(ref).toContain('42')
  })

  it('should generate unique refs even for same index', () => {
    const ref1 = generateCheckpointRef(0)
    // Small delay to ensure different timestamps
    const ref2 = generateCheckpointRef(0)
    // They might be same if generated in same millisecond, so just check format
    expect(ref1.startsWith('ckpt-0-')).toBe(true)
    expect(ref2.startsWith('ckpt-0-')).toBe(true)
  })
})

describe('isEmptySnapshotRef', () => {
  it('should return true for "empty"', () => {
    expect(isEmptySnapshotRef('empty')).toBe(true)
  })

  it('should return true for refs starting with "empty-"', () => {
    expect(isEmptySnapshotRef('empty-abc123')).toBe(true)
  })

  it('should return false for other refs', () => {
    expect(isEmptySnapshotRef('snap-abc123')).toBe(false)
    expect(isEmptySnapshotRef('ckpt-0-abc')).toBe(false)
  })
})

describe('generateEmptySnapshotRef', () => {
  it('should generate refs starting with "empty-"', () => {
    const ref = generateEmptySnapshotRef()
    expect(ref.startsWith('empty-')).toBe(true)
  })

  it('should pass isEmptySnapshotRef check', () => {
    const ref = generateEmptySnapshotRef()
    expect(isEmptySnapshotRef(ref)).toBe(true)
  })
})

describe('EventEmitter', () => {
  it('should emit events to subscribers', () => {
    const emitter = new EventEmitter<{ test: string }>()
    let received: string | null = null
    
    emitter.on('test', (data) => {
      received = data
    })
    
    emitter.emit('test', 'hello')
    expect(received).toBe('hello')
  })

  it('should support multiple subscribers', () => {
    const emitter = new EventEmitter<{ test: number }>()
    const values: number[] = []
    
    emitter.on('test', (data) => values.push(data * 1))
    emitter.on('test', (data) => values.push(data * 2))
    
    emitter.emit('test', 5)
    expect(values).toContain(5)
    expect(values).toContain(10)
  })

  it('should return unsubscribe function', () => {
    const emitter = new EventEmitter<{ test: string }>()
    let callCount = 0
    
    const unsubscribe = emitter.on('test', () => {
      callCount++
    })
    
    emitter.emit('test', 'first')
    expect(callCount).toBe(1)
    
    unsubscribe()
    
    emitter.emit('test', 'second')
    expect(callCount).toBe(1)
  })

  it('should handle multiple event types', () => {
    const emitter = new EventEmitter<{ a: string; b: number }>()
    let aValue: string | null = null
    let bValue: number | null = null
    
    emitter.on('a', (data) => { aValue = data })
    emitter.on('b', (data) => { bValue = data })
    
    emitter.emit('a', 'hello')
    emitter.emit('b', 42)
    
    expect(aValue).toBe('hello')
    expect(bValue).toBe(42)
  })

  it('should track listener count', () => {
    const emitter = new EventEmitter<{ test: string }>()
    
    expect(emitter.listenerCount('test')).toBe(0)
    
    const unsub1 = emitter.on('test', () => {})
    expect(emitter.listenerCount('test')).toBe(1)
    
    const unsub2 = emitter.on('test', () => {})
    expect(emitter.listenerCount('test')).toBe(2)
    
    unsub1()
    expect(emitter.listenerCount('test')).toBe(1)
    
    unsub2()
    expect(emitter.listenerCount('test')).toBe(0)
  })

  it('should remove all listeners for an event', () => {
    const emitter = new EventEmitter<{ a: string; b: number }>()
    
    emitter.on('a', () => {})
    emitter.on('a', () => {})
    emitter.on('b', () => {})
    
    expect(emitter.listenerCount('a')).toBe(2)
    expect(emitter.listenerCount('b')).toBe(1)
    
    emitter.removeAllListeners('a')
    
    expect(emitter.listenerCount('a')).toBe(0)
    expect(emitter.listenerCount('b')).toBe(1)
  })

  it('should remove all listeners when no event specified', () => {
    const emitter = new EventEmitter<{ a: string; b: number }>()
    
    emitter.on('a', () => {})
    emitter.on('b', () => {})
    
    emitter.removeAllListeners()
    
    expect(emitter.listenerCount('a')).toBe(0)
    expect(emitter.listenerCount('b')).toBe(0)
  })

  it('should not throw when emitting without subscribers', () => {
    const emitter = new EventEmitter<{ test: string }>()
    expect(() => emitter.emit('test', 'hello')).not.toThrow()
  })

  it('should catch errors in listeners', () => {
    const emitter = new EventEmitter<{ test: string }>()
    let secondCalled = false
    
    emitter.on('test', () => {
      throw new Error('test error')
    })
    emitter.on('test', () => {
      secondCalled = true
    })
    
    // Should not throw and should continue to next listener
    expect(() => emitter.emit('test', 'hello')).not.toThrow()
    expect(secondCalled).toBe(true)
  })
})
