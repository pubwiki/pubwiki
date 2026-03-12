/**
 * @pubwiki/bundler
 *
 * Frontend bundler library using esbuild-wasm with Virtual File System support.
 */

// Types
export * from './types'

// Utils
export * from './utils'

// Build Cache Storage
export {
  type BuildCacheStorage,
  type BuildCacheFile,
  type BuildCacheMetadata,
  type BuildCacheEntry,
} from './cache'

export {
  OpfsBuildCacheStorage,
  getOpfsBuildCacheStorage,
} from './cache/opfs'

export {
  IdbBuildCacheStorage,
  getIdbBuildCacheStorage,
} from './cache/idb'

// Build-Aware VFS
export {
  createBuildAwareVfs,
  type BuildAwareVfsConfig,
  type RemoteBuildFetcher,
} from './build-aware-vfs'

// Service
export {
  BundlerService,
  detectProject,
  findTsConfig,
  getEntryFilesFromTsConfig,
  isEntryFile,
  getDefaultEntryFile,
  type ProjectConfig,
  type TsConfigContent
} from './service'

// Factory function
import type { BundlerOptions } from './types'
import { BundlerService } from './service'

/**
 * Create and initialize a bundler instance
 *
 * @example
 * ```typescript
 * import { createBundler } from '@pubwiki/bundler'
 * import { Vfs } from '@pubwiki/vfs'
 *
 * const vfs = new Vfs(myProvider)
 * await vfs.initialize()
 *
 * const bundler = await createBundler({ vfs })
 *
 * const result = await bundler.build({
 *   tsconfigPath: '/project/tsconfig.json'
 * })
 * ```
 */
export async function createBundler(options: BundlerOptions): Promise<BundlerService> {
  const bundler = new BundlerService(options)
  await bundler.initialize()
  return bundler
}
