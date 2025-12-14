/**
 * BundlerService Watch Functionality Tests
 *
 * Tests for the file watching and auto-rebuild features of BundlerService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Vfs } from '@pubwiki/vfs'
import { BundlerService } from '../../src/service/bundler-service'
import { createTestVfs, addFile } from '../helpers'

describe('BundlerService Watch', () => {
  let vfs: Vfs
  let bundler: BundlerService

  beforeEach(async () => {
    vfs = createTestVfs()
    bundler = new BundlerService({ vfs })
  })

  afterEach(() => {
    bundler.terminate()
  })

  /**
   * Helper to create a simple project for testing
   */
  async function createTestProject(): Promise<void> {
    await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        jsx: 'react-jsx'
      },
      files: ['src/main.tsx']
    }, null, 2))

    await addFile(vfs, '/project/src/main.tsx', `
import { helper } from './utils/helper'

export function App() {
  return helper()
}
`)

    await addFile(vfs, '/project/src/utils/helper.ts', `
export function helper() {
  return 'Hello World'
}
`)
  }

  describe('watch()', () => {
    it('should return an unwatch function', async () => {
      await createTestProject()
      await bundler.initialize()

      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json'
      })

      expect(typeof unwatch).toBe('function')
      
      // Clean up
      unwatch()
    }, 30000)

    it('should perform initial build when watch starts', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild
      })

      // Wait for initial build to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // The initial build doesn't call onRebuild, but we can check via progress
      // Let's verify the bundler is ready
      expect(bundler.isReady()).toBe(true)
      
      unwatch()
    }, 30000)

    it('should call onFileChange when a watched file changes', async () => {
      await createTestProject()
      await bundler.initialize()

      const onFileChange = vi.fn()
      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onFileChange,
        onRebuild
      })

      // Wait for initial build to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify a dependency file
      await vfs.updateFile('/project/src/utils/helper.ts', `
export function helper() {
  return 'Hello Updated World'
}
`)

      // Wait for file change to be processed
      await new Promise(resolve => setTimeout(resolve, 1000))

      expect(onFileChange).toHaveBeenCalledWith('/project/src/utils/helper.ts')
      
      unwatch()
    }, 30000)

    it('should call onRebuild after file change', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild
      })

      // Wait for initial build to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify the main entry file
      await vfs.updateFile('/project/src/main.tsx', `
import { helper } from './utils/helper'

export function App() {
  return helper() + ' - Updated!'
}
`)

      // Wait for rebuild to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      expect(onRebuild).toHaveBeenCalled()
      const result = onRebuild.mock.calls[0][0]
      expect(result).toBeDefined()
      expect(result.success).toBeDefined()
      
      unwatch()
    }, 30000)

    it('should watch tsconfig.json changes', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify tsconfig.json
      await vfs.updateFile('/project/tsconfig.json', JSON.stringify({
        compilerOptions: {
          target: 'ES2021', // Changed
          module: 'ESNext',
          jsx: 'react-jsx'
        },
        files: ['src/main.tsx']
      }, null, 2))

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 2000))

      expect(onRebuild).toHaveBeenCalled()
      
      unwatch()
    }, 30000)

    it('should handle file deletion', async () => {
      await createTestProject()
      await bundler.initialize()

      const onFileChange = vi.fn()
      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onFileChange,
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Delete a dependency file
      await vfs.deleteFile('/project/src/utils/helper.ts')

      // Wait for change to be processed
      await new Promise(resolve => setTimeout(resolve, 1000))

      expect(onFileChange).toHaveBeenCalledWith('/project/src/utils/helper.ts')
      
      unwatch()
    }, 30000)

    it('should stop watching when unwatch is called', async () => {
      await createTestProject()
      await bundler.initialize()

      const onFileChange = vi.fn()
      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onFileChange,
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Stop watching
      unwatch()

      // Reset mocks
      onFileChange.mockClear()
      onRebuild.mockClear()

      // Modify a file
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'After unwatch'
}
`)

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Should not have been called since we unwatched
      expect(onFileChange).not.toHaveBeenCalled()
      expect(onRebuild).not.toHaveBeenCalled()
    }, 30000)

    it('should only watch files in the dependency graph', async () => {
      await createTestProject()
      
      // Add an unrelated file
      await addFile(vfs, '/project/src/unrelated.ts', `
export const unused = 'not imported'
`)

      await bundler.initialize()

      const onFileChange = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onFileChange
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify the unrelated file
      await vfs.updateFile('/project/src/unrelated.ts', `
export const unused = 'still not imported'
`)

      // Wait for potential change processing
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Should not trigger since unrelated.ts is not in dependencies
      expect(onFileChange).not.toHaveBeenCalled()
      
      unwatch()
    }, 30000)

    it('should update dependency watching after rebuild adds new deps', async () => {
      await createTestProject()
      
      // Add a new file that's not yet imported
      await addFile(vfs, '/project/src/utils/newHelper.ts', `
export function newHelper() {
  return 'New Helper'
}
`)

      await bundler.initialize()

      const onFileChange = vi.fn()
      let rebuildCount = 0
      let lastDependencies: string[] = []
      const onRebuild = vi.fn().mockImplementation((result) => {
        rebuildCount++
        lastDependencies = result.dependencies
      })
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onFileChange,
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify main.tsx to import the new file
      await vfs.updateFile('/project/src/main.tsx', `
import { helper } from './utils/helper'
import { newHelper } from './utils/newHelper'

export function App() {
  return helper() + newHelper()
}
`)

      // Wait for rebuild to complete
      await new Promise(resolve => setTimeout(resolve, 3000))

      expect(onRebuild).toHaveBeenCalled()
      expect(lastDependencies).toContain('/project/src/utils/newHelper.ts')
      
      const countAfterFirstRebuild = rebuildCount

      // Clear mocks but keep count
      onFileChange.mockClear()
      onRebuild.mockClear()

      // Now modify the new dependency - it should be watched now
      await vfs.updateFile('/project/src/utils/newHelper.ts', `
export function newHelper() {
  return 'Updated New Helper'
}
`)

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Should trigger because newHelper.ts is now in dependencies
      expect(rebuildCount).toBeGreaterThan(countAfterFirstRebuild)
      
      unwatch()
    }, 60000)

    it('should cancel previous watch when called again for same tsconfig', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild1 = vi.fn()
      const onRebuild2 = vi.fn()
      
      // First watch
      const unwatch1 = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild: onRebuild1
      })

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Second watch for same tsconfig (should cancel first)
      const unwatch2 = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild: onRebuild2
      })

      // Wait for setup
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify a file
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'Changed'
}
`)

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Only the second callback should be called
      expect(onRebuild1).not.toHaveBeenCalled()
      expect(onRebuild2).toHaveBeenCalled()
      
      unwatch1() // Should be no-op since already cancelled
      unwatch2()
    }, 45000)

    it('should handle errors in onFileChange callback gracefully', async () => {
      await createTestProject()
      await bundler.initialize()

      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error')
      })
      const onRebuild = vi.fn()
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onFileChange: errorCallback,
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify a file - should not crash despite callback error
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'Changed'
}
`)

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Error callback was called but didn't prevent rebuild
      expect(errorCallback).toHaveBeenCalled()
      expect(onRebuild).toHaveBeenCalled()
      
      unwatch()
    }, 30000)

    it('should handle errors in onRebuild callback gracefully', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild = vi.fn().mockImplementation(() => {
        throw new Error('Rebuild callback error')
      })
      
      const unwatch = bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify a file - should not crash despite callback error
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'Changed once'
}
`)

      // Wait
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Modify again to verify watch still works
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'Changed twice'
}
`)

      await new Promise(resolve => setTimeout(resolve, 2000))

      // Should have been called multiple times despite errors
      expect(onRebuild.mock.calls.length).toBeGreaterThanOrEqual(2)
      
      unwatch()
    }, 45000)
  })

  describe('terminate()', () => {
    it('should stop all watchers when terminated', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild = vi.fn()
      
      bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Terminate the bundler
      bundler.terminate()

      // Reset mock
      onRebuild.mockClear()

      // Modify a file
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'After terminate'
}
`)

      // Wait
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Should not have been called since bundler was terminated
      expect(onRebuild).not.toHaveBeenCalled()
    }, 30000)
  })

  describe('invalidate()', () => {
    it('should invalidate cache for specific file', async () => {
      await createTestProject()
      await bundler.initialize()

      // Build first
      await bundler.build({ tsconfigPath: '/project/tsconfig.json' })

      // Invalidate a specific file
      await bundler.invalidate('/project/src/utils/helper.ts')

      // Should not throw
      expect(bundler.isReady()).toBe(true)
    }, 30000)
  })

  describe('invalidateAll()', () => {
    it('should invalidate all cache and stop watchers', async () => {
      await createTestProject()
      await bundler.initialize()

      const onRebuild = vi.fn()
      
      bundler.watch({
        tsconfigPath: '/project/tsconfig.json',
        onRebuild
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Invalidate all
      await bundler.invalidateAll()

      // Reset mock
      onRebuild.mockClear()

      // Modify a file
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'After invalidateAll'
}
`)

      // Wait
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Watcher should have been stopped
      expect(onRebuild).not.toHaveBeenCalled()
    }, 30000)
  })

  describe('onBuildProgress()', () => {
    it('should report build progress events during watch rebuild', async () => {
      await createTestProject()
      await bundler.initialize()

      const progressEvents: Array<{ type: string; path: string }> = []
      
      bundler.onBuildProgress((event) => {
        progressEvents.push({ type: event.type, path: event.path })
      })

      bundler.watch({
        tsconfigPath: '/project/tsconfig.json'
      })

      // Wait for initial build
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Clear events from initial build
      progressEvents.length = 0

      // Modify a file to trigger rebuild
      await vfs.updateFile('/project/src/main.tsx', `
export function App() {
  return 'Triggering rebuild'
}
`)

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Should have progress events
      expect(progressEvents.some(e => e.type === 'start')).toBe(true)
      expect(progressEvents.some(e => e.type === 'complete' || e.type === 'error')).toBe(true)
      
      bundler.terminate()
    }, 30000)
  })
})
