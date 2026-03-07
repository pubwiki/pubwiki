/**
 * BuildAwareVfs Unit Tests
 *
 * Tests the multi-level cache VFS layer (L0→L1→L2→L3).
 * L3 (BundlerService) is not tested here as it requires esbuild-wasm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBuildAwareVfs, type RemoteBuildFetcher, type BuildAwareVfsConfig } from '../src/build-aware-vfs'
import type { OpfsBuildCacheStorage, BuildCacheFile, BuildCacheHandle, BuildCacheMetadata } from '../src/build-cache-storage'
import type { BuildManifest } from '../src/types/result'
import type { ProjectConfig } from '../src/service/project-detector'
import { createTestVfs, addFile, readFileContent } from './helpers'
import type { Vfs } from '@pubwiki/vfs'

// ============================================================================
// Mock factories
// ============================================================================

function createMockBuildCacheStorage(): OpfsBuildCacheStorage {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    evict: vi.fn().mockResolvedValue(0),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(null),
  } as unknown as OpfsBuildCacheStorage
}

function createMockRemoteFetcher(): RemoteBuildFetcher {
  return {
    getMetadata: vi.fn().mockResolvedValue(null),
    fetchArchive: vi.fn().mockResolvedValue(null),
  }
}

function createTestManifest(overrides?: Partial<BuildManifest>): BuildManifest {
  return {
    version: 1,
    buildCacheKey: 'test-cache-key',
    filesHash: 'test-files-hash',
    entries: {
      '/src/index.ts': { jsPath: 'index.js' },
    },
    ...overrides,
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encode(s: string): Uint8Array {
  return encoder.encode(s)
}

function decode(buf: Uint8Array): string {
  return decoder.decode(buf)
}

// ============================================================================
// Tests
// ============================================================================

describe('BuildAwareVfs', () => {
  let sourceVfs: Vfs
  let storage: OpfsBuildCacheStorage
  let projectConfig: ProjectConfig

  beforeEach(async () => {
    sourceVfs = createTestVfs()
    storage = createMockBuildCacheStorage()
    // Set up source files
    await addFile(sourceVfs, '/src/index.ts', 'console.log("hello")')
    await addFile(sourceVfs, '/src/utils.ts', 'export const x = 1')
    projectConfig = {
      tsconfigPath: '/tsconfig.json',
      entryFiles: ['/src/index.ts'],
    } as ProjectConfig
  })

  function createVfs(overrides?: Partial<BuildAwareVfsConfig>) {
    return createBuildAwareVfs({
      sourceVfs,
      projectConfig,
      buildCacheStorage: storage,
      buildCacheKey: 'test-cache-key',
      filesHash: 'test-files-hash',
      ...overrides,
    })
  }

  // --------------------------------------------------------------------------
  // Non-entry file passthrough
  // --------------------------------------------------------------------------

  describe('non-entry file passthrough', () => {
    it('reads non-entry files directly from source VFS', async () => {
      const vfs = createVfs()
      const file = await vfs.readFile('/src/utils.ts')
      expect(decode(file.content as unknown as Uint8Array)).toBe('export const x = 1')
    })

    it('delegates writeFile to source VFS', async () => {
      const vfs = createVfs()
      await vfs.updateFile('/src/utils.ts', 'export const x = 2')
      const file = await vfs.readFile('/src/utils.ts')
      expect(decode(file.content as unknown as Uint8Array)).toBe('export const x = 2')
    })

    it('delegates exists to source VFS', async () => {
      const vfs = createVfs()
      const provider = vfs.getProvider()
      expect(await provider.exists('/src/utils.ts')).toBe(true)
      expect(await provider.exists('/nonexistent.ts')).toBe(false)
    })

    it('delegates readdir to source VFS', async () => {
      const vfs = createVfs()
      const provider = vfs.getProvider()
      const entries = await provider.readdir('/src')
      expect(entries).toContain('index.ts')
      expect(entries).toContain('utils.ts')
    })
  })

  // --------------------------------------------------------------------------
  // L0: In-memory cache
  // --------------------------------------------------------------------------

  describe('L0 in-memory cache', () => {
    it('returns L0 cached content on second read', async () => {
      // Set up L1 to return data on first call
      const manifest = createTestManifest()
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValueOnce(handle)
      vi.mocked(storage.readFile).mockResolvedValueOnce(encode('compiled code'))

      const vfs = createVfs()
      const provider = vfs.getProvider()

      // First read — hits L1
      const content1 = await provider.readFile('/src/index.ts')
      expect(decode(content1)).toBe('compiled code')
      expect(storage.get).toHaveBeenCalledTimes(1)

      // Second read — should hit L0, no more L1 calls
      const content2 = await provider.readFile('/src/index.ts')
      expect(decode(content2)).toBe('compiled code')
      expect(storage.get).toHaveBeenCalledTimes(1) // still 1
    })
  })

  // --------------------------------------------------------------------------
  // L1: OPFS cache (via BuildCacheStorage mock)
  // --------------------------------------------------------------------------

  describe('L1 OPFS cache', () => {
    it('returns compiled output from OPFS when cache hit', async () => {
      const manifest = createTestManifest()
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('compiled from opfs'))

      const vfs = createVfs()
      const provider = vfs.getProvider()
      const content = await provider.readFile('/src/index.ts')
      expect(decode(content)).toBe('compiled from opfs')
      expect(storage.get).toHaveBeenCalledWith('test-cache-key')
      expect(storage.readFile).toHaveBeenCalledWith('test-cache-key', 'index.js')
    })

    it('returns null when OPFS has no entry', async () => {
      vi.mocked(storage.get).mockResolvedValue(null)

      // Without remote fetcher or bundler, this should ultimately throw
      // because L3 is the fallback and we can't mock BundlerService easily
      const vfs = createVfs({ remoteFetcher: undefined })
      const provider = vfs.getProvider()

      // L1 miss + no L2 + L3 will fail (no esbuild-wasm in test env)
      await expect(provider.readFile('/src/index.ts')).rejects.toThrow()
    })

    it('returns null when manifest has no matching entry', async () => {
      // Manifest doesn't include the entry file
      const manifest = createTestManifest({
        entries: {
          '/src/other.ts': { jsPath: 'other.js' },
        },
      })
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)

      const vfs = createVfs()
      const provider = vfs.getProvider()

      // Should fall through L1 because output path not found
      await expect(provider.readFile('/src/index.ts')).rejects.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // L2: Remote cache
  // --------------------------------------------------------------------------

  describe('L2 remote cache', () => {
    it('fetches from remote and writes through to L1 + L0', async () => {
      const remoteFetcher = createMockRemoteFetcher()
      const manifest = createTestManifest()
      const files: BuildCacheFile[] = [
        { path: 'index.js', content: encode('remote compiled') },
      ]

      // L1 miss
      vi.mocked(storage.get).mockResolvedValue(null)

      // L2 hit
      vi.mocked(remoteFetcher.fetchArchive).mockResolvedValue({ manifest, files })
      vi.mocked(remoteFetcher.getMetadata).mockResolvedValue({
        releaseHash: 'release-abc',
        fileHashes: { 'index.js': 'hash-abc' },
      })

      const vfs = createVfs({ remoteFetcher })
      const provider = vfs.getProvider()
      const content = await provider.readFile('/src/index.ts')

      expect(decode(content)).toBe('remote compiled')

      // Should have written through to L1
      expect(storage.put).toHaveBeenCalledWith(
        'test-cache-key',
        manifest,
        files,
        expect.objectContaining({
          buildCacheKey: 'test-cache-key',
          filesHash: 'test-files-hash',
          verified: true,
          fileHashes: { 'index.js': 'hash-abc' },
        })
      )

      // Should have triggered eviction (best-effort)
      expect(storage.evict).toHaveBeenCalled()
    })

    it('falls through when remote returns null', async () => {
      const remoteFetcher = createMockRemoteFetcher()
      vi.mocked(storage.get).mockResolvedValue(null)
      vi.mocked(remoteFetcher.fetchArchive).mockResolvedValue(null)

      const vfs = createVfs({ remoteFetcher })
      const provider = vfs.getProvider()

      // L1 miss + L2 miss → L3 (BundlerService) which will fail in test
      await expect(provider.readFile('/src/index.ts')).rejects.toThrow()
    })

    it('handles remote fetch error gracefully and falls through', async () => {
      const remoteFetcher = createMockRemoteFetcher()
      vi.mocked(storage.get).mockResolvedValue(null)
      vi.mocked(remoteFetcher.fetchArchive).mockRejectedValue(new Error('network error'))

      const vfs = createVfs({ remoteFetcher })
      const provider = vfs.getProvider()

      // L2 error should be caught, falls through to L3
      await expect(provider.readFile('/src/index.ts')).rejects.toThrow()
      // The error should NOT be the network error
    })
  })

  // --------------------------------------------------------------------------
  // Cache invalidation
  // --------------------------------------------------------------------------

  describe('cache invalidation', () => {
    it('clears L0 cache on writeFile', async () => {
      // Populate L0 via L1
      const manifest = createTestManifest()
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('original'))

      const vfs = createVfs()
      const provider = vfs.getProvider()

      // Read to populate L0
      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(1)

      // Write any file to trigger invalidation
      await provider.writeFile('/src/utils.ts', encode('changed'))

      // Next read should go to L1 again (L0 was cleared)
      vi.mocked(storage.readFile).mockResolvedValue(encode('recompiled'))
      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(2)
    })

    it('clears L0 cache on unlink', async () => {
      const manifest = createTestManifest()
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('cached'))

      const vfs = createVfs()
      const provider = vfs.getProvider()

      // First read populates L0
      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(1)

      // Add a temp file and then delete it to trigger unlink invalidation
      await provider.writeFile('/src/temp.ts', encode('temp'))

      // Read after write — L0 was cleared, should go to L1 again
      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(2)

      // Unlink clears L0 again
      await provider.unlink('/src/temp.ts')

      vi.mocked(storage.readFile).mockResolvedValue(encode('refreshed'))
      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(3)
    })

    it('clears L0 cache on rename', async () => {
      const manifest = createTestManifest()
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('cached'))

      const vfs = createVfs()
      const provider = vfs.getProvider()

      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(1)

      await provider.rename('/src/utils.ts', '/src/helpers.ts')

      vi.mocked(storage.readFile).mockResolvedValue(encode('after rename'))
      await provider.readFile('/src/index.ts')
      expect(storage.get).toHaveBeenCalledTimes(2)
    })
  })

  // --------------------------------------------------------------------------
  // Entry file normalization
  // --------------------------------------------------------------------------

  describe('entry file path normalization', () => {
    it('normalizes entry paths without leading slash', async () => {
      projectConfig = {
        tsconfigPath: '/tsconfig.json',
        entryFiles: ['src/index.ts'], // no leading slash
      } as ProjectConfig

      const manifest = createTestManifest({
        entries: {
          '/src/index.ts': { jsPath: 'index.js' },
        },
      })
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('normalized'))

      const vfs = createVfs()
      const provider = vfs.getProvider()

      // Should still recognize as entry file even though config had no leading slash
      const content = await provider.readFile('/src/index.ts')
      expect(decode(content)).toBe('normalized')
    })

    it('handles manifest entries without leading slash', async () => {
      const manifest = createTestManifest({
        entries: {
          'src/index.ts': { jsPath: 'index.js' }, // no leading slash in manifest
        },
      })
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('manifest normalized'))

      const vfs = createVfs()
      const provider = vfs.getProvider()
      const content = await provider.readFile('/src/index.ts')
      expect(decode(content)).toBe('manifest normalized')
    })
  })

  // --------------------------------------------------------------------------
  // Lazy buildCacheKey computation
  // --------------------------------------------------------------------------

  describe('lazy buildCacheKey', () => {
    it('computes buildCacheKey lazily when not provided', async () => {
      const computeFn = vi.fn().mockResolvedValue('lazy-key')

      // Set up L1 to respond for the lazy key
      const manifest = createTestManifest({ buildCacheKey: 'lazy-key' })
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('lazy result'))

      const vfs = createVfs({
        buildCacheKey: undefined,
        computeBuildCacheKey: computeFn,
      })
      const provider = vfs.getProvider()
      const content = await provider.readFile('/src/index.ts')

      expect(decode(content)).toBe('lazy result')
      expect(computeFn).toHaveBeenCalledOnce()
      expect(storage.get).toHaveBeenCalledWith('lazy-key')
    })

    it('does not recompute buildCacheKey on subsequent reads', async () => {
      const computeFn = vi.fn().mockResolvedValue('lazy-key')

      const manifest = createTestManifest({ buildCacheKey: 'lazy-key' })
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('lazy result'))

      const vfs = createVfs({
        buildCacheKey: undefined,
        computeBuildCacheKey: computeFn,
      })
      const provider = vfs.getProvider()

      await provider.readFile('/src/index.ts')
      await provider.readFile('/src/index.ts')

      // computeBuildCacheKey should only be called once (first read computes, second uses L0)
      expect(computeFn).toHaveBeenCalledOnce()
    })
  })

  // --------------------------------------------------------------------------
  // Event forwarding
  // --------------------------------------------------------------------------

  describe('event forwarding', () => {
    // Events are emitted via Promise.resolve().then() (fire-and-forget),
    // so we need to flush microtasks before asserting.
    const flushMicrotasks = () => new Promise(r => setTimeout(r, 10))

    it('forwards file:created events from source VFS', async () => {
      const vfs = createVfs()
      const handler = vi.fn()
      vfs.events.on('file:created', handler)

      await sourceVfs.createFile('/src/new.ts', 'new file')
      await flushMicrotasks()
      expect(handler).toHaveBeenCalledOnce()
    })

    it('forwards file:updated events from source VFS', async () => {
      const vfs = createVfs()
      const handler = vi.fn()
      vfs.events.on('file:updated', handler)

      await sourceVfs.updateFile('/src/utils.ts', 'updated')
      await flushMicrotasks()
      expect(handler).toHaveBeenCalledOnce()
    })

    it('forwards file:deleted events from source VFS', async () => {
      const vfs = createVfs()
      const handler = vi.fn()
      vfs.events.on('file:deleted', handler)

      await sourceVfs.deleteFile('/src/utils.ts')
      await flushMicrotasks()
      expect(handler).toHaveBeenCalledOnce()
    })
  })

  // --------------------------------------------------------------------------
  // Dispose
  // --------------------------------------------------------------------------

  describe('dispose', () => {
    it('cleans up without errors', async () => {
      const vfs = createVfs()
      // Read to trigger initialization
      const provider = vfs.getProvider()
      expect(await provider.exists('/src/utils.ts')).toBe(true)

      // Should not throw
      await vfs.dispose()
    })

    it('stops forwarding events after dispose', async () => {
      const vfs = createVfs()
      const handler = vi.fn()
      vfs.events.on('file:created', handler)

      await vfs.dispose()

      await sourceVfs.createFile('/src/after-dispose.ts', 'nope')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Multiple entry files
  // --------------------------------------------------------------------------

  describe('multiple entry files', () => {
    it('handles multiple entry files correctly', async () => {
      await addFile(sourceVfs, '/src/main.ts', 'main code')
      projectConfig = {
        tsconfigPath: '/tsconfig.json',
        entryFiles: ['/src/index.ts', '/src/main.ts'],
      } as ProjectConfig

      const manifest = createTestManifest({
        entries: {
          '/src/index.ts': { jsPath: 'index.js' },
          '/src/main.ts': { jsPath: 'main.js' },
        },
      })
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile)
        .mockImplementation(async (_key: string, filePath: string) => {
          if (filePath === 'index.js') return encode('compiled index')
          if (filePath === 'main.js') return encode('compiled main')
          return null
        })

      const vfs = createVfs()
      const provider = vfs.getProvider()

      const content1 = await provider.readFile('/src/index.ts')
      const content2 = await provider.readFile('/src/main.ts')

      expect(decode(content1)).toBe('compiled index')
      expect(decode(content2)).toBe('compiled main')
    })
  })

  // --------------------------------------------------------------------------
  // Build progress callback
  // --------------------------------------------------------------------------

  describe('build progress callback', () => {
    it('is not called for L1 cache hits', async () => {
      const onBuildProgress = vi.fn()
      const manifest = createTestManifest()
      const handle: BuildCacheHandle = {
        manifest,
        dirHandle: {} as FileSystemDirectoryHandle,
        metadata: {} as BuildCacheMetadata,
      }
      vi.mocked(storage.get).mockResolvedValue(handle)
      vi.mocked(storage.readFile).mockResolvedValue(encode('cached'))

      const vfs = createVfs({ onBuildProgress })
      const provider = vfs.getProvider()
      await provider.readFile('/src/index.ts')

      // Build progress should NOT be called for cache hits
      expect(onBuildProgress).not.toHaveBeenCalled()
    })
  })
})
