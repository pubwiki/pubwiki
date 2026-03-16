/**
 * HAMT bitmap utilities.
 *
 * A 32-bit bitmap encodes which of the 32 possible children for a given trie
 * level are actually present. We use 5-bit slices of the hash at each level
 * (2^5 = 32 slots).
 */

/** Number of bits consumed per trie level */
export const BITS_PER_LEVEL = 5

/** Mask for extracting BITS_PER_LEVEL bits */
export const LEVEL_MASK = (1 << BITS_PER_LEVEL) - 1 // 0x1f

/** Maximum depth before we fall back to collision nodes */
export const MAX_DEPTH = 6 // 5 * 6 = 30 bits, fits in 32-bit hash

/**
 * Extract the 5-bit fragment from a 32-bit `hash` at the given trie `depth`.
 */
export function maskIndex(hash: number, depth: number): number {
  return (hash >>> (depth * BITS_PER_LEVEL)) & LEVEL_MASK
}

/**
 * The single-bit position corresponding to a fragment index.
 */
export function bitPosition(fragment: number): number {
  return 1 << fragment
}

/**
 * Population count – number of set bits in a 32-bit integer.
 * Used to compute the compressed child-array index from a bitmap.
 */
export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * Given a full bitmap and the bit for the target slot, return the index
 * into the compressed children array.
 */
export function compressedIndex(bitmap: number, bit: number): number {
  return popcount(bitmap & (bit - 1))
}
