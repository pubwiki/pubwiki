/**
 * Core Types
 *
 * Type definitions for the bundler core modules.
 */

// Re-export shared types for convenience
export type {
  BundleOptions,
  FileBuildResult,
  ProjectBuildResult,
  BuildError,
  BuildWarning,
  DependencyEntry,
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
