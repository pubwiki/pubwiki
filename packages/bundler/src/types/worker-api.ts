/**
 * Worker API Types
 *
 * Types for communication between main thread and worker.
 * Uses Comlink for serialization.
 * 
 * Worker 负责:
 * - 项目构建 (多入口)
 * - 依赖跟踪和缓存
 * 
 * 主线程负责:
 * - 文件监听
 * - 调用 invalidate 通知 worker
 */

import type { Vfs } from '@pubwiki/vfs'
import type { BundleOptions } from './options'
import type { ProjectBuildResult } from './result'
import type { DependencyEntry } from './cache'

/**
 * Build request for the worker (project-level)
 */
export interface WorkerBuildRequest {
  /** 项目根目录 */
  projectRoot: string
  /** 入口文件列表 (绝对路径) */
  entryFiles: string[]
  /** Build options */
  options?: BundleOptions
}

/**
 * Worker API exposed via Comlink
 */
export interface BundlerWorkerAPI {
  /** Initialize the bundler with VFS instance */
  initialize(vfs: Vfs): Promise<void>

  /** Build a project, returns result with dependencies for file watching */
  build(request: WorkerBuildRequest): Promise<ProjectBuildResult>

  /** Get cached build output for a project, null if not cached */
  getLastBuildOutput(projectRoot: string): Promise<ProjectBuildResult | null>

  /** Invalidate cache for a specific file path */
  invalidate(path: string): Promise<void>

  /** Invalidate all cached builds */
  invalidateAll(): Promise<void>

  /** Get the dependency graph */
  getDependencyGraph(): Promise<Map<string, DependencyEntry>>

  /** Check if bundler is ready */
  isReady(): boolean
}
