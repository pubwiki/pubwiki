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
import { RpcTarget } from 'capnweb'
import * as z from 'zod'

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

      // Create a simple service that extends RpcTarget
      class CustomService extends RpcTarget {
        greet(name: string): string {
          return `Hello, ${name}!`
        }
      }

      const serviceSchema = z.object({
        greet: z.function()
      })

      host.registerService({
        id: 'custom',
        schema: serviceSchema,
        implementation: new CustomService()
      })

      // Service should be retrievable
      const retrieved = host.getService('custom')
      expect(retrieved).toBeDefined()

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

      class ConfigService extends RpcTarget {
        getValue(): string {
          return 'test'
        }
      }

      const customServices = new Map<string, () => RpcTarget>([
        ['config', () => new ConfigService()]
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
