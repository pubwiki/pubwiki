/**
 * Service Types
 *
 * Types specific to the BundlerService main thread API.
 */

import type { Vfs } from '@pubwiki/vfs'
import type { BundleOptions } from './options'
import type { ProjectBuildResult } from './result'

/**
 * Bundle request for the service layer (using tsconfig path)
 */
export interface BundleRequest {
  /** tsconfig.json 的路径 */
  tsconfigPath: string
  /** Bundle options */
  options?: BundleOptions
}

/**
 * Direct build request (without tsconfig)
 */
export interface DirectBuildRequest {
  /** 项目根目录 */
  projectRoot: string
  /** 入口文件列表 (绝对路径) */
  entryFiles: string[]
  /** Bundle options */
  options?: BundleOptions
}

/**
 * Build progress event
 */
export interface BuildProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error'
  /** tsconfig path or entry path */
  path: string
  progress?: number
  message?: string
  result?: ProjectBuildResult
  error?: Error
}

/**
 * Build progress callback
 */
export type BuildProgressCallback = (event: BuildProgressEvent) => void

/**
 * Watch options for auto-rebuild
 */
export interface WatchOptions {
  /** tsconfig.json 的路径 */
  tsconfigPath: string
  /** Bundle options forwarded to each rebuild */
  bundleOptions?: BundleOptions
  /** Callback when rebuild completes */
  onRebuild?: (result: ProjectBuildResult) => void
  /** Callback when file changes (before rebuild) */
  onFileChange?: (changedPath: string) => void
}

/**
 * Bundler configuration options
 */
export interface BundlerOptions {
  /** @pubwiki/vfs instance */
  vfs: Vfs
}
