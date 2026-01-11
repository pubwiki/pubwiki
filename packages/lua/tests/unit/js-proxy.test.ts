import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, createLuaInstance, type LuaInstance } from '../../src/index'
import type { RDFStore, Triple, TriplePattern } from '../../src/rdf-types'

// 简单的内存 RDFStore 实现用于测试
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

describe('JsProxy - 参数传递', () => {
  let store: MemoryRDFStore
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
    instance = createLuaInstance({ rdfStore: store })
  })

  afterEach(() => {
    instance.destroy()
  })

  describe('基本类型传递', () => {
    it('应该能传递字符串参数', async () => {
      const result = await instance.run(`return name`, { name: 'Alice' })
      expect(result.error).toBeNull()
      expect(result.result).toBe('Alice')
    })

    it('应该能传递数字参数', async () => {
      const result = await instance.run(`return age`, { age: 25 })
      expect(result.error).toBeNull()
      expect(result.result).toBe(25)
    })

    it('应该能传递浮点数参数', async () => {
      const result = await instance.run(`return pi`, { pi: 3.14159 })
      expect(result.error).toBeNull()
      expect(result.result).toBeCloseTo(3.14159, 5)
    })

    it('应该能传递布尔值参数', async () => {
      const result = await instance.run(`
        if active then
          return "yes"
        else
          return "no"
        end
      `, { active: true })
      expect(result.error).toBeNull()
      expect(result.result).toBe('yes')
    })

    it('应该能传递 null/nil 参数', async () => {
      const result = await instance.run(`
        if value == nil then
          return "is nil"
        else
          return "not nil"
        end
      `, { value: null })
      expect(result.error).toBeNull()
      expect(result.result).toBe('is nil')
    })

    it('应该能传递多个参数', async () => {
      const result = await instance.run(`
        return name .. " is " .. tostring(age) .. " years old"
      `, { name: 'Bob', age: 30 })
      expect(result.error).toBeNull()
      expect(result.result).toBe('Bob is 30 years old')
    })
  })

  describe('对象/表传递', () => {
    it('应该能传递简单对象', async () => {
      const result = await instance.run(`
        return user.name .. ", " .. tostring(user.age)
      `, { 
        user: { name: 'Charlie', age: 35 }
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('Charlie, 35')
    })

    it('应该能访问嵌套对象', async () => {
      const result = await instance.run(`
        return data.person.address.city
      `, { 
        data: { 
          person: { 
            address: { 
              city: 'Tokyo' 
            } 
          } 
        }
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('Tokyo')
    })

    it('应该能传递数组', async () => {
      // JsProxy 数组使用 Lua 风格的 1-based 索引
      const result = await instance.run(`
        local sum = 0
        for i = 1, #numbers do
          sum = sum + numbers[i]
        end
        return sum
      `, { numbers: [1, 2, 3, 4, 5] })
      expect(result.error).toBeNull()
      expect(result.result).toBe(15)
    })

    it('应该能访问数组元素', async () => {
      // JsProxy 数组使用 Lua 风格的 1-based 索引
      const result = await instance.run(`
        return items[1] .. ", " .. items[2] .. ", " .. items[3]
      `, { items: ['a', 'b', 'c'] })
      expect(result.error).toBeNull()
      expect(result.result).toBe('a, b, c')
    })

    it('应该能使用 #操作符获取数组长度', async () => {
      const result = await instance.run(`
        return #items
      `, { items: [1, 2, 3, 4, 5] })
      expect(result.error).toBeNull()
      expect(result.result).toBe(5)
    })
  })

  describe('对象迭代 (pairs)', () => {
    it('应该能用 pairs 迭代对象', async () => {
      const result = await instance.run(`
        local keys = {}
        for k, v in pairs(obj) do
          table.insert(keys, k)
        end
        table.sort(keys)
        return table.concat(keys, ",")
      `, { obj: { a: 1, b: 2, c: 3 } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('a,b,c')
    })

    it('应该能用 pairs 迭代并获取值', async () => {
      const result = await instance.run(`
        local sum = 0
        for k, v in pairs(scores) do
          sum = sum + v
        end
        return sum
      `, { scores: { math: 90, english: 85, science: 95 } })
      expect(result.error).toBeNull()
      expect(result.result).toBe(270)
    })
  })

  describe('JsProxy 辅助方法', () => {
    it('应该能使用 typeof 获取类型', async () => {
      const result = await instance.run(`
        return obj:typeof()
      `, { obj: { name: 'test' } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('object')
    })

    it('应该能使用 isArray 检查数组', async () => {
      const result = await instance.run(`
        local arrCheck = arr:isArray()
        local objCheck = obj:isArray()
        if arrCheck and not objCheck then
          return "correct"
        else
          return "wrong"
        end
      `, { arr: [1, 2, 3], obj: { a: 1 } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('correct')
    })

    it('应该能使用 toJSON 序列化', async () => {
      const result = await instance.run(`
        return data:toJSON()
      `, { data: { name: 'test', value: 123 } })
      expect(result.error).toBeNull()
      const parsed = JSON.parse(result.result)
      expect(parsed.name).toBe('test')
      expect(parsed.value).toBe(123)
    })

    it('应该能使用 json.encode 序列化 JsProxy', async () => {
      const result = await instance.run(`
        return json.encode(data)
      `, { data: { name: 'Alice', age: 25, items: [1, 2, 3] } })
      expect(result.error).toBeNull()
      const parsed = JSON.parse(result.result)
      expect(parsed.name).toBe('Alice')
      expect(parsed.age).toBe(25)
      expect(parsed.items).toEqual([1, 2, 3])
    })

    it('应该能使用 json.encode 序列化嵌套的 JsProxy', async () => {
      const result = await instance.run(`
        return json.encode(data.nested)
      `, { data: { nested: { a: 1, b: 2 } } })
      expect(result.error).toBeNull()
      const parsed = JSON.parse(result.result)
      expect(parsed.a).toBe(1)
      expect(parsed.b).toBe(2)
    })

    it('应该能用 is_null 检查属性值是否为 null', async () => {
      // 访问对象的 null 属性会返回 Lua nil
      const result = await instance.run(`
        local v = wrapper.value
        if v == nil then
          return "is nil"
        else
          return "not nil"
        end
      `, { wrapper: { value: null } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('is nil')
    })

    it('应该能用 nil 检查属性值是否为 undefined', async () => {
      // 访问对象的 undefined 属性会返回 Lua nil
      const result = await instance.run(`
        local v = wrapper.value
        if v == nil then
          return "is nil"
        else
          return "not nil"
        end
      `, { wrapper: { value: undefined } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('is nil')
    })
  })

  describe('函数调用', () => {
    it('应该能调用同步 JS 函数', async () => {
      const result = await instance.run(`
        return add(10, 20)
      `, { 
        add: (a: number, b: number) => a + b 
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe(30)
    })

    it('应该能调用无参数函数', async () => {
      const result = await instance.run(`
        return getGreeting()
      `, { 
        getGreeting: () => 'Hello, World!' 
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('Hello, World!')
    })

    it('应该能调用返回对象的函数', async () => {
      const result = await instance.run(`
        local person = createPerson("Alice", 25)
        return person.name .. " is " .. tostring(person.age)
      `, { 
        createPerson: (name: string, age: number) => ({ name, age })
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('Alice is 25')
    })

    it('应该能调用异步 JS 函数', async () => {
      // 使用 CallbackManager 异步机制，自动等待 Promise
      const result = await instance.run(`
        local data = fetchData()
        return data.message
      `, { 
        fetchData: async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return { message: 'async result' }
        }
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('async result')
    })

    it('应该能调用返回 Promise 的函数', async () => {
      // 使用 CallbackManager 异步机制，自动等待 Promise
      const result = await instance.run(`
        local value = compute(5)
        return value
      `, { 
        compute: (x: number) => Promise.resolve(x * 2)
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe(10)
    })

    it('应该能通过 JS 函数调用字符串方法', async () => {
      // JS 字符串会转换为 Lua 字符串，无法直接调用 JS 方法
      // 如果需要调用 JS 方法，应该用 JS 函数包装
      const result = await instance.run(`
        return toUpperCase(str)
      `, { 
        str: 'hello world',
        toUpperCase: (s: string) => s.toUpperCase()
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('HELLO WORLD')
    })
  })

  describe('复杂场景', () => {
    it('应该能处理混合数据结构', async () => {
      // JsProxy 数组使用 Lua 风格的 1-based 索引
      const result = await instance.run(`
        local total = 0
        for i = 1, #order.items do
          local item = order.items[i]
          total = total + (item.price * item.quantity)
        end
        return order.customer .. ": $" .. tostring(total)
      `, { 
        order: {
          customer: 'John',
          items: [
            { name: 'Apple', price: 1.5, quantity: 3 },
            { name: 'Banana', price: 0.75, quantity: 5 }
          ]
        }
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe('John: $8.25')
    })

    it('应该能将 JsProxy 作为参数传递给函数', async () => {
      const result = await instance.run(`
        return process(data)
      `, { 
        data: { value: 42 },
        process: (obj: any) => obj.value * 2
      })
      expect(result.error).toBeNull()
      expect(result.result).toBe(84)
    })

    it('应该能在多次运行之间使用不同的参数', async () => {
      const result1 = await instance.run(`return x + y`, { x: 1, y: 2 })
      expect(result1.result).toBe(3)

      const result2 = await instance.run(`return x + y`, { x: 10, y: 20 })
      expect(result2.result).toBe(30)

      const result3 = await instance.run(`return x * y`, { x: 5, y: 6 })
      expect(result3.result).toBe(30)
    })

    it('应该能不带参数运行代码', async () => {
      const result = await instance.run(`return 1 + 1`)
      expect(result.error).toBeNull()
      expect(result.result).toBe(2)
    })

    it('应该能与全局变量共存', async () => {
      // 先设置全局变量
      await instance.run(`globalCounter = 100`)
      
      // 使用参数，全局变量应该仍然可用
      const result = await instance.run(`
        return globalCounter + offset
      `, { offset: 50 })
      
      expect(result.error).toBeNull()
      expect(result.result).toBe(150)
    })
  })

  describe('错误处理', () => {
    it('应该能处理访问不存在的属性', async () => {
      const result = await instance.run(`
        if obj.nonexistent == nil then
          return "is nil"
        else
          return "has value"
        end
      `, { obj: { name: 'test' } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('is nil')
    })

    it('应该能处理函数抛出的错误', async () => {
      // JS 异常通过 CallbackManager reject 传递，会导致 Lua 错误
      const result = await instance.run(`
        local ok, err = pcall(function()
          return throwError()
        end)
        if not ok then
          return "caught error"
        else
          return "no error"
        end
      `, { 
        throwError: () => { throw new Error('test error') }
      })
      expect(result.result).toBe('caught error')
    })

    it('应该能处理 Promise rejection', async () => {
      // Promise rejection 通过 CallbackManager reject 传递，会导致 Lua 错误
      const result = await instance.run(`
        local ok, err = pcall(function()
          return rejectPromise()
        end)
        if not ok then
          return "caught rejection"
        else
          return "no error"
        end
      `, { 
        rejectPromise: () => Promise.reject(new Error('rejection'))
      })
      expect(result.result).toBe('caught rejection')
    })
  })
})

describe('JsProxy - 与 JS 模块集成', () => {
  let store: MemoryRDFStore
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(() => {
    store = new MemoryRDFStore()
    instance = createLuaInstance({ rdfStore: store })
  })

  afterEach(() => {
    instance.destroy()
  })

  it('应该能同时使用 JS 模块和参数', async () => {
    // 注册 JS 模块
    instance.registerJsModule('utils', {
      double: (x: number) => x * 2
    })

    // 使用参数和 JS 模块
    const result = await instance.run(`
      local utils = require("utils")
      return utils.double(value)
    `, { value: 21 })

    expect(result.error).toBeNull()
    expect(result.result).toBe(42)
  })

  it('参数中的函数应该和 JS 模块函数行为一致', async () => {
    // 通过 JS 模块注册
    instance.registerJsModule('mathLib', {
      add: (a: number, b: number) => a + b
    })

    // 通过参数传递 - 分开测试
    const result1 = await instance.run(`
      local mathLib = require("mathLib")
      return mathLib.add(1, 2)
    `)
    
    const result2 = await instance.run(`
      return addFn(1, 2)
    `, { 
      addFn: (a: number, b: number) => a + b 
    })

    expect(result1.error).toBeNull()
    expect(result1.result).toBe(3)
    expect(result2.error).toBeNull()
    expect(result2.result).toBe(3)
  })
})
