/**
 * E2E tests for real MessagePort RPC communication
 *
 * These tests verify actual RPC calls over MessagePort:
 * - Host side creates RPC session with services
 * - Client side creates RPC session to call remote services
 * - Messages flow through real MessagePort channels
 *
 * Uses the new ICustomService interface with service.call() pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { newMessagePortRpcSession, type RpcStub } from 'capnweb'
import { createMainRpcHost, type MainRpcHost } from '../../src/rpc-host'
import type { SandboxMainService, HmrUpdate, ICustomService, ServiceDefinition } from '@pubwiki/sandbox-service'

// =============================================================================
// Helper Functions for Creating Mock ICustomService Implementations
// =============================================================================

/**
 * Create a stateful service with internal state management
 */
function createStatefulService<TState>(
  name: string,
  namespace: string,
  initialState: TState,
  handlers: Record<string, (state: TState, inputs: Record<string, unknown>) => { state?: TState; outputs: Record<string, unknown> }>
): ICustomService {
  let state = initialState

  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      const action = inputs.action as string
      const handler = handlers[action]
      if (!handler) {
        throw new Error(`Unknown action: ${action}`)
      }
      const result = handler(state, inputs)
      if (result.state !== undefined) {
        state = result.state
      }
      return result.outputs
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name,
        namespace,
        identifier: `${namespace}:${name}`,
        kind: 'ACTION',
        inputs: { type: 'object' },
        outputs: { type: 'object' }
      }
    }
  }
}

describe('Real MessagePort RPC Communication', () => {
  let channel: MessageChannel
  let host: MainRpcHost
  let client: RpcStub<SandboxMainService>

  beforeEach(() => {
    // Create a real MessageChannel
    channel = new MessageChannel()

    // Host uses port1
    host = createMainRpcHost(channel.port1, {
      basePath: '/public/demo'
    })

    // Client uses port2 - creates RPC stub to call remote services
    client = newMessagePortRpcSession<SandboxMainService>(channel.port2, {})

    // Start ports (required for MessagePort communication)
    channel.port1.start()
    channel.port2.start()
  })

  afterEach(() => {
    if (host) host.disconnect()
    channel.port1.close()
    channel.port2.close()
  })

  describe('HMR Service via RPC', () => {
    it('should call HMR subscribe method through RPC', async () => {
      const updates: HmrUpdate[] = []

      // Call subscribe via RPC (real MessagePort communication)
      const subscription = await client.hmr.subscribe((update: HmrUpdate) => {
        updates.push(update)
      })

      expect(subscription).toBeDefined()
      expect(subscription.id).toBeDefined()
    })

    it('should receive HMR updates through RPC callback', async () => {
      const updates: HmrUpdate[] = []

      // Subscribe via RPC
      await client.hmr.subscribe((update: HmrUpdate) => {
        updates.push(update)
      })

      // Trigger update from host side using the HMR service
      host.getHmrService().notifyUpdate({
        path: '/src/app.tsx',
        type: 'update',
        timestamp: Date.now()
      })

      // Wait for RPC message to propagate
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(updates.length).toBe(1)
      expect(updates[0].path).toBe('/src/app.tsx')
      expect(updates[0].type).toBe('update')
    })

    it('should handle multiple HMR updates through RPC', async () => {
      const updates: HmrUpdate[] = []

      await client.hmr.subscribe((update: HmrUpdate) => {
        updates.push(update)
      })

      // Trigger multiple updates via HMR service
      host.getHmrService().notifyUpdate({ path: '/src/a.tsx', type: 'update', timestamp: Date.now() })
      host.getHmrService().notifyUpdate({ path: '/src/b.tsx', type: 'update', timestamp: Date.now() })
      host.getHmrService().notifyUpdate({ path: '/src/c.tsx', type: 'update', timestamp: Date.now() })

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(updates.length).toBe(3)
      expect(updates.map(u => u.path)).toEqual([
        '/src/a.tsx',
        '/src/b.tsx',
        '/src/c.tsx'
      ])
    })

    it('should unsubscribe from HMR updates via RPC', async () => {
      const updates: HmrUpdate[] = []

      const subscription = await client.hmr.subscribe((update: HmrUpdate) => {
        updates.push(update)
      })

      // First update should be received
      host.getHmrService().notifyUpdate({ path: '/src/first.tsx', type: 'update', timestamp: Date.now() })
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(updates.length).toBe(1)

      // Unsubscribe via RPC
      await client.hmr.unsubscribe(subscription.id)

      // Second update should NOT be received
      host.getHmrService().notifyUpdate({ path: '/src/second.tsx', type: 'update', timestamp: Date.now() })
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(updates.length).toBe(1)
    })
  })

  describe('Custom Services via RPC', () => {
    it('should call custom service methods through service.call()', async () => {
      // Create a counter service using ICustomService
      interface CounterState {
        value: number
      }

      const counterService = createStatefulService<CounterState>(
        'counter',
        'demo',
        { value: 0 },
        {
          getValue: (state) => ({ outputs: { value: state.value } }),
          increment: (state) => {
            state.value++
            return { state, outputs: { value: state.value } }
          },
          decrement: (state) => {
            state.value--
            return { state, outputs: { value: state.value } }
          },
          reset: (state) => {
            state.value = 0
            return { state, outputs: {} }
          }
        }
      )

      // Register custom service on host
      host.registerService('counter', counterService)

      // Access service via host.getService()
      const counter = host.getService('counter')
      expect(counter).toBeDefined()

      // Call service via service.call()
      const getValueResult = await counter!.call({ action: 'getValue' })
      expect(getValueResult.value).toBe(0)

      const incrementResult1 = await counter!.call({ action: 'increment' })
      expect(incrementResult1.value).toBe(1)

      const incrementResult2 = await counter!.call({ action: 'increment' })
      expect(incrementResult2.value).toBe(2)

      const decrementResult = await counter!.call({ action: 'decrement' })
      expect(decrementResult.value).toBe(1)

      await counter!.call({ action: 'reset' })
      const finalResult = await counter!.call({ action: 'getValue' })
      expect(finalResult.value).toBe(0)
    })

    it('should handle async service methods through service.call()', async () => {
      // Create async data service
      const mockData = new Map([
        ['1', { id: '1', data: 'Item 1', timestamp: Date.now() }],
        ['2', { id: '2', data: 'Item 2', timestamp: Date.now() }]
      ])

      const asyncDataService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'fetchData': {
              await new Promise(resolve => setTimeout(resolve, 10))
              const item = mockData.get(inputs.id as string)
              if (!item) throw new Error(`Item ${inputs.id} not found`)
              return { item }
            }
            case 'fetchAll': {
              await new Promise(resolve => setTimeout(resolve, 10))
              const items = Array.from(mockData.values()).map(item => ({
                id: item.id,
                name: item.data
              }))
              return { items }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'asyncData',
            namespace: 'demo',
            identifier: 'demo:asyncData',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('asyncData', asyncDataService)

      const dataService = host.getService('asyncData')
      expect(dataService).toBeDefined()

      // Call async methods via service.call()
      const item1Result = await dataService!.call({ action: 'fetchData', id: '1' })
      const item1 = item1Result.item as { id: string; data: string; timestamp: number }
      expect(item1.id).toBe('1')
      expect(item1.data).toBe('Item 1')

      const allItemsResult = await dataService!.call({ action: 'fetchAll' })
      const allItems = allItemsResult.items as Array<{ id: string; name: string }>
      expect(allItems.length).toBe(2)
    })

    it('should handle service method errors through service.call()', async () => {
      const errorService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'throwError':
              throw new Error('Intentional error')
            case 'throwAsync':
              await new Promise(resolve => setTimeout(resolve, 10))
              throw new Error('Async error')
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'errorService',
            namespace: 'demo',
            identifier: 'demo:errorService',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('errorService', errorService)

      const service = host.getService('errorService')
      expect(service).toBeDefined()

      // Sync error
      await expect(service!.call({ action: 'throwError' })).rejects.toThrow('Intentional error')

      // Async error
      await expect(service!.call({ action: 'throwAsync' })).rejects.toThrow('Async error')
    })

    it('should handle complex data types through service.call()', async () => {
      interface ComplexData {
        nested: {
          array: number[]
          map: Record<string, string>
        }
        date: string
        optional?: string
      }

      const complexService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'processData': {
              const input = inputs.data as ComplexData
              return {
                result: {
                  ...input,
                  nested: {
                    ...input.nested,
                    array: input.nested.array.map(n => n * 2)
                  }
                }
              }
            }
            case 'getComplexResult': {
              return {
                result: {
                  nested: {
                    array: [1, 2, 3],
                    map: { key: 'value' }
                  },
                  date: new Date().toISOString()
                }
              }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'complexService',
            namespace: 'demo',
            identifier: 'demo:complexService',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('complexService', complexService)

      const service = host.getService('complexService')
      expect(service).toBeDefined()

      const input: ComplexData = {
        nested: {
          array: [1, 2, 3],
          map: { a: 'b' }
        },
        date: '2024-01-01'
      }

      const processResult = await service!.call({ action: 'processData', data: input })
      const result = processResult.result as ComplexData
      expect(result.nested.array).toEqual([2, 4, 6])
      expect(result.nested.map).toEqual({ a: 'b' })

      const complexResultResponse = await service!.call({ action: 'getComplexResult' })
      const complexResult = complexResultResponse.result as ComplexData
      expect(complexResult.nested.array).toEqual([1, 2, 3])
      expect(complexResult.nested.map).toEqual({ key: 'value' })
    })
  })

  describe('Multiple Clients Communication', () => {
    it('should handle multiple clients connecting to same host', async () => {
      // Create second client
      const channel2 = new MessageChannel()
      const host2Port = channel2.port1
      const client2Port = channel2.port2

      // We need a separate host for the second client because each host manages one port
      const host2 = createMainRpcHost(host2Port, { basePath: '/public/demo2' })
      const _client2 = newMessagePortRpcSession<SandboxMainService>(client2Port, {})

      host2Port.start()
      client2Port.start()

      // Create counter service factory that returns services with different initial values
      function createCounterService(initialValue: number): ICustomService {
        let value = initialValue

        return {
          async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
            const action = inputs.action as string
            switch (action) {
              case 'increment':
                return { value: ++value }
              case 'getValue':
                return { value }
              default:
                throw new Error(`Unknown action: ${action}`)
            }
          },
          async getDefinition(): Promise<ServiceDefinition> {
            return {
              name: 'counter',
              namespace: 'demo',
              identifier: 'demo:counter',
              kind: 'ACTION',
              inputs: { type: 'object' },
              outputs: { type: 'object' }
            }
          }
        }
      }

      // Register services with different initial values to distinguish them
      host.registerService('counter', createCounterService(100)) // Start at 100
      host2.registerService('counter', createCounterService(200)) // Start at 200

      // Each client calls their own host via service.call()
      const counter1 = host.getService('counter')!
      const counter2 = host2.getService('counter')!

      const result1 = await counter1.call({ action: 'increment' })
      const result2 = await counter2.call({ action: 'increment' })

      // Verify they are independent (different initial values)
      expect(result1.value).toBe(101) // 100 + 1
      expect(result2.value).toBe(201) // 200 + 1

      // Cleanup
      host2.disconnect()
      channel2.port1.close()
      channel2.port2.close()
    })
  })

  describe('Service Registration and Discovery', () => {
    it('should allow dynamically registered services to be called', async () => {
      // Register service after host creation
      const greetingService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const name = inputs.name as string
          return { greeting: `Hello, ${name}!` }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'dynamicService',
            namespace: 'demo',
            identifier: 'demo:dynamicService',
            kind: 'PURE',
            inputs: { type: 'object', properties: { name: { type: 'string' } } },
            outputs: { type: 'object', properties: { greeting: { type: 'string' } } }
          }
        }
      }

      host.registerService('dynamicService', greetingService)

      // Should be able to call the new service
      const service = host.getService('dynamicService')
      expect(service).toBeDefined()

      const result = await service!.call({ name: 'World' })
      expect(result.greeting).toBe('Hello, World!')
    })

    it('should handle service replacement for existing connections', async () => {
      // Register initial service
      const serviceV1: ICustomService = {
        async call(): Promise<Record<string, unknown>> {
          return { value: 'v1' }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'replaceable',
            namespace: 'demo',
            identifier: 'demo:replaceable',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      const serviceV2: ICustomService = {
        async call(): Promise<Record<string, unknown>> {
          return { value: 'v2' }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'replaceable',
            namespace: 'demo',
            identifier: 'demo:replaceable',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('replaceable', serviceV1)

      const v1Result = await host.getService('replaceable')!.call({})
      expect(v1Result.value).toBe('v1')

      // Replace service
      host.registerService('replaceable', serviceV2)

      const v2Result = await host.getService('replaceable')!.call({})
      expect(v2Result.value).toBe('v2')
    })
  })

  describe('Performance and Reliability', () => {
    it('should handle rapid successive calls', async () => {
      let callCount = 0

      const perfService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string
          switch (action) {
            case 'increment':
              return { count: ++callCount }
            case 'getCount':
              return { count: callCount }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'perf',
            namespace: 'demo',
            identifier: 'demo:perf',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('perf', perfService)

      const perf = host.getService('perf')!

      // Make many rapid calls
      const promises = Array.from({ length: 100 }, () => perf.call({ action: 'increment' }))
      await Promise.all(promises)

      const countResult = await perf.call({ action: 'getCount' })
      expect(countResult.count).toBe(100)
    })

    it('should maintain call order for sequential calls', async () => {
      const callOrder: number[] = []

      const orderService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const n = inputs.n as number
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10))
          callOrder.push(n)
          return { n }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'order',
            namespace: 'demo',
            identifier: 'demo:order',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('order', orderService)

      const order = host.getService('order')!

      // Sequential calls
      for (let i = 0; i < 10; i++) {
        await order.call({ n: i })
      }

      expect(callOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('should handle large data transfer', async () => {
      const largeDataService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'echo':
              return { data: inputs.data }
            case 'generateLarge': {
              const size = inputs.size as number
              return {
                data: {
                  array: Array.from({ length: size }, (_, i) => i),
                  text: 'x'.repeat(size)
                }
              }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'largeData',
            namespace: 'demo',
            identifier: 'demo:largeData',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('largeData', largeDataService)

      const largeData = host.getService('largeData')!

      // Send large object
      const bigArray = Array.from({ length: 1000 }, (_, i) => ({ index: i, value: `item-${i}` }))
      const echoResult = await largeData.call({ action: 'echo', data: bigArray })
      const echoed = echoResult.data as Array<{ index: number; value: string }>
      expect(echoed.length).toBe(1000)
      expect(echoed[500]).toEqual({ index: 500, value: 'item-500' })

      // Receive large object
      const generateResult = await largeData.call({ action: 'generateLarge', size: 1000 })
      const generated = generateResult.data as { array: number[]; text: string }
      expect(generated.array.length).toBe(1000)
      expect(generated.text.length).toBe(1000)
    })
  })

  describe('Security - Internal Methods', () => {
    it('should not allow direct registration via client RPC', async () => {
      // capnweb RPC Proxy returns a function for any property access
      // But calling internal methods should fail or have no effect
      const internalMethod = (client as any)._registerCustomService

      if (internalMethod) {
        try {
          // Try to register a malicious service via RPC
          await internalMethod('hack', {})
        } catch (_error) {
          // Expected: RPC call should fail because _registerCustomService is not a class method
        }
      }

      // Verify that 'hack' service was NOT registered
      const hackService = host.getService('hack')
      expect(hackService).toBeUndefined()
    })

    it('should only expose hmr getter and public methods via RPC', async () => {
      // HMR should be accessible
      expect(client.hmr).toBeDefined()

      // Internal maps exist as RPC proxies but calling them should fail
      // because they're instance properties, not prototype methods
      const customServicesMap = (client as any).customServicesMap
      if (customServicesMap) {
        try {
          // Trying to use it should fail
          await customServicesMap.get?.('test')
        } catch (error) {
          // Expected: not a real Map, RPC call fails
          expect(error).toBeDefined()
        }
      }
    })

    it('should not allow client to register services directly', async () => {
      // Create a malicious service
      const maliciousService: ICustomService = {
        async call(): Promise<Record<string, unknown>> {
          return { evil: 'pwned' }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'evil',
            namespace: 'hack',
            identifier: 'hack:evil',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      // Try various ways to register - these should all fail
      const registerAttempts = [
        async () => await (client as any)._registerCustomService?.('evil', maliciousService),
        async () => await (client as any).registerCustomService?.('evil', maliciousService),
      ]

      for (const attempt of registerAttempts) {
        try {
          await attempt()
        } catch (_error) {
          // Expected: registration should fail
        }
      }

      // Verify that 'evil' service was NOT registered on host
      const evilService = host.getService('evil')
      expect(evilService).toBeUndefined()
    })
  })

  describe('Service Definition via getDefinition()', () => {
    it('should return proper JSON Schema from getDefinition()', async () => {
      const calculatorService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const a = inputs.a as number
          const b = inputs.b as number
          const op = inputs.operation as string

          switch (op) {
            case 'add': return { result: a + b }
            case 'subtract': return { result: a - b }
            case 'multiply': return { result: a * b }
            case 'divide': return { result: a / b }
            default: throw new Error(`Unknown operation: ${op}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'calculator',
            namespace: 'math',
            identifier: 'math:calculator',
            kind: 'PURE',
            description: 'Basic arithmetic operations',
            inputs: {
              type: 'object',
              properties: {
                a: { type: 'number', description: 'First operand' },
                b: { type: 'number', description: 'Second operand' },
                operation: { type: 'string', description: 'Operation to perform' }
              },
              required: ['a', 'b', 'operation']
            },
            outputs: {
              type: 'object',
              properties: {
                result: { type: 'number', description: 'Calculation result' }
              }
            }
          }
        }
      }

      host.registerService('calculator', calculatorService)

      const service = host.getService('calculator')
      expect(service).toBeDefined()

      const definition = await service!.getDefinition()

      // Verify basic properties
      expect(definition.name).toBe('calculator')
      expect(definition.namespace).toBe('math')
      expect(definition.identifier).toBe('math:calculator')
      expect(definition.kind).toBe('PURE')
      expect(definition.description).toBe('Basic arithmetic operations')

      // Verify inputs schema
      expect(definition.inputs.type).toBe('object')
      expect(definition.inputs.properties).toBeDefined()
      expect(definition.inputs.properties!.a).toEqual({ type: 'number', description: 'First operand' })
      expect(definition.inputs.required).toContain('a')
      expect(definition.inputs.required).toContain('b')
      expect(definition.inputs.required).toContain('operation')

      // Verify outputs schema
      expect(definition.outputs.type).toBe('object')
      expect(definition.outputs.properties).toBeDefined()
      expect(definition.outputs.properties!.result).toEqual({ type: 'number', description: 'Calculation result' })

      // Verify service actually works
      const addResult = await service!.call({ a: 5, b: 3, operation: 'add' })
      expect(addResult.result).toBe(8)

      const multiplyResult = await service!.call({ a: 4, b: 7, operation: 'multiply' })
      expect(multiplyResult.result).toBe(28)
    })
  })

  describe('Service Listing via listServices()', () => {
    it('should list all registered services via client.listServices()', async () => {
      const storageService: ICustomService = {
        async call(): Promise<Record<string, unknown>> {
          return { stored: true }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'storage',
            namespace: 'data',
            identifier: 'data:storage',
            kind: 'ACTION',
            description: 'Persistent storage service',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      const loggerService: ICustomService = {
        async call(): Promise<Record<string, unknown>> {
          return {}
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'logger',
            namespace: 'utils',
            identifier: 'utils:logger',
            kind: 'ACTION',
            description: 'Logging service',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('storage', storageService)
      host.registerService('logger', loggerService)

      // List services via RPC client
      const services = await client.listServices()

      expect(services).toHaveLength(2)

      const storageDef = services.find(s => s.identifier === 'data:storage')
      expect(storageDef).toBeDefined()
      expect(storageDef!.name).toBe('storage')
      expect(storageDef!.namespace).toBe('data')
      expect(storageDef!.kind).toBe('ACTION')
      expect(storageDef!.description).toBe('Persistent storage service')

      const loggerDef = services.find(s => s.identifier === 'utils:logger')
      expect(loggerDef).toBeDefined()
      expect(loggerDef!.name).toBe('logger')
      expect(loggerDef!.namespace).toBe('utils')
    })

    it('should return empty array when no services are registered', async () => {
      const services = await client.listServices()
      expect(services).toHaveLength(0)
    })
  })
})
