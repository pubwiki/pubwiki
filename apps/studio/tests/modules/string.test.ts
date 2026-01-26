/**
 * String Module Integration Tests
 * 
 * Tests for the string JS module that provides UTF-8 aware string methods to Lua.
 * Uses patch mode to override Lua's built-in string methods.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, createLuaInstance, type LuaInstance } from '@pubwiki/lua'
import { createStringModule } from '$lib/loader/modules/string'

describe('String Module (Integration)', () => {
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    instance = createLuaInstance()
    // Use 'patch' mode to override Lua's built-in string table
    instance.registerJsModule('string', createStringModule(), { mode: 'patch' })
  })

  afterEach(() => {
    instance.destroy()
  })

  describe('string.len', () => {
    it('should count UTF-8 characters, not bytes', async () => {
      const result = await instance.run('return string.len("你好世界")')
      expect(result.result).toBe(4)
      expect(result.error).toBeNull()
    })

    it('should work with ASCII strings', async () => {
      const result = await instance.run('return string.len("hello")')
      expect(result.result).toBe(5)
    })

    it('should handle empty string', async () => {
      const result = await instance.run('return string.len("")')
      expect(result.result).toBe(0)
    })

    it('should handle emoji', async () => {
      const result = await instance.run('return string.len("👋🌍")')
      expect(result.result).toBe(2)
    })

    it('should work with method call syntax', async () => {
      const result = await instance.run('return ("你好"):len()')
      expect(result.result).toBe(2)
    })
  })

  describe('string.sub', () => {
    it('should extract substring with positive indices', async () => {
      const result = await instance.run('return string.sub("你好世界", 1, 2)')
      expect(result.result).toBe('你好')
    })

    it('should handle negative indices', async () => {
      const result = await instance.run('return string.sub("你好世界", -2, -1)')
      expect(result.result).toBe('世界')
    })

    it('should handle mixed positive and negative indices', async () => {
      const result = await instance.run('return string.sub("你好世界", 2, -2)')
      expect(result.result).toBe('好世')
    })

    it('should handle negative start only', async () => {
      const result = await instance.run('return string.sub("你好世界", -3)')
      expect(result.result).toBe('好世界')
    })

    it('should work with method call syntax', async () => {
      const result = await instance.run('return ("你好世界"):sub(1, 2)')
      expect(result.result).toBe('你好')
    })
  })

  describe('string.reverse', () => {
    it('should reverse UTF-8 string', async () => {
      const result = await instance.run('return string.reverse("你好")')
      expect(result.result).toBe('好你')
    })

    it('should reverse ASCII string', async () => {
      const result = await instance.run('return string.reverse("hello")')
      expect(result.result).toBe('olleh')
    })
  })

  describe('string.upper/lower', () => {
    it('should convert to uppercase', async () => {
      const result = await instance.run('return string.upper("hello")')
      expect(result.result).toBe('HELLO')
    })

    it('should convert to lowercase', async () => {
      const result = await instance.run('return string.lower("WORLD")')
      expect(result.result).toBe('world')
    })

    it('should handle mixed content', async () => {
      const result = await instance.run('return string.upper("hello你好")')
      expect(result.result).toBe('HELLO你好')
    })
  })

  describe('string.byte', () => {
    it('should return Unicode codepoints', async () => {
      const result = await instance.run('return string.byte("ABC", 1, 3)')
      expect(result.result).toEqual([65, 66, 67])
    })

    it('should return codepoint of Chinese character', async () => {
      const result = await instance.run('return string.byte("你", 1, 1)')
      expect(result.result).toEqual([0x4F60]) // 你 = U+4F60
    })
  })

  describe('string.char', () => {
    it('should create string from ASCII codepoints', async () => {
      const result = await instance.run('return string.char(65, 66, 67)')
      expect(result.result).toBe('ABC')
    })

    it('should create string from Unicode codepoints', async () => {
      const result = await instance.run('return string.char(0x4F60, 0x597D)')
      expect(result.result).toBe('你好')
    })
  })

  describe('string.find', () => {
    it('should find pattern and return 1-based indices', async () => {
      const result = await instance.run(`
        local start, finish = string.find("hello world", "world")
        return {start, finish}
      `)
      expect(result.result).toEqual([[7, 11]])
    })

    it('should return nil when not found', async () => {
      const result = await instance.run(`
        local start, finish = string.find("hello", "xyz")
        return {start, finish}
      `)
      expect(result.result).toEqual([[null, null]])
    })

    it('should work with UTF-8 strings and regex', async () => {
      const result = await instance.run(`
        local start, finish = string.find("你好world世界", "[a-z]+")
        return {start, finish}
      `)
      expect(result.result).toEqual([[3, 7]])
    })
  })

  describe('string.match', () => {
    it('should return captured groups', async () => {
      // Use simpler character class to avoid escape issues
      const result = await instance.run(`
        return string.match("hello world", "([a-z]+) ([a-z]+)")
      `)
      expect(result.result).toEqual(['hello', 'world'])
    })

    it('should return full match if no captures', async () => {
      const result = await instance.run(`
        return string.match("hello", "[a-z]+")
      `)
      expect(result.result).toEqual(['hello'])
    })
  })

  describe('string.gsub', () => {
    it('should replace with string', async () => {
      const result = await instance.run(`
        local res, count = string.gsub("hello world", "o", "0")
        return {res, count}
      `)
      expect(result.result).toEqual([['hell0 w0rld', 2]])
    })

    it('should limit replacements with n parameter', async () => {
      const result = await instance.run(`
        local res, count = string.gsub("hello world", "o", "0", 1)
        return {res, count}
      `)
      expect(result.result).toEqual([['hell0 world', 1]])
    })
  })

  describe('string.rep', () => {
    it('should repeat string n times', async () => {
      const result = await instance.run('return string.rep("ab", 3)')
      expect(result.result).toBe('ababab')
    })

    it('should support separator', async () => {
      const result = await instance.run('return string.rep("ab", 3, ",")')
      expect(result.result).toBe('ab,ab,ab')
    })

    it('should return empty for n <= 0', async () => {
      const result = await instance.run('return string.rep("ab", 0)')
      expect(result.result).toBe('')
    })
  })

  describe('string.format', () => {
    it('should format %s as string', async () => {
      const result = await instance.run('return string.format("hello %s", "world")')
      expect(result.result).toBe('hello world')
    })

    it('should format %d as integer', async () => {
      const result = await instance.run('return string.format("count: %d", 42)')
      expect(result.result).toBe('count: 42')
    })

    it('should escape %%', async () => {
      const result = await instance.run('return string.format("100%%")')
      expect(result.result).toBe('100%')
    })
  })
})
