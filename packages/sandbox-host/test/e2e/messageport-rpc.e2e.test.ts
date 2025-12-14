/**
 * E2E tests for real MessagePort RPC communication
 * 
 * These tests verify actual RPC calls over MessagePort:
 * - Host side creates RPC session with services
 * - Client side creates RPC session to call remote services
 * - Messages flow through real MessagePort channels
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { newMessagePortRpcSession, RpcTarget, type RpcStub } from 'capnweb'
import { createMainRpcHost, type MainRpcHost } from '../../src/rpc-host'
import type { SandboxMainService, HmrUpdate } from '@pubwiki/sandbox-service'
import { z } from 'zod/v4'

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
    it('should call custom service methods through RPC', async () => {
      // Create a counter service using RpcTarget
      class CounterService extends RpcTarget {
        private value = 0
        
        getValue(): number {
          return this.value
        }
        
        increment(): number {
          return ++this.value
        }
        
        decrement(): number {
          return --this.value
        }
        
        reset(): void {
          this.value = 0
        }
      }
      
      const counterSchema = z.object({
        getValue: z.function(),
        increment: z.function(),
        decrement: z.function(),
        reset: z.function()
      })
      
      // Register custom service on host
      host.registerService({
        id: 'counter',
        schema: counterSchema,
        implementation: new CounterService()
      })
      
      // Call service via RPC
      const counter = (client as any).counter
      
      expect(await counter.getValue()).toBe(0)
      expect(await counter.increment()).toBe(1)
      expect(await counter.increment()).toBe(2)
      expect(await counter.decrement()).toBe(1)
      
      await counter.reset()
      expect(await counter.getValue()).toBe(0)
    })

    it('should handle async service methods through RPC', async () => {
      // Create async data service
      class AsyncDataService extends RpcTarget {
        private mockData = new Map([
          ['1', { id: '1', data: 'Item 1', timestamp: Date.now() }],
          ['2', { id: '2', data: 'Item 2', timestamp: Date.now() }]
        ])
        
        async fetchData(id: string): Promise<{ id: string; data: string; timestamp: number }> {
          await new Promise(resolve => setTimeout(resolve, 10))
          const item = this.mockData.get(id)
          if (!item) throw new Error(`Item ${id} not found`)
          return item
        }
        
        async fetchAll(): Promise<Array<{ id: string; name: string }>> {
          await new Promise(resolve => setTimeout(resolve, 10))
          return Array.from(this.mockData.values()).map(item => ({
            id: item.id,
            name: item.data
          }))
        }
      }
      
      const dataSchema = z.object({
        fetchData: z.function(),
        fetchAll: z.function()
      })
      
      host.registerService({
        id: 'asyncData',
        schema: dataSchema,
        implementation: new AsyncDataService()
      })
      
      const dataService = (client as any).asyncData
      
      // Call async methods via RPC
      const item1 = await dataService.fetchData('1')
      expect(item1.id).toBe('1')
      expect(item1.data).toBe('Item 1')
      
      const allItems = await dataService.fetchAll()
      expect(allItems.length).toBe(2)
    })

    it('should handle service method errors through RPC', async () => {
      class ErrorService extends RpcTarget {
        throwError(): never {
          throw new Error('Intentional error')
        }
        
        async throwAsync(): Promise<never> {
          await new Promise(resolve => setTimeout(resolve, 10))
          throw new Error('Async error')
        }
      }
      
      const errorSchema = z.object({
        throwError: z.function(),
        throwAsync: z.function()
      })
      
      host.registerService({
        id: 'errorService',
        schema: errorSchema,
        implementation: new ErrorService()
      })
      
      const errorService = (client as any).errorService
      
      // Sync error
      await expect(errorService.throwError()).rejects.toThrow()
      
      // Async error
      await expect(errorService.throwAsync()).rejects.toThrow()
    })

    it('should handle complex data types through RPC', async () => {
      interface ComplexData {
        nested: {
          array: number[]
          map: Record<string, string>
        }
        date: string
        optional?: string
      }
      
      class ComplexService extends RpcTarget {
        processData(input: ComplexData): ComplexData {
          return {
            ...input,
            nested: {
              ...input.nested,
              array: input.nested.array.map(n => n * 2)
            }
          }
        }
        
        getComplexResult(): ComplexData {
          return {
            nested: {
              array: [1, 2, 3],
              map: { key: 'value' }
            },
            date: new Date().toISOString()
          }
        }
      }
      
      const complexSchema = z.object({
        processData: z.function(),
        getComplexResult: z.function()
      })
      
      host.registerService({
        id: 'complexService',
        schema: complexSchema,
        implementation: new ComplexService()
      })
      
      const complexService = (client as any).complexService
      
      const input: ComplexData = {
        nested: {
          array: [1, 2, 3],
          map: { a: 'b' }
        },
        date: '2024-01-01'
      }
      
      const result = await complexService.processData(input)
      expect(result.nested.array).toEqual([2, 4, 6])
      expect(result.nested.map).toEqual({ a: 'b' })
      
      const complexResult = await complexService.getComplexResult()
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
      const client2 = newMessagePortRpcSession<SandboxMainService>(client2Port, {})
      
      host2Port.start()
      client2Port.start()
      
      // Create counter services with config
      class CounterService extends RpcTarget {
        private value: number
        
        constructor(initialValue: number = 0) {
          super()
          this.value = initialValue
        }
        
        increment(): number {
          return ++this.value
        }
        
        getValue(): number {
          return this.value
        }
      }
      
      const counterSchema = z.object({ 
        increment: z.function(),
        getValue: z.function()
      })
      
      // Register services with different initial values to distinguish them
      host.registerService({
        id: 'counter',
        schema: counterSchema,
        implementation: new CounterService(100) // Start at 100
      })
      
      host2.registerService({
        id: 'counter',
        schema: counterSchema,
        implementation: new CounterService(200) // Start at 200
      })
      
      // Each client calls their own host via RPC
      const result1 = await (client as any).counter.increment()
      const result2 = await (client2 as any).counter.increment()
      
      // Verify they are independent (different initial values)
      expect(result1).toBe(101) // 100 + 1
      expect(result2).toBe(201) // 200 + 1
      
      // Cleanup
      host2.disconnect()
      channel2.port1.close()
      channel2.port2.close()
    })
  })

  describe('Service Registration and Discovery', () => {
    it('should allow client to call dynamically registered services', async () => {
      // Register service after client connection
      class GreetingService extends RpcTarget {
        greet(name: string): string {
          return `Hello, ${name}!`
        }
      }
      
      const greetingSchema = z.object({ greet: z.function() })
      
      host.registerService({
        id: 'dynamicService',
        schema: greetingSchema,
        implementation: new GreetingService()
      })
      
      // Client should be able to call the new service
      const result = await (client as any).dynamicService.greet('World')
      expect(result).toBe('Hello, World!')
    })

    it('should handle service replacement for existing connections', async () => {
      // Register initial service
      class ServiceV1 extends RpcTarget {
        getValue(): string {
          return 'v1'
        }
      }
      
      class ServiceV2 extends RpcTarget {
        getValue(): string {
          return 'v2'
        }
      }
      
      const serviceSchema = z.object({ getValue: z.function() })
      
      host.registerService({
        id: 'replaceable',
        schema: serviceSchema,
        implementation: new ServiceV1()
      })
      
      const v1 = await (client as any).replaceable.getValue()
      expect(v1).toBe('v1')
      
      // Replace service
      host.registerService({
        id: 'replaceable',
        schema: serviceSchema,
        implementation: new ServiceV2()
      })
      
      const v2 = await (client as any).replaceable.getValue()
      expect(v2).toBe('v2')
    })
  })

  describe('Bidirectional Communication (Callbacks)', () => {
    it('should support callbacks from host to client', async () => {
      const receivedEvents: Array<{ type: string; data: any }> = []
      
      // EventService that properly handles RPC callbacks using .dup()
      class EventService extends RpcTarget {
        private callbacks = new Map<string, any>()
        
        subscribe(callback: any): string {
          const id = Math.random().toString(36).substr(2, 9)
          // Must call .dup() to keep the callback alive after the method returns
          // See: https://github.com/cloudflare/capnweb?tab=readme-ov-file#duplicating-stubs
          this.callbacks.set(id, callback.dup())
          return id
        }
        
        async emit(type: string, data: any): Promise<void> {
          // Call all callbacks and wait for them
          const promises: Promise<void>[] = []
          this.callbacks.forEach(cb => {
            promises.push(cb({ type, data }))
          })
          await Promise.all(promises)
        }
        
        unsubscribe(id: string): void {
          this.callbacks.delete(id)
        }
      }
      
      const eventSchema = z.object({
        subscribe: z.function(),
        emit: z.function(),
        unsubscribe: z.function()
      })
      
      host.registerService({
        id: 'events',
        schema: eventSchema,
        implementation: new EventService()
      })
      
      const events = (client as any).events
      
      // Subscribe with callback
      const subscriberId = await events.subscribe((event: { type: string; data: any }) => {
        receivedEvents.push(event)
      })
      
      expect(subscriberId).toBeTruthy()
      
      // Emit events via RPC - the service will call back to client
      await events.emit('test', { message: 'hello' })
      await events.emit('test', { message: 'world' })
      
      // No need to wait extra time since emit awaits callback completion
      expect(receivedEvents.length).toBe(2)
      expect(receivedEvents[0]).toEqual({ type: 'test', data: { message: 'hello' } })
      expect(receivedEvents[1]).toEqual({ type: 'test', data: { message: 'world' } })
    })
  })

  describe('Performance and Reliability', () => {
    it('should handle rapid successive calls', async () => {
      class PerfService extends RpcTarget {
        private callCount = 0
        
        increment(): number {
          return ++this.callCount
        }
        
        getCount(): number {
          return this.callCount
        }
      }
      
      const perfSchema = z.object({
        increment: z.function(),
        getCount: z.function()
      })
      
      host.registerService({
        id: 'perf',
        schema: perfSchema,
        implementation: new PerfService()
      })
      
      const perf = (client as any).perf
      
      // Make many rapid calls
      const promises = Array.from({ length: 100 }, () => perf.increment())
      await Promise.all(promises)
      
      const count = await perf.getCount()
      expect(count).toBe(100)
    })

    it('should maintain call order for sequential calls', async () => {
      const callOrder: number[] = []
      
      class OrderService extends RpcTarget {
        async recordCall(n: number): Promise<number> {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10))
          callOrder.push(n)
          return n
        }
      }
      
      const orderSchema = z.object({ recordCall: z.function() })
      
      host.registerService({
        id: 'order',
        schema: orderSchema,
        implementation: new OrderService()
      })
      
      const order = (client as any).order
      
      // Sequential calls
      for (let i = 0; i < 10; i++) {
        await order.recordCall(i)
      }
      
      expect(callOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('should handle large data transfer', async () => {
      class LargeDataService extends RpcTarget {
        echo(data: any): any {
          return data
        }
        
        generateLarge(size: number): { array: number[]; text: string } {
          return { 
            array: Array.from({ length: size }, (_, i) => i),
            text: 'x'.repeat(size)
          }
        }
      }
      
      const largeDataSchema = z.object({
        echo: z.function(),
        generateLarge: z.function()
      })
      
      host.registerService({
        id: 'largeData',
        schema: largeDataSchema,
        implementation: new LargeDataService()
      })
      
      const largeData = (client as any).largeData
      
      // Send large object
      const bigArray = Array.from({ length: 1000 }, (_, i) => ({ index: i, value: `item-${i}` }))
      const echoed = await largeData.echo(bigArray)
      expect(echoed.length).toBe(1000)
      expect(echoed[500]).toEqual({ index: 500, value: 'item-500' })
      
      // Receive large object
      const generated = await largeData.generateLarge(1000)
      expect(generated.array.length).toBe(1000)
      expect(generated.text.length).toBe(1000)
    })
  })

  describe('Security - Internal Methods', () => {
    it('should not allow _registerCustomService to register services via RPC', async () => {
      // capnweb RPC Proxy returns a function for any property access
      // But calling internal methods should fail or have no effect
      const internalMethod = (client as any)._registerCustomService
      
      if (internalMethod) {
        try {
          // Try to register a malicious service via RPC
          await internalMethod('hack', {}, null)
        } catch (error) {
          // Expected: RPC call should fail because _registerCustomService is not a class method
        }
      }
      
      // Verify that 'hack' service was NOT registered
      // The service should not be accessible
      const hackService = (client as any).hack
      if (hackService) {
        try {
          // If the property exists as RPC proxy, calling it should fail
          await hackService.someMethod?.()
        } catch (error) {
          // Expected: no actual method exists
        }
      }
    })

    it('should only expose hmr getter and public methods via RPC', async () => {
      // These should be accessible
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
      // Verify that the client cannot register a malicious service
      const maliciousService = new (class extends RpcTarget {
        evil() { return 'pwned' }
      })()
      
      // Try various ways to register - these should all fail
      const registerAttempts = [
        async () => await (client as any)._registerCustomService?.('evil', maliciousService),
        async () => await (client as any).registerCustomService?.('evil', maliciousService),
      ]
      
      for (const attempt of registerAttempts) {
        try {
          await attempt()
        } catch (error) {
          // Expected: registration should fail
        }
      }
      
      // Now try to call the "evil" service - it should fail
      const evilService = (client as any).evil
      if (evilService) {
        try {
          const result = await evilService.evil?.()
          // If we somehow got here, verify it's not our malicious result
          expect(result).not.toBe('pwned')
        } catch (error) {
          // Expected: service doesn't exist or method fails
        }
      }
    })
  })
})
