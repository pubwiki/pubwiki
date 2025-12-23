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
})

