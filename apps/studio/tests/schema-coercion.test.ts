/**
 * Schema Coercion Tests
 * 
 * Tests for the schema-based type coercion functions that handle
 * Lua empty table ambiguity (empty object vs empty array).
 */

import { describe, it, expect } from 'vitest'
import { 
	coerceToSchema, 
	coerceOutputs, 
	getIteratorYieldSchema 
} from '@pubwiki/flow-core'
import type { JsonSchema } from '@pubwiki/sandbox-host'

describe('coerceToSchema', () => {
	describe('null and undefined handling', () => {
		it('should return null as-is', () => {
			const schema: JsonSchema = { type: 'string' }
			expect(coerceToSchema(null, schema)).toBeNull()
		})

		it('should return undefined as-is', () => {
			const schema: JsonSchema = { type: 'string' }
			expect(coerceToSchema(undefined, schema)).toBeUndefined()
		})
	})

	describe('array type coercion', () => {
		it('should convert empty object to empty array when schema expects array', () => {
			const schema: JsonSchema = { type: 'array', items: { type: 'string' } }
			const result = coerceToSchema({}, schema)
			expect(result).toEqual([])
			expect(Array.isArray(result)).toBe(true)
		})

		it('should keep existing array unchanged', () => {
			const schema: JsonSchema = { type: 'array', items: { type: 'number' } }
			const input = [1, 2, 3]
			const result = coerceToSchema(input, schema)
			expect(result).toEqual([1, 2, 3])
		})

		it('should convert Lua numeric-keyed object to array', () => {
			const schema: JsonSchema = { type: 'array', items: { type: 'string' } }
			// Lua arrays come as objects with numeric string keys
			const luaArray = { '1': 'a', '2': 'b', '3': 'c' }
			const result = coerceToSchema(luaArray, schema)
			expect(result).toEqual(['a', 'b', 'c'])
		})

		it('should recursively coerce array items', () => {
			const schema: JsonSchema = { 
				type: 'array', 
				items: { 
					type: 'array', 
					items: { type: 'number' } 
				} 
			}
			// Nested empty tables from Lua
			const input = [{}, { '1': 1, '2': 2 }]
			const result = coerceToSchema(input, schema)
			expect(result).toEqual([[], [1, 2]])
		})

		it('should not convert object with non-numeric keys to array', () => {
			const schema: JsonSchema = { type: 'array', items: { type: 'string' } }
			const input = { 'name': 'test', 'value': 'data' }
			const result = coerceToSchema(input, schema)
			// Cannot convert, returns as-is
			expect(result).toEqual({ 'name': 'test', 'value': 'data' })
		})
	})

	describe('object type coercion', () => {
		it('should recursively coerce object properties', () => {
			const schema: JsonSchema = {
				type: 'object',
				properties: {
					items: { type: 'array', items: { type: 'string' } },
					name: { type: 'string' }
				}
			}
			const input = { items: {}, name: 'test' }
			const result = coerceToSchema(input, schema)
			expect(result).toEqual({ items: [], name: 'test' })
		})

		it('should preserve additional properties not in schema', () => {
			const schema: JsonSchema = {
				type: 'object',
				properties: {
					known: { type: 'string' }
				}
			}
			const input = { known: 'value', extra: 'data' }
			const result = coerceToSchema(input, schema)
			expect(result).toEqual({ known: 'value', extra: 'data' })
		})

		it('should handle nested objects with arrays', () => {
			const schema: JsonSchema = {
				type: 'object',
				properties: {
					data: {
						type: 'object',
						properties: {
							list: { type: 'array', items: { type: 'number' } }
						}
					}
				}
			}
			const input = { data: { list: {} } }
			const result = coerceToSchema(input, schema)
			expect(result).toEqual({ data: { list: [] } })
		})
	})

	describe('oneOf handling', () => {
		it('should skip null type in oneOf and use first non-null schema', () => {
			const schema: JsonSchema = {
				oneOf: [
					{ type: 'null' },
					{ type: 'array', items: { type: 'string' } }
				]
			}
			const input = {}
			const result = coerceToSchema(input, schema)
			expect(result).toEqual([])
		})

		it('should coerce using first valid option in oneOf', () => {
			const schema: JsonSchema = {
				oneOf: [
					{ type: 'array', items: { type: 'number' } },
					{ type: 'object' }
				]
			}
			const input = {}
			const result = coerceToSchema(input, schema)
			expect(result).toEqual([])
		})
	})

	describe('anyOf handling', () => {
		it('should skip null type in anyOf and use first non-null schema', () => {
			const schema: JsonSchema = {
				anyOf: [
					{ type: 'null' },
					{ type: 'array', items: { type: 'string' } }
				]
			}
			const input = {}
			const result = coerceToSchema(input, schema)
			expect(result).toEqual([])
		})
	})

	describe('primitive types', () => {
		it('should return primitives unchanged', () => {
			expect(coerceToSchema('hello', { type: 'string' })).toBe('hello')
			expect(coerceToSchema(42, { type: 'number' })).toBe(42)
			expect(coerceToSchema(true, { type: 'boolean' })).toBe(true)
		})
	})
})

describe('coerceOutputs', () => {
	it('should coerce all output properties according to schema', () => {
		const outputSchema: JsonSchema = {
			type: 'object',
			properties: {
				items: { type: 'array', items: { type: 'string' } },
				count: { type: 'number' }
			}
		}
		const outputs = { items: {}, count: 5 }
		const result = coerceOutputs(outputs, outputSchema)
		expect(result).toEqual({ items: [], count: 5 })
	})

	it('should return outputs unchanged if no properties in schema', () => {
		const outputSchema: JsonSchema = { type: 'object' }
		const outputs = { items: {}, count: 5 }
		const result = coerceOutputs(outputs, outputSchema)
		expect(result).toEqual({ items: {}, count: 5 })
	})

	it('should preserve properties not in schema', () => {
		const outputSchema: JsonSchema = {
			type: 'object',
			properties: {
				known: { type: 'array', items: { type: 'number' } }
			}
		}
		const outputs = { known: {}, extra: 'value' }
		const result = coerceOutputs(outputs, outputSchema)
		expect(result).toEqual({ known: [], extra: 'value' })
	})
})

describe('getIteratorYieldSchema', () => {
	it('should extract yield schema from streaming service output', () => {
		const outputSchema: JsonSchema = {
			type: 'object',
			properties: {
				iterator: {
					'x-function': true,
					'x-returns': {
						type: 'object',
						properties: {
							items: { type: 'array', items: { type: 'string' } }
						}
					}
				}
			}
		}
		const yieldSchema = getIteratorYieldSchema(outputSchema)
		expect(yieldSchema).toEqual({
			type: 'object',
			properties: {
				items: { type: 'array', items: { type: 'string' } }
			}
		})
	})

	it('should return null if no properties', () => {
		const outputSchema: JsonSchema = { type: 'object' }
		expect(getIteratorYieldSchema(outputSchema)).toBeNull()
	})

	it('should return null if multiple output properties', () => {
		const outputSchema: JsonSchema = {
			type: 'object',
			properties: {
				prop1: { 'x-function': true, 'x-returns': { type: 'string' } },
				prop2: { type: 'number' }
			}
		}
		expect(getIteratorYieldSchema(outputSchema)).toBeNull()
	})

	it('should return null if property is not a function', () => {
		const outputSchema: JsonSchema = {
			type: 'object',
			properties: {
				value: { type: 'string' }
			}
		}
		expect(getIteratorYieldSchema(outputSchema)).toBeNull()
	})

	it('should return null if function has no x-returns', () => {
		const outputSchema: JsonSchema = {
			type: 'object',
			properties: {
				iterator: { 'x-function': true }
			}
		}
		expect(getIteratorYieldSchema(outputSchema)).toBeNull()
	})
})
