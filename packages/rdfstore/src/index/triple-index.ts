/**
 * Three-way indexed triple store built on persistent HAMT tries.
 *
 * Maintains three indexes for efficient pattern matching:
 *   SPO: subject → predicate → objectKey → Value
 *   POS: predicate → objectKey → Set<subject>
 *   OSP: objectKey → subject → Set<predicate>
 *
 * Plus a graph index:
 *   graphIndex: graph → Set<tripleKey>
 *
 * All mutations return a *new* TripleIndex (immutable / persistent).
 */

import { HAMT } from '../hamt/trie'
import type { Triple, MatchPattern, Value } from '../types'

/** Serialize a Value to a stable string key for use in indexes */
export function objectKey(v: Value): string {
  if (typeof v === 'string') return `s:${v}`
  if (typeof v === 'number') return `n:${v}`
  if (typeof v === 'boolean') return `b:${v}`
  return `j:${JSON.stringify(v)}`
}

/** Unique key for a triple (used in graph index) */
function tripleKey(s: string, p: string, ok: string, g: string | undefined): string {
  return `${s}\0${p}\0${ok}\0${g ?? ''}`
}

type SubjectSet = HAMT<true>    // set of subjects (value is always `true`)
type PredicateSet = HAMT<true>  // set of predicates
type TripleKeySet = HAMT<true>  // set of triple keys

// SPO index: subject → (predicate → (objectKey → Value))
type SPOLevel3 = HAMT<Value>             // objectKey → Value
type SPOLevel2 = HAMT<SPOLevel3>         // predicate → SPOLevel3
type SPOIndex = HAMT<SPOLevel2>          // subject → SPOLevel2

// POS index: predicate → (objectKey → Set<subject>)
type POSLevel3 = HAMT<SubjectSet>        // objectKey → Set<subject>
type POSIndex = HAMT<POSLevel3>          // predicate → (objectKey → subjects)

// OSP index: objectKey → (subject → Set<predicate>)
type OSPLevel3 = HAMT<PredicateSet>      // subject → Set<predicate>
type OSPIndex = HAMT<OSPLevel3>          // objectKey → (subject → predicates)

const EMPTY_HAMT = HAMT.empty<never>()

export class TripleIndex {
  readonly spo: SPOIndex
  readonly pos: POSIndex
  readonly osp: OSPIndex
  readonly graphIndex: HAMT<TripleKeySet>  // graph → set of tripleKeys
  private _count: number | undefined

  constructor(
    spo?: SPOIndex,
    pos?: POSIndex,
    osp?: OSPIndex,
    graphIndex?: HAMT<TripleKeySet>,
    count?: number,
  ) {
    this.spo = (spo ?? EMPTY_HAMT) as SPOIndex
    this.pos = (pos ?? EMPTY_HAMT) as POSIndex
    this.osp = (osp ?? EMPTY_HAMT) as OSPIndex
    this.graphIndex = (graphIndex ?? EMPTY_HAMT) as HAMT<TripleKeySet>
    this._count = count
  }

  static empty(): TripleIndex {
    return new TripleIndex(undefined, undefined, undefined, undefined, 0)
  }

  /** Total number of triples. Lazily counted from SPO index. */
  get count(): number {
    if (this._count === undefined) {
      let n = 0
      for (const pMap of this.spo.values()) {
        for (const oMap of pMap.values()) {
          n += oMap.size
        }
      }
      this._count = n
    }
    return this._count
  }

  /** Insert a triple. Returns a new TripleIndex. */
  insert(s: string, p: string, o: Value, g?: string): TripleIndex {
    const ok = objectKey(o)

    // Check if already exists
    const existingP = this.spo.get(s)
    if (existingP) {
      const existingO = existingP.get(p)
      if (existingO && existingO.has(ok)) {
        return this // already exists
      }
    }

    // SPO: subject → predicate → objectKey → Value
    const pMap = this.spo.get(s) ?? HAMT.empty<SPOLevel3>()
    const oMap = pMap.get(p) ?? HAMT.empty<Value>()
    const newSpo = this.spo.set(s, pMap.set(p, oMap.set(ok, o)))

    // POS: predicate → objectKey → Set<subject>
    const posOMap = this.pos.get(p) ?? HAMT.empty<SubjectSet>()
    const posSubs = posOMap.get(ok) ?? HAMT.empty<true>()
    const newPos = this.pos.set(p, posOMap.set(ok, posSubs.set(s, true)))

    // OSP: objectKey → subject → Set<predicate>
    const ospSMap = this.osp.get(ok) ?? HAMT.empty<PredicateSet>()
    const ospPreds = ospSMap.get(s) ?? HAMT.empty<true>()
    const newOsp = this.osp.set(ok, ospSMap.set(s, ospPreds.set(p, true)))

    // Graph index
    let newGraphIndex = this.graphIndex
    if (g) {
      const gSet = this.graphIndex.get(g) ?? HAMT.empty<true>()
      const tk = tripleKey(s, p, ok, g)
      newGraphIndex = this.graphIndex.set(g, gSet.set(tk, true))
    }

    const newCount = this._count !== undefined ? this._count + 1 : undefined
    return new TripleIndex(newSpo, newPos, newOsp, newGraphIndex, newCount)
  }

  /**
   * Delete triples matching the given pattern.
   * - If `o` is provided, deletes the specific (s, p, o) triple.
   * - If `o` is undefined, deletes all triples matching (s, p, *).
   * Returns a new TripleIndex.
   */
  delete(s: string, p: string, o?: Value, g?: string): TripleIndex {
    const pMap = this.spo.get(s)
    if (!pMap) return this

    const oMap = pMap.get(p)
    if (!oMap) return this

    if (o !== undefined) {
      return this.deleteSingle(s, p, o, g, pMap, oMap)
    } else {
      return this.deleteAllForSP(s, p, g, pMap, oMap)
    }
  }

  private deleteSingle(
    s: string, p: string, o: Value, g: string | undefined,
    pMap: SPOLevel2, oMap: SPOLevel3,
  ): TripleIndex {
    const ok = objectKey(o)
    if (!oMap.has(ok)) return this

    // SPO
    const newOMap = oMap.delete(ok)
    let newPMap: SPOLevel2
    let newSpo: SPOIndex
    if (newOMap.size === 0) {
      newPMap = pMap.delete(p)
      newSpo = newPMap.size === 0 ? this.spo.delete(s) : this.spo.set(s, newPMap)
    } else {
      newPMap = pMap.set(p, newOMap)
      newSpo = this.spo.set(s, newPMap)
    }

    // POS
    let newPos = this.pos
    const posOMap = this.pos.get(p)
    if (posOMap) {
      const posSubs = posOMap.get(ok)
      if (posSubs) {
        const newSubs = posSubs.delete(s)
        if (newSubs.size === 0) {
          const newPosOMap = posOMap.delete(ok)
          newPos = newPosOMap.size === 0 ? this.pos.delete(p) : this.pos.set(p, newPosOMap)
        } else {
          newPos = this.pos.set(p, posOMap.set(ok, newSubs))
        }
      }
    }

    // OSP
    let newOsp = this.osp
    const ospSMap = this.osp.get(ok)
    if (ospSMap) {
      const ospPreds = ospSMap.get(s)
      if (ospPreds) {
        const newPreds = ospPreds.delete(p)
        if (newPreds.size === 0) {
          const newSMap = ospSMap.delete(s)
          newOsp = newSMap.size === 0 ? this.osp.delete(ok) : this.osp.set(ok, newSMap)
        } else {
          newOsp = this.osp.set(ok, ospSMap.set(s, newPreds))
        }
      }
    }

    // Graph index
    let newGraphIndex = this.graphIndex
    if (g) {
      const gSet = this.graphIndex.get(g)
      if (gSet) {
        const tk = tripleKey(s, p, ok, g)
        const newGSet = gSet.delete(tk)
        newGraphIndex = newGSet.size === 0
          ? this.graphIndex.delete(g)
          : this.graphIndex.set(g, newGSet)
      }
    }

    const newCount = this._count !== undefined ? this._count - 1 : undefined
    return new TripleIndex(newSpo, newPos, newOsp, newGraphIndex, newCount)
  }

  private deleteAllForSP(
    s: string, p: string, g: string | undefined,
    pMap: SPOLevel2, oMap: SPOLevel3,
  ): TripleIndex {
    // Collect all object keys being removed
    let current: TripleIndex = this
    for (const [ok, val] of oMap) {
      current = current.deleteSingle(s, p, val, g, 
        current.spo.get(s) ?? pMap,
        current.spo.get(s)?.get(p) ?? oMap)
      // Re-fetch if structure changed (rare edge case if called in a loop)
      void ok
    }
    return current
  }

  /** Match triples against a pattern (all absent fields are wildcards). */
  match(pattern: MatchPattern): Triple[] {
    const { subject, predicate, object, graph } = pattern
    const results: Triple[] = []

    if (subject !== undefined && predicate !== undefined && object !== undefined) {
      // Exact match
      this.matchSPO(subject, predicate, object, graph, results)
    } else if (subject !== undefined && predicate !== undefined) {
      // S+P given → iterate objects
      this.matchSP(subject, predicate, graph, results)
    } else if (subject !== undefined) {
      // S given → iterate predicates and objects
      this.matchS(subject, graph, results)
    } else if (predicate !== undefined && object !== undefined) {
      // P+O given → use POS index
      this.matchPO(predicate, object, graph, results)
    } else if (predicate !== undefined) {
      // P given → use POS index
      this.matchP(predicate, graph, results)
    } else if (object !== undefined) {
      // O given → use OSP index
      this.matchO(object, graph, results)
    } else if (graph !== undefined) {
      // Only G given → use graph index
      this.matchG(graph, results)
    } else {
      // No constraints → return all
      this.matchAll(results)
    }

    return results
  }

  /** Get a single value for (subject, predicate) */
  get(s: string, p: string, g?: string): Value | undefined {
    const pMap = this.spo.get(s)
    if (!pMap) return undefined
    const oMap = pMap.get(p)
    if (!oMap) return undefined

    // Return first value (or filter by graph if needed)
    if (!g) {
      for (const [, v] of oMap) return v
      return undefined
    }

    // With graph filter: need to check graph index
    for (const [ok, v] of oMap) {
      const tk = tripleKey(s, p, ok, g)
      const gSet = this.graphIndex.get(g)
      if (gSet?.has(tk)) return v
    }
    return undefined
  }

  /** Return all triples */
  getAll(): Triple[] {
    return this.match({})
  }

  // ── Private match helpers ──

  private matchSPO(s: string, p: string, o: Value, g: string | undefined, out: Triple[]) {
    const ok = objectKey(o)
    const pMap = this.spo.get(s)
    if (!pMap) return
    const oMap = pMap.get(p)
    if (!oMap) return
    const val = oMap.get(ok)
    if (val === undefined) return
    if (g !== undefined && !this.inGraph(s, p, ok, g)) return
    out.push({ subject: s, predicate: p, object: val, ...(g !== undefined ? { graph: g } : {}) })
  }

  private matchSP(s: string, p: string, g: string | undefined, out: Triple[]) {
    const pMap = this.spo.get(s)
    if (!pMap) return
    const oMap = pMap.get(p)
    if (!oMap) return
    for (const [ok, val] of oMap) {
      if (g !== undefined && !this.inGraph(s, p, ok, g)) continue
      out.push({ subject: s, predicate: p, object: val, ...(g !== undefined ? { graph: g } : {}) })
    }
  }

  private matchS(s: string, g: string | undefined, out: Triple[]) {
    const pMap = this.spo.get(s)
    if (!pMap) return
    for (const [p, oMap] of pMap) {
      for (const [ok, val] of oMap) {
        if (g !== undefined && !this.inGraph(s, p, ok, g)) continue
        out.push({ subject: s, predicate: p, object: val, ...(g !== undefined ? { graph: g } : {}) })
      }
    }
  }

  private matchPO(p: string, o: Value, g: string | undefined, out: Triple[]) {
    const ok = objectKey(o)
    const posOMap = this.pos.get(p)
    if (!posOMap) return
    const subs = posOMap.get(ok)
    if (!subs) return
    for (const [s] of subs) {
      if (g !== undefined && !this.inGraph(s, p, ok, g)) continue
      out.push({ subject: s, predicate: p, object: o, ...(g !== undefined ? { graph: g } : {}) })
    }
  }

  private matchP(p: string, g: string | undefined, out: Triple[]) {
    const posOMap = this.pos.get(p)
    if (!posOMap) return
    for (const [ok, subs] of posOMap) {
      for (const [s] of subs) {
        // Get the actual value from SPO
        const val = this.spo.get(s)?.get(p)?.get(ok)
        if (val === undefined) continue
        if (g !== undefined && !this.inGraph(s, p, ok, g)) continue
        out.push({ subject: s, predicate: p, object: val, ...(g !== undefined ? { graph: g } : {}) })
      }
    }
  }

  private matchO(o: Value, g: string | undefined, out: Triple[]) {
    const ok = objectKey(o)
    const ospSMap = this.osp.get(ok)
    if (!ospSMap) return
    for (const [s, preds] of ospSMap) {
      for (const [p] of preds) {
        if (g !== undefined && !this.inGraph(s, p, ok, g)) continue
        out.push({ subject: s, predicate: p, object: o, ...(g !== undefined ? { graph: g } : {}) })
      }
    }
  }

  private matchG(g: string, out: Triple[]) {
    const gSet = this.graphIndex.get(g)
    if (!gSet) return
    for (const [tk] of gSet) {
      const parts = tk.split('\0')
      const s = parts[0], p = parts[1]
      const val = this.spo.get(s)?.get(p)?.get(parts[2])
      if (val !== undefined) {
        out.push({ subject: s, predicate: p, object: val, graph: g })
      }
    }
  }

  private matchAll(out: Triple[]) {
    for (const [s, pMap] of this.spo) {
      for (const [p, oMap] of pMap) {
        for (const [, val] of oMap) {
          out.push({ subject: s, predicate: p, object: val })
        }
      }
    }
  }

  private inGraph(s: string, p: string, ok: string, g: string): boolean {
    const gSet = this.graphIndex.get(g)
    if (!gSet) return false
    return gSet.has(tripleKey(s, p, ok, g))
  }
}
