/**
 * JSON Module Tests
 * 
 * Tests for the json JS module that provides JSON encode/decode capabilities to Lua.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, createLuaInstance, type LuaInstance } from '@pubwiki/lua'
import { createJsonModule } from '$lib/loader/modules'

describe('JSON Module', () => {
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    instance = createLuaInstance()
    instance.registerJsModule('json', createJsonModule(), { mode: 'global' })
  })

  afterEach(() => {
    instance.destroy()
  })

  describe('json.encode', () => {
    it('should encode nil as null', async () => {
      const result = await instance.run('return json.encode(nil)')
      expect(result.result).toBe('null')
      expect(result.error).toBeNull()
    })

    it('should encode boolean values', async () => {
      const resultTrue = await instance.run('return json.encode(true)')
      expect(resultTrue.result).toBe('true')

      const resultFalse = await instance.run('return json.encode(false)')
      expect(resultFalse.result).toBe('false')
    })

    it('should encode integer numbers', async () => {
      const result = await instance.run('return json.encode(42)')
      expect(result.result).toBe('42')
    })

    it('should encode floating point numbers', async () => {
      const result = await instance.run('return json.encode(3.14)')
      expect(JSON.parse(result.result as string)).toBeCloseTo(3.14)
    })

    it('should encode strings', async () => {
      const result = await instance.run('return json.encode("hello world")')
      expect(result.result).toBe('"hello world"')
    })

    it('should encode strings with special characters', async () => {
      const result = await instance.run('return json.encode("hello\\nworld")')
      expect(JSON.parse(result.result as string)).toBe('hello\nworld')
    })

    it('should encode arrays (sequential integer keys from 1)', async () => {
      const result = await instance.run('return json.encode({1, 2, 3})')
      expect(JSON.parse(result.result as string)).toEqual([1, 2, 3])
    })

    it('should encode objects (string keys)', async () => {
      const result = await instance.run('return json.encode({name = "Alice", age = 30})')
      const parsed = JSON.parse(result.result as string)
      expect(parsed.name).toBe('Alice')
      expect(parsed.age).toBe(30)
    })

    it('should encode nested structures', async () => {
      const result = await instance.run(`
        local data = {
          name = "test",
          items = {1, 2, 3},
          nested = {
            foo = "bar"
          }
        }
        return json.encode(data)
      `)
      const parsed = JSON.parse(result.result as string)
      expect(parsed.name).toBe('test')
      expect(parsed.items).toEqual([1, 2, 3])
      expect(parsed.nested.foo).toBe('bar')
    })

    it('should encode empty table as empty object', async () => {
      // Empty Lua table {} is converted to empty JS object, then JSON "{}"
      const result = await instance.run('return json.encode({})')
      expect(result.result).toBe('{}')
    })

    it('should encode mixed arrays as objects', async () => {
      const result = await instance.run('return json.encode({foo = "bar", baz = 123})')
      const parsed = JSON.parse(result.result as string)
      expect(parsed.foo).toBe('bar')
      expect(parsed.baz).toBe(123)
    })

    it('should error on encoding functions', async () => {
      const result = await instance.run('return json.encode(function() end)')
      expect(result.error).toBeTruthy()
    })
  })

  describe('json.decode', () => {
    it('should decode null to nil', async () => {
      const result = await instance.run('return json.decode("null")')
      expect(result.result).toBeNull()
      expect(result.error).toBeNull()
    })

    it('should decode boolean values', async () => {
      const resultTrue = await instance.run('return json.decode("true")')
      expect(resultTrue.result).toBe(true)

      const resultFalse = await instance.run('return json.decode("false")')
      expect(resultFalse.result).toBe(false)
    })

    it('should decode integer numbers', async () => {
      const result = await instance.run('return json.decode("42")')
      expect(result.result).toBe(42)
    })

    it('should decode floating point numbers', async () => {
      const result = await instance.run('return json.decode("3.14")')
      expect(result.result).toBeCloseTo(3.14)
    })

    it('should decode strings', async () => {
      const result = await instance.run('return json.decode(\'"hello world"\')')
      expect(result.result).toBe('hello world')
    })

    it('should decode arrays', async () => {
      const result = await instance.run(`
        local arr = json.decode('[1, 2, 3]')
        return {arr[1], arr[2], arr[3]}
      `)
      expect(result.result).toEqual([1, 2, 3])
    })

    it('should decode objects', async () => {
      const result = await instance.run(`
        local obj = json.decode('{"name": "Alice", "age": 30}')
        return {obj.name, obj.age}
      `)
      expect(result.result).toEqual(['Alice', 30])
    })

    it('should decode nested structures', async () => {
      const result = await instance.run(`
        local data = json.decode('{"items": [1, 2, 3], "nested": {"foo": "bar"}}')
        return {data.items[1], data.items[2], data.nested.foo}
      `)
      expect(result.result).toEqual([1, 2, 'bar'])
    })

    it('should decode empty array', async () => {
      const result = await instance.run(`
        local arr = json.decode('[]')
        return #arr
      `)
      expect(result.result).toBe(0)
    })

    it('should decode empty object', async () => {
      const result = await instance.run(`
        local obj = json.decode('{}')
        local count = 0
        for _ in pairs(obj) do count = count + 1 end
        return count
      `)
      expect(result.result).toBe(0)
    })

    it('should error on invalid JSON', async () => {
      const result = await instance.run('return json.decode("invalid json")')
      expect(result.error).toBeTruthy()
    })

    it('should error on truncated JSON', async () => {
      const result = await instance.run('return json.decode(\'{"incomplete":\')')
      expect(result.error).toBeTruthy()
    })
  })

  describe('json roundtrip', () => {
    it('should roundtrip simple values', async () => {
      const result = await instance.run(`
        local original = 42
        local encoded = json.encode(original)
        local decoded = json.decode(encoded)
        return decoded
      `)
      expect(result.result).toBe(42)
    })

    it('should roundtrip complex structures', async () => {
      const result = await instance.run(`
        local original = {
          name = "test",
          count = 100,
          active = true,
          tags = {"lua", "json", "test"}
        }
        local encoded = json.encode(original)
        local decoded = json.decode(encoded)
        return {decoded.name, decoded.count, decoded.active, decoded.tags[1], decoded.tags[3]}
      `)
      expect(result.result).toEqual(['test', 100, true, 'lua', 'test'])
    })

    it('should roundtrip UTF-8 strings', async () => {
      const result = await instance.run(`
        local original = "你好世界 🌍"
        local encoded = json.encode(original)
        local decoded = json.decode(encoded)
        return decoded
      `)
      expect(result.result).toBe('你好世界 🌍')
    })
  })
})
