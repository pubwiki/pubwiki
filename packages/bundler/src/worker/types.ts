/**
 * Worker Types
 *
 * Type definitions specific to the bundler web worker.
 */

// Re-export shared types for convenience
export type {
  BundleOptions,
  BuildResult,
  FileBuildResult,
  ProjectBuildResult,
  BuildError,
  BuildWarning,
  DependencyEntry,
  // Worker API types
  BundlerWorkerAPI,
  WorkerBuildRequest
} from '../types'

/**
 * CDN configuration
 */
export interface CDNConfig {
  name: string
  url: (packageName: string) => string
  priority: number
}

/**
 * Loader type for esbuild
 */
export type LoaderType = 'tsx' | 'ts' | 'jsx' | 'js' | 'json' | 'css' | 'text'

/**
 * Resolve result for dependency resolution
 */
export interface ResolveResult {
  path: string
  namespace: 'vfs' | 'http' | 'external'
}
