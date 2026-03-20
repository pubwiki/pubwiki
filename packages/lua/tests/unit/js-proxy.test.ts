import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, createLuaInstance, type LuaInstance } from '../../src/index'

// Simple json module for testing JsProxy serialization
const createTestJsonModule = () => ({
  encode(value: unknown): string {
    return JSON.stringify(value)
  },
  decode(str: string): unknown {
    return JSON.parse(str)
  }
})

describe('JsProxy - 参数传递', () => {
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(async () => {
    instance = createLuaInstance()
    // Register json module for tests that need it
    instance.registerJsModule('json', createTestJsonModule(), { mode: 'global' })
  })

  afterEach(async () => {
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

    it('应该能用 ipairs 迭代数组', async () => {
      const result = await instance.run(`
        local result = {}
        for i, v in ipairs(items) do
          table.insert(result, i .. ":" .. v)
        end
        return table.concat(result, ",")
      `, { items: ['a', 'b', 'c'] })
      expect(result.error).toBeNull()
      expect(result.result).toBe('1:a,2:b,3:c')
    })

    it('应该能迭代空对象', async () => {
      const result = await instance.run(`
        local count = 0
        for k, v in pairs(obj) do
          count = count + 1
        end
        return count
      `, { obj: {} })
      expect(result.error).toBeNull()
      expect(result.result).toBe(0)
    })

    it('应该能迭代空数组', async () => {
      const result = await instance.run(`
        local count = 0
        for i, v in ipairs(arr) do
          count = count + 1
        end
        return count
      `, { arr: [] })
      expect(result.error).toBeNull()
      expect(result.result).toBe(0)
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

    it('应该能使用 isNull 方法检查 JsProxy 是否为 null', async () => {
      // 注意：直接传递 null 会变成 Lua nil，无法调用方法
      // 这里测试 JsProxy 对象的 isNull 方法
      const result = await instance.run(`
        -- 普通对象不是 null
        local notNull = obj:isNull()
        return tostring(notNull)
      `, { obj: { a: 1 } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('false')
    })

    it('应该能使用 isUndefined 方法检查 JsProxy 是否为 undefined', async () => {
      // 注意：直接传递 undefined 会变成 Lua nil，无法调用方法
      // 这里测试 JsProxy 对象的 isUndefined 方法
      const result = await instance.run(`
        -- 普通对象不是 undefined
        local notUndef = obj:isUndefined()
        return tostring(notUndef)
      `, { obj: { a: 1 } })
      expect(result.error).toBeNull()
      expect(result.result).toBe('false')
    })

    it('null/undefined 参数会直接变成 Lua nil', async () => {
      // 这是预期行为：JS 的 null/undefined 转换为 Lua nil
      const result = await instance.run(`
        local results = {}
        if nullVal == nil then table.insert(results, "null is nil") end
        if undefVal == nil then table.insert(results, "undefined is nil") end
        return table.concat(results, ", ")
      `, { nullVal: null, undefVal: undefined })
      expect(result.error).toBeNull()
      expect(result.result).toBe('null is nil, undefined is nil')
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

    it('应该能修改 JsProxy 对象属性', async () => {
      const obj = { name: 'original', count: 0 }
      const result = await instance.run(`
        data.name = "modified"
        data.count = 42
        data.newField = "added"
        return data.name .. "," .. tostring(data.count) .. "," .. data.newField
      `, { data: obj })
      expect(result.error).toBeNull()
      expect(result.result).toBe('modified,42,added')
      // 验证原 JS 对象也被修改
      expect(obj.name).toBe('modified')
      expect(obj.count).toBe(42)
      expect((obj as Record<string, unknown>).newField).toBe('added')
    })

    it('应该能修改 JsProxy 数组元素', async () => {
      const arr = [10, 20, 30]
      const result = await instance.run(`
        -- 使用 1-based 索引修改
        arr[1] = 100
        arr[2] = 200
        return arr[1] + arr[2] + arr[3]
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe(330) // 100 + 200 + 30
      // 验证原 JS 数组也被修改
      expect(arr[0]).toBe(100)
      expect(arr[1]).toBe(200)
    })

    it('应该能将 JsProxy 作为参数传递给函数', async () => {
      const result = await instance.run(`
        return process(data)
      `, { 
        data: { value: 42 },
        process: (obj: Record<string, unknown>) => (obj.value as number) * 2
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

describe('JsProxy - table.insert 和 table.remove 支持', () => {
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

  describe('table.insert 基本操作', () => {
    it('应该能在 JS 数组末尾插入元素', async () => {
      const arr = [1, 2, 3]
      const result = await instance.run(`
        table.insert(arr, 4)
        return #arr
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe(4)
      expect(arr).toEqual([1, 2, 3, 4])
    })

    it('应该能在 JS 数组指定位置插入元素', async () => {
      const arr = [1, 2, 3]
      const result = await instance.run(`
        table.insert(arr, 2, 10)
        return arr[2]
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe(10)
      expect(arr).toEqual([1, 10, 2, 3])
    })

    it('应该能在 JS 数组开头插入元素', async () => {
      const arr = ['b', 'c']
      const result = await instance.run(`
        table.insert(arr, 1, "a")
        return arr[1]
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe('a')
      expect(arr).toEqual(['a', 'b', 'c'])
    })
  })

  describe('table.remove 基本操作', () => {
    // table.remove 在 JsProxy 上操作时，会使用 JS 的 splice 方法来真正删除元素
    // 这样可以保持与 Lua 语义一致：删除后数组长度会减少

    it('应该能从 JS 数组末尾移除元素并返回被移除的值', async () => {
      const arr = [1, 2, 3]
      const result = await instance.run(`
        local removed = table.remove(arr)
        return removed
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe(3)
      // 使用 splice 真正删除元素，数组长度减少
      expect(arr).toEqual([1, 2])
    })

    it('应该能从 JS 数组指定位置移除元素并移动后续元素', async () => {
      const arr = ['a', 'b', 'c']
      const result = await instance.run(`
        local removed = table.remove(arr, 2)
        return removed
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe('b')
      // 使用 splice 真正删除元素
      expect(arr).toEqual(['a', 'c'])
    })

    it('应该能从 JS 数组开头移除元素并移动所有后续元素', async () => {
      const arr = [10, 20, 30]
      const result = await instance.run(`
        local removed = table.remove(arr, 1)
        return removed
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe(10)
      // 使用 splice 真正删除元素
      expect(arr).toEqual([20, 30])
    })
  })

  describe('带有自定义 setter 的对象', () => {
    it('应该能通过 table.insert 触发自定义 setter', async () => {
      // 创建一个带有自定义 setter 的对象
      const logs: string[] = []
      const arr = new Proxy([1, 2, 3] as (number | undefined)[], {
        set(target, prop, value) {
          logs.push(`set ${String(prop)} = ${value}`)
          target[prop as unknown as number] = value
          return true
        },
        get(target, prop) {
          if (prop === 'length') {
            return target.length
          }
          return target[prop as unknown as number]
        }
      })

      const result = await instance.run(`
        table.insert(arr, 4)
        return #arr
      `, { arr })

      expect(result.error).toBeNull()
      expect(result.result).toBe(4)
      // 验证 setter 被调用
      expect(logs.length).toBeGreaterThan(0)
      expect(logs.some(log => log.includes('= 4'))).toBe(true)
    })

    it('应该能通过 table.insert 在指定位置插入并触发多次 setter', async () => {
      // 创建一个带有自定义 setter 的对象，记录所有写入操作
      const logs: string[] = []
      const arr = new Proxy([1, 2, 3] as (number | undefined)[], {
        set(target, prop, value) {
          logs.push(`set [${String(prop)}] = ${value}`)
          target[prop as unknown as number] = value
          return true
        },
        get(target, prop) {
          if (prop === 'length') {
            return target.length
          }
          return target[prop as unknown as number]
        }
      })

      const result = await instance.run(`
        -- 在位置 2 插入 10，应该触发元素移动
        table.insert(arr, 2, 10)
        return arr[2]
      `, { arr })

      expect(result.error).toBeNull()
      expect(result.result).toBe(10)
      // 验证 setter 被多次调用（移动元素 + 插入新值）
      expect(logs.length).toBeGreaterThanOrEqual(2)
      // 检查是否有设置新值的记录
      expect(logs.some(log => log.includes('= 10'))).toBe(true)
    })

    it('应该能通过 table.remove 使用 splice 删除元素并触发 Proxy 拦截', async () => {
      // table.remove 在 JsProxy 上使用 splice 方法
      // Proxy 的 set trap 会捕获 splice 内部的元素移动操作
      const logs: string[] = []
      const arr = new Proxy(['a', 'b', 'c'] as (string | undefined)[], {
        set(target, prop, value) {
          logs.push(`set [${String(prop)}] = ${value}`)
          target[prop as unknown as number] = value
          return true
        },
        get(target, prop) {
          if (prop === 'length') {
            return target.length
          }
          if (prop === 'splice') {
            // 返回原始 splice 方法
            return Array.prototype.splice.bind(target)
          }
          return target[prop as unknown as number]
        }
      })

      const result = await instance.run(`
        local removed = table.remove(arr, 1)
        return removed
      `, { arr })

      expect(result.error).toBeNull()
      expect(result.result).toBe('a')
      // 使用 splice 后，数组长度会正确减少
      expect(arr.length).toBe(2)
      expect(arr).toEqual(['b', 'c'])
    })

    it('应该能使用带有 getter 验证的 Proxy 对象', async () => {
      // 创建一个同时有 getter 和 setter 的 Proxy
      let accessCount = 0
      let writeCount = 0
      const arr = new Proxy([10, 20, 30] as number[], {
        get(target, prop) {
          if (prop === 'length') {
            return target.length
          }
          accessCount++
          return target[prop as unknown as number]
        },
        set(target, prop, value) {
          writeCount++
          target[prop as unknown as number] = value
          return true
        }
      })

      const result = await instance.run(`
        -- 插入一个元素
        table.insert(arr, 2, 15)
        -- 返回新插入位置的值
        return arr[2]
      `, { arr })

      expect(result.error).toBeNull()
      expect(result.result).toBe(15)
      // 验证 getter 和 setter 都被调用
      expect(accessCount).toBeGreaterThan(0)
      expect(writeCount).toBeGreaterThan(0)
    })

    it('应该能正确处理带有副作用的 setter', async () => {
      // 创建一个 setter 有副作用的对象（例如：自动更新时间戳）
      const metadata = {
        lastModified: 0,
        modificationCount: 0
      }
      const arr = new Proxy([1, 2, 3] as (number | undefined)[], {
        set(target, prop, value) {
          target[prop as unknown as number] = value
          metadata.lastModified = Date.now()
          metadata.modificationCount++
          return true
        },
        get(target, prop) {
          if (prop === 'length') {
            return target.length
          }
          return target[prop as unknown as number]
        }
      })

      const initialCount = metadata.modificationCount

      const result = await instance.run(`
        table.insert(arr, 100)
        table.insert(arr, 1, 0)
        table.remove(arr)
        return #arr
      `, { arr })

      expect(result.error).toBeNull()
      // 验证 setter 的副作用被触发
      expect(metadata.modificationCount).toBeGreaterThan(initialCount)
      expect(metadata.lastModified).toBeGreaterThan(0)
    })
  })

  describe('边界情况', () => {
    it('应该能处理空 JS 数组的 table.insert', async () => {
      const arr: number[] = []
      const result = await instance.run(`
        table.insert(arr, 1)
        return #arr
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe(1)
      expect(arr).toEqual([1])
    })

    it('应该能处理空 JS 数组的 table.remove', async () => {
      const arr: number[] = []
      const result = await instance.run(`
        local removed = table.remove(arr)
        if removed == nil then
          return "nil"
        else
          return removed
        end
      `, { arr })
      expect(result.error).toBeNull()
      expect(result.result).toBe('nil')
    })

    it('应该拒绝无效的插入位置', async () => {
      const arr = [1, 2, 3]
      const result = await instance.run(`
        table.insert(arr, 10, "invalid")
        return "should not reach"
      `, { arr })
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('position out of bounds')
    })

    it('应该拒绝无效的移除位置', async () => {
      const arr = [1, 2, 3]
      const result = await instance.run(`
        table.remove(arr, 10)
        return "should not reach"
      `, { arr })
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('position out of bounds')
    })

    it('应该拒绝非数组的 JS 对象使用 table.insert', async () => {
      // 非数组对象应该被拒绝
      const obj = { name: 'test', value: 42 }
      const result = await instance.run(`
        table.insert(obj, "inserted")
        return "should not reach"
      `, { obj })
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('table or array expected')
    })

    it('应该拒绝非数组的 JS 对象使用 table.remove', async () => {
      // 非数组对象应该被拒绝
      const obj = { name: 'test', value: 42 }
      const result = await instance.run(`
        table.remove(obj)
        return "should not reach"
      `, { obj })
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('table or array expected')
    })

    it('应该拒绝类数组对象（array-like object）使用 table 操作', async () => {
      // 类数组对象虽然有 length 属性，但不是真正的数组，应该被拒绝
      const arrayLike = { 0: 'a', 1: 'b', 2: 'c', length: 3 }
      const result = await instance.run(`
        table.remove(arrayLike)
        return "should not reach"
      `, { arrayLike })
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('table or array expected')
    })
  })
})
