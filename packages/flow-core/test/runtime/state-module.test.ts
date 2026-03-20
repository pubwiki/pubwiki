/**
 * State Module (rdf.ts) — value round-trip tests
 *
 * Verifies that complex nested values stored via the state module
 * do NOT acquire extra { value: ... } wrappers from LuaTable when
 * persisted in the TripleStore or read back out.
 */

import { describe, it, expect } from 'vitest'
import { createTripleStore } from '@pubwiki/rdfstore'
import { LuaTable } from '@pubwiki/lua'
import { createStateModule } from '../../src/runtime/modules/rdf'

/**
 * Helper: recursively unwrap LuaTable wrappers to get the plain JS value.
 * This simulates what the Rust WASM bridge does when converting LuaTable
 * back to a native Lua table (via val_to_lua_deep).
 */
function unwrapLuaTable(v: unknown): unknown {
	if (v instanceof LuaTable) return unwrapLuaTable(v.value)
	if (Array.isArray(v)) return v.map(unwrapLuaTable)
	if (v !== null && typeof v === 'object') {
		const result: Record<string, unknown> = {}
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			result[k] = unwrapLuaTable(val)
		}
		return result
	}
	return v
}

describe('State module value round-trip', () => {
	function setup() {
		const store = createTripleStore()
		const stateModule = createStateModule(() => Promise.resolve(store))
		return { store, stateModule }
	}

	it('should store and retrieve a simple object without extra value wrapping', async () => {
		const { store, stateModule } = setup()

		const original = { name: 'Alice', age: 30 }
		await stateModule.set(null, 'entity:1', 'profile', original)

		// Raw store value should be a plain object (no LuaTable wrapper)
		const raw = store.get('entity:1', 'profile')
		expect(raw).toEqual({ name: 'Alice', age: 30 })
		// Should not be a LuaTable instance
		expect(raw).not.toBeInstanceOf(LuaTable)

		// State module get() wraps in LuaTable for Lua consumption
		const luaResult = await stateModule.get(null, 'entity:1', 'profile')
		expect(luaResult).toBeInstanceOf(LuaTable)

		// After unwrapping LuaTable, the structure should match the original
		const unwrapped = unwrapLuaTable(luaResult)
		expect(unwrapped).toEqual(original)
	})

	it('should store and retrieve nested objects without extra value wrapping', async () => {
		const { store, stateModule } = setup()

		const region = {
			locations: [
				{ id: 'loc_1', name: '书店内部', description: '高高低低的书架' },
				{ id: 'loc_2', name: '后花园', description: '安静的角落' },
			],
		}

		await stateModule.set(null, 'Region', 'locations', region)

		// Raw store value: no { value: ... } wrapping at any level
		const raw = store.get('Region', 'locations')
		expect(raw).toEqual(region)

		// Verify the array items are plain objects, NOT { value: { id, name, ... } }
		const rawObj = raw as Record<string, unknown>
		const locations = rawObj.locations as unknown[]
		expect(locations[0]).toEqual({ id: 'loc_1', name: '书店内部', description: '高高低低的书架' })
		expect(locations[0]).not.toHaveProperty('value')

		// State module get() returns LuaTable, but unwrapped structure matches
		const luaResult = await stateModule.get(null, 'Region', 'locations')
		const unwrapped = unwrapLuaTable(luaResult)
		expect(unwrapped).toEqual(region)
	})

	it('should not have value wrapping in serialized triples', async () => {
		const { store, stateModule } = setup()

		const region = {
			locations: [
				{ id: 'loc_paper_moon_interior', name: '书店内部', description: '布置得像个迷宫' },
			],
		}

		await stateModule.set(null, 'Region', 'locations', region)

		// Serialize all triples (as would happen for cloud save)
		const allTriples = store.getAll()
		const serialized = JSON.stringify(allTriples)
		const parsed = JSON.parse(serialized) as Array<{ object: unknown }>

		// The serialized object should not contain extra "value" wrappers
		const tripleObj = parsed[0].object as Record<string, unknown>
		const locations = tripleObj.locations as unknown[]
		expect(locations[0]).toEqual({
			id: 'loc_paper_moon_interior',
			name: '书店内部',
			description: '布置得像个迷宫',
		})
		// This is the bug pattern the user reported — extra "value" wrapping
		expect(locations[0]).not.toHaveProperty('value')
	})

	it('should handle deeply nested structures correctly', async () => {
		const { store, stateModule } = setup()

		const deepValue = {
			level1: {
				level2: {
					level3: [1, 2, { key: 'deep' }],
				},
			},
		}

		await stateModule.set(null, 'test', 'deep', deepValue)

		const raw = store.get('test', 'deep')
		expect(raw).toEqual(deepValue)

		// Verify no intermediate level has a "value" property that wraps the real data
		const rawObj = raw as Record<string, unknown>
		expect(rawObj).not.toHaveProperty('value')
		expect((rawObj.level1 as Record<string, unknown>)).not.toHaveProperty('value')
	})

	it('round-trip: get then set should not accumulate value wrappers', async () => {
		const { store, stateModule } = setup()

		const original = {
			locations: [
				{ id: 'loc_1', name: 'Place A' },
				{ id: 'loc_2', name: 'Place B' },
			],
		}

		// Write original
		await stateModule.set(null, 'Region', 'data', original)

		// Read via state module (returns LuaTable-wrapped)
		const luaResult = await stateModule.get(null, 'Region', 'data')

		// Simulate what happens when Lua passes this back through the WASM bridge:
		// The Rust side would call lua_to_val which converts Lua tables to plain JS objects.
		// But in pure JS tests, we simulate the worst case: what if the LuaTable
		// object is passed directly back to set() without unwrapping?
		await stateModule.set(null, 'Region', 'data_copy', luaResult)

		// Check what got stored — this is the potential bug
		const rawCopy = store.get('Region', 'data_copy')
		const serialized = JSON.stringify(rawCopy)

		// If LuaTable is stored as-is, the serialized form will have { value: ... }
		// wrapping because LuaTable has a `value` property
		const parsed = JSON.parse(serialized)

		// This test documents the current behavior.
		// If this FAILS (parsed has extra "value" wrapping), that confirms the bug.
		// The fix would be to unwrap LuaTable in the write path.
		expect(parsed).toEqual(original)
	})

	it('valueToLua should preserve array vs object distinction for Rust val_to_lua_deep', async () => {
		const { stateModule } = setup()

		const data = {
			items: [
				{ id: 'a', tags: ['x', 'y'] },
				{ id: 'b', tags: ['z'] },
			],
			meta: { count: 2 },
		}

		await stateModule.set(null, 'test', 'data', data)
		const luaResult = await stateModule.get(null, 'test', 'data')

		// Top-level should be LuaTable
		expect(luaResult).toBeInstanceOf(LuaTable)

		// Inner value should be plain JS — arrays stay arrays, objects stay objects
		const inner = (luaResult as LuaTable<unknown>).value as Record<string, unknown>
		expect(Array.isArray(inner.items)).toBe(true)

		const items = inner.items as Array<Record<string, unknown>>
		expect(typeof items[0]).toBe('object')
		expect(Array.isArray(items[0])).toBe(false)
		expect(Array.isArray(items[0].tags)).toBe(true)
		expect(items[0].tags).toEqual(['x', 'y'])

		expect(typeof inner.meta).toBe('object')
		expect(Array.isArray(inner.meta)).toBe(false)

		// Nested values should NOT be LuaTable instances
		expect(inner.items).not.toBeInstanceOf(LuaTable)
		expect(items[0]).not.toBeInstanceOf(LuaTable)
		expect(items[0].tags).not.toBeInstanceOf(LuaTable)
		expect(inner.meta).not.toBeInstanceOf(LuaTable)
	})

	it('match() should not double-wrap object values in LuaTable', async () => {
		const { stateModule } = setup()

		const data = {
			custom_components: [
				{ id: 'comp_1', type: 'button' },
				{ id: 'comp_2', type: 'label' },
			],
		}

		await stateModule.set(null, 'entity:1', 'ui', data)

		const matchResult = await stateModule.match(null, { subject: 'entity:1', predicate: 'ui' })
		expect(matchResult).toBeInstanceOf(LuaTable)

		// The outer LuaTable wraps an array of triple objects
		const triples = (matchResult as LuaTable<unknown[]>).value
		expect(triples).toHaveLength(1)

		const triple = triples[0] as Record<string, unknown>
		expect(triple.subject).toBe('entity:1')
		expect(triple.predicate).toBe('ui')

		// The object field should be a plain JS value, NOT a LuaTable
		// (val_to_lua_deep handles it correctly via the outer LuaTable)
		const obj = triple.object
		expect(obj).not.toBeInstanceOf(LuaTable)

		// The plain object should preserve array vs object distinction
		const objRecord = obj as Record<string, unknown>
		expect(Array.isArray(objRecord.custom_components)).toBe(true)
		expect(objRecord.custom_components).not.toHaveProperty('value')

		const components = objRecord.custom_components as Array<Record<string, unknown>>
		expect(components[0]).toEqual({ id: 'comp_1', type: 'button' })
		expect(components[0]).not.toHaveProperty('value')
	})
})
