import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, runLua, createLuaInstance, LuaTable, type LuaInstance } from '../../src/index'

// Helper function: delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('pubwiki-lua', () => {
  beforeAll(async () => {
    // Load WASM module
    await loadRunner()
    console.log('WASM module loaded successfully')
  })

  describe('Basic Lua execution', () => {
    it('should run simple Lua code', async () => {
      const result = await runLua('return 1 + 2')
      expect(result.result).toBe(3)
      expect(result.error).toBeNull()
    })

    it('should handle print statements', async () => {
      const result = await runLua(`
        print('Hello')
        print('World')
        return 42
      `)
      expect(result.output).toContain('Hello')
      expect(result.output).toContain('World')
      expect(result.result).toBe(42)
      expect(result.error).toBeNull()
    })
  })
})

describe('Persistent Lua Instance', () => {
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(async () => {
    instance = createLuaInstance()
  })

  afterEach(async () => {
    instance.destroy()
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

  describe('Instance cleanup', () => {
    it('should not share state between different instances', async () => {
      const instance2 = createLuaInstance()

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
      const tempInstance = createLuaInstance()
      expect(() => tempInstance.destroy()).not.toThrow()
    })
  })
})

describe('JS Module Registration', () => {
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(async () => {
    instance = createLuaInstance()
  })

  afterEach(async () => {
    instance.destroy()
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

    it('should return JS object as Lua table type', async () => {
      const LUA_VALUE_SYMBOL = Symbol.for('pubwiki.lua.value')
      
      instance.registerJsModule('myAPI', {
        // 不带标记的对象 - 应该返回 userdata（JsProxy）
        getPlainObject: () => ({ name: 'test', value: 123 }),
        getPlainArray: () => [1, 2, 3],
        // 带标记的对象 - 应该转换为 Lua table
        getMarkedObject: () => ({ [LUA_VALUE_SYMBOL]: true, value: { name: 'test', num: 456 } }),
        getMarkedArray: () => ({ [LUA_VALUE_SYMBOL]: true, value: [4, 5, 6] })
      })

      // 不带标记的对象返回 userdata（这是预期行为，支持懒加载）
      const plainResult = await instance.run(`
        local api = require("myAPI")
        local obj = api.getPlainObject()
        local arr = api.getPlainArray()
        return {
          objType = type(obj),
          arrType = type(arr),
          objName = obj.name,
          arrLen = #arr
        }
      `)
      expect(plainResult.error).toBeNull()
      expect(plainResult.result.objType).toBe('userdata')
      expect(plainResult.result.arrType).toBe('userdata')
      expect(plainResult.result.objName).toBe('test')
      expect(plainResult.result.arrLen).toBe(3)

      // 带标记的对象应该转换为 Lua table
      const markedResult = await instance.run(`
        local api = require("myAPI")
        local obj = api.getMarkedObject()
        local arr = api.getMarkedArray()
        return {
          objType = type(obj),
          arrType = type(arr),
          objName = obj.name,
          arrLen = #arr
        }
      `)
      expect(markedResult.error).toBeNull()
      expect(markedResult.result.objType).toBe('table')
      expect(markedResult.result.arrType).toBe('table')
      expect(markedResult.result.objName).toBe('test')
      expect(markedResult.result.arrLen).toBe(3)
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

  describe('Lua iterator via callback', () => {
    it('should iterate ipairs via callback', async () => {
      const items: { index: number; value: number }[] = []
      await instance.run(`
        for index, value in ipairs({10, 20, 30, 40, 50}) do
          callback(index, value)
        end
      `, { callback: (index: number, value: number) => items.push({ index, value }) })
      expect(items).toHaveLength(5)
      expect(items[0]).toEqual({ index: 1, value: 10 })
      expect(items[4]).toEqual({ index: 5, value: 50 })
    })

    it('should iterate pairs via callback', async () => {
      const items: { key: string; value: unknown }[] = []
      await instance.run(`
        for key, value in pairs({ name = "Alice", age = 25, city = "Beijing" }) do
          callback(key, value)
        end
      `, { callback: (key: string, value: unknown) => items.push({ key, value }) })
      expect(items).toHaveLength(3)
    })

    it('should iterate custom Lua iterator via callback', async () => {
      const items: number[] = []
      await instance.run(`
        local function fib_iter(max)
          local a, b = 0, 1
          return function()
            if a > max then return nil end
            local current = a
            a, b = b, a + b
            return current
          end
        end
        for value in fib_iter(50) do
          callback(value)
        end
      `, { callback: (value: number) => items.push(value) })
      expect(items).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34])
    })

    it('should support early termination via callback return value', async () => {
      const items: number[] = []
      await instance.run(`
        for index, value in ipairs({1, 2, 3, 4, 5, 6, 7, 8, 9, 10}) do
          local shouldContinue = callback(value)
          if not shouldContinue then break end
        end
      `, { callback: (value: number) => {
        items.push(value)
        return value < 5
      }})
      expect(items).toEqual([1, 2, 3, 4, 5])
    })
  })
})

describe('Error Output Preservation', () => {
  beforeAll(async () => {
    await loadRunner()
  })

  it('should preserve output before error in runLua', async () => {
    const result = await runLua(`
      print("Line 1")
      print("Line 2")
      print("Line 3")
      error("Test error")
    `)

    // Should have error
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('Test error')

    // Should preserve all output before error
    expect(result.output).toContain('Line 1')
    expect(result.output).toContain('Line 2')
    expect(result.output).toContain('Line 3')
  })

  it('should preserve output before error in persistent instance', async () => {
    const instance = createLuaInstance()

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
    `)

    expect(result.error).toBeTruthy()
  })

  it('should continue working after an error in persistent instance', async () => {
    const instance = createLuaInstance()

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

describe('LuaTable wrapper', () => {
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    instance = createLuaInstance()
  })

  afterEach(() => {
    instance.destroy()
  })

  it('should convert wrapped array to native Lua table', async () => {
    const testModule = {
      getArray() {
        return new LuaTable([1, 2, 3])
      }
    }
    instance.registerJsModule('testMod', testModule, { mode: 'global' })

    const result = await instance.run(`
      local arr = testMod.getArray()
      return { type = type(arr), len = #arr, first = arr[1], last = arr[3] }
    `)

    expect(result.error).toBeNull()
    expect(result.result.type).toBe('table')
    expect(result.result.len).toBe(3)
    expect(result.result.first).toBe(1)
    expect(result.result.last).toBe(3)
  })

  it('should convert wrapped object to native Lua table', async () => {
    const testModule = {
      getObject() {
        return new LuaTable({ name: 'Alice', age: 30 })
      }
    }
    instance.registerJsModule('testMod', testModule, { mode: 'global' })

    const result = await instance.run(`
      local obj = testMod.getObject()
      return { type = type(obj), name = obj.name, age = obj.age }
    `)

    expect(result.error).toBeNull()
    expect(result.result.type).toBe('table')
    expect(result.result.name).toBe('Alice')
    expect(result.result.age).toBe(30)
  })

  it('should convert nested structures deeply', async () => {
    const testModule = {
      getNested() {
        return new LuaTable([
          { name: 'Alice' },
          { name: 'Bob' }
        ])
      }
    }
    instance.registerJsModule('testMod', testModule, { mode: 'global' })

    const result = await instance.run(`
      local arr = testMod.getNested()
      return { 
        type = type(arr), 
        len = #arr, 
        firstName = arr[1].name,
        secondName = arr[2].name,
        innerType = type(arr[1])
      }
    `)

    expect(result.error).toBeNull()
    expect(result.result.type).toBe('table')
    expect(result.result.len).toBe(2)
    expect(result.result.firstName).toBe('Alice')
    expect(result.result.secondName).toBe('Bob')
    expect(result.result.innerType).toBe('table')
  })

  it('should work with async functions', async () => {
    const testModule = {
      async fetchData() {
        return new LuaTable(['a', 'b', 'c'])
      }
    }
    instance.registerJsModule('testMod', testModule, { mode: 'global' })

    const result = await instance.run(`
      local data = testMod.fetchData()
      return { type = type(data), len = #data }
    `)

    expect(result.error).toBeNull()
    expect(result.result.type).toBe('table')
    expect(result.result.len).toBe(3)
  })

  it('should allow ipairs iteration on wrapped arrays', async () => {
    const testModule = {
      getNumbers() {
        return new LuaTable([10, 20, 30])
      }
    }
    instance.registerJsModule('testMod', testModule, { mode: 'global' })

    const result = await instance.run(`
      local nums = testMod.getNumbers()
      local sum = 0
      for i, v in ipairs(nums) do
        sum = sum + v
      end
      return sum
    `)

    expect(result.error).toBeNull()
    expect(result.result).toBe(60)
  })

  it('should allow pairs iteration on wrapped objects', async () => {
    const testModule = {
      getScores() {
        return new LuaTable({ math: 90, english: 85, science: 95 })
      }
    }
    instance.registerJsModule('testMod', testModule, { mode: 'global' })

    const result = await instance.run(`
      local scores = testMod.getScores()
      local total = 0
      local count = 0
      for k, v in pairs(scores) do
        total = total + v
        count = count + 1
      end
      return { total = total, count = count }
    `)

    expect(result.error).toBeNull()
    expect(result.result.total).toBe(270)
    expect(result.result.count).toBe(3)
  })
})
