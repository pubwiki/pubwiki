/**
 * SandboxConnection E2E Tests
 *
 * End-to-end tests for sandbox connection management running in a real browser
 * environment with iframe and window APIs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSandboxConnection } from '../../src/connection'
import { createTestVfs, addFile, createRealIframe, removeIframe, waitFor } from './helpers'
import { RpcTarget } from 'capnweb'
import * as z from 'zod'
import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'
import type { SandboxConnection } from '../../src/types'

describe('SandboxConnection E2E', () => {
  let vfs: Vfs
  let projectConfig: ProjectConfig
  let iframe: HTMLIFrameElement | null = null
  let connection: SandboxConnection | null = null

  beforeEach(async () => {
    const testVfs = createTestVfs()
    vfs = testVfs.vfs

    // Create a simple static project
    await addFile(vfs, '/public/demo/index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Sandbox Test</title>
</head>
<body>
  <div id="root">Hello Sandbox</div>
</body>
</html>
`)
    await addFile(vfs, '/public/demo/styles.css', 'body { color: red; }')
    await addFile(vfs, '/public/demo/script.js', 'console.log("sandbox script")')

    projectConfig = {
      isBuildable: false,
      tsconfigPath: '',
      projectRoot: '/public/demo',
      entryFiles: [],
      tsconfigContent: null
    }
  })

  afterEach(() => {
    if (connection) {
      connection.disconnect()
      connection = null
    }
    if (iframe) {
      removeIframe(iframe)
      iframe = null
    }
  })

  describe('createSandboxConnection', () => {
    it('should create a sandbox connection', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      expect(connection).toBeDefined()
      expect(connection.id).toMatch(/^sandbox-conn-/)
      expect(connection.isConnected).toBe(false) // Not connected until initialize()
    })

    it('should have required methods', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      expect(connection.initialize).toBeDefined()
      expect(typeof connection.initialize).toBe('function')
      expect(connection.disconnect).toBeDefined()
      expect(typeof connection.disconnect).toBe('function')
      expect(connection.reload).toBeDefined()
      expect(typeof connection.reload).toBe('function')
      expect(connection.addCustomService).toBeDefined()
      expect(typeof connection.addCustomService).toBe('function')
    })
  })

  describe('initialize', () => {
    it('should fail initialization without iframe contentWindow', async () => {
      // Create a detached iframe (not added to DOM)
      const detachedIframe = document.createElement('iframe')

      connection = createSandboxConnection({
        iframe: detachedIframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      const result = await connection.initialize('/index.html')
      
      expect(result).toBe(false)
      expect(connection.isConnected).toBe(false)
    })

    it('should initialize with valid iframe', async () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      // Initialize the connection
      const result = await connection.initialize('/index.html')
      
      // Even if the sandbox doesn't respond, the host side should be ready
      // The actual connection depends on the sandbox page responding
      expect(connection.isConnected).toBe(true)
    })
  })

  describe('addCustomService', () => {
    it('should log error when adding service before initialization', () => {
      iframe = createRealIframe()

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      class TestService extends RpcTarget {}

      connection.addCustomService({
        id: 'test',
        schema: z.object({}),
        implementation: new TestService()
      })

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should add custom service after initialization', async () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      await connection.initialize('/index.html')

      class GreetingService extends RpcTarget {
        greet(name: string): string {
          return `Hello, ${name}!`
        }
      }

      // Should not throw
      expect(() => {
        connection!.addCustomService({
          id: 'greeting',
          schema: z.object({ greet: z.function() }),
          implementation: new GreetingService()
        })
      }).not.toThrow()
    })
  })

  describe('reload', () => {
    it('should not throw when called before initialization', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      // Should not throw
      expect(() => connection!.reload()).not.toThrow()
    })

    it('should trigger reload after initialization', async () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      await connection.initialize('/index.html')

      // Should not throw
      expect(() => connection!.reload()).not.toThrow()
    })
  })

  describe('disconnect', () => {
    it('should be safe to call disconnect without initialization', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      // Should not throw
      expect(() => connection!.disconnect()).not.toThrow()
      
      // Multiple disconnect calls should be safe
      expect(() => connection!.disconnect()).not.toThrow()

      connection = null // Already disconnected
    })

    it('should disconnect after initialization', async () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      await connection.initialize('/index.html')
      expect(connection.isConnected).toBe(true)

      connection.disconnect()
      expect(connection.isConnected).toBe(false)

      connection = null // Already disconnected
    })
  })

  describe('multiple connections', () => {
    it('should support multiple independent connections', async () => {
      const iframe1 = createRealIframe()
      const iframe2 = createRealIframe()

      const conn1 = createSandboxConnection({
        iframe: iframe1,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      const conn2 = createSandboxConnection({
        iframe: iframe2,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*'
      })

      // Should have different IDs
      expect(conn1.id).not.toBe(conn2.id)

      // Initialize both
      await conn1.initialize('/index.html')
      await conn2.initialize('/index.html')

      expect(conn1.isConnected).toBe(true)
      expect(conn2.isConnected).toBe(true)

      // Disconnect one shouldn't affect the other
      conn1.disconnect()
      expect(conn1.isConnected).toBe(false)
      expect(conn2.isConnected).toBe(true)

      conn2.disconnect()
      removeIframe(iframe1)
      removeIframe(iframe2)
    })
  })
})

// Import vi for mocking
import { vi } from 'vitest'
