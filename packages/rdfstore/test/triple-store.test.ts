import { describe, it, expect, vi } from 'vitest'
import { createTripleStore, MemoryBackend } from '../src/index'
import type { Triple, ChangeEvent } from '../src/types'

// ── Basic CRUD ──

describe('TripleStore CRUD', () => {
  it('starts empty', () => {
    const store = createTripleStore()
    expect(store.getAll()).toEqual([])
  })

  it('insert and get', () => {
    const store = createTripleStore()
    store.insert('alice', 'name', 'Alice')
    expect(store.get('alice', 'name')).toBe('Alice')
  })

  it('insert number value', () => {
    const store = createTripleStore()
    store.insert('alice', 'age', 30)
    expect(store.get('alice', 'age')).toBe(30)
  })

  it('insert boolean value', () => {
    const store = createTripleStore()
    store.insert('alice', 'active', true)
    expect(store.get('alice', 'active')).toBe(true)
  })

  it('insert object value', () => {
    const store = createTripleStore()
    const data = { x: 1, y: 'hello' }
    store.insert('alice', 'data', data)
    expect(store.get('alice', 'data')).toEqual(data)
  })

  it('insert array value', () => {
    const store = createTripleStore()
    const arr = [1, 2, 3]
    store.insert('alice', 'scores', arr)
    expect(store.get('alice', 'scores')).toEqual(arr)
  })

  it('insert with graph', () => {
    const store = createTripleStore()
    store.insert('alice', 'name', 'Alice', 'graph1')
    expect(store.get('alice', 'name', 'graph1')).toBe('Alice')
    // Without graph filter, should still return the value
    expect(store.get('alice', 'name')).toBe('Alice')
  })

  it('duplicate insert is idempotent', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.insert('a', 'b', 'c')
    expect(store.getAll()).toHaveLength(1)
  })

  it('delete by (s, p, o)', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    store.insert('a', 'age', 30)
    store.delete('a', 'name', 'Alice')
    expect(store.get('a', 'name')).toBeUndefined()
    expect(store.get('a', 'age')).toBe(30)
  })

  it('delete by (s, p) removes all objects', () => {
    const store = createTripleStore()
    store.insert('a', 'tag', 'x')
    store.insert('a', 'tag', 'y')
    store.insert('a', 'tag', 'z')
    store.delete('a', 'tag')
    expect(store.match({ subject: 'a', predicate: 'tag' })).toEqual([])
  })

  it('delete non-existent is no-op', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.delete('x', 'y', 'z')
    expect(store.getAll()).toHaveLength(1)
  })

  it('clear removes everything', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.insert('d', 'e', 'f')
    store.clear()
    expect(store.getAll()).toEqual([])
  })

  it('getAll returns all triples', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    store.insert('b', 'name', 'Bob')
    const all = store.getAll()
    expect(all).toHaveLength(2)
    expect(all.map(t => t.subject).sort()).toEqual(['a', 'b'])
  })
})

// ── Pattern matching ──

describe('TripleStore match', () => {
  function populate() {
    const store = createTripleStore()
    store.insert('alice', 'name', 'Alice')
    store.insert('alice', 'age', 30)
    store.insert('alice', 'knows', 'bob')
    store.insert('bob', 'name', 'Bob')
    store.insert('bob', 'age', 25)
    store.insert('bob', 'knows', 'alice')
    return store
  }

  it('match by subject', () => {
    const store = populate()
    const results = store.match({ subject: 'alice' })
    expect(results).toHaveLength(3)
    expect(results.every(t => t.subject === 'alice')).toBe(true)
  })

  it('match by subject + predicate', () => {
    const store = populate()
    const results = store.match({ subject: 'alice', predicate: 'name' })
    expect(results).toHaveLength(1)
    expect(results[0].object).toBe('Alice')
  })

  it('match by subject + predicate + object', () => {
    const store = populate()
    const results = store.match({ subject: 'alice', predicate: 'age', object: 30 })
    expect(results).toHaveLength(1)
  })

  it('match by predicate only', () => {
    const store = populate()
    const results = store.match({ predicate: 'name' })
    expect(results).toHaveLength(2)
  })

  it('match by predicate + object', () => {
    const store = populate()
    const results = store.match({ predicate: 'knows', object: 'alice' })
    expect(results).toHaveLength(1)
    expect(results[0].subject).toBe('bob')
  })

  it('match by object only', () => {
    const store = populate()
    const results = store.match({ object: 'alice' })
    // bob knows alice
    expect(results).toHaveLength(1)
    expect(results[0].subject).toBe('bob')
  })

  it('match with empty pattern returns all', () => {
    const store = populate()
    const results = store.match({})
    expect(results).toHaveLength(6)
  })

  it('match by graph', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    store.insert('a', 'b', 'd', 'g2')
    store.insert('x', 'y', 'z', 'g1')

    const g1 = store.match({ graph: 'g1' })
    expect(g1).toHaveLength(2)
    expect(g1.every(t => t.graph === 'g1')).toBe(true)
  })
})

// ── Batch operations ──

describe('TripleStore batch', () => {
  it('batchInsert adds multiple triples', () => {
    const store = createTripleStore()
    store.batchInsert([
      { subject: 'a', predicate: 'p', object: 1 },
      { subject: 'b', predicate: 'q', object: 2 },
      { subject: 'c', predicate: 'r', object: 3 },
    ])
    expect(store.getAll()).toHaveLength(3)
  })

  it('batch function groups operations', () => {
    const store = createTripleStore()
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.batch(s => {
      s.insert('a', 'b', 'c')
      s.insert('d', 'e', 'f')
    })

    // Should emit one change event with both changes
    expect(changes).toHaveLength(1)
    expect(changes[0]).toHaveLength(2)
  })
})

// ── Events ──

describe('TripleStore events', () => {
  it('emits change on insert', () => {
    const store = createTripleStore()
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.insert('a', 'b', 'c')
    expect(changes).toHaveLength(1)
    expect(changes[0][0].type).toBe('insert')
    expect(changes[0][0].triple.subject).toBe('a')
  })

  it('emits change on delete', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.delete('a', 'b', 'c')
    expect(changes).toHaveLength(1)
    expect(changes[0][0].type).toBe('delete')
  })

  it('does not emit when insert is duplicate', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.insert('a', 'b', 'c')
    expect(changes).toHaveLength(0)
  })

  it('unsubscribe stops events', () => {
    const store = createTripleStore()
    const changes: ChangeEvent[][] = []
    const unsub = store.on('change', c => changes.push(c))

    store.insert('a', 'b', 'c')
    unsub()
    store.insert('d', 'e', 'f')
    expect(changes).toHaveLength(1)
  })
})

// ── Version Control (checkpoint / checkout) ──

describe('TripleStore version control', () => {
  it('checkpoint saves current state', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const cp = store.checkpoint({ title: 'Save 1' })
    expect(cp.title).toBe('Save 1')
    expect(cp.tripleCount).toBe(1)
  })

  it('checkout restores a checkpoint', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const cp = store.checkpoint({ title: 'Before change' })
    store.insert('d', 'e', 'f')
    expect(store.getAll()).toHaveLength(2)

    store.checkout(cp.id)
    expect(store.getAll()).toHaveLength(1)
    expect(store.get('a', 'b')).toBe('c')
    expect(store.get('d', 'e')).toBeUndefined()
  })

  it('checkout with invalid id throws', () => {
    const store = createTripleStore()
    expect(() => store.checkout('nonexistent')).toThrow()
  })

  it('listCheckpoints returns sorted by timestamp', () => {
    const store = createTripleStore()
    store.checkpoint({ title: 'First' })
    store.checkpoint({ title: 'Second' })
    store.checkpoint({ title: 'Third' })
    const list = store.listCheckpoints()
    expect(list).toHaveLength(3)
    expect(list[0].title).toBe('First')
    expect(list[2].title).toBe('Third')
  })

  it('deleteCheckpoint removes a checkpoint', () => {
    const store = createTripleStore()
    const cp = store.checkpoint({ title: 'Delete me' })
    expect(store.listCheckpoints()).toHaveLength(1)
    store.deleteCheckpoint(cp.id)
    expect(store.listCheckpoints()).toHaveLength(0)
  })

  it('getCheckpoint returns metadata', () => {
    const store = createTripleStore()
    const cp = store.checkpoint({ title: 'Test', description: 'desc' })
    const found = store.getCheckpoint(cp.id)
    expect(found?.title).toBe('Test')
    expect(found?.description).toBe('desc')
  })

  it('checkpoint creation emits event', () => {
    const store = createTripleStore()
    const events: unknown[] = []
    store.on('checkpointCreated', e => events.push(e))
    store.checkpoint({ title: 'Event test' })
    expect(events).toHaveLength(1)
  })

  it('checkout emits event', () => {
    const store = createTripleStore()
    const cp = store.checkpoint({ title: 'Test' })
    const events: unknown[] = []
    store.on('checkpointLoaded', e => events.push(e))
    store.checkout(cp.id)
    expect(events).toHaveLength(1)
  })

  it('multiple checkpoints maintain independent state', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const cp1 = store.checkpoint({ title: 'cp1' })

    store.insert('d', 'e', 'f')
    const cp2 = store.checkpoint({ title: 'cp2' })

    store.insert('g', 'h', 'i')

    // Current: 3 triples
    expect(store.getAll()).toHaveLength(3)

    // Checkout cp1: 1 triple
    store.checkout(cp1.id)
    expect(store.getAll()).toHaveLength(1)

    // Checkout cp2: 2 triples
    store.checkout(cp2.id)
    expect(store.getAll()).toHaveLength(2)
  })
})

// ── Live Query ──

describe('TripleStore LiveQuery', () => {
  it('liveMatch returns initial value', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const lq = store.liveMatch({ subject: 'a' })
    expect(lq.value).toHaveLength(1)
    expect(lq.value[0].object).toBe('Alice')
    lq.dispose()
  })

  it('liveMatch updates on insert', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ subject: 'a' })
    expect(lq.value).toHaveLength(0)

    store.insert('a', 'name', 'Alice')
    expect(lq.value).toHaveLength(1)
    lq.dispose()
  })

  it('liveMatch updates on delete', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const lq = store.liveMatch({ subject: 'a' })
    expect(lq.value).toHaveLength(1)

    store.delete('a', 'name', 'Alice')
    expect(lq.value).toHaveLength(0)
    lq.dispose()
  })

  it('liveMatch notifies subscribers', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ predicate: 'name' })
    const values: Triple[][] = []
    lq.subscribe(v => values.push(v))

    store.insert('a', 'name', 'Alice')
    store.insert('b', 'name', 'Bob')

    expect(values).toHaveLength(2)
    expect(values[0]).toHaveLength(1)
    expect(values[1]).toHaveLength(2)
    lq.dispose()
  })

  it('liveMatch does not fire for unrelated changes', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ subject: 'a' })
    const callback = vi.fn()
    lq.subscribe(callback)

    store.insert('b', 'name', 'Bob')
    expect(callback).not.toHaveBeenCalled()
    lq.dispose()
  })

  it('liveGet returns initial value', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const lq = store.liveGet('a', 'name')
    expect(lq.value).toBe('Alice')
    lq.dispose()
  })

  it('liveGet updates on change', () => {
    const store = createTripleStore()
    const lq = store.liveGet('a', 'name')
    expect(lq.value).toBeUndefined()

    store.insert('a', 'name', 'Alice')
    expect(lq.value).toBe('Alice')
    lq.dispose()
  })

  it('disposed LiveQuery stops receiving updates', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ subject: 'a' })
    const callback = vi.fn()
    lq.subscribe(callback)
    lq.dispose()

    store.insert('a', 'name', 'Alice')
    expect(callback).not.toHaveBeenCalled()
  })

  it('checkout recomputes all live queries', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const cp = store.checkpoint({ title: 'cp1' })

    const lq = store.liveMatch({ subject: 'a' })
    store.insert('a', 'age', 30)
    expect(lq.value).toHaveLength(2)

    store.checkout(cp.id)
    expect(lq.value).toHaveLength(1)
    lq.dispose()
  })
})

// ── Serialization ──

describe('TripleStore serialization', () => {
  it('exportState / importState roundtrip (v2 delta)', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    store.insert('b', 'name', 'Bob')
    store.checkpoint({ title: 'cp1' })
    store.insert('c', 'name', 'Charlie')

    const state = store.exportState()
    expect(state.version).toBe(2)
    expect(state.triples).toHaveLength(3)
    expect(state.checkpoints).toHaveLength(1)
    // Single checkpoint → keyframe (first is always keyframe)
    expect(state.checkpoints[0].type).toBe('keyframe')

    const store2 = createTripleStore()
    store2.importState(state)
    expect(store2.getAll()).toHaveLength(3)
    expect(store2.listCheckpoints()).toHaveLength(1)

    // Checkout restored checkpoint
    store2.checkout(state.checkpoints[0].info.id)
    expect(store2.getAll()).toHaveLength(2) // a + b
  })

  it('exportState includes checkpoint data (keyframe)', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.checkpoint({ title: 'snap' })
    store.clear()
    store.insert('d', 'e', 'f')

    const state = store.exportState()
    expect(state.triples).toHaveLength(1) // current: d,e,f
    const cp0 = state.checkpoints[0]
    expect(cp0.type).toBe('keyframe')
    if (cp0.type === 'keyframe') {
      expect(cp0.triples).toHaveLength(1) // snapshot: a,b,c
    }
  })

  it('delta encoding reduces export size', () => {
    const store = createTripleStore()
    // Insert 100 triples
    for (let i = 0; i < 100; i++) {
      store.insert(`entity:${i}`, 'value', `data_${i}`)
    }
    // Create 10 checkpoints, each changing 1 triple
    for (let cp = 0; cp < 10; cp++) {
      store.insert(`entity:${cp}`, 'tag', `v${cp}`)
      store.checkpoint({ title: `cp-${cp}` })
    }

    const state = store.exportState()
    expect(state.version).toBe(2)
    // First checkpoint is keyframe, rest are deltas
    expect(state.checkpoints[0].type).toBe('keyframe')
    for (let i = 1; i < 10; i++) {
      expect(state.checkpoints[i].type).toBe('delta')
    }

    // Roundtrip
    const store2 = createTripleStore()
    store2.importState(state)
    expect(store2.getAll()).toHaveLength(store.getAll().length)
    expect(store2.listCheckpoints()).toHaveLength(10)

    // Verify each checkpoint can be checked out correctly
    for (const cp of store2.listCheckpoints()) {
      store2.checkout(cp.id)
      expect(store2.getAll().length).toBeGreaterThanOrEqual(100)
    }
  })

  it('keyframe interval controls encoding', () => {
    const store = createTripleStore()
    store.insert('x', 'y', 'z')
    for (let i = 0; i < 5; i++) {
      store.insert('x', `p${i}`, i)
      store.checkpoint({ title: `cp-${i}` })
    }

    // Interval 2: keyframes at index 0, 2, 4; deltas at 1, 3
    const state = store.exportState({ keyframeInterval: 2 })
    expect(state.checkpoints[0].type).toBe('keyframe')
    expect(state.checkpoints[1].type).toBe('delta')
    expect(state.checkpoints[2].type).toBe('keyframe')
    expect(state.checkpoints[3].type).toBe('delta')
    expect(state.checkpoints[4].type).toBe('keyframe')

    // Interval 1: all keyframes
    const stateAll = store.exportState({ keyframeInterval: 1 })
    for (const cp of stateAll.checkpoints) {
      expect(cp.type).toBe('keyframe')
    }
  })
})

// ── exportCheckpoints ──

describe('TripleStore exportCheckpoints', () => {
  it('exports all checkpoints as keyframes in full mode', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const cp1 = store.checkpoint({ title: 'cp1' })
    store.insert('b', 'name', 'Bob')
    const cp2 = store.checkpoint({ title: 'cp2' })
    store.insert('c', 'name', 'Carol')
    const cp3 = store.checkpoint({ title: 'cp3' })

    const entries = store.exportCheckpoints([cp1.id, cp2.id, cp3.id], { mode: 'full' })
    expect(entries).toHaveLength(3)
    expect(entries[0].type).toBe('keyframe')
    expect(entries[1].type).toBe('keyframe')
    expect(entries[2].type).toBe('keyframe')

    // Verify data
    expect((entries[0] as { triples: unknown[] }).triples).toHaveLength(1)
    expect((entries[1] as { triples: unknown[] }).triples).toHaveLength(2)
    expect((entries[2] as { triples: unknown[] }).triples).toHaveLength(3)
  })

  it('defaults to full mode', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const cp1 = store.checkpoint({ title: 'cp1' })
    store.insert('b', 'name', 'Bob')
    const cp2 = store.checkpoint({ title: 'cp2' })

    const entries = store.exportCheckpoints([cp1.id, cp2.id])
    expect(entries[0].type).toBe('keyframe')
    expect(entries[1].type).toBe('keyframe')
  })

  it('exports first as keyframe, rest as deltas in delta mode', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const cp1 = store.checkpoint({ title: 'cp1' })
    store.insert('b', 'name', 'Bob')
    const cp2 = store.checkpoint({ title: 'cp2' })
    store.insert('c', 'name', 'Carol')
    const cp3 = store.checkpoint({ title: 'cp3' })

    const entries = store.exportCheckpoints([cp1.id, cp2.id, cp3.id], { mode: 'delta' })
    expect(entries).toHaveLength(3)

    // First is keyframe
    expect(entries[0].type).toBe('keyframe')
    expect(entries[0].info.id).toBe(cp1.id)
    expect((entries[0] as { triples: unknown[] }).triples).toHaveLength(1)

    // Rest are deltas chained from the previous entry
    expect(entries[1].type).toBe('delta')
    expect((entries[1] as { type: 'delta'; parentId: string }).parentId).toBe(cp1.id)
    expect(entries[2].type).toBe('delta')
    expect((entries[2] as { type: 'delta'; parentId: string }).parentId).toBe(cp2.id)
  })

  it('delta entries can reconstruct the checkpoint data', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const cp1 = store.checkpoint({ title: 'cp1' })
    store.insert('b', 'name', 'Bob')
    const cp2 = store.checkpoint({ title: 'cp2' })
    store.delete('a', 'name', 'Alice')
    store.insert('c', 'name', 'Carol')
    const cp3 = store.checkpoint({ title: 'cp3' })

    const entries = store.exportCheckpoints([cp1.id, cp2.id, cp3.id], { mode: 'delta' })

    // Reconstruct via import roundtrip
    const store2 = createTripleStore()
    store2.importState({
      version: 2,
      triples: [],
      checkpoints: entries,
      keyframeInterval: 50,
    })

    const cps = store2.listCheckpoints()
    expect(cps).toHaveLength(3)

    store2.checkout(cp3.id)
    const all = store2.getAll()
    expect(all).toHaveLength(2)
    expect(all.find(t => t.object === 'Bob')).toBeTruthy()
    expect(all.find(t => t.object === 'Carol')).toBeTruthy()
  })

  it('exports a subset of checkpoints', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    const cp1 = store.checkpoint({ title: 'cp1' })
    store.insert('b', 'name', 'Bob')
    store.checkpoint({ title: 'cp2' })
    store.insert('c', 'name', 'Carol')
    const cp3 = store.checkpoint({ title: 'cp3' })

    // Export only cp1 and cp3 (skip cp2)
    const entries = store.exportCheckpoints([cp1.id, cp3.id], { mode: 'delta' })
    expect(entries).toHaveLength(2)
    expect(entries[0].type).toBe('keyframe')
    expect(entries[1].type).toBe('delta')
    expect((entries[1] as { type: 'delta'; parentId: string }).parentId).toBe(cp1.id)
  })

  it('throws for unknown checkpoint id', () => {
    const store = createTripleStore()
    expect(() => store.exportCheckpoints(['nonexistent'])).toThrow('Checkpoint not found: nonexistent')
  })

  it('returns empty array for empty ids', () => {
    const store = createTripleStore()
    expect(store.exportCheckpoints([])).toEqual([])
  })
})

// ── Persistence ──

describe('TripleStore persistence', () => {
  it('persist and restore roundtrip with MemoryBackend', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'name', 'Alice')
    store.insert('b', 'name', 'Bob')

    await store.persist()

    const store2 = createTripleStore({ backend })
    await store2.restore('current')
    expect(store2.getAll()).toHaveLength(2)
    expect(store2.get('a', 'name')).toBe('Alice')
  })

  it('persistAll saves checkpoints', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'b', 'c')
    store.checkpoint({ title: 'cp1' })
    store.insert('d', 'e', 'f')

    await store.persistAll()

    const store2 = createTripleStore({ backend })
    await store2.restoreLatest()
    expect(store2.getAll()).toHaveLength(2)
    expect(store2.listCheckpoints()).toHaveLength(1)
  })

  it('concurrent persist calls are serialized', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'name', 'Alice')
    store.insert('b', 'name', 'Bob')

    // Fire multiple persist calls concurrently
    await Promise.all([
      store.persist(),
      store.persist(),
      store.persist(),
    ])

    // Should not throw and data should be intact
    const store2 = createTripleStore({ backend })
    await store2.restore('current')
    expect(store2.getAll()).toHaveLength(2)
  })

  it('concurrent persistAll and restore are serialized', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'name', 'Alice')
    store.checkpoint({ title: 'cp1' })
    store.insert('b', 'name', 'Bob')

    await store.persistAll()

    // Fire restore and persistAll concurrently — should not corrupt state
    const store2 = createTripleStore({ backend })
    await Promise.all([
      store2.restoreLatest(),
      store2.restoreLatest(),
    ])

    expect(store2.getAll()).toHaveLength(2)
    expect(store2.listCheckpoints()).toHaveLength(1)
  })
})

// ── Lifecycle ──

describe('TripleStore lifecycle', () => {
  it('close makes store unusable', () => {
    const store = createTripleStore()
    store.close()
    expect(store.isOpen).toBe(false)
    expect(() => store.insert('a', 'b', 'c')).toThrow('TripleStore is closed')
  })
})

// ── pendingDelta safety ──

describe('TripleStore pendingDelta safety', () => {
  it('checkout resets pendingDelta so next checkpoint has clean delta', () => {
    const store = createTripleStore()

    // Build initial state with checkpoint
    store.insert('a', 'name', 'Alice')
    const cp1 = store.checkpoint({ title: 'cp1' })

    // Make changes that accumulate into pendingDelta
    store.insert('b', 'name', 'Bob')
    store.insert('c', 'name', 'Carol')

    // Checkout discards those pending changes
    store.checkout(cp1.id)

    // Now make a fresh change and checkpoint
    store.insert('d', 'name', 'Dave')
    const cp2 = store.checkpoint({ title: 'cp2' })

    // Export and verify the delta only contains the post-checkout change
    const entries = store.exportCheckpoints([cp1.id, cp2.id], { mode: 'delta' })
    expect(entries[1].type).toBe('delta')
    const delta = (entries[1] as { type: 'delta'; delta: { inserts: unknown[]; deletes: unknown[] } }).delta
    // Should only have Dave insert, not Bob/Carol
    expect(delta.inserts).toHaveLength(1)
    expect(delta.deletes).toHaveLength(0)
  })
})
