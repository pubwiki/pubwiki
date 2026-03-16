/**
 * FNV-1a 32-bit hash function.
 *
 * Fast, simple, good distribution for string keys.
 * Used by the HAMT trie for bucket placement.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * Compute a 32-bit FNV-1a hash for the given string key.
 * Returns an unsigned 32-bit integer.
 */
export function fnv1a(key: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // Ensure unsigned 32-bit
  return hash >>> 0
}
