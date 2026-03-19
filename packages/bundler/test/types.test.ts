/**
 * Types Export Tests
 *
 * Verify all types are correctly exported from the package.
 */

import { describe, it, expect } from 'vitest'
import type {
  // Options
  BundleOptions,
  
  // Results
  BuildError,
  BuildWarning as _BuildWarning,
  FileBuildResult,
  ProjectBuildResult,
  BuildResult as _BuildResult,
  
  // Cache
  DependencyEntry,
  
  // Worker API
  BundlerWorkerAPI as _BundlerWorkerAPI,
  WorkerBuildRequest,
  
  // Service
  BundleRequest,
  DirectBuildRequest,
  BuildProgressEvent,
  BuildProgressCallback as _BuildProgressCallback,
  WatchOptions,
  BundlerOptions as _BundlerOptions
} from '../src/types'

describe('types exports', () => {
  describe('BundleOptions', () => {
    it('should have correct properties', () => {
      const options: BundleOptions = {
        minify: true,
        sourcemap: 'inline',
        target: 'es2020',
        format: 'esm',
        external: ['react'],
        define: { 'process.env.NODE_ENV': '"production"' },
        jsx: 'automatic',
        jsxImportSource: 'react',
        treeShaking: true
      }
      
      expect(options.minify).toBe(true)
      expect(options.target).toBe('es2020')
    })

    it('should allow partial options', () => {
      const options: BundleOptions = {}
      expect(options).toBeDefined()
    })
  })

  describe('BuildError', () => {
    it('should have required properties', () => {
      const error: BuildError = {
        file: '/project/main.ts',
        line: 10,
        column: 5,
        message: 'Type error'
      }
      
      expect(error.file).toBe('/project/main.ts')
      expect(error.line).toBe(10)
    })

    it('should allow optional snippet', () => {
      const error: BuildError = {
        file: '/project/main.ts',
        line: 10,
        column: 5,
        message: 'Type error',
        snippet: 'const x: string = 123'
      }
      
      expect(error.snippet).toBeDefined()
    })
  })

  describe('FileBuildResult', () => {
    it('should have success result', () => {
      const result: FileBuildResult = {
        success: true,
        code: 'export default {}',
        errors: []
      }
      
      expect(result.success).toBe(true)
      expect(result.code).toBeDefined()
    })

    it('should have error result', () => {
      const result: FileBuildResult = {
        success: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, message: 'Error' }]
      }
      
      expect(result.success).toBe(false)
      expect(result.errors.length).toBe(1)
    })
  })

  describe('ProjectBuildResult', () => {
    it('should contain outputs map', () => {
      const result: ProjectBuildResult = {
        success: true,
        outputs: new Map([
          ['/main.ts', { success: true, errors: [], code: '' }]
        ]),
        dependencies: ['/utils.ts']
      }
      
      expect(result.outputs.size).toBe(1)
      expect(result.dependencies).toContain('/utils.ts')
    })
  })

  describe('DependencyEntry', () => {
    it('should have path and relations', () => {
      const entry: DependencyEntry = {
        path: '/project/main.ts',
        dependencies: ['/project/utils.ts'],
        dependents: []
      }
      
      expect(entry.path).toBe('/project/main.ts')
      expect(entry.dependencies).toHaveLength(1)
    })
  })

  describe('WorkerBuildRequest', () => {
    it('should have required properties', () => {
      const request: WorkerBuildRequest = {
        projectRoot: '/project',
        entryFiles: ['/project/main.ts']
      }
      
      expect(request.projectRoot).toBe('/project')
      expect(request.entryFiles).toHaveLength(1)
    })

    it('should allow options', () => {
      const request: WorkerBuildRequest = {
        projectRoot: '/project',
        entryFiles: ['/project/main.ts'],
        options: { minify: true }
      }
      
      expect(request.options?.minify).toBe(true)
    })
  })

  describe('BundleRequest', () => {
    it('should have tsconfig path', () => {
      const request: BundleRequest = {
        tsconfigPath: '/project/tsconfig.json'
      }
      
      expect(request.tsconfigPath).toBeDefined()
    })
  })

  describe('DirectBuildRequest', () => {
    it('should have project root and entry files', () => {
      const request: DirectBuildRequest = {
        projectRoot: '/project',
        entryFiles: ['/project/main.ts', '/project/worker.ts']
      }
      
      expect(request.projectRoot).toBe('/project')
      expect(request.entryFiles).toHaveLength(2)
    })
  })

  describe('BuildProgressEvent', () => {
    it('should have event types', () => {
      const startEvent: BuildProgressEvent = {
        type: 'start',
        path: '/project/tsconfig.json',
        message: 'Starting build'
      }
      
      const completeEvent: BuildProgressEvent = {
        type: 'complete',
        path: '/project/tsconfig.json',
        result: { success: true, outputs: new Map(), dependencies: [] }
      }
      
      expect(startEvent.type).toBe('start')
      expect(completeEvent.type).toBe('complete')
    })
  })

  describe('WatchOptions', () => {
    it('should have required and optional properties', () => {
      const options: WatchOptions = {
        tsconfigPath: '/project/tsconfig.json',
        onRebuild: () => {},
        onFileChange: () => {}
      }
      
      expect(options.tsconfigPath).toBeDefined()
    })
  })
})
