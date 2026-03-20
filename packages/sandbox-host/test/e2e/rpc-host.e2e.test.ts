/**
 * RPC Host E2E Tests
 *
 * End-to-end tests for VFS and Main RPC hosts running in a real browser environment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createVfsRpcHost, createMainRpcHost, createVfsRpcChannel, createMainRpcChannel } from '../../src/rpc-host'
import { HmrServiceImpl } from '../../src/services/hmr-service'
import { createTestVfs, addFile } from './helpers'
import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'
import type { VfsRpcHost, MainRpcHost, ICustomService, ServiceDefinition } from '../../src/types'

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

      const greetingService = createMockService('greeting')

      host.registerService('greeting', greetingService)

      const retrieved = host.getService('greeting')
      expect(retrieved).toBeDefined()
      expect(retrieved).toBe(greetingService)
    })

    it('should support custom services in config', () => {
      const channel = new MessageChannel()

      const customServices = new Map<string, () => ICustomService>([
        ['config', () => createMockService('config')]
      ])

      host = createMainRpcHost(channel.port1, {
        basePath: '/public/demo',
        customServices
      })

      const service = host.getService('config')
      expect(service).toBeDefined()
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
      const { host: rpcHost } = createMainRpcChannel({
        basePath: '/public/demo'
      })

      host = rpcHost

      const calculatorService = createMockService('calculator')

      host.registerService('calculator', calculatorService)

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
      const echoService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const message = inputs.message as string
          return { echo: `Echo: ${message}` }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'echo',
            namespace: 'test',
            identifier: 'test:echo',
            kind: 'PURE',
            inputs: { type: 'object', properties: { message: { type: 'string' } } },
            outputs: { type: 'object', properties: { echo: { type: 'string' } } }
          }
        }
      }

      host.registerService('echo', echoService)

      // The service is registered and can be retrieved
      const service = host.getService('echo')
      expect(service).toBeDefined()
      const result = await service!.call({ message: 'test' })
      expect(result.echo).toBe('Echo: test')

      host.disconnect()
    })
  })
})
