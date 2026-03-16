/**
 * HAMT node types.
 *
 * Three node variants form the trie:
 * - InternalNode: bitmap-indexed array of children (branch)
 * - LeafNode: single key-value pair at a terminal position
 * - CollisionNode: multiple key-value pairs sharing the same hash
 */

export const enum NodeType {
  Internal = 0,
  Leaf = 1,
  Collision = 2,
}

export interface InternalNode<V> {
  readonly type: NodeType.Internal
  readonly bitmap: number
  readonly children: ReadonlyArray<HAMTNode<V>>
}

export interface LeafNode<V> {
  readonly type: NodeType.Leaf
  readonly hash: number
  readonly key: string
  readonly value: V
}

export interface CollisionNode<V> {
  readonly type: NodeType.Collision
  readonly hash: number
  readonly pairs: ReadonlyArray<readonly [string, V]>
}

export type HAMTNode<V> = InternalNode<V> | LeafNode<V> | CollisionNode<V>

// ── Node constructors (produce frozen objects for structural sharing safety) ──

export function createInternal<V>(
  bitmap: number,
  children: ReadonlyArray<HAMTNode<V>>,
): InternalNode<V> {
  return { type: NodeType.Internal, bitmap, children }
}

export function createLeaf<V>(hash: number, key: string, value: V): LeafNode<V> {
  return { type: NodeType.Leaf, hash, key, value }
}

export function createCollision<V>(
  hash: number,
  pairs: ReadonlyArray<readonly [string, V]>,
): CollisionNode<V> {
  return { type: NodeType.Collision, hash, pairs }
}
