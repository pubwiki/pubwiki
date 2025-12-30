/**
 * RPC Host Tests
 *
 * Tests for the VFS and Main RPC host factories.
 * 
 * Note: Tests involving createVfsRpcHost and createVfsRpcChannel are in e2e tests
 * (test/e2e/rpc-host.e2e.test.ts) because they require Web Workers.
 */

import { describe, it, expect } from 'vitest'
import { createMainRpcHost, createMainRpcChannel } from '../../src/rpc-host'
import { HmrServiceImpl } from '../../src/services/hmr-service'
import { MockMessageChannel } from '../helpers'
import type { ICustomService, ServiceDefinition } from '../../src/types'

// Helper to create mock ICustomService
function createMockService(name: string = 'test'): ICustomService {
  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      return { result: `called with ${JSON.stringify(inputs)}` }
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name,
        namespace: 'test',
        identifier: `test:${name}`,
        kind: 'PURE',
        inputs: { type: 'object' },
        outputs: { type: 'object' }
      }
    }
  }
}

describe('createMainRpcHost', () => {
  it('should create a Main RPC host', () => {
    const channel = new MockMessageChannel()

    const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
      basePath: '/public/demo'
    })

    expect(host).toBeDefined()
    expect(host.id).toMatch(/^main-rpc-/)
    expect(host.isConnected).toBe(true)
    expect(host.disconnect).toBeDefined()
    expect(typeof host.disconnect).toBe('function')

    host.disconnect()
  })

  it('should expose HMR service', () => {
    const channel = new MockMessageChannel()

    const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
      basePath: '/public/demo'
    })

    const hmrService = host.getHmrService()
    expect(hmrService).toBeDefined()
    expect(hmrService).toBeInstanceOf(HmrServiceImpl)

    host.disconnect()
  })

  describe('dynamic service registration', () => {
    it('should support registerService method', () => {
      const channel = new MockMessageChannel()

      const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
        basePath: '/public/demo'
      })

      expect(host.registerService).toBeDefined()
      expect(typeof host.registerService).toBe('function')

      host.disconnect()
    })

    it('should register a custom service', () => {
      const channel = new MockMessageChannel()

      const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
        basePath: '/public/demo'
      })

      const mockService = createMockService('custom')

      host.registerService('custom', mockService)

      // Service should be retrievable
      const retrieved = host.getService('custom')
      expect(retrieved).toBeDefined()
      expect(retrieved).toBe(mockService)

      host.disconnect()
    })

    it('should support getService method', () => {
      const channel = new MockMessageChannel()

      const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
        basePath: '/public/demo'
      })

      expect(host.getService).toBeDefined()
      expect(typeof host.getService).toBe('function')

      host.disconnect()
    })

    it('should return undefined for unregistered services', () => {
      const channel = new MockMessageChannel()

      const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
        basePath: '/public/demo'
      })

      const service = host.getService('non-existent')
      expect(service).toBeUndefined()

      host.disconnect()
    })

    it('should support custom services in config', () => {
      const channel = new MockMessageChannel()

      const customServices = new Map<string, () => ICustomService>([
        ['config', () => createMockService('config')]
      ])

      const host = createMainRpcHost(channel.port1 as unknown as MessagePort, {
        basePath: '/public/demo',
        customServices
      })

      const service = host.getService('config')
      expect(service).toBeDefined()

      host.disconnect()
    })
  })
})

describe('createMainRpcChannel', () => {
  it('should create a channel with host and client port', () => {
    const { host, clientPort } = createMainRpcChannel({
      basePath: '/public/demo'
    })

    expect(host).toBeDefined()
    expect(clientPort).toBeDefined()
    expect(clientPort).toBeInstanceOf(MessagePort)

    host.disconnect()
  })
})
