import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, createLuaInstance, type LuaInstance } from '../../src/index'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('Lua async interleaving', () => {
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

  it('should interleave two run() calls on the SAME instance when one yields on async', async () => {
    const callOrder: string[] = []

    instance.registerJsModule('testAPI', {
      slowStream: async function* () {
        callOrder.push('stream: yielding 1')
        yield 1
        callOrder.push('stream: before async wait')
        await delay(50)
        callOrder.push('stream: after async wait')
        yield 2
      },
      record: (msg: string) => {
        callOrder.push(msg)
      },
    })

    // Start streaming task — it will yield on await delay(50)
    const promise1 = instance.run(`
      local api = require("testAPI")
      local items = {}
      for item in api.slowStream() do
        table.insert(items, item)
      end
      return items
    `)

    // Give the first task time to start and hit the async wait
    await delay(20)

    // Run a second task on the SAME instance while first is suspended
    const promise2 = instance.run(`
      local api = require("testAPI")
      api.record("task2: running while task1 waits")
      return 42
    `)

    const [result1, result2] = await Promise.all([promise1, promise2])

    console.log('Call order:', callOrder)

    // Task 2 should have completed
    expect(result2.result).toBe(42)
    expect(result2.error).toBeNull()

    // Task 1 should have collected both items
    expect(result1.result).toEqual([1, 2])
    expect(result1.error).toBeNull()

    // Verify interleaving: task2 ran BETWEEN task1's async waits
    const task2Index = callOrder.indexOf('task2: running while task1 waits')
    const beforeWaitIndex = callOrder.indexOf('stream: before async wait')
    const afterWaitIndex = callOrder.indexOf('stream: after async wait')

    expect(task2Index).toBeGreaterThan(-1)
    expect(task2Index).toBeGreaterThan(beforeWaitIndex)
    expect(task2Index).toBeLessThan(afterWaitIndex)
  })

  it('should interleave across different instances', async () => {
    const instance2 = createLuaInstance()
    const callOrder: string[] = []

    instance.registerJsModule('testAPI', {
      slowStream: async function* () {
        callOrder.push('instance1: yielding 1')
        yield 1
        callOrder.push('instance1: before async wait')
        await delay(50)
        callOrder.push('instance1: after async wait')
        yield 2
      },
    })

    instance2.registerJsModule('tracker', {
      record: (msg: string) => {
        callOrder.push(msg)
      },
    })

    const promise1 = instance.run(`
      local api = require("testAPI")
      local items = {}
      for item in api.slowStream() do
        table.insert(items, item)
      end
      return items
    `)

    await delay(20)

    const result2 = await instance2.run(`
      local t = require("tracker")
      t.record("instance2: running during instance1 wait")
      return 99
    `)

    const result1 = await promise1

    console.log('Call order:', callOrder)

    expect(result2.result).toBe(99)
    expect(result1.result).toEqual([1, 2])

    const inst2Index = callOrder.indexOf('instance2: running during instance1 wait')
    const beforeWaitIndex = callOrder.indexOf('instance1: before async wait')
    const afterWaitIndex = callOrder.indexOf('instance1: after async wait')

    expect(inst2Index).toBeGreaterThan(beforeWaitIndex)
    expect(inst2Index).toBeLessThan(afterWaitIndex)

    instance2.destroy()
  })
})
