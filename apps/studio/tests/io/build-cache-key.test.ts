/**
 * Tests for computeBuildCacheKey in @pubwiki/api/utils
 *
 * Verifies determinism, normalization, and sensitivity to input changes.
 */

import { describe, it, expect } from 'vitest'
import { computeBuildCacheKey } from '@pubwiki/api/utils'

describe('computeBuildCacheKey', () => {
	const baseParams = {
		filesHash: 'abc123def456',
		entryFiles: ['/src/index.tsx'],
	}

	it('should return a 64-char hex string', async () => {
		const key = await computeBuildCacheKey(baseParams)
		expect(key).toMatch(/^[0-9a-f]{64}$/)
	})

	it('should be deterministic — same inputs produce same key', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey(baseParams)
		expect(key1).toBe(key2)
	})

	it('should sort entryFiles — order should not matter', async () => {
		const key1 = await computeBuildCacheKey({
			...baseParams,
			entryFiles: ['/src/a.tsx', '/src/b.tsx'],
		})
		const key2 = await computeBuildCacheKey({
			...baseParams,
			entryFiles: ['/src/b.tsx', '/src/a.tsx'],
		})
		expect(key1).toBe(key2)
	})

	it('should differ when filesHash changes', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey({
			...baseParams,
			filesHash: 'different_hash',
		})
		expect(key1).not.toBe(key2)
	})

	it('should differ when entryFiles change', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey({
			...baseParams,
			entryFiles: ['/src/other.tsx'],
		})
		expect(key1).not.toBe(key2)
	})

	it('should apply default values for optional params', async () => {
		// Explicitly passing defaults should produce same key as omitting them
		const keyWithDefaults = await computeBuildCacheKey({
			...baseParams,
			buildTarget: 'es2020',
			jsx: 'automatic',
			jsxImportSource: 'react',
			minify: false,
		})
		const keyWithoutDefaults = await computeBuildCacheKey(baseParams)
		expect(keyWithDefaults).toBe(keyWithoutDefaults)
	})

	it('should differ when buildTarget changes', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey({
			...baseParams,
			buildTarget: 'esnext',
		})
		expect(key1).not.toBe(key2)
	})

	it('should differ when minify changes', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey({
			...baseParams,
			minify: true,
		})
		expect(key1).not.toBe(key2)
	})

	it('should differ when jsx config changes', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey({
			...baseParams,
			jsx: 'transform',
		})
		expect(key1).not.toBe(key2)
	})

	it('should differ when jsxImportSource changes', async () => {
		const key1 = await computeBuildCacheKey(baseParams)
		const key2 = await computeBuildCacheKey({
			...baseParams,
			jsxImportSource: 'preact',
		})
		expect(key1).not.toBe(key2)
	})
})
