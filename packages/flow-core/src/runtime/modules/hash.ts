/**
 * Hash Module
 *
 * Provides xxHash hashing via xxhash-wasm.
 * WASM is initialized once; after that all hash functions are synchronous.
 */

import xxhashInit from 'xxhash-wasm';

/**
 * Create the hash module (async — WASM must be loaded first).
 *
 * Exposed API:
 *   hash.xxhash(input: string): string   — 64-bit xxHash hex string
 */
export async function createHashModule() {
	const { h64ToString } = await xxhashInit();

	function xxhash(input: string): string {
		return h64ToString(input);
	}

	return { xxhash };
}
