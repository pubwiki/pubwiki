/**
 * Public API Tests
 *
 * Tests that all expected exports are available from the @pubwiki/sandbox-host package.
 */

import { describe, it, expect } from 'vitest'
import * as sandboxHost from '../../src/index'

describe('@pubwiki/sandbox-host public API', () => {
  describe('main exports', () => {
    it('should export createVfsRpcHost', () => {
      expect(sandboxHost.createVfsRpcHost).toBeDefined()
      expect(typeof sandboxHost.createVfsRpcHost).toBe('function')
    })

    it('should export createMainRpcHost', () => {
      expect(sandboxHost.createMainRpcHost).toBeDefined()
      expect(typeof sandboxHost.createMainRpcHost).toBe('function')
    })

    it('should export createSandboxConnection', () => {
      expect(sandboxHost.createSandboxConnection).toBeDefined()
      expect(typeof sandboxHost.createSandboxConnection).toBe('function')
    })

    it('should export createVfsRpcChannel', () => {
      expect(sandboxHost.createVfsRpcChannel).toBeDefined()
      expect(typeof sandboxHost.createVfsRpcChannel).toBe('function')
    })

    it('should export createMainRpcChannel', () => {
      expect(sandboxHost.createMainRpcChannel).toBeDefined()
      expect(typeof sandboxHost.createMainRpcChannel).toBe('function')
    })
  })

  describe('service exports', () => {
    it('should export HmrServiceImpl', () => {
      expect(sandboxHost.HmrServiceImpl).toBeDefined()
      expect(typeof sandboxHost.HmrServiceImpl).toBe('function')
    })

    it('should export VfsServiceImpl', () => {
      expect(sandboxHost.VfsServiceImpl).toBeDefined()
      expect(typeof sandboxHost.VfsServiceImpl).toBe('function')
    })
  })

  describe('utility exports', () => {
    it('should export getMimeType', () => {
      expect(sandboxHost.getMimeType).toBeDefined()
      expect(typeof sandboxHost.getMimeType).toBe('function')
    })

    it('should export normalizePath', () => {
      expect(sandboxHost.normalizePath).toBeDefined()
      expect(typeof sandboxHost.normalizePath).toBe('function')
    })

    it('should export createBuildErrorPage', () => {
      expect(sandboxHost.createBuildErrorPage).toBeDefined()
      expect(typeof sandboxHost.createBuildErrorPage).toBe('function')
    })

    it('should export createSimpleErrorPage', () => {
      expect(sandboxHost.createSimpleErrorPage).toBeDefined()
      expect(typeof sandboxHost.createSimpleErrorPage).toBe('function')
    })

    it('should export isEntryFile', () => {
      expect(sandboxHost.isEntryFile).toBeDefined()
      expect(typeof sandboxHost.isEntryFile).toBe('function')
    })

    it('should export MIME_TYPES constant', () => {
      expect(sandboxHost.MIME_TYPES).toBeDefined()
      expect(typeof sandboxHost.MIME_TYPES).toBe('object')
    })
  })

  describe('re-exported types from @pubwiki/vfs', () => {
    it('should export Vfs class', () => {
      expect(sandboxHost.Vfs).toBeDefined()
      expect(typeof sandboxHost.Vfs).toBe('function')
    })
  })

  describe('API surface validation', () => {
    it('should have expected exports', () => {
      const exportedKeys = Object.keys(sandboxHost)
      
      // Main functions
      expect(exportedKeys).toContain('createVfsRpcHost')
      expect(exportedKeys).toContain('createMainRpcHost')
      expect(exportedKeys).toContain('createSandboxConnection')
      expect(exportedKeys).toContain('createVfsRpcChannel')
      expect(exportedKeys).toContain('createMainRpcChannel')
      
      // Services
      expect(exportedKeys).toContain('HmrServiceImpl')
      expect(exportedKeys).toContain('VfsServiceImpl')
      
      // Utils
      expect(exportedKeys).toContain('getMimeType')
      expect(exportedKeys).toContain('normalizePath')
      expect(exportedKeys).toContain('MIME_TYPES')
      
      // Re-exports
      expect(exportedKeys).toContain('Vfs')
    })
  })
})
