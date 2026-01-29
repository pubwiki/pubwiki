/**
 * LuaBackend Schema Coercion Integration Tests
 * 
 * Tests that verify schema-based type coercion works correctly
 * with real Lua services returning data through callService and streamService.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner } from '@pubwiki/lua'
import { createVfs, type VfsProvider, type VfsStat, type Vfs } from '@pubwiki/vfs'
import { LuaBackend } from '$lib/loader/backends/lua'
import type { BackendConfig } from '$lib/loader/types'

// ============================================================================
// In-memory VFS for testing
// ============================================================================

class MemoryVfsProvider implements VfsProvider {
	private files = new Map<string, Uint8Array>()
	private directories = new Set<string>(['/'])
	private encoder = new TextEncoder()

	private normalizePath(path: string): string {
		if (!path.startsWith('/')) path = '/' + path
		if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)
		return path
	}

	async id(path: string): Promise<string> {
		return this.normalizePath(path)
	}

	async readFile(path: string): Promise<Uint8Array> {
		const normalized = this.normalizePath(path)
		const content = this.files.get(normalized)
		if (!content) throw new Error(`ENOENT: ${normalized}`)
		return content
	}

	async writeFile(path: string, content: Uint8Array): Promise<void> {
		const normalized = this.normalizePath(path)
		this.files.set(normalized, content)
	}

	async unlink(path: string): Promise<void> {
		this.files.delete(this.normalizePath(path))
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		this.directories.add(this.normalizePath(path))
	}

	async readdir(path: string): Promise<string[]> {
		return []
	}

	async rmdir(path: string): Promise<void> {
		this.directories.delete(this.normalizePath(path))
	}

	async stat(path: string): Promise<VfsStat> {
		const normalized = this.normalizePath(path)
		const now = new Date()
		if (this.files.has(normalized)) {
			return { isFile: true, isDirectory: false, size: this.files.get(normalized)!.length, createdAt: now, updatedAt: now }
		}
		if (this.directories.has(normalized)) {
			return { isFile: false, isDirectory: true, size: 0, createdAt: now, updatedAt: now }
		}
		throw new Error(`ENOENT: ${normalized}`)
	}

	async exists(path: string): Promise<boolean> {
		const normalized = this.normalizePath(path)
		return this.files.has(normalized) || this.directories.has(normalized)
	}

	async rename(from: string, to: string): Promise<void> {
		const content = this.files.get(this.normalizePath(from))
		if (content) {
			this.files.delete(this.normalizePath(from))
			this.files.set(this.normalizePath(to), content)
		}
	}

	async copyFile(from: string, to: string): Promise<void> {
		const content = this.files.get(this.normalizePath(from))
		if (content) {
			this.files.set(this.normalizePath(to), new Uint8Array(content))
		}
	}

	createFile(path: string, content: string): void {
		this.writeFile(path, this.encoder.encode(content))
	}
}

function createMemoryVfs(): Vfs<MemoryVfsProvider> {
	return createVfs(new MemoryVfsProvider())
}

// ============================================================================
// Test Suite
// ============================================================================

describe('LuaBackend Schema Coercion Integration', () => {
	let backend: LuaBackend
	let backendVfs: Vfs<MemoryVfsProvider>

	beforeAll(async () => {
		await loadRunner()
	})

	beforeEach(() => {
		backend = new LuaBackend()
		backendVfs = createMemoryVfs()
	})

	afterEach(async () => {
		await backend.destroy()
	})

	async function initWithLuaCode(initCode: string): Promise<void> {
		backendVfs.getProvider().createFile('/init.lua', initCode)
		
		const config: BackendConfig = {
			backendVfs,
			assetMounts: new Map(),
			jsModules: new Map()
		}
		
		const result = await backend.initialize(config)
		if (!result.success) {
			throw new Error(`Failed to initialize: ${result.error}`)
		}
	}

	describe('callService with array outputs', () => {
		it('should coerce empty Lua table to empty array when schema expects array', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("emptyArray")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						items = Type.Array(Type.String)
					}))
					:impl(function(inputs)
						return { items = {} }  -- Empty Lua table
					end)
			`)

			// Refresh schema cache
			await backend.listServices()

			const result = await backend.callService('test:emptyArray', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs).toBeDefined()
			expect(result.outputs!.items).toEqual([])
			expect(Array.isArray(result.outputs!.items)).toBe(true)
		})

		it('should coerce Lua array-like table to array', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("numberedArray")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						numbers = Type.Array(Type.Int)
					}))
					:impl(function(inputs)
						return { numbers = {10, 20, 30} }
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:numberedArray', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs!.numbers).toEqual([10, 20, 30])
			expect(Array.isArray(result.outputs!.numbers)).toBe(true)
		})

		it('should coerce nested empty tables to nested empty arrays', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("nestedArrays")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						matrix = Type.Array(Type.Array(Type.Int))
					}))
					:impl(function(inputs)
						return { matrix = { {}, {1, 2}, {} } }
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:nestedArrays', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs!.matrix).toEqual([[], [1, 2], []])
			expect(Array.isArray(result.outputs!.matrix)).toBe(true)
			expect(Array.isArray((result.outputs!.matrix as unknown[])[0])).toBe(true)
		})

		it('should coerce object with array property', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("objectWithArray")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						data = Type.Object({
							tags = Type.Array(Type.String),
							count = Type.Int
						})
					}))
					:impl(function(inputs)
						return { 
							data = { 
								tags = {},
								count = 0
							} 
						}
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:objectWithArray', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs!.data).toEqual({ tags: [], count: 0 })
			expect(Array.isArray((result.outputs!.data as Record<string, unknown>).tags)).toBe(true)
		})
	})

	describe('callService with optional types', () => {
		it('should handle optional array that is empty', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("optionalArray")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						items = Type.Optional(Type.Array(Type.String))
					}))
					:impl(function(inputs)
						return { items = {} }
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:optionalArray', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs!.items).toEqual([])
			expect(Array.isArray(result.outputs!.items)).toBe(true)
		})

		it('should handle optional array that is nil', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("nilOptional")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						items = Type.Optional(Type.Array(Type.String))
					}))
					:impl(function(inputs)
						return { items = nil }
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:nilOptional', {})
			
			expect(result.success).toBe(true)
			// nil should remain nil/undefined
			expect(result.outputs!.items).toBeUndefined()
		})
	})

	describe('callService preserves non-array types', () => {
		it('should not modify object outputs', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("objectOutput")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						data = Type.Object({
							name = Type.String,
							value = Type.Int
						})
					}))
					:impl(function(inputs)
						return { data = { name = "test", value = 42 } }
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:objectOutput', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs!.data).toEqual({ name: "test", value: 42 })
		})

		it('should not modify primitive outputs', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("primitiveOutput")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						text = Type.String,
						number = Type.Int,
						flag = Type.Bool
					}))
					:impl(function(inputs)
						return { text = "hello", number = 123, flag = true }
					end)
			`)

			await backend.listServices()

			const result = await backend.callService('test:primitiveOutput', {})
			
			expect(result.success).toBe(true)
			expect(result.outputs).toEqual({ text: "hello", number: 123, flag: true })
		})
	})

	describe('streamService with coercion', () => {
		it('should coerce each yielded value according to schema', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("streamWithArrays")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						iterator = Type.Function({
							returns = Type.Object({
								items = Type.Array(Type.Int)
							})
						})
					}))
					:impl(function(inputs)
						local index = 0
						return function()
							index = index + 1
							if index <= 3 then
								-- Each yield contains an empty table that should become []
								if index == 1 then
									return { items = {} }
								elseif index == 2 then
									return { items = {1, 2} }
								else
									return { items = {} }
								end
							end
							return nil
						end
					end)
			`)

			await backend.listServices()

			const received: unknown[] = []
            //@ts-ignore
			await backend.streamService('test:streamWithArrays', {}, async (value) => {
				received.push(value)
			})

			expect(received).toHaveLength(3)
			expect(received[0]).toEqual({ items: [] })
			expect(received[1]).toEqual({ items: [1, 2] })
			expect(received[2]).toEqual({ items: [] })
			
			// Verify arrays are actual arrays
			expect(Array.isArray((received[0] as Record<string, unknown>).items)).toBe(true)
			expect(Array.isArray((received[1] as Record<string, unknown>).items)).toBe(true)
			expect(Array.isArray((received[2] as Record<string, unknown>).items)).toBe(true)
		})
	})

	describe('service without schema caching', () => {
		it('should still work if listServices was not called (no coercion)', async () => {
			await initWithLuaCode(`
				local ServiceRegistry = require("core/service")
				local Type = ServiceRegistry.Type

				ServiceRegistry:definePure()
					:namespace("test")
					:name("noCache")
					:inputs(Type.Object({}))
					:outputs(Type.Object({
						items = Type.Array(Type.String)
					}))
					:impl(function(inputs)
						return { items = {} }
					end)
			`)

			// Intentionally NOT calling listServices() to skip schema caching
			const result = await backend.callService('test:noCache', {})
			
			expect(result.success).toBe(true)
			// Without schema cache, empty table remains as empty object
			expect(result.outputs!.items).toEqual({})
		})
	})
})
