/**
 * End-to-End Integration Tests
 *
 * Tests the complete build workflow using the actual ESBuildEngine with esbuild-wasm.
 * These tests run the full bundling process, not just individual components.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Vfs } from '@pubwiki/vfs'
import { ESBuildEngine } from '../../src/core/esbuild-engine'
import { DependencyResolver } from '../../src/core/dependency-resolver'
import type { BuildCacheStorage } from '../../src/cache'
import { createTestVfs, addFile, updateFile, MockBuildCacheStorage } from '../helpers'
import {
  createSimpleProject,
  createMultiEntryProject,
  createComplexDependencyProject,
  createCircularDependencyProject,
  createIndexImportProject,
  createProjectWithError
} from '../helpers/fixtures'

describe('End-to-End Build Tests', () => {
  let resolver: DependencyResolver
  let cache: BuildCacheStorage
  let vfs: Vfs

  beforeEach(() => {
    vfs = createTestVfs()
    cache = new MockBuildCacheStorage()
    resolver = new DependencyResolver()
  })

  async function setupEngine(): Promise<ESBuildEngine> {
    resolver.setFileExistsChecker(async (path: string) => vfs.exists(path))
    
    const engine = new ESBuildEngine(resolver, cache)
    engine.setFileLoader(async (path: string) => {
      try {
        const file = await vfs.readFile(path)
        if (file.content === null) {
          throw new Error(`File not found: ${path}`)
        }
        if (file.content instanceof ArrayBuffer) {
          return new TextDecoder().decode(file.content)
        }
        return file.content as string
      } catch {
        throw new Error(`File not found: ${path}`)
      }
    })
    
    // Initialize esbuild-wasm
    await engine.initialize()
    
    return engine
  }

  describe('Simple Project Build', () => {
    it('should build a simple TypeScript project', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: {
          format: 'esm',
          target: 'es2020'
        }
      })

      expect(result.success).toBe(true)
      expect(result.outputs.size).toBeGreaterThan(0)
      
      // Check the main entry output
      const mainOutput = result.outputs.get('/project/src/main.tsx')
      expect(mainOutput).toBeDefined()
      expect(mainOutput?.success).toBe(true)
      expect(mainOutput?.code).toBeDefined()
      expect(mainOutput?.code).toContain('App')
    }, 30000)

    it('should handle JSX transformation', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: {
          jsx: 'automatic',
          jsxImportSource: 'react'
        }
      })

      expect(result.success).toBe(true)
      
      const mainOutput = result.outputs.get('/project/src/main.tsx')
      expect(mainOutput?.code).toBeDefined()
      // JSX should be transformed
      expect(mainOutput?.code).not.toContain('<div>')
    }, 30000)
  })

  describe('Multi-Entry Project Build', () => {
    it('should build multiple entry files', async () => {
      await createMultiEntryProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/multi-entry',
        entryFiles: ['/multi-entry/src/app.tsx', '/multi-entry/src/worker.ts'],
        options: {
          format: 'esm'
        }
      })

      expect(result.success).toBe(true)
      expect(result.outputs.size).toBeGreaterThanOrEqual(2)
      
      // Check both entries
      const appOutput = result.outputs.get('/multi-entry/src/app.tsx')
      const workerOutput = result.outputs.get('/multi-entry/src/worker.ts')
      
      expect(appOutput).toBeDefined()
      expect(workerOutput).toBeDefined()
      expect(appOutput?.success).toBe(true)
      expect(workerOutput?.success).toBe(true)
    }, 30000)

    it('should track dependencies for multi-entry projects', async () => {
      await createMultiEntryProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/multi-entry',
        entryFiles: ['/multi-entry/src/app.tsx', '/multi-entry/src/worker.ts'],
        options: {}
      })

      expect(result.dependencies.length).toBeGreaterThan(0)
      // Should include utility files
      expect(result.dependencies).toContain('/multi-entry/src/utils/date.ts')
      expect(result.dependencies).toContain('/multi-entry/src/utils/data.ts')
    }, 30000)
  })

  describe('Complex Dependency Project Build', () => {
    it('should build project with deep dependency tree', async () => {
      await createComplexDependencyProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/complex',
        entryFiles: ['/complex/src/main.tsx'],
        options: {
          format: 'esm'
        }
      })

      expect(result.success).toBe(true)
      
      // Should have tracked all dependencies
      expect(result.dependencies.length).toBeGreaterThan(5)
      expect(result.dependencies).toContain('/complex/src/components/App.tsx')
      expect(result.dependencies).toContain('/complex/src/utils/config.ts')
    }, 30000)

    it('should handle shared dependencies correctly', async () => {
      await createComplexDependencyProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/complex',
        entryFiles: ['/complex/src/main.tsx'],
        options: {}
      })

      expect(result.success).toBe(true)
      
      const mainOutput = result.outputs.get('/complex/src/main.tsx')
      expect(mainOutput?.code).toBeDefined()
      
      // The shared config.ts should be resolved correctly
      // (used by Header, Footer, api, logger)
      expect(result.dependencies).toContain('/complex/src/utils/config.ts')
    }, 30000)
  })

  describe('Index Import Resolution', () => {
    it('should resolve index file imports', async () => {
      await createIndexImportProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/index-imports',
        entryFiles: ['/index-imports/src/main.tsx'],
        options: {}
      })

      expect(result.success).toBe(true)
      
      // Should resolve index files
      expect(result.dependencies).toContain('/index-imports/src/components/index.ts')
      expect(result.dependencies).toContain('/index-imports/src/utils/index.ts')
      
      // And the actual component files
      expect(result.dependencies).toContain('/index-imports/src/components/Button.tsx')
      expect(result.dependencies).toContain('/index-imports/src/utils/date.ts')
    }, 30000)
  })

  describe('Circular Dependency Handling', () => {
    it('should handle circular dependencies without infinite loop', async () => {
      await createCircularDependencyProject(vfs)
      const engine = await setupEngine()

      // This should complete without hanging
      const result = await engine.build({
        projectRoot: '/circular',
        entryFiles: ['/circular/src/main.ts'],
        options: {}
      })

      // Build may fail due to circular deps, but should not hang
      expect(result).toBeDefined()
      // At minimum, dependencies should be tracked
      expect(result.dependencies).toBeDefined()
    }, 30000)
  })

  describe('Build Options', () => {
    it('should apply minification', async () => {
      // Create two separate projects to test minification
      // (same engine uses cached context per projectRoot, so we need different roots)
      const code = `
        // This is a comment that should be removed during minification
        const veryLongVariableName = "hello world";
        const anotherLongVariableName = "goodbye world";
        
        function myVeryLongFunctionName(parameterOne: string, parameterTwo: string) {
          const result = parameterOne + " and " + parameterTwo;
          return result;
        }
        
        export const output = myVeryLongFunctionName(veryLongVariableName, anotherLongVariableName);
      `
      const tsconfig = JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          jsx: 'react-jsx'
        }
      })
      
      // Two different project roots for different build options
      await addFile(vfs, '/minify-normal/src/main.tsx', code)
      await addFile(vfs, '/minify-normal/tsconfig.json', tsconfig)
      await addFile(vfs, '/minify-minified/src/main.tsx', code)
      await addFile(vfs, '/minify-minified/tsconfig.json', tsconfig)

      const engine = await setupEngine()

      const normalResult = await engine.build({
        projectRoot: '/minify-normal',
        entryFiles: ['/minify-normal/src/main.tsx'],
        options: { minify: false }
      })

      const minifiedResult = await engine.build({
        projectRoot: '/minify-minified',
        entryFiles: ['/minify-minified/src/main.tsx'],
        options: { minify: true }
      })

      const normalCode = normalResult.outputs.get('/minify-normal/src/main.tsx')?.code || ''
      const minifiedCode = minifiedResult.outputs.get('/minify-minified/src/main.tsx')?.code || ''

      // Minified code should be shorter (comments removed, names shortened)
      expect(minifiedCode.length).toBeLessThan(normalCode.length)
    }, 30000)

    it('should support different target environments', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      const es2020Result = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { target: 'es2020' }
      })

      expect(es2020Result.success).toBe(true)
      
      const esnextResult = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { target: 'esnext' }
      })

      expect(esnextResult.success).toBe(true)
    }, 30000)

    it('should generate sourcemaps when requested', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { sourcemap: 'inline' }
      })

      expect(result.success).toBe(true)
      
      const mainOutput = result.outputs.get('/project/src/main.tsx')
      expect(mainOutput?.code).toContain('sourceMappingURL')
    }, 30000)
  })

  describe('Error Handling', () => {
    it('should report errors for missing imports', async () => {
      await createProjectWithError(vfs)
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/error-project',
        entryFiles: ['/error-project/src/main.ts'],
        options: {}
      })

      // Build should fail but not throw
      expect(result.success).toBe(false)
      
      const mainOutput = result.outputs.get('/error-project/src/main.ts')
      expect(mainOutput?.errors.length).toBeGreaterThan(0)
    }, 30000)

    it('should handle syntax errors gracefully', async () => {
      await addFile(vfs, '/syntax-error/src/main.ts', `
        const x = {
          // Missing closing brace
      `)
      
      const engine = await setupEngine()

      const result = await engine.build({
        projectRoot: '/syntax-error',
        entryFiles: ['/syntax-error/src/main.ts'],
        options: {}
      })

      expect(result.success).toBe(false)
      expect(result.outputs.get('/syntax-error/src/main.ts')?.errors.length).toBeGreaterThan(0)
    }, 30000)
  })

  describe('Dependency Graph', () => {
    it('should build and expose dependency graph', async () => {
      await createComplexDependencyProject(vfs)
      const engine = await setupEngine()

      await engine.build({
        projectRoot: '/complex',
        entryFiles: ['/complex/src/main.tsx'],
        options: {}
      })

      const graph = engine.getDependencyGraph()
      
      expect(graph.size).toBeGreaterThan(0)
      
      // Main should have dependencies
      const mainDeps = graph.get('/complex/src/main.tsx')
      expect(mainDeps).toBeDefined()
      // getDependencyGraph returns { dependencies: string[], dependents: string[] }
      expect(mainDeps?.dependencies.length).toBeGreaterThan(0)
    }, 30000)
  })

  describe('Incremental Builds', () => {
    it('should reuse context for faster incremental rebuilds', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      // First build — cold (creates context + initializes worker)
      const start1 = performance.now()
      const result1 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { format: 'esm', target: 'es2020' }
      })
      const time1 = performance.now() - start1
      expect(result1.success).toBe(true)

      // Second build — incremental (reuses context via ctx.rebuild())
      const start2 = performance.now()
      const result2 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { format: 'esm', target: 'es2020' }
      })
      const time2 = performance.now() - start2
      expect(result2.success).toBe(true)

      console.log(`First build: ${time1.toFixed(2)}ms, Incremental rebuild: ${time2.toFixed(2)}ms`)

      // Incremental rebuild should be faster (no worker init, esbuild caches ASTs)
      expect(time2).toBeLessThan(time1)

      // Output should be equivalent
      const code1 = result1.outputs.get('/project/src/main.tsx')?.code || ''
      const code2 = result2.outputs.get('/project/src/main.tsx')?.code || ''
      expect(code1).toBe(code2)
    }, 60000)

    it('should pick up file changes on incremental rebuild', async () => {
      await createComplexDependencyProject(vfs)
      const engine = await setupEngine()

      // First build
      const result1 = await engine.build({
        projectRoot: '/complex',
        entryFiles: ['/complex/src/main.tsx'],
        options: {}
      })
      expect(result1.success).toBe(true)

      const code1 = result1.outputs.get('/complex/src/main.tsx')?.code || ''
      expect(code1).not.toContain('INCREMENTAL_CHANGE_MARKER')

      // Modify a dependency file
      await updateFile(vfs, '/complex/src/utils/config.ts', `
export const APP_NAME = "INCREMENTAL_CHANGE_MARKER"
export const config = { name: APP_NAME }
`)

      // Incremental rebuild should reflect the change
      const result2 = await engine.build({
        projectRoot: '/complex',
        entryFiles: ['/complex/src/main.tsx'],
        options: {}
      })
      expect(result2.success).toBe(true)

      const code2 = result2.outputs.get('/complex/src/main.tsx')?.code || ''
      expect(code2).toContain('INCREMENTAL_CHANGE_MARKER')
    }, 60000)

    it('should recover from build failure and continue incremental builds', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      // Build 1: success
      const r1 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: {}
      })
      expect(r1.success).toBe(true)

      // Build 2: break the file → failure (triggers full reset)
      await updateFile(vfs, '/project/src/main.tsx', 'INVALID {{{ SYNTAX')
      const r2 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: {}
      })
      expect(r2.success).toBe(false)

      // Build 3: fix the file → success (re-creates context from scratch)
      await updateFile(vfs, '/project/src/main.tsx', `
import React from 'react'
export function App() { return <div>Recovered</div> }
export default App
`)
      const r3 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: {}
      })
      expect(r3.success).toBe(true)
      expect(r3.outputs.get('/project/src/main.tsx')?.code).toContain('Recovered')

      // Build 4: incremental rebuild on the recovered context
      const r4 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: {}
      })
      expect(r4.success).toBe(true)
      expect(r4.outputs.get('/project/src/main.tsx')?.code).toContain('Recovered')
    }, 60000)

    it('should create new context when build options change', async () => {
      await createSimpleProject(vfs)
      const engine = await setupEngine()

      // Build with minify=false
      const r1 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { minify: false }
      })
      expect(r1.success).toBe(true)
      const code1 = r1.outputs.get('/project/src/main.tsx')?.code || ''

      // Build with minify=true — different options, new context
      const r2 = await engine.build({
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        options: { minify: true }
      })
      expect(r2.success).toBe(true)
      const code2 = r2.outputs.get('/project/src/main.tsx')?.code || ''

      // Minified code should be shorter
      expect(code2.length).toBeLessThan(code1.length)
    }, 60000)
  })
})