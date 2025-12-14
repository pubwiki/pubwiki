/**
 * Public API Integration Tests
 * 
 * Tests for all public exports from @pubwiki/bundler.
 * Ensures the package API is correctly exposed and usable.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Vfs } from '@pubwiki/vfs'

// Import all public exports
import {
  // Main factory function
  createBundler,
  
  // Classes
  BundlerService,
  
  // Service functions
  detectProject,
  findTsConfig,
  getEntryFilesFromTsConfig,
  isEntryFile,
  getDefaultEntryFile,
  
  // Path Utilities
  normalizePath,
  normalizeAbsolutePath,
  getDirectory,
  getParentDirectory,
  getFilename,
  getExtension,
  joinPath,
  isAbsolutePath,
  stripJsonComments,
  
  // MIME Utilities
  getMimeType,
  
  // Error page utilities
  createBuildErrorPage,
  createSimpleErrorPage
} from '../../src'

import { createTestVfs } from '../helpers'
import {
  createSimpleProject,
  createMultiEntryProject,
  createComplexDependencyProject,
  createIndexImportProject
} from '../helpers/fixtures'

// Import worker classes separately since they're not re-exported from main index
import { DependencyResolver } from '../../src/worker/dependency-resolver'

describe('Public API', () => {
  describe('Factory Function', () => {
    it('should export createBundler function', () => {
      expect(typeof createBundler).toBe('function')
    })
  })

  describe('Classes', () => {
    it('should export BundlerService', () => {
      expect(BundlerService).toBeDefined()
      expect(typeof BundlerService).toBe('function')
    })
  })

  describe('Service Functions', () => {
    it('should export detectProject', () => {
      expect(typeof detectProject).toBe('function')
    })

    it('should export findTsConfig', () => {
      expect(typeof findTsConfig).toBe('function')
    })

    it('should export getEntryFilesFromTsConfig', () => {
      expect(typeof getEntryFilesFromTsConfig).toBe('function')
    })

    it('should export isEntryFile', () => {
      expect(typeof isEntryFile).toBe('function')
    })

    it('should export getDefaultEntryFile', () => {
      expect(typeof getDefaultEntryFile).toBe('function')
    })
  })

  describe('Path Utilities', () => {
    describe('normalizePath', () => {
      it('should normalize paths correctly', () => {
        expect(normalizePath('/foo', 'bar/../baz')).toBe('/foo/baz')
        expect(normalizePath('/foo', './bar')).toBe('/foo/bar')
        expect(normalizePath('/base', '/absolute')).toBe('/absolute')
      })
    })

    describe('normalizeAbsolutePath', () => {
      it('should normalize absolute paths', () => {
        expect(normalizeAbsolutePath('/foo/bar/../baz')).toBe('/foo/baz')
        expect(normalizeAbsolutePath('/foo/./bar')).toBe('/foo/bar')
        expect(normalizeAbsolutePath('//foo//bar//')).toBe('/foo/bar')
      })
    })

    describe('joinPath', () => {
      it('should join path segments', () => {
        expect(joinPath('/foo', 'bar', 'baz')).toBe('/foo/bar/baz')
        expect(joinPath('/foo', '../bar')).toBe('/bar')
        expect(joinPath('/foo/bar', './baz')).toBe('/foo/bar/baz')
      })
    })

    describe('getDirectory', () => {
      it('should extract directory name', () => {
        expect(getDirectory('/foo/bar/baz.ts')).toBe('/foo/bar')
        expect(getDirectory('/foo/bar')).toBe('/foo')
        expect(getDirectory('/foo')).toBe('/')
      })
    })

    describe('getFilename', () => {
      it('should extract base name', () => {
        expect(getFilename('/foo/bar/baz.ts')).toBe('baz.ts')
        expect(getFilename('/foo/bar')).toBe('bar')
        expect(getFilename('foo')).toBe('foo')
      })
    })

    describe('getExtension', () => {
      it('should extract extension', () => {
        expect(getExtension('/foo/bar.ts')).toBe('.ts')
        expect(getExtension('/foo/bar.test.ts')).toBe('.ts')
        expect(getExtension('/foo/bar')).toBe('')
      })
    })

    describe('isAbsolutePath', () => {
      it('should detect absolute paths', () => {
        expect(isAbsolutePath('/foo/bar')).toBe(true)
        expect(isAbsolutePath('foo/bar')).toBe(false)
        expect(isAbsolutePath('./foo')).toBe(false)
      })
    })

    describe('getParentDirectory', () => {
      it('should get parent directory', () => {
        expect(getParentDirectory('/foo/bar')).toBe('/foo')
        expect(getParentDirectory('/foo')).toBe('/')
        expect(getParentDirectory('/')).toBeNull()
      })
    })

    describe('stripJsonComments', () => {
      it('should strip comments from JSON', () => {
        const json = `{
          // comment
          "key": "value" /* inline comment */
        }`
        const result = stripJsonComments(json)
        expect(result).not.toContain('//')
        expect(result).not.toContain('/*')
      })
    })
  })

  describe('MIME Type Utilities', () => {
    describe('getMimeType', () => {
      it('should return correct MIME types', () => {
        expect(getMimeType('/app.js')).toBe('application/javascript')
        expect(getMimeType('/app.ts')).toBe('application/typescript')
        expect(getMimeType('/style.css')).toBe('text/css')
        expect(getMimeType('/data.json')).toBe('application/json')
        expect(getMimeType('/index.html')).toBe('text/html')
      })
    })
  })

  describe('Error Page Generator', () => {
    it('should generate error page HTML with createBuildErrorPage', () => {
      const errors = [
        { file: '/app.ts', line: 10, column: 5, message: 'Type error' }
      ]
      
      const html = createBuildErrorPage('/app.ts', errors)
      
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('app.ts')
      expect(html).toContain('Type error')
    })

    it('should generate simple error page', () => {
      const html = createSimpleErrorPage('Something went wrong')
      
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Something went wrong')
    })
  })
})

describe('Project Detection Integration', () => {
  let vfs: Vfs
  
  beforeEach(() => {
    vfs = createTestVfs()
  })

  describe('findTsConfig', () => {
    it('should find tsconfig.json in project', async () => {
      await createSimpleProject(vfs)
      
      const tsconfig = await findTsConfig('/project/src/main.tsx', vfs)
      
      expect(tsconfig).toBe('/project/tsconfig.json')
    })

    it('should return null when no tsconfig exists', async () => {
      await vfs.createFile('/project/main.ts', 'console.log("hello")')
      
      const tsconfig = await findTsConfig('/project/main.ts', vfs)
      
      expect(tsconfig).toBeNull()
    })
  })

  describe('detectProject', () => {
    it('should detect simple project structure', async () => {
      await createSimpleProject(vfs)
      
      // detectProject expects a file path, not a directory
      const project = await detectProject('/project/src/main.tsx', vfs)
      
      expect(project).toBeDefined()
      expect(project?.tsconfigPath).toBe('/project/tsconfig.json')
      expect(project?.entryFiles.length).toBeGreaterThan(0)
    })

    it('should detect multi-entry project', async () => {
      await createMultiEntryProject(vfs)
      
      // detectProject expects a file path, not a directory
      const project = await detectProject('/multi-entry/src/app.tsx', vfs)
      
      expect(project).toBeDefined()
      expect(project?.entryFiles.length).toBeGreaterThanOrEqual(2)
    })

    it('should detect complex dependency project', async () => {
      await createComplexDependencyProject(vfs)
      
      // detectProject expects a file path, not a directory
      const project = await detectProject('/complex/src/main.tsx', vfs)
      
      expect(project).toBeDefined()
      expect(project?.tsconfigPath).toBe('/complex/tsconfig.json')
    })
  })
})

describe('DependencyResolver Integration', () => {
  let vfs: Vfs
  
  beforeEach(() => {
    vfs = createTestVfs()
  })

  describe('resolve', () => {
    it('should resolve all import types', async () => {
      await createComplexDependencyProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // Relative import
      const relResult = await resolver.resolve('./components/App', '/complex/src/main.tsx')
      expect(relResult.path).toBe('/complex/src/components/App.tsx')
      expect(relResult.namespace).toBe('vfs')
      
      // Absolute import
      const absResult = await resolver.resolve('/complex/src/utils/config.ts')
      expect(absResult.path).toBe('/complex/src/utils/config.ts')
      expect(absResult.namespace).toBe('vfs')
      
      // npm package
      const npmResult = await resolver.resolve('react')
      expect(npmResult.namespace).toBe('http')
      
      // HTTP URL
      const httpResult = await resolver.resolve('https://esm.sh/lodash')
      expect(httpResult.path).toBe('https://esm.sh/lodash')
      expect(httpResult.namespace).toBe('http')
    })

    it('should resolve index file imports', async () => {
      await createIndexImportProject(vfs)
      
      const resolver = new DependencyResolver({
        fileExistsChecker: async (path: string) => vfs.exists(path)
      })
      
      // Import from directory with index.ts
      const componentsResult = await resolver.resolve('./components', '/index-imports/src/main.tsx')
      expect(componentsResult.path).toBe('/index-imports/src/components/index.ts')
      
      const utilsResult = await resolver.resolve('./utils', '/index-imports/src/main.tsx')
      expect(utilsResult.path).toBe('/index-imports/src/utils/index.ts')
    })
  })
})
