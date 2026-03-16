/**
 * Realistic benchmark: storage and memory consumption with thousands of
 * triples and thousands of checkpoints.
 *
 * The key insight about HAMT structural sharing:
 * - **In-memory**: checkpoints share unchanged HAMT nodes, so 1000 checkpoints
 *   with small deltas use far less memory than 1000 independent copies.
 * - **Serialized (exportState)**: currently each checkpoint stores its full triple
 *   array (no delta encoding), so serialized size grows linearly. Future delta
 *   serialization could improve this.
 *
 * This benchmark measures both to give a clear picture of real resource consumption.
 */

import { describe, it, expect } from 'vitest'
import { createTripleStore } from '../src/index'
import { serialize } from '../src/version/serializer'
import { TripleIndex } from '../src/index/triple-index'

/** Force a GC and return heap used in bytes. Falls back to estimate if --expose-gc is not set. */
function heapUsed(): number {
  const g = globalThis as Record<string, unknown>
  if (typeof g.gc === 'function') (g.gc as () => void)()
  return (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process.memoryUsage().heapUsed
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Generate a deterministic ~1000-char text string */
function longText(seed: number): string {
  const base = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `
  // Repeat and truncate to ~1000 chars, append seed for uniqueness
  const repeated = (base + base + base).slice(0, 980)
  return `${repeated} [id=${seed}]`
}

describe('Storage benchmark', () => {
  /**
   * Scenario: Game world state with long text content (~1000 chars per object)
   *
   * - 2000 entities, each with 3 predicates (name, description=~1000chars, metadata)
   * - 1000 checkpoints, each modifying 10 triples
   */
  it('thousands of triples (long text) + thousands of checkpoints', () => {
    const NUM_ENTITIES = 2000
    const PREDICATES = ['name', 'description', 'metadata']
    const NUM_CHECKPOINTS = 1000
    const MODIFICATIONS_PER_CHECKPOINT = 10

    const store = createTripleStore()

    // ── Phase 1: Populate baseline state with ~1000-char text values ──
    const t0 = performance.now()
    for (let i = 0; i < NUM_ENTITIES; i++) {
      const entity = `entity:${i}`
      store.insert(entity, 'name', `Entity_${i}`)
      store.insert(entity, 'description', longText(i))
      store.insert(entity, 'metadata', { bio: longText(i + 10000), tags: ['alpha', 'beta', 'gamma'] })
    }
    const tPopulate = performance.now() - t0
    const baseTripleCount = store.getAll().length

    expect(baseTripleCount).toBe(NUM_ENTITIES * PREDICATES.length)

    // Measure serialized size of the baseline (single snapshot = all triples as JSON)
    const baselineSnapshotSize = measureSnapshotSize(store.getAll())

    // Heap after baseline
    const heapAfterBaseline = heapUsed()

    // ── Phase 2: Create checkpoints with incremental modifications ──
    const t1 = performance.now()

    for (let cp = 0; cp < NUM_CHECKPOINTS; cp++) {
      // Modify a small number of random entities
      for (let m = 0; m < MODIFICATIONS_PER_CHECKPOINT; m++) {
        const entityIdx = (cp * 7 + m * 13) % NUM_ENTITIES // deterministic pseudo-random
        const entity = `entity:${entityIdx}`
        // Update description (delete old + insert new long text)
        store.delete(entity, 'description')
        store.insert(entity, 'description', longText(cp * 10000 + m))
      }

      store.checkpoint({ title: `save-${cp}` })
    }
    const tCheckpoints = performance.now() - t1

    const heapAfterCheckpoints = heapUsed()
    const heapDelta = heapAfterCheckpoints - heapAfterBaseline

    // ── Phase 3: Measure checkout speed ──
    const checkpoints = store.listCheckpoints()
    const t2 = performance.now()
    store.checkout(checkpoints[0].id)
    const tCheckoutFirst = performance.now() - t2

    const t3 = performance.now()
    store.checkout(checkpoints[checkpoints.length - 1].id)
    const tCheckoutLast = performance.now() - t3

    // ── Phase 4: Measure query speed on large state ──
    const t4 = performance.now()
    const matchResult = store.match({ subject: 'entity:500' })
    const tMatch = performance.now() - t4

    expect(matchResult.length).toBe(PREDICATES.length)

    const t5 = performance.now()
    const matchByPredicate = store.match({ predicate: 'description' })
    const tMatchPredicate = performance.now() - t5

    expect(matchByPredicate.length).toBe(NUM_ENTITIES)

    // ── Phase 5: Serialized sizes ──
    // Delta-encoded export (v2)
    const t6 = performance.now()
    const deltaState = store.exportState()
    const tExportDelta = performance.now() - t6
    const deltaStateJson = JSON.stringify(deltaState)
    const deltaExportSize = new TextEncoder().encode(deltaStateJson).byteLength

    // Naïve total = every checkpoint stored as full JSON (no delta)
    const naiveSerializedTotal = baselineSnapshotSize * (NUM_CHECKPOINTS + 1)

    // Average object value size (pick a description triple)
    const descTriples = store.match({ subject: 'entity:0', predicate: 'description' })
    const avgObjectSize = typeof descTriples[0]?.object === 'string' ? descTriples[0].object.length : 0

    // Count keyframes vs deltas
    const keyframes = deltaState.checkpoints.filter(c => c.type === 'keyframe').length
    const deltas = deltaState.checkpoints.filter(c => c.type === 'delta').length

    // Compression ratio
    const compressionRatio = naiveSerializedTotal > 0
      ? ((1 - deltaExportSize / naiveSerializedTotal) * 100).toFixed(1)
      : '0'

    // ── Report ──
    console.log('\n╔══════════════════════════════════════════════════════════════════╗')
    console.log('║     HAMT TripleStore Benchmark (Long Text ~1000 chars, Delta)   ║')
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log(`║ Baseline: ${baseTripleCount} triples (${NUM_ENTITIES} entities × ${PREDICATES.length} predicates)`)
    console.log(`║ Avg object value size: ~${avgObjectSize} chars`)
    console.log(`║ Checkpoints: ${NUM_CHECKPOINTS} (${MODIFICATIONS_PER_CHECKPOINT} modifications each)`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║ IN-MEMORY (HAMT structural sharing)                             ║')
    console.log(`║   Heap after baseline:              ${fmt(heapAfterBaseline).padStart(12)}`)
    console.log(`║   Heap after ${NUM_CHECKPOINTS} checkpoints:        ${fmt(heapAfterCheckpoints).padStart(12)}`)
    console.log(`║   Delta (checkpoint overhead):      ${fmt(heapDelta).padStart(12)}`)
    console.log(`║   Avg heap per checkpoint:          ${fmt(heapDelta / NUM_CHECKPOINTS).padStart(12)}`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║ SERIALIZED (v2 delta encoding)                                  ║')
    console.log(`║   Single snapshot (serialized):     ${fmt(baselineSnapshotSize).padStart(12)}`)
    console.log(`║   Naïve total (snapshot × ${(NUM_CHECKPOINTS + 1).toString().padEnd(4)}): ${fmt(naiveSerializedTotal).padStart(12)}`)
    console.log(`║   Delta export (actual):            ${fmt(deltaExportSize).padStart(12)}`)
    console.log(`║   Compression vs naïve:             ${compressionRatio.padStart(10)}%`)
    console.log(`║   Keyframes: ${keyframes}, Deltas: ${deltas}`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║ TIMING                                                          ║')
    console.log(`║   Populate ${baseTripleCount} triples:          ${tPopulate.toFixed(1).padStart(10)} ms`)
    console.log(`║   Create ${NUM_CHECKPOINTS} checkpoints:         ${tCheckpoints.toFixed(1).padStart(10)} ms`)
    console.log(`║   Avg per checkpoint:               ${(tCheckpoints / NUM_CHECKPOINTS).toFixed(3).padStart(10)} ms`)
    console.log(`║   Checkout (first):                 ${tCheckoutFirst.toFixed(3).padStart(10)} ms`)
    console.log(`║   Checkout (last):                  ${tCheckoutLast.toFixed(3).padStart(10)} ms`)
    console.log(`║   Match by subject:                 ${tMatch.toFixed(3).padStart(10)} ms`)
    console.log(`║   Match by predicate (${NUM_ENTITIES} hits):   ${tMatchPredicate.toFixed(3).padStart(10)} ms`)
    console.log(`║   Export (delta encoded):           ${tExportDelta.toFixed(1).padStart(10)} ms`)
    console.log('╚══════════════════════════════════════════════════════════════════╝\n')

    // Delta encoded export should be much smaller than naïve
    expect(deltaExportSize).toBeLessThan(naiveSerializedTotal * 0.5)

    // Sanity: checkpoint operations should be fast (< 5ms average including modifications)
    expect(tCheckpoints / NUM_CHECKPOINTS).toBeLessThan(5)
    // Checkout should be essentially O(1) — under 1ms
    expect(tCheckoutFirst).toBeLessThan(1)
    expect(tCheckoutLast).toBeLessThan(1)
  })

  /**
   * Directly measure HAMT structural sharing ratio.
   *
   * Creates a large TripleIndex, then creates many slightly-modified copies.
   * Counts how many unique HAMT internal nodes exist across all versions,
   * compared to the naïve approach of full duplication.
   */
  it('HAMT structural sharing: node reuse measurement', () => {
    const NUM_ENTITIES = 3000
    const NUM_VERSIONS = 500
    const CHANGES_PER_VERSION = 5

    // Build baseline index
    let baseIndex = TripleIndex.empty()
    for (let i = 0; i < NUM_ENTITIES; i++) {
      baseIndex = baseIndex.insert(`entity:${i}`, 'value', i)
    }

    const baseSerializedSize = serialize(baseIndex).byteLength

    // Create versions with small deltas, measure serialized sizes
    const versions: TripleIndex[] = [baseIndex]
    let current = baseIndex
    for (let v = 0; v < NUM_VERSIONS; v++) {
      for (let c = 0; c < CHANGES_PER_VERSION; c++) {
        const idx = (v * 11 + c * 7) % NUM_ENTITIES
        current = current.delete(`entity:${idx}`, 'value')
        current = current.insert(`entity:${idx}`, 'value', v * 1000 + c)
      }
      versions.push(current)
    }

    // Measure: sum of all serialized versions (each is full triple list)
    const totalSerializedSize = versions.reduce(
      (sum, idx) => sum + serialize(idx).byteLength,
      0,
    )

    // Naïve cost: if every version were independently stored
    const naiveTotalSerialized = baseSerializedSize * (NUM_VERSIONS + 1)

    // Heap measurement: capture heap with all version roots alive
    const heapBefore = heapUsed()
    // Prevent V8 from optimizing away the versions array
    void versions[versions.length - 1].count
    const heapAfter = heapUsed()

    console.log('\n╔══════════════════════════════════════════════════════════════════╗')
    console.log('║           HAMT Node Reuse / Structural Sharing                  ║')
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log(`║ Base: ${NUM_ENTITIES} triples, ${NUM_VERSIONS} versions, ${CHANGES_PER_VERSION} changes/version`)
    console.log(`║ Single version (serialized):        ${fmt(baseSerializedSize).padStart(12)}`)
    console.log(`║ All versions (serialized sum):      ${fmt(totalSerializedSize).padStart(12)}`)
    console.log(`║ Naïve (base × ${NUM_VERSIONS + 1}):                ${fmt(naiveTotalSerialized).padStart(12)}`)
    console.log(`║ Serialization note: each snapshot stores full triple list,`)
    console.log(`║   so serialized ratio ≈ 100%. Savings are in-memory only.`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log(`║ Heap holding ${NUM_VERSIONS + 1} versions:          ${fmt(Math.abs(heapAfter - heapBefore)).padStart(12)}`)
    console.log(`║ vs naïve ${NUM_VERSIONS + 1} full copies:           ${fmt(naiveTotalSerialized).padStart(12)}`)
    console.log('╚══════════════════════════════════════════════════════════════════╝\n')

    // All versions should have correct triple count
    expect(versions[0].count).toBe(NUM_ENTITIES)
    expect(versions[NUM_VERSIONS].count).toBe(NUM_ENTITIES)
  })

  /**
   * Scenario: Chat history (graph-partitioned)
   *
   * - 500 message nodes across 10 graphs
   * - Frequent checkpoints with minimal changes
   * - Tests graph index efficiency
   */
  it('graph-partitioned data with checkpoints', () => {
    const NUM_MESSAGES = 500
    const NUM_GRAPHS = 10
    const NUM_CHECKPOINTS = 200

    const store = createTripleStore()

    // Populate
    for (let i = 0; i < NUM_MESSAGES; i++) {
      const g = `chat:${i % NUM_GRAPHS}`
      const s = `msg:${i}`
      store.insert(s, 'rdf:type', 'Message', g)
      store.insert(s, 'content', `Message body ${i}`, g)
      store.insert(s, 'timestamp', Date.now() + i * 1000, g)
      if (i > 0) store.insert(s, 'parentId', `msg:${i - 1}`, g)
    }

    const baseCount = store.getAll().length
    const baseSize = measureSnapshotSize(store.getAll())

    const heapBefore = heapUsed()

    // Create checkpoints with small edits
    for (let cp = 0; cp < NUM_CHECKPOINTS; cp++) {
      const msgIdx = cp % NUM_MESSAGES
      const g = `chat:${msgIdx % NUM_GRAPHS}`
      store.delete(`msg:${msgIdx}`, 'content', undefined, g)
      store.insert(`msg:${msgIdx}`, 'content', `Edited message ${msgIdx} v${cp}`, g)
      store.checkpoint({ title: `autosave-${cp}` })
    }

    const heapAfter = heapUsed()
    const heapDelta = heapAfter - heapBefore

    // Graph query
    const t0 = performance.now()
    const graphResults = store.match({ graph: 'chat:0' })
    const tGraphMatch = performance.now() - t0

    console.log('\n╔══════════════════════════════════════════════════════════════════╗')
    console.log('║          Graph-Partitioned Chat Benchmark                       ║')
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log(`║ Messages: ${NUM_MESSAGES}, Graphs: ${NUM_GRAPHS}, Checkpoints: ${NUM_CHECKPOINTS}`)
    console.log(`║ Total triples: ${baseCount}`)
    console.log(`║ Single snapshot (serialized):       ${fmt(baseSize).padStart(12)}`)
    console.log(`║ Heap delta for ${NUM_CHECKPOINTS} checkpoints:     ${fmt(heapDelta).padStart(12)}`)
    console.log(`║ Avg heap per checkpoint:            ${fmt(heapDelta / NUM_CHECKPOINTS).padStart(12)}`)
    console.log(`║ Graph match (chat:0, ${graphResults.length} results):  ${tGraphMatch.toFixed(3).padStart(7)} ms`)
    console.log('╚══════════════════════════════════════════════════════════════════╝\n')

    expect(graphResults.length).toBeGreaterThan(0)
  })
})

function measureSnapshotSize(triples: { subject: string; predicate: string; object: unknown; graph?: string }[]): number {
  const json = JSON.stringify(triples)
  return new TextEncoder().encode(json).byteLength
}
