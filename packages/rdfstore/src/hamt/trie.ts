/**
 * Persistent (immutable) HAMT – Hash Array Mapped Trie.
 *
 * Every mutating operation returns a **new** HAMT that shares structure
 * with the previous version (path-copying). The old HAMT is never modified.
 */

import { bitPosition, compressedIndex, maskIndex, MAX_DEPTH } from './bitmap'
import { fnv1a } from './hash'
import {
  createCollision,
  createInternal,
  createLeaf,
  type CollisionNode,
  type HAMTNode,
  type InternalNode,
  type LeafNode,
  NodeType,
} from './node'

// ── Empty root sentinel ──

const EMPTY_INTERNAL: InternalNode<never> = createInternal(0, [])

// ── Array helpers (immutable splice) ──

function arraySet<T>(arr: ReadonlyArray<T>, idx: number, value: T): T[] {
  const out = arr.slice() as T[]
  out[idx] = value
  return out
}

function arrayInsert<T>(arr: ReadonlyArray<T>, idx: number, value: T): T[] {
  const out = new Array<T>(arr.length + 1)
  for (let i = 0; i < idx; i++) out[i] = arr[i]
  out[idx] = value
  for (let i = idx; i < arr.length; i++) out[i + 1] = arr[i]
  return out
}

function arrayRemove<T>(arr: ReadonlyArray<T>, idx: number): T[] {
  const out = new Array<T>(arr.length - 1)
  for (let i = 0; i < idx; i++) out[i] = arr[i]
  for (let i = idx + 1; i < arr.length; i++) out[i - 1] = arr[i]
  return out
}

// ── Core node operations ──

function nodeSet<V>(
  node: HAMTNode<V>,
  hash: number,
  key: string,
  value: V,
  depth: number,
): HAMTNode<V> {
  switch (node.type) {
    case NodeType.Internal:
      return internalSet(node, hash, key, value, depth)
    case NodeType.Leaf:
      return leafSet(node, hash, key, value, depth)
    case NodeType.Collision:
      return collisionSet(node, hash, key, value, depth)
  }
}

function internalSet<V>(
  node: InternalNode<V>,
  hash: number,
  key: string,
  value: V,
  depth: number,
): HAMTNode<V> {
  const frag = maskIndex(hash, depth)
  const bit = bitPosition(frag)
  const idx = compressedIndex(node.bitmap, bit)

  if (node.bitmap & bit) {
    // Slot exists – recurse into existing child
    const existing = node.children[idx]
    const updated = nodeSet(existing, hash, key, value, depth + 1)
    if (updated === existing) return node // no change
    return createInternal(node.bitmap, arraySet(node.children, idx, updated))
  } else {
    // Empty slot – insert new leaf
    const leaf = createLeaf(hash, key, value)
    return createInternal(node.bitmap | bit, arrayInsert(node.children, idx, leaf))
  }
}

function leafSet<V>(
  node: LeafNode<V>,
  hash: number,
  key: string,
  value: V,
  depth: number,
): HAMTNode<V> {
  if (node.hash === hash) {
    if (node.key === key) {
      // Same key – replace value
      return createLeaf(hash, key, value)
    }
    // Hash collision – create collision node
    return createCollision(hash, [
      [node.key, node.value],
      [key, value],
    ])
  }
  // Different hashes sharing this slot – expand into internal node
  return expandLeaf(node, hash, key, value, depth)
}

function expandLeaf<V>(
  existing: LeafNode<V>,
  newHash: number,
  newKey: string,
  newValue: V,
  depth: number,
): HAMTNode<V> {
  if (depth >= MAX_DEPTH) {
    // Shouldn't happen if hashes differ, but safeguard
    return createCollision(newHash, [
      [existing.key, existing.value],
      [newKey, newValue],
    ])
  }

  const existFrag = maskIndex(existing.hash, depth)
  const newFrag = maskIndex(newHash, depth)

  if (existFrag === newFrag) {
    // Same fragment at this depth – need to go deeper
    const child = expandLeaf(existing, newHash, newKey, newValue, depth + 1)
    const bit = bitPosition(existFrag)
    return createInternal(bit, [child])
  }

  // Different fragments – create internal node with both leaves
  const existBit = bitPosition(existFrag)
  const newBit = bitPosition(newFrag)
  const newLeaf = createLeaf(newHash, newKey, newValue)

  if (existFrag < newFrag) {
    return createInternal(existBit | newBit, [existing, newLeaf])
  } else {
    return createInternal(existBit | newBit, [newLeaf, existing])
  }
}

function collisionSet<V>(
  node: CollisionNode<V>,
  hash: number,
  key: string,
  value: V,
  depth: number,
): HAMTNode<V> {
  if (hash === node.hash) {
    // Same hash bucket – update or append
    for (let i = 0; i < node.pairs.length; i++) {
      if (node.pairs[i][0] === key) {
        const newPairs = node.pairs.slice()
        newPairs[i] = [key, value]
        return createCollision(hash, newPairs)
      }
    }
    return createCollision(hash, [...node.pairs, [key, value]])
  }
  // Different hash – wrap collision in internal and insert new leaf
  const wrapped: HAMTNode<V> = node
  const internal = createInternal<V>(
    bitPosition(maskIndex(node.hash, depth)),
    [wrapped],
  )
  return internalSet(internal, hash, key, value, depth)
}

// ── Delete ──

function nodeDelete<V>(
  node: HAMTNode<V>,
  hash: number,
  key: string,
  depth: number,
): HAMTNode<V> | undefined {
  switch (node.type) {
    case NodeType.Internal:
      return internalDelete(node, hash, key, depth)
    case NodeType.Leaf:
      return node.key === key ? undefined : node
    case NodeType.Collision:
      return collisionDelete(node, key)
  }
}

function internalDelete<V>(
  node: InternalNode<V>,
  hash: number,
  key: string,
  depth: number,
): HAMTNode<V> | undefined {
  const frag = maskIndex(hash, depth)
  const bit = bitPosition(frag)

  if (!(node.bitmap & bit)) return node // key not present

  const idx = compressedIndex(node.bitmap, bit)
  const child = node.children[idx]
  const updated = nodeDelete(child, hash, key, depth + 1)

  if (updated === child) return node // no change

  if (updated === undefined) {
    // Child was removed
    if (node.children.length === 1) return undefined // this node is now empty
    const newBitmap = node.bitmap ^ bit
    const newChildren = arrayRemove(node.children, idx)
    // If only one child remains and it's a leaf or collision, we can collapse
    if (newChildren.length === 1 && newChildren[0].type !== NodeType.Internal) {
      return newChildren[0]
    }
    return createInternal(newBitmap, newChildren)
  }

  return createInternal(node.bitmap, arraySet(node.children, idx, updated))
}

function collisionDelete<V>(
  node: CollisionNode<V>,
  key: string,
): HAMTNode<V> | undefined {
  const idx = node.pairs.findIndex(([k]) => k === key)
  if (idx === -1) return node // key not found

  if (node.pairs.length === 1) return undefined
  if (node.pairs.length === 2) {
    // Collapse to leaf
    const remaining = node.pairs[1 - idx]
    return createLeaf(node.hash, remaining[0], remaining[1])
  }

  const newPairs = [...node.pairs.slice(0, idx), ...node.pairs.slice(idx + 1)]
  return createCollision(node.hash, newPairs)
}

// ── Lookup ──

function nodeGet<V>(
  node: HAMTNode<V>,
  hash: number,
  key: string,
  depth: number,
): V | undefined {
   
  while (true) {
    switch (node.type) {
      case NodeType.Leaf:
        return node.key === key ? node.value : undefined

      case NodeType.Collision:
        for (const [k, v] of node.pairs) {
          if (k === key) return v
        }
        return undefined

      case NodeType.Internal: {
        const frag = maskIndex(hash, depth)
        const bit = bitPosition(frag)
        if (!(node.bitmap & bit)) return undefined
        const idx = compressedIndex(node.bitmap, bit)
        node = node.children[idx]
        depth++
        break
      }
    }
  }
}

// ── Iteration ──

function* nodeEntries<V>(node: HAMTNode<V>): IterableIterator<[string, V]> {
  switch (node.type) {
    case NodeType.Leaf:
      yield [node.key, node.value]
      break
    case NodeType.Collision:
      for (const pair of node.pairs) yield pair as [string, V]
      break
    case NodeType.Internal:
      for (const child of node.children) {
        yield* nodeEntries(child)
      }
      break
  }
}

function nodeCount<V>(node: HAMTNode<V>): number {
  switch (node.type) {
    case NodeType.Leaf:
      return 1
    case NodeType.Collision:
      return node.pairs.length
    case NodeType.Internal: {
      let n = 0
      for (const child of node.children) n += nodeCount(child)
      return n
    }
  }
}

// ── Public HAMT class ──

export class HAMT<V> {
  /** @internal */
  readonly _root: HAMTNode<V>
  private _size: number | undefined

  private constructor(root: HAMTNode<V>, size?: number) {
    this._root = root
    this._size = size
  }

  /** Create an empty HAMT. */
  static empty<V>(): HAMT<V> {
    return new HAMT<V>(EMPTY_INTERNAL as InternalNode<V>, 0)
  }

  /** Number of key-value pairs. Lazily computed and cached. */
  get size(): number {
    if (this._size === undefined) {
      this._size = nodeCount(this._root)
    }
    return this._size
  }

  /**
   * Return a new HAMT with the given key set to value.
   * The current HAMT is unchanged (persistent / immutable).
   */
  set(key: string, value: V): HAMT<V> {
    const hash = fnv1a(key)
    const newRoot = nodeSet(this._root, hash, key, value, 0)
    if (newRoot === this._root) return this // no change
    return new HAMT(newRoot)
  }

  /** Look up a value by key. */
  get(key: string): V | undefined {
    const hash = fnv1a(key)
    return nodeGet(this._root, hash, key, 0)
  }

  /** Check if the key exists. */
  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  /**
   * Return a new HAMT with the given key removed.
   * Returns `this` if the key doesn't exist.
   */
  delete(key: string): HAMT<V> {
    const hash = fnv1a(key)
    const newRoot = nodeDelete(this._root, hash, key, 0)
    if (newRoot === this._root) return this
    if (newRoot === undefined) return HAMT.empty()
    return new HAMT(newRoot)
  }

  /** Iterate over all [key, value] pairs. */
  *entries(): IterableIterator<[string, V]> {
    if (this._root.type === NodeType.Internal && (this._root as InternalNode<V>).bitmap === 0) {
      return
    }
    yield* nodeEntries(this._root)
  }

  /** Iterate over all keys. */
  *keys(): IterableIterator<string> {
    for (const [k] of this.entries()) yield k
  }

  /** Iterate over all values. */
  *values(): IterableIterator<V> {
    for (const [, v] of this.entries()) yield v
  }

  /** Iterate over entries (makes HAMT directly iterable). */
  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.entries()
  }

  /** Create a HAMT from an iterable of [key, value] pairs. */
  static from<V>(entries: Iterable<[string, V]>): HAMT<V> {
    let hamt = HAMT.empty<V>()
    for (const [k, v] of entries) {
      hamt = hamt.set(k, v)
    }
    return hamt
  }
}
