/**
 * @pubwiki/bundler
 *
 * Frontend bundler library using esbuild-wasm with Virtual File System support.
 */

// Types
export * from './types'

// Utils
export * from './utils'

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
 * const bundler = await createBundler({
 *   vfs,
 *   workerUrl: new URL('./worker/index.js', import.meta.url)
 * })
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

/**
 * Re-export worker types for consumers who want to create their own worker
 */
export type { BundlerWorkerAPI, WorkerBuildRequest } from './types'
