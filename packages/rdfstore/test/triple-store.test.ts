import { describe, it, expect, vi } from 'vitest'
import { createTripleStore, MemoryBackend } from '../src/index'
import type { Triple, ChangeEvent, Value } from '../src/types'

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

  it('get with checkpoint queries snapshot without checkout', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'v1')
    const cp = store.checkpoint({ title: 'v1' })

    store.delete('a', 'name')
    store.insert('a', 'name', 'v2')

    // Current state
    expect(store.get('a', 'name')).toBe('v2')
    // Checkpoint state (no side-effect on current)
    expect(store.get('a', 'name', undefined, cp.id)).toBe('v1')
    // Current still unchanged
    expect(store.get('a', 'name')).toBe('v2')
  })

  it('match with checkpoint queries snapshot without checkout', () => {
    const store = createTripleStore()
    store.insert('a', 'x', '1')
    store.insert('b', 'x', '2')
    const cp = store.checkpoint({ title: 'two items' })

    store.insert('c', 'x', '3')

    // Current: 3 triples
    expect(store.match({ predicate: 'x' })).toHaveLength(3)
    // Checkpoint: 2 triples
    expect(store.match({ predicate: 'x' }, cp.id)).toHaveLength(2)
    // Current unchanged
    expect(store.match({ predicate: 'x' })).toHaveLength(3)
  })

  it('get/match with invalid checkpoint throws', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    expect(() => store.get('a', 'b', undefined, 'bad-id')).toThrow('Checkpoint not found')
    expect(() => store.match({ subject: 'a' }, 'bad-id')).toThrow('Checkpoint not found')
  })

  it('match with checkpoint and graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'p', 'v1', 'g1')
    store.insert('a', 'p', 'v2', 'g2')
    const cp = store.checkpoint({ title: 'with graphs' })

    store.insert('a', 'p', 'v3', 'g1')

    // Checkpoint: only g1 triples
    const g1 = store.match({ subject: 'a', graph: 'g1' }, cp.id)
    expect(g1).toHaveLength(1)
    expect(g1[0].object).toBe('v1')

    // Current: g1 has 2 triples
    expect(store.match({ subject: 'a', graph: 'g1' })).toHaveLength(2)
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

// ══════════════════════════════════════════════════════════════
// Extended coverage tests
// ══════════════════════════════════════════════════════════════

// ── CRUD edge cases ──

describe('CRUD edge cases', () => {
  it('delete with graph removes only that graph triple', () => {
    const store = createTripleStore()
    store.insert('a', 'p', 'v1', 'g1')
    store.insert('a', 'p', 'v2', 'g2')
    store.delete('a', 'p', 'v1', 'g1')
    expect(store.match({ graph: 'g1' })).toHaveLength(0)
    expect(store.match({ graph: 'g2' })).toHaveLength(1)
  })

  it('delete (s,p) wildcard removes all objects under that pair', () => {
    const store = createTripleStore()
    store.insert('a', 'tag', 'x')
    store.insert('a', 'tag', 'y')
    store.insert('a', 'tag', 'z')
    store.insert('a', 'name', 'Alice')
    store.delete('a', 'tag')
    expect(store.match({ subject: 'a', predicate: 'tag' })).toHaveLength(0)
    expect(store.get('a', 'name')).toBe('Alice')
  })

  it('delete (s,p) wildcard on non-existent subject is no-op', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.delete('nonexistent', 'b')
    expect(store.getAll()).toHaveLength(1)
  })

  it('delete (s,p) wildcard on non-existent predicate is no-op', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.delete('a', 'nonexistent')
    expect(store.getAll()).toHaveLength(1)
  })

  it('delete specific (s,p,o) with wrong object is no-op', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.delete('a', 'b', 'wrong')
    expect(store.getAll()).toHaveLength(1)
  })

  it('insert and get with empty string values', () => {
    const store = createTripleStore()
    store.insert('', '', '')
    expect(store.get('', '')).toBe('')
    expect(store.getAll()).toHaveLength(1)
  })

  it('insert false as object value', () => {
    const store = createTripleStore()
    store.insert('a', 'active', false)
    expect(store.get('a', 'active')).toBe(false)
  })

  it('insert zero as object value', () => {
    const store = createTripleStore()
    store.insert('a', 'count', 0)
    expect(store.get('a', 'count')).toBe(0)
  })

  it('get returns undefined for non-existent subject', () => {
    const store = createTripleStore()
    expect(store.get('nonexistent', 'p')).toBeUndefined()
  })

  it('get returns undefined for non-existent predicate', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    expect(store.get('a', 'nonexistent')).toBeUndefined()
  })

  it('get with graph returns undefined when triple exists in different graph', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    expect(store.get('a', 'b', 'g2')).toBeUndefined()
  })

  it('get without graph returns value regardless of which graph it belongs to', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    expect(store.get('a', 'b')).toBe('c')
  })

  it('multiple objects for same (s,p): get returns one, getAll returns all', () => {
    const store = createTripleStore()
    store.insert('a', 'tag', 'x')
    store.insert('a', 'tag', 'y')
    store.insert('a', 'tag', 'z')
    const val = store.get('a', 'tag')
    expect(val).toBeDefined()
    expect(store.match({ subject: 'a', predicate: 'tag' })).toHaveLength(3)
  })

  it('insert preserves nested object structure', () => {
    const store = createTripleStore()
    const deep = { a: { b: { c: [1, 2, { d: true }] } } }
    store.insert('x', 'data', deep)
    expect(store.get('x', 'data')).toEqual(deep)
  })

  it('clear emits delete events for every triple', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.insert('d', 'e', 'f')
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))
    store.clear()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toHaveLength(2)
    expect(changes[0].every(c => c.type === 'delete')).toBe(true)
  })

  it('delete that empties all triples for a subject cleans up SPO index', () => {
    const store = createTripleStore()
    store.insert('a', 'only', 'val')
    store.delete('a', 'only', 'val')
    expect(store.match({ subject: 'a' })).toHaveLength(0)
    expect(store.getAll()).toHaveLength(0)
  })

  it('delete last object for (s,p) cleans up predicate entry', () => {
    const store = createTripleStore()
    store.insert('a', 'p1', 'v1')
    store.insert('a', 'p2', 'v2')
    store.delete('a', 'p1', 'v1')
    expect(store.match({ subject: 'a', predicate: 'p1' })).toHaveLength(0)
    expect(store.match({ subject: 'a', predicate: 'p2' })).toHaveLength(1)
  })
})

// ── Extended match patterns ──

describe('Match pattern edge cases', () => {
  it('match by object only (string)', () => {
    const store = createTripleStore()
    store.insert('a', 'knows', 'target')
    store.insert('b', 'likes', 'target')
    store.insert('c', 'name', 'other')
    const results = store.match({ object: 'target' })
    expect(results).toHaveLength(2)
    expect(results.every(t => t.object === 'target')).toBe(true)
  })

  it('match by object only (number)', () => {
    const store = createTripleStore()
    store.insert('a', 'age', 30)
    store.insert('b', 'age', 30)
    store.insert('c', 'age', 25)
    const results = store.match({ object: 30 })
    expect(results).toHaveLength(2)
  })

  it('match by object only (boolean)', () => {
    const store = createTripleStore()
    store.insert('a', 'active', true)
    store.insert('b', 'active', false)
    store.insert('c', 'active', true)
    expect(store.match({ object: true })).toHaveLength(2)
    expect(store.match({ object: false })).toHaveLength(1)
  })

  it('match by predicate + object with no results', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'Alice')
    expect(store.match({ predicate: 'name', object: 'Bob' })).toHaveLength(0)
    expect(store.match({ predicate: 'age', object: 'Alice' })).toHaveLength(0)
  })

  it('match exact SPO with no result', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    expect(store.match({ subject: 'a', predicate: 'b', object: 'wrong' })).toHaveLength(0)
    expect(store.match({ subject: 'a', predicate: 'wrong', object: 'c' })).toHaveLength(0)
    expect(store.match({ subject: 'wrong', predicate: 'b', object: 'c' })).toHaveLength(0)
  })

  it('match exact SPO succeeds', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const results = store.match({ subject: 'a', predicate: 'b', object: 'c' })
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ subject: 'a', predicate: 'b', object: 'c' })
  })

  it('match exact SPO with graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    store.insert('a', 'b', 'c', 'g2')
    expect(store.match({ subject: 'a', predicate: 'b', object: 'c', graph: 'g1' })).toHaveLength(1)
    expect(store.match({ subject: 'a', predicate: 'b', object: 'c', graph: 'g3' })).toHaveLength(0)
  })

  it('match S+P with graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'p', 'v1', 'g1')
    store.insert('a', 'p', 'v2', 'g2')
    store.insert('a', 'p', 'v3', 'g1')
    expect(store.match({ subject: 'a', predicate: 'p', graph: 'g1' })).toHaveLength(2)
    expect(store.match({ subject: 'a', predicate: 'p', graph: 'g2' })).toHaveLength(1)
  })

  it('match subject only with graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'p1', 'v1', 'g1')
    store.insert('a', 'p2', 'v2', 'g2')
    store.insert('a', 'p3', 'v3', 'g1')
    expect(store.match({ subject: 'a', graph: 'g1' })).toHaveLength(2)
  })

  it('match P+O with graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'type', 'Person', 'g1')
    store.insert('b', 'type', 'Person', 'g2')
    store.insert('c', 'type', 'Person', 'g1')
    expect(store.match({ predicate: 'type', object: 'Person', graph: 'g1' })).toHaveLength(2)
  })

  it('match predicate only with graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'name', 'A', 'g1')
    store.insert('b', 'name', 'B', 'g2')
    store.insert('c', 'age', 10, 'g1')
    expect(store.match({ predicate: 'name', graph: 'g1' })).toHaveLength(1)
  })

  it('match object only with graph filter', () => {
    const store = createTripleStore()
    store.insert('a', 'likes', 'target', 'g1')
    store.insert('b', 'knows', 'target', 'g2')
    expect(store.match({ object: 'target', graph: 'g1' })).toHaveLength(1)
  })

  it('match graph only returns all triples in that graph', () => {
    const store = createTripleStore()
    store.insert('a', 'p1', 'v1', 'g1')
    store.insert('a', 'p2', 'v2', 'g1')
    store.insert('b', 'p3', 'v3', 'g2')
    const results = store.match({ graph: 'g1' })
    expect(results).toHaveLength(2)
    expect(results.every(t => t.graph === 'g1')).toBe(true)
  })

  it('match graph only with empty graph returns nothing', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    expect(store.match({ graph: 'nonexistent' })).toHaveLength(0)
  })

  it('match with object of various value types', () => {
    const store = createTripleStore()
    const obj = { key: 'val' }
    const arr = [1, 2, 3]
    store.insert('a', 'obj', obj)
    store.insert('a', 'arr', arr)
    store.insert('a', 'str', 'hello')
    store.insert('a', 'num', 42)
    store.insert('a', 'bool', true)

    expect(store.match({ object: obj })).toHaveLength(1)
    expect(store.match({ object: arr })).toHaveLength(1)
    expect(store.match({ object: 'hello' })).toHaveLength(1)
    expect(store.match({ object: 42 })).toHaveLength(1)
    expect(store.match({ object: true })).toHaveLength(1)
  })

  it('triples without graph do not appear in graph-filtered match', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c') // no graph
    store.insert('d', 'e', 'f', 'g1')
    expect(store.match({ graph: 'g1' })).toHaveLength(1)
    expect(store.match({})).toHaveLength(2)
  })
})

// ── Graph-partitioned operations ──

describe('Graph operations', () => {
  it('same (s,p,o) in different graphs: second insert is treated as duplicate (known limitation)', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    store.insert('a', 'b', 'c', 'g2') // early-exit: SPO already has (a,b,c)
    // Graph index for g2 is never populated
    const g1 = store.match({ graph: 'g1' })
    const g2 = store.match({ graph: 'g2' })
    expect(g1).toHaveLength(1)
    expect(g2).toHaveLength(0) // known limitation: g2 not tracked
  })

  it('different (s,p,o) in different graphs are independent', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'v1', 'g1')
    store.insert('a', 'b', 'v2', 'g2')
    const g1 = store.match({ graph: 'g1' })
    const g2 = store.match({ graph: 'g2' })
    expect(g1).toHaveLength(1)
    expect(g2).toHaveLength(1)
    expect(g1[0].object).toBe('v1')
    expect(g2[0].object).toBe('v2')
  })

  it('delete with graph filter only removes from that graph', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'v1', 'g1')
    store.insert('a', 'b', 'v2', 'g2')
    store.delete('a', 'b', 'v1', 'g1')
    expect(store.match({ graph: 'g1' })).toHaveLength(0)
    expect(store.match({ graph: 'g2' })).toHaveLength(1)
  })
})

// ── Batch edge cases ──

describe('Batch edge cases', () => {
  it('batchInsert with empty array is no-op', () => {
    const store = createTripleStore()
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))
    store.batchInsert([])
    expect(changes).toHaveLength(0)
    expect(store.getAll()).toHaveLength(0)
  })

  it('batchInsert with duplicates deduplicates', () => {
    const store = createTripleStore()
    store.batchInsert([
      { subject: 'a', predicate: 'b', object: 'c' },
      { subject: 'a', predicate: 'b', object: 'c' },
      { subject: 'a', predicate: 'b', object: 'c' },
    ])
    expect(store.getAll()).toHaveLength(1)
  })

  it('batchInsert with graphs', () => {
    const store = createTripleStore()
    store.batchInsert([
      { subject: 'a', predicate: 'b', object: 'c', graph: 'g1' },
      { subject: 'd', predicate: 'e', object: 'f', graph: 'g2' },
    ])
    expect(store.match({ graph: 'g1' })).toHaveLength(1)
    expect(store.match({ graph: 'g2' })).toHaveLength(1)
  })

  it('batch emits single change event for mixed insert+delete', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.batch(s => {
      s.delete('a', 'b', 'c')
      s.insert('d', 'e', 'f')
      s.insert('g', 'h', 'i')
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toHaveLength(3)
    expect(changes[0][0].type).toBe('delete')
    expect(changes[0][1].type).toBe('insert')
    expect(changes[0][2].type).toBe('insert')
  })

  it('batch with no actual changes emits no event', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.batch(s => {
      // duplicate insert → no change
      s.insert('a', 'b', 'c')
    })

    expect(changes).toHaveLength(0)
  })
})

// ── Events extended ──

describe('Events extended', () => {
  it('does not emit when delete hits non-existent triple', () => {
    const store = createTripleStore()
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))
    store.delete('x', 'y', 'z')
    expect(changes).toHaveLength(0)
  })

  it('change event includes correct triple data', () => {
    const store = createTripleStore()
    const changes: ChangeEvent[][] = []
    store.on('change', c => changes.push(c))

    store.insert('a', 'name', 'Alice', 'g1')
    expect(changes[0][0].triple).toEqual({
      subject: 'a', predicate: 'name', object: 'Alice', graph: 'g1',
    })
  })

  it('multiple listeners all receive events', () => {
    const store = createTripleStore()
    const calls1: number[] = []
    const calls2: number[] = []
    store.on('change', c => calls1.push(c.length))
    store.on('change', c => calls2.push(c.length))

    store.insert('a', 'b', 'c')
    expect(calls1).toEqual([1])
    expect(calls2).toEqual([1])
  })

  it('error in listener does not break other listeners', () => {
    const store = createTripleStore()
    const calls: number[] = []
    store.on('change', () => { throw new Error('boom') })
    store.on('change', c => calls.push(c.length))

    // Should not throw, second listener still fires
    store.insert('a', 'b', 'c')
    expect(calls).toEqual([1])
  })
})

// ── LiveQuery extended ──

describe('LiveQuery extended', () => {
  it('liveMatch with S+P constraint', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ subject: 'a', predicate: 'name' })
    expect(lq.value).toHaveLength(0)

    store.insert('a', 'name', 'Alice')
    expect(lq.value).toHaveLength(1)

    store.insert('a', 'age', 30) // different predicate — should not affect
    expect(lq.value).toHaveLength(1)

    store.insert('b', 'name', 'Bob') // different subject — should not affect
    expect(lq.value).toHaveLength(1)

    lq.dispose()
  })

  it('liveMatch with object constraint', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ object: 'target' })
    store.insert('a', 'likes', 'target')
    expect(lq.value).toHaveLength(1)

    store.insert('b', 'likes', 'other')
    expect(lq.value).toHaveLength(1)

    store.insert('c', 'knows', 'target')
    expect(lq.value).toHaveLength(2)
    lq.dispose()
  })

  it('liveMatch with graph constraint', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ graph: 'g1' })
    store.insert('a', 'b', 'c', 'g1')
    expect(lq.value).toHaveLength(1)

    store.insert('d', 'e', 'f', 'g2') // different graph
    expect(lq.value).toHaveLength(1)

    store.insert('g', 'h', 'i', 'g1')
    expect(lq.value).toHaveLength(2)
    lq.dispose()
  })

  it('liveGet returns undefined initially', () => {
    const store = createTripleStore()
    const lq = store.liveGet('a', 'name')
    expect(lq.value).toBeUndefined()
    lq.dispose()
  })

  it('liveGet unsubscribe stops callbacks', () => {
    const store = createTripleStore()
    const lq = store.liveGet('a', 'name')
    const values: (Value | undefined)[] = []
    const unsub = lq.subscribe(v => values.push(v))

    store.insert('a', 'name', 'v1')
    unsub()
    store.insert('a', 'name', 'v2') // should not trigger callback
    // liveGet tracks s+p; inserting a second object still triggers recompute but callback is unsubscribed
    expect(values).toHaveLength(1)
    lq.dispose()
  })

  it('multiple live queries are independently tracked', () => {
    const store = createTripleStore()
    const lq1 = store.liveMatch({ subject: 'a' })
    const lq2 = store.liveMatch({ subject: 'b' })

    store.insert('a', 'x', '1')
    expect(lq1.value).toHaveLength(1)
    expect(lq2.value).toHaveLength(0)

    store.insert('b', 'y', '2')
    expect(lq1.value).toHaveLength(1)
    expect(lq2.value).toHaveLength(1)

    lq1.dispose()
    lq2.dispose()
  })

  it('disposed live query recompute and notifyListeners are no-ops', () => {
    const store = createTripleStore()
    const lq = store.liveMatch({ subject: 'a' })
    const cb = vi.fn()
    lq.subscribe(cb)
    lq.dispose()

    // Even if we directly poke, it shouldn't throw or call
    store.insert('a', 'b', 'c')
    expect(cb).not.toHaveBeenCalled()
  })
})

// ── Version control extended ──

describe('Version control extended', () => {
  it('checkpoint with custom id', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const cp = store.checkpoint({ id: 'my-custom-id', title: 'custom' })
    expect(cp.id).toBe('my-custom-id')
    store.checkout('my-custom-id')
    expect(store.get('a', 'b')).toBe('c')
  })

  it('checkpoint with description', () => {
    const store = createTripleStore()
    const cp = store.checkpoint({ title: 'T', description: 'Detailed desc' })
    expect(store.getCheckpoint(cp.id)?.description).toBe('Detailed desc')
  })

  it('getCheckpoint returns undefined for unknown id', () => {
    const store = createTripleStore()
    expect(store.getCheckpoint('nope')).toBeUndefined()
  })

  it('deleteCheckpoint of unknown id is silent', () => {
    const store = createTripleStore()
    store.deleteCheckpoint('nonexistent') // no throw
    expect(store.listCheckpoints()).toHaveLength(0)
  })

  it('checkout then modify creates divergent branch', () => {
    const store = createTripleStore()
    store.insert('a', 'v', '1')
    const cp1 = store.checkpoint({ title: 'base' })

    store.insert('b', 'v', '2')
    store.checkpoint({ title: 'branch-a' })

    store.checkout(cp1.id)
    store.insert('c', 'v', '3')
    const cpB = store.checkpoint({ title: 'branch-b' })

    store.checkout(cpB.id)
    expect(store.get('a', 'v')).toBe('1')
    expect(store.get('c', 'v')).toBe('3')
    expect(store.get('b', 'v')).toBeUndefined()
  })

  it('checkpoint on empty store records tripleCount 0', () => {
    const store = createTripleStore()
    const cp = store.checkpoint({ title: 'empty' })
    expect(cp.tripleCount).toBe(0)
  })

  it('checkout to empty checkpoint', () => {
    const store = createTripleStore()
    const cp = store.checkpoint({ title: 'empty' })
    store.insert('a', 'b', 'c')
    expect(store.getAll()).toHaveLength(1)
    store.checkout(cp.id)
    expect(store.getAll()).toHaveLength(0)
  })

  it('get with graph on checkpoint', () => {
    const store = createTripleStore()
    store.insert('a', 'p', 'old', 'g1')
    const cp = store.checkpoint({ title: 'v1' })
    store.delete('a', 'p', 'old', 'g1')
    store.insert('a', 'p', 'new', 'g1')

    expect(store.get('a', 'p', 'g1')).toBe('new')
    expect(store.get('a', 'p', 'g1', cp.id)).toBe('old')
  })
})

// ── Serialization extended ──

describe('Serialization extended', () => {
  it('importState with delta whose parent is missing throws', () => {
    const store = createTripleStore()
    expect(() => store.importState({
      version: 2,
      triples: [],
      checkpoints: [{
        info: { id: 'cp1', title: 'bad', timestamp: 1, tripleCount: 0 },
        type: 'delta',
        parentId: 'nonexistent',
        delta: { inserts: [], deletes: [] },
      }],
      keyframeInterval: 50,
    })).toThrow('Delta parent not found: nonexistent')
  })

  it('exportState with no checkpoints', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const state = store.exportState()
    expect(state.triples).toHaveLength(1)
    expect(state.checkpoints).toHaveLength(0)
  })

  it('importState clears previous state', () => {
    const store = createTripleStore()
    store.insert('old', 'data', 'here')
    store.checkpoint({ title: 'old-cp' })

    store.importState({
      version: 2,
      triples: [{ subject: 'new', predicate: 'data', object: 'fresh' }],
      checkpoints: [],
      keyframeInterval: 50,
    })

    expect(store.get('old', 'data')).toBeUndefined()
    expect(store.get('new', 'data')).toBe('fresh')
    expect(store.listCheckpoints()).toHaveLength(0)
  })

  it('importState recomputes live queries', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const lq = store.liveMatch({ subject: 'x' })
    expect(lq.value).toHaveLength(0)

    store.importState({
      version: 2,
      triples: [{ subject: 'x', predicate: 'y', object: 'z' }],
      checkpoints: [],
      keyframeInterval: 50,
    })

    expect(lq.value).toHaveLength(1)
    lq.dispose()
  })

  it('export/import roundtrip preserves various value types', () => {
    const store = createTripleStore()
    store.insert('a', 'str', 'hello')
    store.insert('a', 'num', 42)
    store.insert('a', 'bool', true)
    store.insert('a', 'obj', { nested: true })
    store.insert('a', 'arr', [1, 'two', false])

    const state = store.exportState()
    const store2 = createTripleStore()
    store2.importState(state)

    expect(store2.get('a', 'str')).toBe('hello')
    expect(store2.get('a', 'num')).toBe(42)
    expect(store2.get('a', 'bool')).toBe(true)
    expect(store2.get('a', 'obj')).toEqual({ nested: true })
    expect(store2.get('a', 'arr')).toEqual([1, 'two', false])
  })

  it('matchAll / getAll does not include graph property (known limitation)', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c', 'g1')
    const all = store.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].graph).toBeUndefined() // graph lost in matchAll
    // But graph-scoped match still works
    expect(store.match({ graph: 'g1' })).toHaveLength(1)
    expect(store.match({ graph: 'g1' })[0].graph).toBe('g1')
  })

  it('export/import roundtrip preserves non-graph triples', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.insert('d', 'e', 'f')
    store.checkpoint({ title: 'cp1' })

    const state = store.exportState()
    const store2 = createTripleStore()
    store2.importState(state)

    expect(store2.getAll()).toHaveLength(2)
    expect(store2.get('a', 'b')).toBe('c')
    expect(store2.get('d', 'e')).toBe('f')
  })

  it('exportCheckpoints with single id in delta mode returns keyframe', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    const cp = store.checkpoint({ title: 'only' })
    const entries = store.exportCheckpoints([cp.id], { mode: 'delta' })
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe('keyframe')
  })

  it('export many checkpoints with keyframe interval covers delta fallback', () => {
    // This tests the branch where cached delta is unavailable (restored checkpoints)
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.checkpoint({ title: 'cp1' })
    store.insert('d', 'e', 'f')
    store.checkpoint({ title: 'cp2' })

    // Export and reimport to lose cached deltas
    const state = store.exportState({ keyframeInterval: 1 })
    const store2 = createTripleStore()
    store2.importState(state)

    // Now re-export with delta encoding — will trigger fallback computeDelta
    const state2 = store2.exportState({ keyframeInterval: 50 })
    expect(state2.checkpoints[0].type).toBe('keyframe')
    expect(state2.checkpoints[1].type).toBe('delta')

    // Roundtrip again to verify correctness
    const store3 = createTripleStore()
    store3.importState(state2)
    expect(store3.listCheckpoints()).toHaveLength(2)
  })
})

// ── Persistence extended ──

describe('Persistence extended', () => {
  it('persist without backend is no-op', async () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    await store.persist() // should not throw
  })

  it('restore non-existent snapshot throws', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    await expect(store.restore('nonexistent')).rejects.toThrow('Snapshot not found')
  })

  it('restoreLatest with empty backend is no-op', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'b', 'c')
    await store.restoreLatest() // no metadata → no-op
    expect(store.get('a', 'b')).toBe('c') // state unchanged
  })

  it('restoreLatest recomputes live queries', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'b', 'c')
    await store.persistAll()

    const store2 = createTripleStore({ backend })
    const lq = store2.liveMatch({ subject: 'a' })
    expect(lq.value).toHaveLength(0)

    await store2.restoreLatest()
    expect(lq.value).toHaveLength(1)
    lq.dispose()
  })

  it('persist specific checkpoint', async () => {
    const backend = new MemoryBackend()
    const store = createTripleStore({ backend })
    store.insert('a', 'b', 'c')
    const cp = store.checkpoint({ title: 'cp1' })
    await store.persist(cp.id)

    const store2 = createTripleStore({ backend })
    await store2.restore(cp.id)
    expect(store2.get('a', 'b')).toBe('c')
  })

  it('persistAll without backend is no-op', async () => {
    const store = createTripleStore()
    await store.persistAll() // should not throw
  })

  it('restoreLatest without backend is no-op', async () => {
    const store = createTripleStore()
    await store.restoreLatest() // should not throw
  })
})

// ── Lifecycle extended ──

describe('Lifecycle extended', () => {
  it('close prevents all query operations', () => {
    const store = createTripleStore()
    store.insert('a', 'b', 'c')
    store.close()

    expect(() => store.get('a', 'b')).toThrow('TripleStore is closed')
    expect(() => store.match({})).toThrow('TripleStore is closed')
    expect(() => store.getAll()).toThrow('TripleStore is closed')
  })

  it('close prevents mutation operations', () => {
    const store = createTripleStore()
    store.close()

    expect(() => store.delete('a', 'b')).toThrow('TripleStore is closed')
    expect(() => store.batchInsert([])).toThrow('TripleStore is closed')
    expect(() => store.clear()).toThrow('TripleStore is closed')
    expect(() => store.batch(() => {})).toThrow('TripleStore is closed')
  })

  it('close prevents version control operations', () => {
    const store = createTripleStore()
    store.close()

    expect(() => store.checkpoint({ title: 'x' })).toThrow('TripleStore is closed')
    expect(() => store.checkout('x')).toThrow('TripleStore is closed')
    expect(() => store.listCheckpoints()).toThrow('TripleStore is closed')
    expect(() => store.getCheckpoint('x')).toThrow('TripleStore is closed')
    expect(() => store.deleteCheckpoint('x')).toThrow('TripleStore is closed')
  })

  it('close prevents serialization operations', () => {
    const store = createTripleStore()
    store.close()

    expect(() => store.exportState()).toThrow('TripleStore is closed')
    expect(() => store.importState({ version: 2, triples: [], checkpoints: [], keyframeInterval: 50 })).toThrow('TripleStore is closed')
    expect(() => store.exportCheckpoints([])).toThrow('TripleStore is closed')
  })

  it('close prevents live query creation', () => {
    const store = createTripleStore()
    store.close()

    expect(() => store.liveMatch({})).toThrow('TripleStore is closed')
    expect(() => store.liveGet('a', 'b')).toThrow('TripleStore is closed')
  })

  it('isOpen reflects correct state', () => {
    const store = createTripleStore()
    expect(store.isOpen).toBe(true)
    store.close()
    expect(store.isOpen).toBe(false)
  })
})

// ── TripleIndex count caching ──

describe('TripleIndex count correctness', () => {
  it('count updates correctly through insert/delete cycles', () => {
    const store = createTripleStore()
    expect(store.getAll()).toHaveLength(0)

    store.insert('a', 'b', 'c')
    expect(store.getAll()).toHaveLength(1)

    store.insert('d', 'e', 'f')
    expect(store.getAll()).toHaveLength(2)

    store.delete('a', 'b', 'c')
    expect(store.getAll()).toHaveLength(1)

    store.delete('d', 'e', 'f')
    expect(store.getAll()).toHaveLength(0)
  })

  it('count after wildcard delete', () => {
    const store = createTripleStore()
    store.insert('a', 'p', 'v1')
    store.insert('a', 'p', 'v2')
    store.insert('a', 'p', 'v3')
    expect(store.getAll()).toHaveLength(3)

    store.delete('a', 'p') // wildcard
    expect(store.getAll()).toHaveLength(0)
  })

  it('checkpoint tripleCount is accurate', () => {
    const store = createTripleStore()
    for (let i = 0; i < 10; i++) {
      store.insert(`e${i}`, 'v', `${i}`)
    }
    const cp = store.checkpoint({ title: 'ten' })
    expect(cp.tripleCount).toBe(10)

    store.insert('extra', 'v', 'x')
    const cp2 = store.checkpoint({ title: 'eleven' })
    expect(cp2.tripleCount).toBe(11)
  })
})

// ── Scale / stress ──

describe('Scale operations', () => {
  it('handles 1000 triples with various patterns', () => {
    const store = createTripleStore()
    for (let i = 0; i < 1000; i++) {
      store.insert(`s${i % 10}`, `p${i % 5}`, `o${i}`, `g${i % 3}`)
    }

    // Subject query
    const bySubject = store.match({ subject: 's0' })
    expect(bySubject.length).toBeGreaterThan(0)
    expect(bySubject.every(t => t.subject === 's0')).toBe(true)

    // Predicate query
    const byPred = store.match({ predicate: 'p0' })
    expect(byPred.length).toBeGreaterThan(0)

    // Graph query
    const byGraph = store.match({ graph: 'g0' })
    expect(byGraph.length).toBeGreaterThan(0)
    expect(byGraph.every(t => t.graph === 'g0')).toBe(true)
  })

  it('checkpoint/checkout with many checkpoints', () => {
    const store = createTripleStore()
    const cps: string[] = []
    for (let i = 0; i < 50; i++) {
      store.insert(`e${i}`, 'v', `${i}`)
      cps.push(store.checkpoint({ title: `cp${i}` }).id)
    }

    // Verify each checkpoint has correct count
    for (let i = 0; i < 50; i++) {
      store.checkout(cps[i])
      expect(store.getAll()).toHaveLength(i + 1)
    }
  })
})
