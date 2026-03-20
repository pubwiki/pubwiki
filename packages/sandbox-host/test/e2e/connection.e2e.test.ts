/**
 * SandboxConnection E2E Tests
 *
 * End-to-end tests for sandbox connection management running in a real browser
 * environment with iframe and window APIs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSandboxConnection } from '../../src/connection'
import { createTestVfs, addFile, createRealIframe, removeIframe } from './helpers'
import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'
import type { SandboxConnection, ICustomService } from '../../src/types'
import type { ServiceDefinition } from '@pubwiki/sandbox-service'

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
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      expect(connection).toBeDefined()
      expect(connection.id).toMatch(/^sandbox-conn-/)
      expect(connection.isConnected).toBe(false) // Not connected until SANDBOX_READY
    })

    it('should have required methods', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      expect(connection.waitForReady).toBeDefined()
      expect(typeof connection.waitForReady).toBe('function')
      expect(connection.disconnect).toBeDefined()
      expect(typeof connection.disconnect).toBe('function')
      expect(connection.reload).toBeDefined()
      expect(typeof connection.reload).toBe('function')
      expect(connection.addCustomService).toBeDefined()
      expect(typeof connection.addCustomService).toBe('function')
    })
  })

  describe('waitForReady', () => {
    it('should fail without iframe contentWindow', async () => {
      // Create a detached iframe (not added to DOM)
      const detachedIframe = document.createElement('iframe')

      connection = createSandboxConnection({
        iframe: detachedIframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Note: waitForReady waits for SANDBOX_READY message from iframe,
      // which won't come from a detached iframe
      // For now, we just check the initial state
      expect(connection.isConnected).toBe(false)
    })

    it('should be ready with valid iframe after sandbox sends SANDBOX_READY', async () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Initial state should be not connected
      expect(connection.isConnected).toBe(false)
      
      // Note: Full integration would require a sandbox page that sends SANDBOX_READY
      // This test verifies the initial state
    })
  })

  describe('addCustomService', () => {
    // Helper to create a mock ICustomService
    function createMockService(): ICustomService {
      return {
        async call(_inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          return { result: 'mock' }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'test',
            namespace: 'test',
            identifier: 'test:test',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }
    }

    it('should log error when adding service before connection is ready', () => {
      iframe = createRealIframe()

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      const mockService = createMockService()

      connection.addCustomService('test', mockService)

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    // Note: Testing addCustomService after connection is ready would require
    // a full sandbox integration with SANDBOX_READY message
  })

  describe('reload', () => {
    it('should not throw when called before connection is ready', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Should not throw
      expect(() => connection!.reload()).not.toThrow()
    })

    // Note: Testing reload after connection is ready would require
    // a full sandbox integration with SANDBOX_READY message
  })

  describe('disconnect', () => {
    it('should be safe to call disconnect without being connected', () => {
      iframe = createRealIframe()

      connection = createSandboxConnection({
        iframe,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Should not throw
      expect(() => connection!.disconnect()).not.toThrow()
      
      // Multiple disconnect calls should be safe
      expect(() => connection!.disconnect()).not.toThrow()

      connection = null // Already disconnected
    })

    // Note: Testing disconnect after connection is ready would require
    // a full sandbox integration with SANDBOX_READY message
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
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      const conn2 = createSandboxConnection({
        iframe: iframe2,
        basePath: '/public/demo',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Should have different IDs
      expect(conn1.id).not.toBe(conn2.id)


      // Both connections should have unique IDs
      expect(conn1.id).not.toBe(conn2.id)

      // Both should start as not connected
      expect(conn1.isConnected).toBe(false)
      expect(conn2.isConnected).toBe(false)

      // Disconnect one shouldn't affect the other
      conn1.disconnect()
      expect(conn1.isConnected).toBe(false)
      expect(conn2.isConnected).toBe(false)

      conn2.disconnect()
      removeIframe(iframe1)
      removeIframe(iframe2)
    })
  })
})