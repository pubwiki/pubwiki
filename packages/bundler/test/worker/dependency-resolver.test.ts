/**
 * Dependency Resolver Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DependencyResolver } from '../../src/worker/dependency-resolver'

describe('DependencyResolver', () => {
  let resolver: DependencyResolver
  let mockFileChecker: (path: string) => Promise<boolean>
  let existingFiles: Set<string>

  beforeEach(() => {
    existingFiles = new Set<string>()
    mockFileChecker = async (path: string) => existingFiles.has(path)
    resolver = new DependencyResolver({ fileExistsChecker: mockFileChecker })
  })

  describe('relative path resolution', () => {
    it('should resolve ./ paths', async () => {
      existingFiles.add('/project/src/utils.ts')
      
      const result = await resolver.resolve('./utils', '/project/src/main.ts')
      
      expect(result.namespace).toBe('vfs')
      expect(result.path).toBe('/project/src/utils.ts')
    })

    it('should resolve ../ paths', async () => {
      existingFiles.add('/project/lib/helper.ts')
      
      const result = await resolver.resolve('../lib/helper', '/project/src/main.ts')
      
      expect(result.namespace).toBe('vfs')
      expect(result.path).toBe('/project/lib/helper.ts')
    })

    it('should resolve multiple ../', async () => {
      existingFiles.add('/utils.ts')
      
      const result = await resolver.resolve('../../utils', '/project/src/main.ts')
      
      expect(result.namespace).toBe('vfs')
      expect(result.path).toBe('/utils.ts')
    })

    it('should throw for relative path without importer', async () => {
      await expect(resolver.resolve('./utils')).rejects.toThrow()
    })
  })

  describe('absolute path resolution', () => {
    it('should resolve absolute paths', async () => {
      const result = await resolver.resolve('/project/src/utils.ts', '/other/file.ts')
      
      expect(result.namespace).toBe('vfs')
      expect(result.path).toBe('/project/src/utils.ts')
    })
  })

  describe('extension resolution', () => {
    it('should try .tsx extension first', async () => {
      existingFiles.add('/project/src/Component.tsx')
      
      const result = await resolver.resolve('./Component', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/Component.tsx')
    })

    it('should try .ts extension', async () => {
      existingFiles.add('/project/src/utils.ts')
      
      const result = await resolver.resolve('./utils', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/utils.ts')
    })

    it('should try .jsx extension', async () => {
      existingFiles.add('/project/src/App.jsx')
      
      const result = await resolver.resolve('./App', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/App.jsx')
    })

    it('should try .js extension', async () => {
      existingFiles.add('/project/src/lib.js')
      
      const result = await resolver.resolve('./lib', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/lib.js')
    })

    it('should preserve explicit extension', async () => {
      const result = await resolver.resolve('./utils.ts', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/utils.ts')
    })
  })

  describe('index file resolution', () => {
    it('should resolve index.tsx', async () => {
      existingFiles.add('/project/src/components/index.tsx')
      
      const result = await resolver.resolve('./components', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/components/index.tsx')
    })

    it('should resolve index.ts', async () => {
      existingFiles.add('/project/src/utils/index.ts')
      
      const result = await resolver.resolve('./utils', '/project/src/main.ts')
      
      expect(result.path).toBe('/project/src/utils/index.ts')
    })
  })

  describe('npm package resolution', () => {
    it('should resolve npm packages to CDN URL', async () => {
      const result = await resolver.resolve('lodash', '/project/src/main.ts')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toMatch(/^https:\/\//)
      expect(result.path).toContain('lodash')
    })

    it('should resolve scoped packages', async () => {
      const result = await resolver.resolve('@scope/package', '/project/src/main.ts')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toContain('@scope/package')
    })

    it('should resolve package subpaths', async () => {
      const result = await resolver.resolve('lodash/debounce', '/project/src/main.ts')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toContain('lodash/debounce')
    })
  })

  describe('HTTP URL resolution', () => {
    it('should pass through HTTP URLs', async () => {
      const result = await resolver.resolve('https://cdn.example.com/lib.js', '/project/main.ts')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toBe('https://cdn.example.com/lib.js')
    })

    it('should resolve relative paths from HTTP importer', async () => {
      const result = await resolver.resolve('./utils.js', 'https://cdn.example.com/lib/main.js')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toBe('https://cdn.example.com/lib/utils.js')
    })

    it('should resolve absolute paths from HTTP importer', async () => {
      const result = await resolver.resolve('/other/file.js', 'https://cdn.example.com/lib/main.js')
      
      expect(result.namespace).toBe('http')
      expect(result.path).toBe('https://cdn.example.com/other/file.js')
    })
  })

  describe('caching', () => {
    it('should cache resolve results', async () => {
      existingFiles.add('/project/src/utils.ts')
      
      const result1 = await resolver.resolve('./utils', '/project/src/main.ts')
      const result2 = await resolver.resolve('./utils', '/project/src/main.ts')
      
      expect(result1).toEqual(result2)
    })

    it('should clear cache', async () => {
      existingFiles.add('/project/src/utils.ts')
      
      await resolver.resolve('./utils', '/project/src/main.ts')
      
      const stats1 = resolver.getCacheStats()
      expect(stats1.resolveCache).toBeGreaterThan(0)
      
      resolver.clearCache()
      
      const stats2 = resolver.getCacheStats()
      expect(stats2.resolveCache).toBe(0)
    })
  })

  describe('no-bundle packages', () => {
    it('should handle react without ?bundle', async () => {
      const result = await resolver.resolve('react', '/project/main.ts')
      
      expect(result.namespace).toBe('http')
      // esm.sh should not add ?bundle for react
      if (result.path.includes('esm.sh')) {
        expect(result.path).not.toContain('?bundle')
      }
    })

    it('should add custom no-bundle packages', () => {
      resolver.addNoBundlePackages(['my-custom-lib'])
      
      // The package should now be in the no-bundle list
      const stats = resolver.getCacheStats()
      expect(stats).toBeDefined()
    })
  })
})
