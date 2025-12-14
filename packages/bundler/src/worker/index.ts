/**
 * Bundler Worker Entry Point
 *
 * Web Worker that handles all code bundling operations.
 * Uses Comlink for communication with the main thread.
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
import * as Comlink from 'comlink'
import { ESBuildEngine } from './esbuild-engine'
import { DependencyResolver } from './dependency-resolver'
import { BundleCache } from './bundle-cache'
import {
  setVFS,
  createFileLoader,
  createFileExistsChecker
} from './vfs-adapter'
import type {
  DependencyEntry,
  ProjectBuildResult,
  BundlerWorkerAPI,
  WorkerBuildRequest,
} from '../types'

// Initialize components
const cache = new BundleCache()
const resolver = new DependencyResolver()
const engine = new ESBuildEngine(resolver, cache)

// Cache for last build outputs (keyed by projectRoot)
const lastBuildOutputs = new Map<string, ProjectBuildResult>()

// Track initialization state
let isVFSInitialized = false

/**
 * Worker API implementation
 */
const workerApi: BundlerWorkerAPI = {
  async initialize(vfs: Vfs): Promise<void> {
    console.log('[BundlerWorker] Initializing...')
    
    setVFS(vfs)
    
    const fileLoader = createFileLoader()
    const fileExistsChecker = createFileExistsChecker()
    
    engine.setFileLoader(fileLoader)
    resolver.setFileExistsChecker(fileExistsChecker)
    
    isVFSInitialized = true
    
    await cache.init()
    await engine.initialize()
    
    console.log('[BundlerWorker] Initialized')
  },

  async build(request: WorkerBuildRequest): Promise<ProjectBuildResult> {
    const { projectRoot, entryFiles, options = {} } = request
    console.log(`[BundlerWorker] Building project: ${projectRoot}, entries: ${entryFiles.length}`)
    
    if (!isVFSInitialized) {
      return {
        success: false,
        outputs: new Map(),
        dependencies: [],
      }
    }
    
    const result = await engine.build({ projectRoot, entryFiles, options })
    console.log("[BundlerWorker] Build result", result)
    
    // Cache the build result
    lastBuildOutputs.set(projectRoot, result)
    
    return result
  },

  async getLastBuildOutput(projectRoot: string): Promise<ProjectBuildResult | null> {
    return lastBuildOutputs.get(projectRoot) ?? null
  },

  async invalidate(path: string): Promise<void> {
    console.log(`[BundlerWorker] Invalidating: ${path}`)
    
    // Clear transform cache for the changed file
    await cache.deleteTransform(path)
    
    // Clear lastBuildOutput for all affected projects
    // ESBuild's rebuild system will handle incremental compilation
    for (const projectRoot of lastBuildOutputs.keys()) {
      const buildResult = lastBuildOutputs.get(projectRoot)
      console.log("[BundlerWorker] build result for", projectRoot, "is", buildResult)
      if (buildResult?.dependencies.includes(path)) {
        console.log(`[BundlerWorker] Clearing cache for project: ${projectRoot}`)
        lastBuildOutputs.delete(projectRoot)
      }
    }
  },

  async invalidateAll(): Promise<void> {
    console.log('[BundlerWorker] Invalidating all')
    await cache.clearTransformCache()
    await engine.invalidateAllContexts()
    resolver.clearCache()
    lastBuildOutputs.clear()
  },

  async getDependencyGraph(): Promise<Map<string, DependencyEntry>> {
    const graph = engine.getDependencyGraph()
    const result = new Map<string, DependencyEntry>()
    
    for (const [path, entry] of graph.entries()) {
      result.set(path, {
        path,
        dependencies: entry.dependencies,
        dependents: entry.dependents
      })
    }
    
    return result
  },

  isReady(): boolean {
    return engine.isInitialized() && isVFSInitialized
  }
}

Comlink.expose(workerApi)
console.log('[BundlerWorker] Worker started')

export type { BundlerWorkerAPI }
