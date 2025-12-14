/**
 * RPC Host E2E Tests
 *
 * End-to-end tests for VFS and Main RPC hosts running in a real browser environment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createVfsRpcHost, createMainRpcHost, createVfsRpcChannel, createMainRpcChannel } from '../../src/rpc-host'
import { HmrServiceImpl } from '../../src/services/hmr-service'
import { createTestVfs, addFile } from './helpers'
import { RpcTarget } from 'capnweb'
import * as z from 'zod'
import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'
import type { VfsRpcHost, MainRpcHost } from '../../src/types'

describe('RPC Host E2E', () => {
  let vfs: Vfs
  let hmrService: HmrServiceImpl
  let projectConfig: ProjectConfig

  beforeEach(async () => {
    const testVfs = createTestVfs()
    vfs = testVfs.vfs
    hmrService = new HmrServiceImpl()

    // Create a simple project
    await addFile(vfs, '/public/demo/index.html', `
<!DOCTYPE html>
<html>
<body>
  <div id="root"></div>
</body>
</html>
`)
    await addFile(vfs, '/public/demo/styles.css', 'body { color: red; }')
    await addFile(vfs, '/public/demo/script.js', 'console.log("test")')

    projectConfig = {
      isBuildable: false,
      tsconfigPath: '',
      projectRoot: '/public/demo',
      entryFiles: [],
      tsconfigContent: null
    }
  })

  afterEach(() => {
    hmrService.dispose()
  })

  describe('createVfsRpcHost', () => {
    let host: VfsRpcHost | null = null

    afterEach(() => {
      if (host) {
        host.disconnect()
        host = null
      }
    })

    it('should create a VFS RPC host', () => {
      const channel = new MessageChannel()

      host = createVfsRpcHost(channel.port1, {
        basePath: '/public/demo',
        vfs,
        projectConfig,
        hmrService
      })

      expect(host).toBeDefined()
      expect(host.id).toMatch(/^vfs-rpc-/)
      expect(host.isConnected).toBe(true)
    })

    it('should disconnect properly', () => {
      const channel = new MessageChannel()

      host = createVfsRpcHost(channel.port1, {
        basePath: '/public/demo',
        vfs,
        projectConfig,
        hmrService
      })

      expect(host.isConnected).toBe(true)
      
      host.disconnect()
      
      expect(host.isConnected).toBe(false)
      host = null
    })
  })

  describe('createMainRpcHost', () => {
    let host: MainRpcHost | null = null

    afterEach(() => {
      if (host) {
        host.disconnect()
        host = null
      }
    })

    it('should create a Main RPC host', () => {
      const channel = new MessageChannel()

      host = createMainRpcHost(channel.port1, {
        basePath: '/public/demo'
      })

      expect(host).toBeDefined()
      expect(host.id).toMatch(/^main-rpc-/)
      expect(host.isConnected).toBe(true)
    })

    it('should expose HMR service', () => {
      const channel = new MessageChannel()

      host = createMainRpcHost(channel.port1, {
        basePath: '/public/demo'
      })

      const hmr = host.getHmrService()
      expect(hmr).toBeDefined()
      expect(hmr).toBeInstanceOf(HmrServiceImpl)
    })

    it('should support dynamic service registration', () => {
      const channel = new MessageChannel()

      host = createMainRpcHost(channel.port1, {
        basePath: '/public/demo'
      })

      class GreetingService extends RpcTarget {
        greet(name: string): string {
          return `Hello, ${name}!`
        }
      }

      const schema = z.object({
        greet: z.function()
      })

      host.registerService({
        id: 'greeting',
        schema,
        implementation: new GreetingService()
      })

      const retrieved = host.getService('greeting')
      expect(retrieved).toBeDefined()
      expect(retrieved).toBeInstanceOf(GreetingService)

      const retrievedSchema = host.getServiceSchema('greeting')
      expect(retrievedSchema).toBe(schema)
    })

    it('should support custom services in config', () => {
      const channel = new MessageChannel()

      class ConfigService extends RpcTarget {
        getValue(): string {
          return 'test'
        }
      }

      const customServices = new Map<string, () => RpcTarget>([
        ['config', () => new ConfigService()]
      ])

      host = createMainRpcHost(channel.port1, {
        basePath: '/public/demo',
        customServices
      })

      const service = host.getService('config')
      expect(service).toBeDefined()
      expect(service).toBeInstanceOf(ConfigService)
    })
  })

  describe('createVfsRpcChannel', () => {
    let host: VfsRpcHost | null = null

    afterEach(() => {
      if (host) {
        host.disconnect()
        host = null
      }
    })

    it('should create a channel with host and client port', () => {
      const { host: rpcHost, clientPort } = createVfsRpcChannel({
        basePath: '/public/demo',
        vfs,
        projectConfig,
        hmrService
      })

      host = rpcHost

      expect(host).toBeDefined()
      expect(clientPort).toBeDefined()
      expect(clientPort).toBeInstanceOf(MessagePort)
    })
  })

  describe('createMainRpcChannel', () => {
    let host: MainRpcHost | null = null

    afterEach(() => {
      if (host) {
        host.disconnect()
        host = null
      }
    })

    it('should create a channel with host and client port', () => {
      const { host: rpcHost, clientPort } = createMainRpcChannel({
        basePath: '/public/demo'
      })

      host = rpcHost

      expect(host).toBeDefined()
      expect(clientPort).toBeDefined()
      expect(clientPort).toBeInstanceOf(MessagePort)
    })

    it('should allow registering services on channel host', () => {
      const { host: rpcHost, clientPort } = createMainRpcChannel({
        basePath: '/public/demo'
      })

      host = rpcHost

      class CalculatorService extends RpcTarget {
        add(a: number, b: number): number {
          return a + b
        }
      }

      host.registerService({
        id: 'calculator',
        schema: z.object({ add: z.function() }),
        implementation: new CalculatorService()
      })

      expect(host.getService('calculator')).toBeDefined()
    })
  })

  describe('RPC communication', () => {
    it('should communicate between Main RPC hosts', async () => {
      const channel = new MessageChannel()

      const host = createMainRpcHost(channel.port1, {
        basePath: '/public/demo'
      })

      // Register a service
      class EchoService extends RpcTarget {
        echo(message: string): string {
          return `Echo: ${message}`
        }
      }

      host.registerService({
        id: 'echo',
        schema: z.object({ echo: z.function() }),
        implementation: new EchoService()
      })

      // The service is registered and can be retrieved
      const service = host.getService('echo') as EchoService
      expect(service.echo('test')).toBe('Echo: test')

      host.disconnect()
    })
  })
})
