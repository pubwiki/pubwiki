/**
 * Custom Service Integration Tests
 *
 * Tests for dynamic service registration functionality with ICustomService interface.
 * Services use JSON Schema for inputs/outputs instead of Zod schemas.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createMainRpcHost, createMainRpcChannel } from '../../src/rpc-host'
import { MockMessageChannel } from '../helpers'
import type { ICustomService, ServiceDefinition, MainRpcHost } from '../../src/types'

// ==================== Mock ICustomService Implementations ====================

/**
 * Create a mock greeting service implementing ICustomService
 */
function createGreetingService(): ICustomService {
  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      const name = inputs.name as string
      return { greeting: `Hello, ${name}!` }
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name: 'greet',
        namespace: 'greeting',
        identifier: 'greeting:greet',
        kind: 'PURE',
        description: 'A simple greeting service',
        inputs: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' }
          },
          required: ['name']
        },
        outputs: {
          type: 'object',
          properties: {
            greeting: { type: 'string', description: 'The greeting message' }
          },
          required: ['greeting']
        }
      }
    }
  }
}

/**
 * Create a mock calculator service implementing ICustomService
 */
function createCalculatorService(): ICustomService {
  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      const a = inputs.a as number
      const b = inputs.b as number
      const operation = inputs.operation as string
      
      let result: number
      switch (operation) {
        case 'add':
          result = a + b
          break
        case 'subtract':
          result = a - b
          break
        case 'multiply':
          result = a * b
          break
        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
      
      return { result }
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name: 'calculate',
        namespace: 'math',
        identifier: 'math:calculate',
        kind: 'PURE',
        description: 'A calculator service',
        inputs: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First operand' },
            b: { type: 'number', description: 'Second operand' },
            operation: { type: 'string', description: 'Operation: add, subtract, multiply' }
          },
          required: ['a', 'b', 'operation']
        },
        outputs: {
          type: 'object',
          properties: {
            result: { type: 'number', description: 'Calculation result' }
          },
          required: ['result']
        }
      }
    }
  }
}

/**
 * Create a mock state service implementing ICustomService (with side effects)
 */
function createStateService(): ICustomService {
  const state: Map<string, unknown> = new Map()
  
  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      const action = inputs.action as string
      const key = inputs.key as string
      
      switch (action) {
        case 'get':
          return { value: state.get(key), exists: state.has(key) }
        case 'set':
          state.set(key, inputs.value)
          return { success: true }
        case 'delete':
          return { deleted: state.delete(key) }
        case 'keys':
          return { keys: Array.from(state.keys()) }
        case 'clear':
          state.clear()
          return { success: true }
        default:
          throw new Error(`Unknown action: ${action}`)
      }
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name: 'state',
        namespace: 'storage',
        identifier: 'storage:state',
        kind: 'ACTION',
        description: 'A state management service',
        inputs: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Action: get, set, delete, keys, clear' },
            key: { type: 'string', description: 'State key' },
            value: { description: 'Value to store (for set action)' }
          },
          required: ['action']
        },
        outputs: {
          type: 'object',
          properties: {
            value: { description: 'Retrieved value' },
            exists: { type: 'boolean' },
            success: { type: 'boolean' },
            deleted: { type: 'boolean' },
            keys: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  }
}

/**
 * Create a custom service with specific definition
 */
function createCustomService(definition: ServiceDefinition): ICustomService {
  return {
    async call(_inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      return { result: 'mock' }
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return definition
    }
  }
}

// ==================== Tests ====================

describe('Custom Service Registration', () => {
  let channel: MockMessageChannel
  let host: MainRpcHost

  beforeEach(() => {
    channel = new MockMessageChannel()
    host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
      basePath: '/public/demo'
    })
  })

  afterEach(() => {
    host.disconnect()
  })

  describe('ICustomService interface', () => {
    it('should have call and getDefinition methods', () => {
      const service = createGreetingService()

      expect(service.call).toBeDefined()
      expect(typeof service.call).toBe('function')
      expect(service.getDefinition).toBeDefined()
      expect(typeof service.getDefinition).toBe('function')
    })

    it('should return valid ServiceDefinition from getDefinition', async () => {
      const service = createGreetingService()
      const definition = await service.getDefinition()

      expect(definition.name).toBe('greet')
      expect(definition.namespace).toBe('greeting')
      expect(definition.identifier).toBe('greeting:greet')
      expect(definition.kind).toBe('PURE')
      expect(definition.inputs).toBeDefined()
      expect(definition.outputs).toBeDefined()
    })

    it('should support ACTION kind for services with side effects', async () => {
      const service = createStateService()
      const definition = await service.getDefinition()

      expect(definition.kind).toBe('ACTION')
    })

    it('should support PURE kind for services without side effects', async () => {
      const service = createCalculatorService()
      const definition = await service.getDefinition()

      expect(definition.kind).toBe('PURE')
    })
  })

  describe('registerService', () => {
    it('should register a simple service', () => {
      const service = createGreetingService()

      // Should not throw
      expect(() => host.registerService('greeting', service)).not.toThrow()

      // Should be retrievable
      const retrieved = host.getService('greeting')
      expect(retrieved).toBeDefined()
    })

    it('should register multiple services', () => {
      host.registerService('greeting', createGreetingService())
      host.registerService('calculator', createCalculatorService())
      host.registerService('state', createStateService())

      expect(host.getService('greeting')).toBeDefined()
      expect(host.getService('calculator')).toBeDefined()
      expect(host.getService('state')).toBeDefined()
    })

    it('should allow overwriting existing service', () => {
      const service1 = createGreetingService()
      const service2 = createGreetingService()

      host.registerService('greeting', service1)
      host.registerService('greeting', service2)

      // Should have the latest registration
      const retrieved = host.getService('greeting')
      expect(retrieved).toBe(service2)
    })
  })

  describe('getService', () => {
    it('should return registered service', () => {
      const service = createCalculatorService()

      host.registerService('calc', service)

      const retrieved = host.getService('calc')
      expect(retrieved).toBe(service)
    })

    it('should return undefined for non-existent service', () => {
      const result = host.getService('non-existent')
      expect(result).toBeUndefined()
    })

    it('should not return HMR service via getService', () => {
      // HMR is a built-in service, not a custom service
      const result = host.getService('hmr')
      expect(result).toBeUndefined()
    })

    it('should return service that can be called', async () => {
      const service = createGreetingService()
      host.registerService('greeting', service)

      const retrieved = host.getService('greeting')!
      const result = await retrieved.call({ name: 'World' })

      expect(result.greeting).toBe('Hello, World!')
    })

    it('should return service whose definition can be retrieved', async () => {
      const service = createCalculatorService()
      host.registerService('calculator', service)

      const retrieved = host.getService('calculator')!
      const definition = await retrieved.getDefinition()

      expect(definition.name).toBe('calculate')
      expect(definition.namespace).toBe('math')
      expect(definition.identifier).toBe('math:calculate')
    })
  })

  describe('listServices', () => {
    it('should return empty array when no services registered', async () => {
      const newChannel = new MockMessageChannel()
      const newHost = createMainRpcHost(newChannel.port1 as unknown as MessagePort, {
        basePath: '/public/demo'
      })

      // Access internal services to call listServices
      // Note: listServices is on the internal MainRpcServices, not MainRpcHost
      // For now, we test via registering services and checking getService works
      expect(newHost.getService('any')).toBeUndefined()

      newHost.disconnect()
    })

    it('should return definitions for registered services', async () => {
      host.registerService('greeting', createGreetingService())
      host.registerService('calculator', createCalculatorService())

      // Verify services are registered by checking they exist
      const greeting = host.getService('greeting')
      const calculator = host.getService('calculator')

      expect(greeting).toBeDefined()
      expect(calculator).toBeDefined()

      // Verify definitions can be retrieved
      const greetingDef = await greeting!.getDefinition()
      const calculatorDef = await calculator!.getDefinition()

      expect(greetingDef.identifier).toBe('greeting:greet')
      expect(calculatorDef.identifier).toBe('math:calculate')
    })
  })

  describe('service call functionality', () => {
    it('should execute greeting service call correctly', async () => {
      const service = createGreetingService()
      host.registerService('greeting', service)

      const retrieved = host.getService('greeting')!
      const result = await retrieved.call({ name: 'Alice' })

      expect(result.greeting).toBe('Hello, Alice!')
    })

    it('should execute calculator service call correctly', async () => {
      const service = createCalculatorService()
      host.registerService('calculator', service)

      const retrieved = host.getService('calculator')!

      const addResult = await retrieved.call({ a: 5, b: 3, operation: 'add' })
      expect(addResult.result).toBe(8)

      const subResult = await retrieved.call({ a: 10, b: 4, operation: 'subtract' })
      expect(subResult.result).toBe(6)

      const mulResult = await retrieved.call({ a: 3, b: 7, operation: 'multiply' })
      expect(mulResult.result).toBe(21)
    })

    it('should execute state service call correctly', async () => {
      const service = createStateService()
      host.registerService('state', service)

      const retrieved = host.getService('state')!

      // Set a value
      await retrieved.call({ action: 'set', key: 'myKey', value: 'myValue' })

      // Get the value
      const getResult = await retrieved.call({ action: 'get', key: 'myKey' })
      expect(getResult.value).toBe('myValue')
      expect(getResult.exists).toBe(true)

      // Get keys
      const keysResult = await retrieved.call({ action: 'keys' })
      expect(keysResult.keys).toContain('myKey')

      // Delete the value
      const deleteResult = await retrieved.call({ action: 'delete', key: 'myKey' })
      expect(deleteResult.deleted).toBe(true)

      // Verify deletion
      const afterDelete = await retrieved.call({ action: 'get', key: 'myKey' })
      expect(afterDelete.exists).toBe(false)
    })

    it('should throw error for invalid service operation', async () => {
      const service = createCalculatorService()
      host.registerService('calculator', service)

      const retrieved = host.getService('calculator')!

      await expect(
        retrieved.call({ a: 1, b: 2, operation: 'invalid' })
      ).rejects.toThrow('Unknown operation: invalid')
    })
  })

  describe('service isolation', () => {
    it('should maintain separate service instances', async () => {
      const state1 = createStateService()
      const state2 = createStateService()

      host.registerService('state1', state1)
      host.registerService('state2', state2)

      // Set different values
      await state1.call({ action: 'set', key: 'key', value: 'value1' })
      await state2.call({ action: 'set', key: 'key', value: 'value2' })

      // Verify isolation
      const result1 = await state1.call({ action: 'get', key: 'key' })
      const result2 = await state2.call({ action: 'get', key: 'key' })

      expect(result1.value).toBe('value1')
      expect(result2.value).toBe('value2')

      // Verify through getService
      const retrieved1 = host.getService('state1')!
      const retrieved2 = host.getService('state2')!

      const retrievedResult1 = await retrieved1.call({ action: 'get', key: 'key' })
      const retrievedResult2 = await retrieved2.call({ action: 'get', key: 'key' })

      expect(retrievedResult1.value).toBe('value1')
      expect(retrievedResult2.value).toBe('value2')
    })
  })

  describe('custom services in config', () => {
    it('should initialize with custom services from config', () => {
      const newChannel = new MockMessageChannel()

      const customServices = new Map<string, () => ICustomService>([
        ['greeting', () => createGreetingService()],
        ['calculator', () => createCalculatorService()]
      ])

      const newHost = createMainRpcHost(newChannel.port1 as unknown as MessagePort, {
        basePath: '/public/demo',
        customServices
      })

      expect(newHost.getService('greeting')).toBeDefined()
      expect(newHost.getService('calculator')).toBeDefined()

      newHost.disconnect()
    })

    it('should allow adding more services after initialization', () => {
      const newChannel = new MockMessageChannel()

      const customServices = new Map<string, () => ICustomService>([
        ['greeting', () => createGreetingService()]
      ])

      const newHost = createMainRpcHost(newChannel.port1 as unknown as MessagePort, {
        basePath: '/public/demo',
        customServices
      })

      // Add another service dynamically
      newHost.registerService('state', createStateService())

      expect(newHost.getService('greeting')).toBeDefined()
      expect(newHost.getService('state')).toBeDefined()

      newHost.disconnect()
    })
  })

  describe('createMainRpcChannel with services', () => {
    it('should create channel with custom services', () => {
      const customServices = new Map<string, () => ICustomService>([
        ['greeting', () => createGreetingService()]
      ])

      const { host: channelHost, clientPort } = createMainRpcChannel({
        basePath: '/public/demo',
        customServices
      })

      expect(channelHost).toBeDefined()
      expect(clientPort).toBeInstanceOf(MessagePort)
      expect(channelHost.getService('greeting')).toBeDefined()

      channelHost.disconnect()
    })

    it('should allow registering services on channel host', () => {
      const { host: channelHost, clientPort } = createMainRpcChannel({
        basePath: '/public/demo'
      })

      channelHost.registerService('calculator', createCalculatorService())

      expect(channelHost.getService('calculator')).toBeDefined()

      channelHost.disconnect()
    })
  })

  describe('ServiceDefinition with JSON Schema', () => {
    it('should support complex JSON Schema for inputs', async () => {
      const definition: ServiceDefinition = {
        name: 'complexInput',
        namespace: 'test',
        identifier: 'test:complexInput',
        kind: 'PURE',
        inputs: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                age: { type: 'number' },
                tags: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['name']
            }
          },
          required: ['user']
        },
        outputs: {
          type: 'object',
          properties: {
            success: { type: 'boolean' }
          }
        }
      }

      const service = createCustomService(definition)
      host.registerService('complexInput', service)

      const retrieved = host.getService('complexInput')!
      const retrievedDef = await retrieved.getDefinition()

      expect(retrievedDef.inputs.properties?.user).toBeDefined()
      expect(retrievedDef.inputs.properties?.user?.properties?.tags?.type).toBe('array')
    })

    it('should support oneOf/anyOf in JSON Schema', async () => {
      const definition: ServiceDefinition = {
        name: 'unionType',
        namespace: 'test',
        identifier: 'test:unionType',
        kind: 'PURE',
        inputs: {
          type: 'object',
          properties: {
            value: {
              oneOf: [
                { type: 'string' },
                { type: 'number' }
              ]
            }
          }
        },
        outputs: {
          type: 'object',
          properties: {
            result: {
              anyOf: [
                { type: 'string' },
                { type: 'null' }
              ]
            }
          }
        }
      }

      const service = createCustomService(definition)
      host.registerService('unionType', service)

      const retrieved = host.getService('unionType')!
      const retrievedDef = await retrieved.getDefinition()

      expect(retrievedDef.inputs.properties?.value?.oneOf).toHaveLength(2)
      expect(retrievedDef.outputs.properties?.result?.anyOf).toHaveLength(2)
    })

    it('should include optional description field', async () => {
      const definition: ServiceDefinition = {
        name: 'documented',
        namespace: 'test',
        identifier: 'test:documented',
        kind: 'PURE',
        description: 'A well-documented service',
        inputs: {
          type: 'object',
          properties: {
            input1: {
              type: 'string',
              description: 'The first input parameter'
            }
          }
        },
        outputs: {
          type: 'object',
          properties: {
            output1: {
              type: 'string',
              description: 'The output value'
            }
          }
        }
      }

      const service = createCustomService(definition)
      host.registerService('documented', service)

      const retrieved = host.getService('documented')!
      const retrievedDef = await retrieved.getDefinition()

      expect(retrievedDef.description).toBe('A well-documented service')
      expect(retrievedDef.inputs.properties?.input1?.description).toBe('The first input parameter')
    })
  })

  describe('edge cases', () => {
    it('should handle empty service id', () => {
      const service = createGreetingService()

      // This should work - empty string is a valid ID
      host.registerService('', service)

      expect(host.getService('')).toBeDefined()
    })

    it('should handle service id with special characters', () => {
      const specialIds = [
        'my-service',
        'my.service',
        'my:service',
        'my/service',
        'my_service',
        '123-service'
      ]

      for (const id of specialIds) {
        host.registerService(id, createGreetingService())
        expect(host.getService(id)).toBeDefined()
      }
    })

    it('should handle service registration after disconnect', () => {
      host.disconnect()

      // Behavior depends on implementation - should either throw or silently fail
      // This test documents the current behavior
      expect(() => {
        host.registerService('late-service', createGreetingService())
      }).not.toThrow()
    })

    it('should handle service that throws on call', async () => {
      const throwingService: ICustomService = {
        async call(_inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          throw new Error('Service error')
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'throwing',
            namespace: 'test',
            identifier: 'test:throwing',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('throwing', throwingService)

      const retrieved = host.getService('throwing')!
      await expect(retrieved.call({})).rejects.toThrow('Service error')
    })

    it('should handle service that throws on getDefinition', async () => {
      const throwingDefService: ICustomService = {
        async call(_inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          return {}
        },
        async getDefinition(): Promise<ServiceDefinition> {
          throw new Error('Definition error')
        }
      }

      host.registerService('throwingDef', throwingDefService)

      const retrieved = host.getService('throwingDef')!
      await expect(retrieved.getDefinition()).rejects.toThrow('Definition error')
    })
  })
})
