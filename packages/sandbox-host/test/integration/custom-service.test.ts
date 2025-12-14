/**
 * Custom Service Integration Tests
 *
 * Tests for dynamic service registration functionality with zod v4 schemas.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createMainRpcHost, createMainRpcChannel } from '../../src/rpc-host'
import { MockMessageChannel } from '../helpers'
import { RpcTarget } from 'capnweb'
import * as z from 'zod'
import type { ServiceDefinition, MainRpcHost } from '../../src/types'

// ==================== Test Service Definitions ====================

/**
 * Simple greeting service
 */
class GreetingService extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }

  greetMany(names: string[]): string[] {
    return names.map(name => `Hello, ${name}!`)
  }
}

const greetingSchema = z.object({
  greet: z.function(),
  greetMany: z.function()
})

/**
 * Calculator service with async methods
 */
class CalculatorService extends RpcTarget {
  add(a: number, b: number): number {
    return a + b
  }

  subtract(a: number, b: number): number {
    return a - b
  }

  async computeAsync(value: number): Promise<number> {
    return new Promise(resolve => {
      setTimeout(() => resolve(value * 2), 10)
    })
  }
}

const calculatorSchema = z.object({
  add: z.function(),
  subtract: z.function(),
  computeAsync: z.function()
})

/**
 * State management service
 */
class StateService extends RpcTarget {
  private state: Map<string, unknown> = new Map()

  set(key: string, value: unknown): void {
    this.state.set(key, value)
  }

  get(key: string): unknown {
    return this.state.get(key)
  }

  has(key: string): boolean {
    return this.state.has(key)
  }

  delete(key: string): boolean {
    return this.state.delete(key)
  }

  clear(): void {
    this.state.clear()
  }

  keys(): string[] {
    return Array.from(this.state.keys())
  }
}

const stateSchema = z.object({
  set: z.function(),
  get: z.function(),
  has: z.function(),
  delete: z.function(),
  clear: z.function(),
  keys: z.function()
})

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

  describe('ServiceDefinition interface', () => {
    it('should accept valid ServiceDefinition with zod schema', () => {
      const definition: ServiceDefinition<typeof greetingSchema> = {
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      }

      expect(definition.id).toBe('greeting')
      expect(definition.schema).toBe(greetingSchema)
      expect(definition.implementation).toBeInstanceOf(GreetingService)
    })

    it('should support multiple schema types', () => {
      const greetDef: ServiceDefinition<typeof greetingSchema> = {
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      }

      const calcDef: ServiceDefinition<typeof calculatorSchema> = {
        id: 'calculator',
        schema: calculatorSchema,
        implementation: new CalculatorService()
      }

      expect(greetDef.schema).not.toBe(calcDef.schema)
    })
  })

  describe('registerService', () => {
    it('should register a simple service', () => {
      const definition: ServiceDefinition = {
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      }

      // Should not throw
      expect(() => host.registerService(definition)).not.toThrow()

      // Should be retrievable
      const retrieved = host.getService('greeting')
      expect(retrieved).toBeDefined()
    })

    it('should register multiple services', () => {
      host.registerService({
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      })

      host.registerService({
        id: 'calculator',
        schema: calculatorSchema,
        implementation: new CalculatorService()
      })

      host.registerService({
        id: 'state',
        schema: stateSchema,
        implementation: new StateService()
      })

      expect(host.getService('greeting')).toBeDefined()
      expect(host.getService('calculator')).toBeDefined()
      expect(host.getService('state')).toBeDefined()
    })

    it('should allow overwriting existing service', () => {
      const service1 = new GreetingService()
      const service2 = new GreetingService()

      host.registerService({
        id: 'greeting',
        schema: greetingSchema,
        implementation: service1
      })

      host.registerService({
        id: 'greeting',
        schema: greetingSchema,
        implementation: service2
      })

      // Should have the latest registration
      const retrieved = host.getService('greeting')
      expect(retrieved).toBe(service2)
    })
  })

  describe('getService', () => {
    it('should return registered service', () => {
      const service = new CalculatorService()

      host.registerService({
        id: 'calc',
        schema: calculatorSchema,
        implementation: service
      })

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
  })

  describe('getServiceSchema', () => {
    it('should return registered schema', () => {
      host.registerService({
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      })

      const schema = host.getServiceSchema('greeting')
      expect(schema).toBe(greetingSchema)
    })

    it('should return undefined for non-existent service', () => {
      const schema = host.getServiceSchema('non-existent')
      expect(schema).toBeUndefined()
    })

    it('should return correct schema for each service', () => {
      host.registerService({
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      })

      host.registerService({
        id: 'calculator',
        schema: calculatorSchema,
        implementation: new CalculatorService()
      })

      host.registerService({
        id: 'state',
        schema: stateSchema,
        implementation: new StateService()
      })

      expect(host.getServiceSchema('greeting')).toBe(greetingSchema)
      expect(host.getServiceSchema('calculator')).toBe(calculatorSchema)
      expect(host.getServiceSchema('state')).toBe(stateSchema)
    })

    it('should update schema when service is overwritten', () => {
      const schema1 = z.object({ method1: z.function() })
      const schema2 = z.object({ method2: z.function() })

      host.registerService({
        id: 'test',
        schema: schema1,
        implementation: new GreetingService()
      })

      expect(host.getServiceSchema('test')).toBe(schema1)

      host.registerService({
        id: 'test',
        schema: schema2,
        implementation: new GreetingService()
      })

      expect(host.getServiceSchema('test')).toBe(schema2)
    })

    it('should work with complex schemas', () => {
      const complexSchema = z.object({
        getData: z.function(),
        setData: z.function(),
        nested: z.object({
          value: z.string()
        }).optional()
      })

      class ComplexService extends RpcTarget {
        getData(): unknown { return null }
        setData(_data: unknown): void {}
      }

      host.registerService({
        id: 'complex',
        schema: complexSchema,
        implementation: new ComplexService()
      })

      const retrieved = host.getServiceSchema('complex')
      expect(retrieved).toBe(complexSchema)
      
      // Verify it's a valid zod schema
      expect(retrieved).toBeDefined()
      expect(typeof (retrieved as z.ZodType).parse).toBe('function')
    })

    it('should be independent from getService', () => {
      host.registerService({
        id: 'greeting',
        schema: greetingSchema,
        implementation: new GreetingService()
      })

      // Both should work independently
      const service = host.getService('greeting')
      const schema = host.getServiceSchema('greeting')

      expect(service).toBeDefined()
      expect(schema).toBeDefined()
      expect(service).not.toBe(schema)
    })
  })

  describe('service isolation', () => {
    it('should maintain separate service instances', () => {
      const state1 = new StateService()
      const state2 = new StateService()

      host.registerService({
        id: 'state1',
        schema: stateSchema,
        implementation: state1
      })

      host.registerService({
        id: 'state2',
        schema: stateSchema,
        implementation: state2
      })

      // Set different values
      state1.set('key', 'value1')
      state2.set('key', 'value2')

      // Verify isolation
      expect(state1.get('key')).toBe('value1')
      expect(state2.get('key')).toBe('value2')

      // Verify through getService
      const retrieved1 = host.getService('state1') as StateService
      const retrieved2 = host.getService('state2') as StateService
      expect(retrieved1.get('key')).toBe('value1')
      expect(retrieved2.get('key')).toBe('value2')
    })
  })

  describe('custom services in config', () => {
    it('should initialize with custom services from config', () => {
      const newChannel = new MockMessageChannel()

      const customServices = new Map<string, () => RpcTarget>([
        ['greeting', () => new GreetingService()],
        ['calculator', () => new CalculatorService()]
      ])

      const newHost = createMainRpcHost(newChannel.port1 as unknown as MessagePort, {
        basePath: '/public/demo',
        customServices
      })

      expect(newHost.getService('greeting')).toBeDefined()
      expect(newHost.getService('greeting')).toBeInstanceOf(GreetingService)
      expect(newHost.getService('calculator')).toBeDefined()
      expect(newHost.getService('calculator')).toBeInstanceOf(CalculatorService)

      newHost.disconnect()
    })

    it('should allow adding more services after initialization', () => {
      const newChannel = new MockMessageChannel()

      const customServices = new Map<string, () => RpcTarget>([
        ['greeting', () => new GreetingService()]
      ])

      const newHost = createMainRpcHost(newChannel.port1 as unknown as MessagePort, {
        basePath: '/public/demo',
        customServices
      })

      // Add another service dynamically
      newHost.registerService({
        id: 'state',
        schema: stateSchema,
        implementation: new StateService()
      })

      expect(newHost.getService('greeting')).toBeDefined()
      expect(newHost.getService('state')).toBeDefined()

      newHost.disconnect()
    })
  })

  describe('createMainRpcChannel with services', () => {
    it('should create channel with custom services', () => {
      const customServices = new Map<string, () => RpcTarget>([
        ['greeting', () => new GreetingService()]
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

      channelHost.registerService({
        id: 'calculator',
        schema: calculatorSchema,
        implementation: new CalculatorService()
      })

      expect(channelHost.getService('calculator')).toBeDefined()

      channelHost.disconnect()
    })
  })

  describe('service with complex types', () => {
    it('should handle services with object parameters', () => {
      interface UserData {
        name: string
        age: number
        email: string
      }

      class UserService extends RpcTarget {
        private users: Map<string, UserData> = new Map()

        create(id: string, data: UserData): UserData {
          this.users.set(id, data)
          return data
        }

        get(id: string): UserData | undefined {
          return this.users.get(id)
        }

        update(id: string, data: Partial<UserData>): UserData | undefined {
          const existing = this.users.get(id)
          if (!existing) return undefined
          const updated = { ...existing, ...data }
          this.users.set(id, updated)
          return updated
        }
      }

      const userSchema = z.object({
        create: z.function(),
        get: z.function(),
        update: z.function()
      })

      const userService = new UserService()

      host.registerService({
        id: 'users',
        schema: userSchema,
        implementation: userService
      })

      const retrieved = host.getService('users') as UserService
      
      // Test functionality
      const userData: UserData = { name: 'Alice', age: 30, email: 'alice@example.com' }
      retrieved.create('user1', userData)
      
      expect(retrieved.get('user1')).toEqual(userData)
      
      retrieved.update('user1', { age: 31 })
      expect(retrieved.get('user1')?.age).toBe(31)
    })
  })

  describe('edge cases', () => {
    it('should handle empty service id', () => {
      // This should work - empty string is a valid ID
      host.registerService({
        id: '',
        schema: greetingSchema,
        implementation: new GreetingService()
      })

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
        host.registerService({
          id,
          schema: greetingSchema,
          implementation: new GreetingService()
        })

        expect(host.getService(id)).toBeDefined()
      }
    })

    it('should handle service registration after disconnect', () => {
      host.disconnect()

      // Behavior depends on implementation - should either throw or silently fail
      // This test documents the current behavior
      expect(() => {
        host.registerService({
          id: 'late-service',
          schema: greetingSchema,
          implementation: new GreetingService()
        })
      }).not.toThrow()
    })
  })
})
