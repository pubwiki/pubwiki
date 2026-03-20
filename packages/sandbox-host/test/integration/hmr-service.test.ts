/**
 * HmrServiceImpl Tests
 *
 * Tests for the HMR (Hot Module Replacement) service implementation.
 */

import { describe, it, expect, vi } from 'vitest'
import { HmrServiceImpl } from '../../src/services/hmr-service'
import type { HmrUpdate, RpcStub } from '@pubwiki/sandbox-service'

// Helper to create a mock RpcStub callback
function createMockCallback(): { 
  callback: RpcStub<(update: HmrUpdate) => Promise<void>>
  calls: HmrUpdate[] 
} {
  const calls: HmrUpdate[] = []
  const callback = vi.fn((update: HmrUpdate) => {
    calls.push(update)
    return Promise.resolve()
  }) as unknown as RpcStub<(update: HmrUpdate) => Promise<void>>
  
  // Mock the dup() method that RpcStub has
  ;(callback as unknown as Record<string, unknown>).dup = () => callback
  
  return { callback, calls }
}

describe('HmrServiceImpl', () => {
  describe('constructor', () => {
    it('should create an HmrServiceImpl instance', () => {
      const service = new HmrServiceImpl()
      expect(service).toBeDefined()
      expect(service).toBeInstanceOf(HmrServiceImpl)
    })
  })

  describe('subscribe', () => {
    it('should return a subscription with id and createdAt', async () => {
      const service = new HmrServiceImpl()
      const { callback } = createMockCallback()
      
      const subscription = await service.subscribe(callback)
      
      expect(subscription).toBeDefined()
      expect(subscription.id).toMatch(/^hmr-/)
      expect(subscription.createdAt).toBeGreaterThan(0)
    })
  })

  describe('notifyUpdate', () => {
    it('should notify subscribed callback of updates', async () => {
      const service = new HmrServiceImpl()
      const { callback, calls } = createMockCallback()
      
      await service.subscribe(callback)
      
      const update: HmrUpdate = {
        type: 'full-reload',
        timestamp: Date.now(),
        path: '/index.html'
      }
      service.notifyUpdate(update)
      
      // Wait for async callback
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(calls.length).toBe(1)
      expect(calls[0]).toEqual(update)
    })

    it('should not notify after unsubscribe', async () => {
      const service = new HmrServiceImpl()
      const { callback, calls } = createMockCallback()
      
      const subscription = await service.subscribe(callback)
      await service.unsubscribe(subscription.id)
      
      service.notifyUpdate({ type: 'full-reload', timestamp: Date.now(), path: '/index.html' })
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(calls.length).toBe(0)
    })
  })

  describe('unsubscribe', () => {
    it('should unsubscribe with valid id', async () => {
      const service = new HmrServiceImpl()
      const { callback } = createMockCallback()
      
      const subscription = await service.subscribe(callback)
      
      // Should not throw
      await expect(service.unsubscribe(subscription.id)).resolves.toBeUndefined()
    })

    it('should ignore invalid subscription id', async () => {
      const service = new HmrServiceImpl()
      
      // Should not throw
      await expect(service.unsubscribe('invalid-id')).resolves.toBeUndefined()
    })
  })

  describe('dispose', () => {
    it('should clean up resources', async () => {
      const service = new HmrServiceImpl()
      const { callback, calls } = createMockCallback()
      
      await service.subscribe(callback)
      service.dispose()
      
      // After dispose, notifications should not be sent
      service.notifyUpdate({ type: 'full-reload', timestamp: Date.now(), path: '/index.html' })
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(calls.length).toBe(0)
    })
  })
})
