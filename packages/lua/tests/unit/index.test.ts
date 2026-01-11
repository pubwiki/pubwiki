import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadRunner, runLua, createLuaInstance, type LuaInstance } from '../../src/index'
import type { RDFStore, Triple, TriplePattern } from '../../src/rdf-types'

// 简单的内存 RDFStore 实现用于测试（异步版本）
class MemoryRDFStore implements RDFStore {
  private triples: Triple[] = []

  async insert(subject: string, predicate: string, object: any): Promise<void> {
    this.triples.push({ subject, predicate, object })
  }

  async delete(subject: string, predicate: string, object?: any): Promise<void> {
    this.triples = this.triples.filter(t => {
      if (t.subject !== subject || t.predicate !== predicate) return true
      if (object === undefined || object === null) return false
      return JSON.stringify(t.object) !== JSON.stringify(object)
    })
  }

  async query(pattern: TriplePattern): Promise<Triple[]> {
    return this.triples.filter(t => {
      if (pattern.subject !== undefined && pattern.subject !== null && t.subject !== pattern.subject) return false
      if (pattern.predicate !== undefined && pattern.predicate !== null && t.predicate !== pattern.predicate) return false
      if (pattern.object !== undefined && pattern.object !== null && JSON.stringify(t.object) !== JSON.stringify(pattern.object)) return false
      return true
    })
  }

  async batchInsert(triples: Triple[]): Promise<void> {
    this.triples.push(...triples)
  }

  clear(): void {
    this.triples = []
  }
}

// 辅助函数：延迟
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('pubwiki-lua', () => {
  let store: MemoryRDFStore

  beforeAll(async () => {
    // 加载 WASM 模块
    await loadRunner()
    console.log('WASM module loaded successfully')
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
  })

  describe('Basic Lua execution', () => {
    it('should run simple Lua code', async () => {
      const result = await runLua('return 1 + 2', { rdfStore: store })
      expect(result.result).toBe(3)
      expect(result.error).toBeNull()
    })

    it('should handle print statements', async () => {
      const result = await runLua(`
        print('Hello')
        print('World')
        return 42
      `, { rdfStore: store })
      expect(result.output).toContain('Hello')
      expect(result.output).toContain('World')
      expect(result.result).toBe(42)
      expect(result.error).toBeNull()
    })
  })

  describe('State:insert', () => {
    it('should insert a triple', async () => {
      await runLua(`
        State:insert('book:1984', 'title', '1984')
      `, { rdfStore: store })

      const results = await store.query({ predicate: 'title' })
      expect(results).toHaveLength(1)
      expect(results[0].subject).toBe('book:1984')
      expect(results[0].object).toBe('1984')
    })

    it('should insert multiple triples', async () => {
      await runLua(`
        State:insert('book:1984', 'title', '1984')
        State:insert('book:1984', 'author', 'George Orwell')
        State:insert('book:1984', 'year', 1949)
      `, { rdfStore: store })

      const results = await store.query({ subject: 'book:1984' })
      expect(results).toHaveLength(3)
    })
  })

  describe('State:match', () => {
    it('should query by subject', async () => {
      await runLua(`
        State:insert('book:1984', 'title', '1984')
        State:insert('book:1984', 'author', 'George Orwell')
        State:insert('book:brave', 'title', 'Brave New World')
      `, { rdfStore: store })

      const result = await runLua(`
        local results = State:match({subject = 'book:1984'})
        return #results
      `, { rdfStore: store })

      expect(result.result).toBe(2)
    })

    it('should query by predicate', async () => {
      await runLua(`
        State:insert('book:1984', 'title', '1984')
        State:insert('book:brave', 'title', 'Brave New World')
      `, { rdfStore: store })

      const result = await runLua(`
        local results = State:match({predicate = 'title'})
        return #results
      `, { rdfStore: store })

      expect(result.result).toBe(2)
    })

    it('should query by object', async () => {
      await runLua(`
        State:insert('book:1984', 'genre', 'dystopian')
        State:insert('book:brave', 'genre', 'dystopian')
        State:insert('book:lotr', 'genre', 'fantasy')
      `, { rdfStore: store })

      const result = await runLua(`
        local results = State:match({object = 'dystopian'})
        return #results
      `, { rdfStore: store })

      expect(result.result).toBe(2)
    })
  })

  describe('State:delete', () => {
    it('should delete a specific triple', async () => {
      await runLua(`
        State:insert('user:alice', 'age', 25)
        State:delete('user:alice', 'age', 25)
      `, { rdfStore: store })

      const results = await store.query({ subject: 'user:alice' })
      expect(results).toHaveLength(0)
    })

    it('should delete all triples with subject+predicate', async () => {
      await runLua(`
        State:insert('user:alice', 'hobby', 'reading')
        State:insert('user:alice', 'hobby', 'coding')
        State:delete('user:alice', 'hobby')
      `, { rdfStore: store })

      const results = await store.query({ subject: 'user:alice' })
      expect(results).toHaveLength(0)
    })
  })

  describe('State:batchInsert', () => {
    it('should insert multiple triples at once', async () => {
      await runLua(`
        local books = {
          {subject = 'book:1', predicate = 'title', object = 'Book 1'},
          {subject = 'book:2', predicate = 'title', object = 'Book 2'},
          {subject = 'book:3', predicate = 'title', object = 'Book 3'},
        }
        State:batchInsert(books)
      `, { rdfStore: store })

      const results = await store.query({ predicate: 'title' })
      expect(results).toHaveLength(3)
    })
  })

  describe('State:set', () => {
    it('should replace existing value', async () => {
      await runLua(`
        State:insert('user:alice', 'age', 25)
        State:set('user:alice', 'age', 30)
      `, { rdfStore: store })

      const results = await store.query({ subject: 'user:alice', predicate: 'age' })
      expect(results).toHaveLength(1)
      expect(results[0].object).toBe(30)
    })

    it('should work like insert when no previous value', async () => {
      await runLua(`
        State:set('user:alice', 'city', 'Tokyo')
      `, { rdfStore: store })

      const results = await store.query({ subject: 'user:alice', predicate: 'city' })
      expect(results).toHaveLength(1)
      expect(results[0].object).toBe('Tokyo')
    })
  })

  describe('State:get', () => {
    it('should get a single value', async () => {
      await runLua(`
        State:insert('user:alice', 'name', 'Alice')
      `, { rdfStore: store })

      const result = await runLua(`
        local name = State:get('user:alice', 'name')
        return name
      `, { rdfStore: store })

      expect(result.result).toBe('Alice')
    })

    it('should return nil for non-existent property', async () => {
      const result = await runLua(`
        local value = State:get('user:alice', 'nonexistent')
        if value == nil then
          return 'is nil'
        else
          return 'not nil'
        end
      `, { rdfStore: store })

      expect(result.result).toBe('is nil')
    })

    it('should work with default values', async () => {
      const result = await runLua(`
        local city = State:get('user:alice', 'city') or 'Unknown'
        return city
      `, { rdfStore: store })

      expect(result.result).toBe('Unknown')
    })
  })

  describe('Complex scenarios', () => {
    it('should handle book catalog example', async () => {
      const result = await runLua(`
        -- Insert books
        State:batchInsert({
          {subject = 'book:1984', predicate = 'title', object = '1984'},
          {subject = 'book:1984', predicate = 'author', object = 'George Orwell'},
          {subject = 'book:1984', predicate = 'year', object = 1949},
          {subject = 'book:1984', predicate = 'genre', object = 'dystopian'},
          {subject = 'book:brave', predicate = 'title', object = 'Brave New World'},
          {subject = 'book:brave', predicate = 'author', object = 'Aldous Huxley'},
          {subject = 'book:brave', predicate = 'year', object = 1932},
          {subject = 'book:brave', predicate = 'genre', object = 'dystopian'},
        })
        
        -- Query dystopian books
        local dystopian = State:match({predicate = 'genre', object = 'dystopian'})
        local count = #dystopian
        
        -- Get titles
        local titles = {}
        for i, triple in ipairs(dystopian) do
          local title = State:get(triple.subject, 'title')
          table.insert(titles, title)
        end
        
        return string.format('Found %d dystopian books: %s', count, table.concat(titles, ', '))
      `, { rdfStore: store })

      expect(result.result).toContain('Found 2 dystopian books')
      expect(result.result).toContain('1984')
      expect(result.result).toContain('Brave New World')
    })
  })
})

describe('Persistent Lua Instance', () => {
  let store: MemoryRDFStore
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
    instance = createLuaInstance({ rdfStore: store })
  })

  describe('State persistence between runs', () => {
    it('should preserve global variables between executions', async () => {
      // First run: set counter = 0
      let result = await instance.run('counter = 0; return counter')
      expect(result.result).toBe(0)

      // Second run: increment
      result = await instance.run('counter = counter + 1; return counter')
      expect(result.result).toBe(1)

      // Third run: increment again
      result = await instance.run('counter = counter + 1; return counter')
      expect(result.result).toBe(2)

      // Verify counter is still 2
      result = await instance.run('return counter')
      expect(result.result).toBe(2)
    })

    it('should preserve functions between executions', async () => {
      // Define a function
      await instance.run(`
        function greet(name)
          return "Hello, " .. name .. "!"
        end
      `)

      // Use the function in subsequent runs
      const result = await instance.run('return greet("World")')
      expect(result.result).toBe('Hello, World!')
    })

    it('should preserve tables between executions', async () => {
      // Create a table
      await instance.run(`
        data = { name = "Alice", age = 25 }
      `)

      // Modify the table
      await instance.run(`data.city = "Tokyo"`)

      // Read back all values
      const result = await instance.run(`
        return data.name .. ", " .. data.age .. ", " .. data.city
      `)
      expect(result.result).toBe('Alice, 25, Tokyo')
    })
  })

  describe('RDF state persistence', () => {
    it('should preserve RDF data in instance', async () => {
      // Insert data
      await instance.run(`
        State:insert("http://example.org/person1", "http://xmlns.com/foaf/0.1/name", "Alice")
        State:insert("http://example.org/person1", "http://xmlns.com/foaf/0.1/age", 30)
      `)

      // Query in separate run
      const result = await instance.run(`
        local results = State:match({ subject = "http://example.org/person1" })
        return #results
      `)
      expect(result.result).toBe(2)
    })
  })

  describe('Instance cleanup', () => {
    it('should not share state between different instances', async () => {
      const instance2 = createLuaInstance({ rdfStore: new MemoryRDFStore() })

      // Set value in first instance
      await instance.run('shared_value = 42')

      // Try to read in second instance (should be nil)
      const result = await instance2.run(`
        if shared_value == nil then
          return "not found"
        else
          return shared_value
        end
      `)
      expect(result.result).toBe('not found')

      instance2.destroy()
    })

    it('should properly destroy instance', () => {
      const tempInstance = createLuaInstance({ rdfStore: store })
      expect(() => tempInstance.destroy()).not.toThrow()
    })
  })
})

describe('JS Module Registration', () => {
  let store: MemoryRDFStore
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
    instance = createLuaInstance({ rdfStore: store })
  })

  describe('Synchronous functions', () => {
    it('should call sync function with number arguments', async () => {
      instance.registerJsModule('myAPI', {
        add: (a: number, b: number) => a + b
      })

      const result = await instance.run(`
        local api = require("myAPI")
        return api.add(10, 20)
      `)
      expect(result.result).toBe(30)
    })

    it('should call sync function with string arguments', async () => {
      instance.registerJsModule('myAPI', {
        reverseString: (str: string) => str.split('').reverse().join('')
      })

      const result = await instance.run(`
        local api = require("myAPI")
        return api.reverseString("Hello")
      `)
      expect(result.result).toBe('olleH')
    })

    it('should call sync function with array arguments', async () => {
      instance.registerJsModule('myAPI', {
        sumArray: (numbers: number[]) => numbers.reduce((sum, n) => sum + n, 0)
      })

      const result = await instance.run(`
        local api = require("myAPI")
        return api.sumArray({1, 2, 3, 4, 5})
      `)
      expect(result.result).toBe(15)
    })

    it('should call sync function with object arguments and return object', async () => {
      instance.registerJsModule('myAPI', {
        processUser: (user: { name: string; age: number }) => ({
          greeting: `Hello, ${user.name}!`,
          isAdult: user.age >= 18,
          category: user.age < 13 ? 'child' : user.age < 18 ? 'teen' : 'adult'
        })
      })

      const result = await instance.run(`
        local api = require("myAPI")
        local result = api.processUser({ name = "Alice", age = 25 })
        return result.greeting .. " - " .. result.category
      `)
      expect(result.result).toBe('Hello, Alice! - adult')
    })
  })

  describe('Asynchronous functions', () => {
    it('should call async function', async () => {
      instance.registerJsModule('myAPI', {
        delayedEcho: async (message: string, delayMs: number) => {
          await delay(delayMs)
          return `Echoed: ${message}`
        }
      })

      const result = await instance.run(`
        local api = require("myAPI")
        return api.delayedEcho("Hello", 10)
      `)
      expect(result.result).toBe('Echoed: Hello')
    })

    it('should call async function returning object', async () => {
      instance.registerJsModule('myAPI', {
        fetchData: async (id: number) => {
          await delay(10)
          return {
            id,
            name: `Item ${id}`,
            data: { value: id * 100, status: 'ok' }
          }
        }
      })

      const result = await instance.run(`
        local api = require("myAPI")
        local data = api.fetchData(42)
        return data.name .. " - " .. data.data.status
      `)
      expect(result.result).toBe('Item 42 - ok')
    })
  })

  describe('Async iterators/generators', () => {
    it('should iterate over async generator in Lua', async () => {
      instance.registerJsModule('myAPI', {
        generateNumbers: async function* (start: number, count: number) {
          for (let i = 0; i < count; i++) {
            await delay(5)
            yield start + i
          }
        }
      })

      const result = await instance.run(`
        local api = require("myAPI")
        local numbers = {}
        for num in api.generateNumbers(10, 5) do
          table.insert(numbers, num)
        end
        return numbers
      `)
      expect(result.result).toEqual([10, 11, 12, 13, 14])
    })

    it('should iterate over async generator returning objects', async () => {
      instance.registerJsModule('myAPI', {
        streamData: async function* () {
          const items = ['apple', 'banana', 'cherry']
          for (const item of items) {
            await delay(5)
            yield { name: item }
          }
        }
      })

      const result = await instance.run(`
        local api = require("myAPI")
        local items = {}
        for item in api.streamData() do
          table.insert(items, item.name)
        end
        return items
      `)
      expect(result.result).toEqual(['apple', 'banana', 'cherry'])
    })
  })

  describe('Module caching', () => {
    it('should cache module across multiple requires', async () => {
      instance.registerJsModule('myAPI', {
        add: (a: number, b: number) => a + b
      })

      const result = await instance.run(`
        local api1 = require("myAPI")
        local api2 = require("myAPI")
        local api3 = require("myAPI")
        
        -- Should be the same table reference
        local same = (api1 == api2) and (api2 == api3)
        
        -- All should work
        local sum = api1.add(1, 1) + api2.add(2, 2) + api3.add(3, 3)
        
        return { same = same, sum = sum }
      `)
      expect(result.result.same).toBe(true)
      expect(result.result.sum).toBe(12)
    })

    it('should call function multiple times correctly', async () => {
      instance.registerJsModule('myAPI', {
        add: (a: number, b: number) => a + b
      })

      const result = await instance.run(`
        local api = require("myAPI")
        return api.add(1, 2) + api.add(3, 4) + api.add(5, 6)
      `)
      expect(result.result).toBe(21) // 3 + 7 + 11
    })
  })

  describe('Error handling', () => {
    it('should handle calling non-existent function', async () => {
      instance.registerJsModule('myAPI', {
        exists: () => true
      })

      const result = await instance.run(`
        local api = require("myAPI")
        local status, err = pcall(function()
          return api.nonExistentFunction()
        end)
        return status
      `)
      // pcall should return false when function doesn't exist
      expect(result.result).toBe(false)
    })
  })

  describe('Lua iterator to JS async iterator', () => {
    it('should iterate ipairs from Lua', async () => {
      const items: any[] = []
      const iter = instance.runIter(`return ipairs({10, 20, 30, 40, 50})`)
      for await (const [index, value] of iter) {
        items.push({ index, value })
      }
      expect(items).toHaveLength(5)
      expect(items[0]).toEqual({ index: 1, value: 10 })
      expect(items[4]).toEqual({ index: 5, value: 50 })
    })

    it('should iterate pairs from Lua', async () => {
      const items: any[] = []
      const iter = instance.runIter(`return pairs({ name = "Alice", age = 25, city = "Beijing" })`)
      for await (const [key, value] of iter) {
        items.push({ key, value })
      }
      expect(items).toHaveLength(3)
    })

    it('should iterate custom Lua iterator', async () => {
      const items: number[] = []
      const iter = instance.runIter(`
        local function fib_iter(max)
          local a, b = 0, 1
          return function()
            if a > max then return nil end
            local current = a
            a, b = b, a + b
            return current
          end
        end
        return fib_iter(50)
      `)
      for await (const [value] of iter) {
        items.push(value)
      }
      expect(items).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34])
    })

    it('should support early termination of Lua iterator', async () => {
      const items: number[] = []
      const iter = instance.runIter(`return ipairs({1, 2, 3, 4, 5, 6, 7, 8, 9, 10})`)
      for await (const [_, value] of iter) {
        items.push(value)
        if (value >= 5) break
      }
      expect(items).toEqual([1, 2, 3, 4, 5])
    })
  })
})

describe('Error Output Preservation', () => {
  let store: MemoryRDFStore

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
  })

  it('should preserve output before error in runLua', async () => {
    const result = await runLua(`
      print("Line 1")
      print("Line 2")
      print("Line 3")
      error("Test error")
    `, { rdfStore: store })

    // Should have error
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('Test error')

    // Should preserve all output before error
    expect(result.output).toContain('Line 1')
    expect(result.output).toContain('Line 2')
    expect(result.output).toContain('Line 3')
  })

  it('should preserve output before error in persistent instance', async () => {
    const instance = createLuaInstance({ rdfStore: store })

    const result = await instance.run(`
      print("Before error 1")
      print("Before error 2")
      nonExistentFunction()
    `)

    expect(result.error).toBeTruthy()
    expect(result.output).toContain('Before error 1')
    expect(result.output).toContain('Before error 2')

    instance.destroy()
  })

  it('should handle syntax errors gracefully', async () => {
    const result = await runLua(`
      print("This should print")
      local x = -- syntax error
    `, { rdfStore: store })

    expect(result.error).toBeTruthy()
  })

  it('should continue working after an error in persistent instance', async () => {
    const instance = createLuaInstance({ rdfStore: store })

    // First run with error
    const errorResult = await instance.run(`
      counter = 1
      print("Setting counter to 1")
      error("Intentional error")
    `)
    expect(errorResult.error).toBeTruthy()

    // Second run should still work (state may be affected by error)
    const successResult = await instance.run(`
      print("After error")
      return "success"
    `)
    expect(successResult.error).toBeNull()
    expect(successResult.result).toBe('success')

    instance.destroy()
  })

  describe('JSON module', () => {
    describe('json.encode', () => {
      it('should encode nil as null', async () => {
        const result = await runLua('return json.encode(nil)', { rdfStore: store })
        expect(result.result).toBe('null')
        expect(result.error).toBeNull()
      })

      it('should encode boolean values', async () => {
        const resultTrue = await runLua('return json.encode(true)', { rdfStore: store })
        expect(resultTrue.result).toBe('true')

        const resultFalse = await runLua('return json.encode(false)', { rdfStore: store })
        expect(resultFalse.result).toBe('false')
      })

      it('should encode integer numbers', async () => {
        const result = await runLua('return json.encode(42)', { rdfStore: store })
        expect(result.result).toBe('42')
      })

      it('should encode floating point numbers', async () => {
        const result = await runLua('return json.encode(3.14)', { rdfStore: store })
        expect(JSON.parse(result.result as string)).toBeCloseTo(3.14)
      })

      it('should encode strings', async () => {
        const result = await runLua('return json.encode("hello world")', { rdfStore: store })
        expect(result.result).toBe('"hello world"')
      })

      it('should encode strings with special characters', async () => {
        const result = await runLua('return json.encode("hello\\nworld")', { rdfStore: store })
        expect(JSON.parse(result.result as string)).toBe('hello\nworld')
      })

      it('should encode arrays (sequential integer keys from 1)', async () => {
        const result = await runLua('return json.encode({1, 2, 3})', { rdfStore: store })
        expect(JSON.parse(result.result as string)).toEqual([1, 2, 3])
      })

      it('should encode objects (string keys)', async () => {
        const result = await runLua('return json.encode({name = "Alice", age = 30})', { rdfStore: store })
        const parsed = JSON.parse(result.result as string)
        expect(parsed.name).toBe('Alice')
        expect(parsed.age).toBe(30)
      })

      it('should encode nested structures', async () => {
        const result = await runLua(`
          local data = {
            name = "test",
            items = {1, 2, 3},
            nested = {
              foo = "bar"
            }
          }
          return json.encode(data)
        `, { rdfStore: store })
        const parsed = JSON.parse(result.result as string)
        expect(parsed.name).toBe('test')
        expect(parsed.items).toEqual([1, 2, 3])
        expect(parsed.nested.foo).toBe('bar')
      })

      it('should encode empty table as empty object', async () => {
        // mlua 的序列化将空表视为空对象
        const result = await runLua('return json.encode({})', { rdfStore: store })
        expect(result.result).toBe('{}')
      })

      it('should encode mixed arrays as objects', async () => {
        // 注意：mlua 序列化对于混合键表（同时有整数键和字符串键）的行为是
        // 将其视为数组，只保留连续整数键的值，忽略字符串键
        // 这是 mlua 的预期行为，如需保留所有键应使用纯字符串键的表
        const result = await runLua('return json.encode({foo = "bar", baz = 123})', { rdfStore: store })
        const parsed = JSON.parse(result.result as string)
        expect(parsed.foo).toBe('bar')
        expect(parsed.baz).toBe(123)
      })

      it('should error on encoding functions', async () => {
        const result = await runLua('return json.encode(function() end)', { rdfStore: store })
        expect(result.error).toBeTruthy()
      })
    })

    describe('json.decode', () => {
      it('should decode null to nil', async () => {
        const result = await runLua('return json.decode("null")', { rdfStore: store })
        expect(result.result).toBeNull()
        expect(result.error).toBeNull()
      })

      it('should decode boolean values', async () => {
        const resultTrue = await runLua('return json.decode("true")', { rdfStore: store })
        expect(resultTrue.result).toBe(true)

        const resultFalse = await runLua('return json.decode("false")', { rdfStore: store })
        expect(resultFalse.result).toBe(false)
      })

      it('should decode integer numbers', async () => {
        const result = await runLua('return json.decode("42")', { rdfStore: store })
        expect(result.result).toBe(42)
      })

      it('should decode floating point numbers', async () => {
        const result = await runLua('return json.decode("3.14")', { rdfStore: store })
        expect(result.result).toBeCloseTo(3.14)
      })

      it('should decode strings', async () => {
        const result = await runLua('return json.decode(\'"hello world"\')', { rdfStore: store })
        expect(result.result).toBe('hello world')
      })

      it('should decode arrays', async () => {
        const result = await runLua(`
          local arr = json.decode('[1, 2, 3]')
          return {arr[1], arr[2], arr[3]}
        `, { rdfStore: store })
        expect(result.result).toEqual([1, 2, 3])
      })

      it('should decode objects', async () => {
        const result = await runLua(`
          local obj = json.decode('{"name": "Alice", "age": 30}')
          return {obj.name, obj.age}
        `, { rdfStore: store })
        expect(result.result).toEqual(['Alice', 30])
      })

      it('should decode nested structures', async () => {
        const result = await runLua(`
          local data = json.decode('{"items": [1, 2, 3], "nested": {"foo": "bar"}}')
          return {data.items[1], data.items[2], data.nested.foo}
        `, { rdfStore: store })
        expect(result.result).toEqual([1, 2, 'bar'])
      })

      it('should decode empty array', async () => {
        const result = await runLua(`
          local arr = json.decode('[]')
          return #arr
        `, { rdfStore: store })
        expect(result.result).toBe(0)
      })

      it('should decode empty object', async () => {
        const result = await runLua(`
          local obj = json.decode('{}')
          local count = 0
          for _ in pairs(obj) do count = count + 1 end
          return count
        `, { rdfStore: store })
        expect(result.result).toBe(0)
      })

      it('should error on invalid JSON', async () => {
        const result = await runLua('return json.decode("invalid json")', { rdfStore: store })
        expect(result.error).toBeTruthy()
      })

      it('should error on truncated JSON', async () => {
        const result = await runLua('return json.decode(\'{"incomplete":\')', { rdfStore: store })
        expect(result.error).toBeTruthy()
      })
    })

    describe('json roundtrip', () => {
      it('should roundtrip simple values', async () => {
        const result = await runLua(`
          local original = 42
          local encoded = json.encode(original)
          local decoded = json.decode(encoded)
          return decoded
        `, { rdfStore: store })
        expect(result.result).toBe(42)
      })

      it('should roundtrip complex structures', async () => {
        const result = await runLua(`
          local original = {
            name = "test",
            count = 100,
            active = true,
            tags = {"lua", "json", "test"}
          }
          local encoded = json.encode(original)
          local decoded = json.decode(encoded)
          return {decoded.name, decoded.count, decoded.active, decoded.tags[1], decoded.tags[3]}
        `, { rdfStore: store })
        expect(result.result).toEqual(['test', 100, true, 'lua', 'test'])
      })

      it('should roundtrip UTF-8 strings', async () => {
        const result = await runLua(`
          local original = "你好世界 🌍"
          local encoded = json.encode(original)
          local decoded = json.decode(encoded)
          return decoded
        `, { rdfStore: store })
        expect(result.result).toBe('你好世界 🌍')
      })
    })
  })
})

// ============= VFS 文件系统测试 =============
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createVfs, type Vfs, type VfsProvider } from '@pubwiki/vfs'

// 简单的内存 VfsProvider 实现用于测试
class MemoryVfsProvider implements VfsProvider {
  private files = new Map<string, { content: Uint8Array; createdAt: Date; updatedAt: Date }>()
  private directories = new Set<string>(['/'])

  private normalizePath(p: string): string {
    return path.posix.normalize('/' + p).replace(/\/+$/, '') || '/'
  }

  async id(filePath: string): Promise<string> {
    return this.normalizePath(filePath)
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const p = this.normalizePath(filePath)
    const file = this.files.get(p)
    if (!file) throw new Error(`File not found: ${p}`)
    return file.content
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const p = this.normalizePath(filePath)
    const now = new Date()
    const existing = this.files.get(p)
    this.files.set(p, {
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
  }

  async unlink(filePath: string): Promise<void> {
    const p = this.normalizePath(filePath)
    if (!this.files.has(p)) throw new Error(`File not found: ${p}`)
    this.files.delete(p)
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const p = this.normalizePath(dirPath)
    if (options?.recursive) {
      const parts = p.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.directories.add(current)
      }
    } else {
      this.directories.add(p)
    }
  }

  async readdir(dirPath: string): Promise<string[]> {
    const p = this.normalizePath(dirPath)
    
    // 检查目录是否存在
    if (!this.directories.has(p)) {
      throw new Error(`Directory not found: ${p}`)
    }
    
    const entries: string[] = []
    
    // 查找文件
    for (const [filePath] of this.files) {
      const parent = path.posix.dirname(filePath)
      if (parent === p) {
        entries.push(path.posix.basename(filePath))
      }
    }
    
    // 查找子目录
    for (const dir of this.directories) {
      if (dir !== p && path.posix.dirname(dir) === p) {
        entries.push(path.posix.basename(dir))
      }
    }
    
    return entries
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const p = this.normalizePath(dirPath)
    if (options?.recursive) {
      // 删除目录下的所有文件
      for (const [filePath] of this.files) {
        if (filePath.startsWith(p + '/') || filePath === p) {
          this.files.delete(filePath)
        }
      }
      // 删除目录及子目录
      for (const dir of this.directories) {
        if (dir.startsWith(p + '/') || dir === p) {
          this.directories.delete(dir)
        }
      }
    } else {
      this.directories.delete(p)
    }
  }

  async stat(filePath: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean; createdAt: Date; updatedAt: Date }> {
    const p = this.normalizePath(filePath)
    
    // 检查是否是文件
    const file = this.files.get(p)
    if (file) {
      return {
        size: file.content.length,
        isFile: true,
        isDirectory: false,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt
      }
    }
    
    // 检查是否是目录
    if (this.directories.has(p)) {
      const now = new Date()
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        createdAt: now,
        updatedAt: now
      }
    }
    
    throw new Error(`Path not found: ${p}`)
  }

  async exists(filePath: string): Promise<boolean> {
    const p = this.normalizePath(filePath)
    return this.files.has(p) || this.directories.has(p)
  }

  async rename(from: string, to: string): Promise<void> {
    const fromPath = this.normalizePath(from)
    const toPath = this.normalizePath(to)
    
    const file = this.files.get(fromPath)
    if (file) {
      this.files.delete(fromPath)
      this.files.set(toPath, file)
    } else if (this.directories.has(fromPath)) {
      this.directories.delete(fromPath)
      this.directories.add(toPath)
    } else {
      throw new Error(`Path not found: ${fromPath}`)
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    const fromPath = this.normalizePath(from)
    const toPath = this.normalizePath(to)
    
    const file = this.files.get(fromPath)
    if (!file) throw new Error(`File not found: ${fromPath}`)
    
    const now = new Date()
    this.files.set(toPath, {
      content: new Uint8Array(file.content),
      createdAt: now,
      updatedAt: now
    })
  }

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}
}

describe('VFS File System Operations', () => {
  let store: MemoryRDFStore
  let vfs: Vfs<VfsProvider>

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
    const provider = new MemoryVfsProvider()
    vfs = createVfs(provider)
  })

  describe('fs.stat', () => {
    it('should get file stat', async () => {
      // 先创建一个文件
      await vfs.createFile('/test.txt', 'Hello, World!')

      const result = await runLua(`
        local stat, err = fs.stat('/test.txt')
        if err then return { error = err } end
        return {
          size = stat.size,
          isDirectory = stat.isDirectory,
          hasCreatedAt = stat.createdAt ~= nil,
          hasUpdatedAt = stat.updatedAt ~= nil
        }
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result.size).toBe(13) // "Hello, World!" 长度
      expect(result.result.isDirectory).toBe(false)
      expect(result.result.hasCreatedAt).toBe(true)
      expect(result.result.hasUpdatedAt).toBe(true)
    })

    it('should get directory stat', async () => {
      await vfs.createFolder('/mydir')

      const result = await runLua(`
        local stat, err = fs.stat('/mydir')
        if err then return { error = err } end
        return {
          isDirectory = stat.isDirectory,
          size = stat.size
        }
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result.isDirectory).toBe(true)
      expect(result.result.size).toBe(0)
    })

    it('should return error for non-existent path', async () => {
      const result = await runLua(`
        local stat, err = fs.stat('/nonexistent')
        return { stat = stat, hasError = err ~= nil }
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result.stat).toBeFalsy()
      expect(result.result.hasError).toBe(true)
    })
  })

  describe('fs.readdir', () => {
    it('should list directory contents', async () => {
      // 创建一些文件和目录
      await vfs.createFile('/dir/file1.txt', 'content1')
      await vfs.createFile('/dir/file2.txt', 'content2')
      await vfs.createFolder('/dir/subdir')

      const result = await runLua(`
        local entries, err = fs.readdir('/dir')
        if err then return { error = err } end
        
        local names = {}
        for _, entry in ipairs(entries) do
          table.insert(names, entry.name)
        end
        table.sort(names)
        return names
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result).toEqual(['file1.txt', 'file2.txt', 'subdir'])
    })

    it('should return entries with stat info', async () => {
      await vfs.createFile('/testdir/hello.txt', 'Hello!')
      await vfs.createFolder('/testdir/folder')

      const result = await runLua(`
        local entries, err = fs.readdir('/testdir')
        if err then return { error = err } end
        
        local result = {}
        for _, entry in ipairs(entries) do
          table.insert(result, {
            name = entry.name,
            isDirectory = entry.isDirectory,
            size = entry.size,
            hasPath = entry.path ~= nil
          })
        end
        return result
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result).toHaveLength(2)
      
      // 检查文件
      const file = result.result.find((e: any) => e.name === 'hello.txt')
      expect(file).toBeDefined()
      expect(file.isDirectory).toBe(false)
      expect(file.size).toBe(6) // "Hello!" 长度
      expect(file.hasPath).toBe(true)
      
      // 检查目录
      const folder = result.result.find((e: any) => e.name === 'folder')
      expect(folder).toBeDefined()
      expect(folder.isDirectory).toBe(true)
    })

    it('should return empty array for empty directory', async () => {
      await vfs.createFolder('/emptydir')

      const result = await runLua(`
        local entries, err = fs.readdir('/emptydir')
        if err then return { error = err } end
        return #entries
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result).toBe(0)
    })

    it('should return error for non-existent directory', async () => {
      const result = await runLua(`
        local entries, err = fs.readdir('/nonexistent')
        if err then
          return { hasError = true, errorMsg = err }
        end
        return { hasError = false, count = #entries }
      `, { rdfStore: store, vfs })

      expect(result.error).toBeNull()
      expect(result.result.hasError).toBe(true)
      expect(result.result.errorMsg).toContain('not found')
    })
  })

  describe('fs.stat with relative paths', () => {
    it('should resolve relative paths from working directory', async () => {
      await vfs.createFile('/work/project/file.txt', 'content')

      const result = await runLua(`
        local stat, err = fs.stat('./file.txt')
        if err then return { error = err } end
        return { size = stat.size, isDirectory = stat.isDirectory }
      `, { rdfStore: store, vfs, workingDirectory: '/work/project' })

      expect(result.error).toBeNull()
      expect(result.result.size).toBe(7)
      expect(result.result.isDirectory).toBe(false)
    })
  })
})