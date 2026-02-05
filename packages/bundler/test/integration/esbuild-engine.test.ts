/**
 * Integration Tests for ESBuildEngine and supporting classes
 * 
 * Tests the core bundling engine with complex dependency scenarios.
 * Note: These tests use a memory VFS and don't actually run esbuild in a browser context.
 * For real bundling tests, use the bundler-service integration tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Vfs } from '@pubwiki/vfs'
import { ESBuildEngine } from '../../src/core/esbuild-engine'
import { DependencyResolver } from '../../src/core/dependency-resolver'
import { BundleCache } from '../../src/core/bundle-cache'
import { createTestVfs } from '../helpers'
import {
  createComplexDependencyProject,
  createCircularDependencyProject,
  createIndexImportProject,
  createProjectWithError
} from '../helpers/fixtures'

describe('ESBuildEngine', () => {
  let vfs: Vfs

  beforeEach(() => {
    vfs = createTestVfs()
    // Reset mocks
    vi.clearAllMocks()
  })
  
  describe('initialization', () => {
    it('should be importable', () => {
      expect(ESBuildEngine).toBeDefined()
    })
    
    it('should have build method', () => {
      // We can't fully instantiate without esbuild WASM
      // but we can verify the class structure
      expect(ESBuildEngine.prototype.build).toBeDefined()
      expect(ESBuildEngine.prototype.initialize).toBeDefined()
    })
  })

  describe('DependencyResolver with complex projects', () => {
    it('should resolve relative imports', async () => {
      await createComplexDependencyProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // Resolve a relative import from main.tsx
      const result = await resolver.resolve('./components/App', '/complex/src/main.tsx')
      
      expect(result.path).toBe('/complex/src/components/App.tsx')
      expect(result.namespace).toBe('vfs')
    })

    it('should resolve npm packages', async () => {
      const resolver = new DependencyResolver()
      
      // Resolve react package
      const result = await resolver.resolve('react')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toContain('esm.sh')
    })

    it('should handle HTTP URLs', async () => {
      const resolver = new DependencyResolver()
      
      const httpUrl = 'https://esm.sh/react'
      const result = await resolver.resolve(httpUrl)
      
      expect(result.path).toBe(httpUrl)
      expect(result.namespace).toBe('http')
    })

    it('should resolve absolute paths', async () => {
      await createComplexDependencyProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      const result = await resolver.resolve('/complex/src/utils/config.ts')
      
      expect(result.path).toBe('/complex/src/utils/config.ts')
      expect(result.namespace).toBe('vfs')
    })

    it('should resolve index files', async () => {
      await createIndexImportProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // Resolve ./components which has an index.ts
      const result = await resolver.resolve('./components', '/index-imports/src/main.tsx')
      
      expect(result.path).toBe('/index-imports/src/components/index.ts')
      expect(result.namespace).toBe('vfs')
    })

    it('should handle circular dependency setup without infinite loop', async () => {
      await createCircularDependencyProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // Should resolve without hanging
      const resultA = await resolver.resolve('./moduleB', '/circular/src/moduleA.ts')
      expect(resultA.path).toBe('/circular/src/moduleB.ts')
      
      const resultB = await resolver.resolve('./moduleA', '/circular/src/moduleB.ts')
      expect(resultB.path).toBe('/circular/src/moduleA.ts')
    })

    it('should handle missing files gracefully', async () => {
      await createProjectWithError(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // Resolve a missing module - should still return a path
      const result = await resolver.resolve('./missing-module', '/error-project/src/main.ts')
      
      expect(result).toBeDefined()
      expect(result.namespace).toBe('vfs')
    })

    it('should cache resolve results', async () => {
      await createComplexDependencyProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // First resolve
      const result1 = await resolver.resolve('./components/App', '/complex/src/main.tsx')
      
      // Second resolve should use cache
      const result2 = await resolver.resolve('./components/App', '/complex/src/main.tsx')
      
      expect(result1.path).toBe(result2.path)
    })
  })

  describe('BundleCache', () => {
    it('should initialize and have transform methods', async () => {
      const cache = new BundleCache()
      
      // Verify the cache has expected methods
      expect(typeof cache.getTransform).toBe('function')
      expect(typeof cache.setTransform).toBe('function')
      expect(typeof cache.deleteTransform).toBe('function')
      expect(typeof cache.clearTransformCache).toBe('function')
    })

    it('should have HTTP cache methods', () => {
      const cache = new BundleCache()
      
      expect(typeof cache.getHttp).toBe('function')
      expect(typeof cache.setHttp).toBe('function')
    })

    it('should have statistics methods', () => {
      const cache = new BundleCache()
      
      expect(typeof cache.getStats).toBe('function')
      expect(typeof cache.clearAll).toBe('function')
    })
  })
})
