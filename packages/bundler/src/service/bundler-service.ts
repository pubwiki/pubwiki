/**
 * Bundler Service
 *
 * Main thread service layer for the bundler worker.
 * 
 * 主线程负责:
 * - Worker 生命周期管理
 * - 读取 tsconfig.json
 * - 文件监听，变更时调用 worker.invalidate()
 * - 构建进度回调
 * 
 * Worker 负责:
 * - 项目构建
 * - 依赖跟踪和缓存
 */

import type { Vfs } from '@pubwiki/vfs'
import { wrap, proxy, type Remote } from 'comlink'
import type {
  BundleRequest,
  DirectBuildRequest,
  ProjectBuildResult,
  DependencyEntry,
  BuildProgressCallback,
  BuildProgressEvent,
  WatchOptions,
  BundlerOptions,
  BundlerWorkerAPI
} from '../types'
import { getDirectory } from '../utils'
import { getEntryFilesFromTsConfig } from './project-detector'
// Import worker entry directly - bundler will handle this
import BundlerWorker from '../worker?worker'

/**
 * Bundler Service Class
 * 
 * Main API for the bundler, manages worker lifecycle and file watching.
 */
export class BundlerService {
  private worker: Worker | null = null
  private workerAPI: Remote<BundlerWorkerAPI> | null = null
  private isInitialized = false
  private initPromise: Promise<void> | null = null

  // VFS instance
  private vfs: Vfs

  // Build progress subscribers
  private progressSubscribers = new Set<BuildProgressCallback>()

  // File watch unsubscribers (keyed by tsconfigPath)
  private fileWatchUnsubscribers = new Map<string, () => void>()

  constructor(options: BundlerOptions) {
    this.vfs = options.vfs
  }

  /**
   * Initialize the bundler service.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.doInitialize()
    await this.initPromise
  }

  private async doInitialize(): Promise<void> {
    try {
      // Create worker using bundled worker entry
      this.worker = new BundlerWorker()

      this.workerAPI = wrap<BundlerWorkerAPI>(this.worker)
      // Pass VFS as Comlink proxy to worker
      await this.workerAPI!.initialize(proxy(this.vfs))

      this.isInitialized = true
      console.log('[BundlerService] Initialized successfully')
    } catch (error) {
      console.error('[BundlerService] Initialization failed:', error)
      this.cleanup()
      throw error
    }
  }

  /**
   * Build a project from tsconfig.json
   */
  async build(request: BundleRequest): Promise<ProjectBuildResult> {
    await this.ensureInitialized()

    const { tsconfigPath, options = {} } = request

    this.notifyProgress({
      type: 'start',
      path: tsconfigPath,
      message: `Starting build: ${tsconfigPath}`
    })

    try {
      // Get entry files from tsconfig
      const entryFiles = await getEntryFilesFromTsConfig(tsconfigPath, this.vfs)
      
      if (entryFiles.length === 0) {
        throw new Error(`[BundlerService] No files specified in tsconfig.json`)
      }

      // Get project root
      const projectRoot = getDirectory(tsconfigPath)

      // Call worker to build
      const buildResult = await this.workerAPI!.build({ projectRoot, entryFiles, options })

      this.notifyProgress({
        type: 'complete',
        path: tsconfigPath,
        message: buildResult.success ? 'Build successful' : 'Build failed',
        result: buildResult
      })

      return buildResult
    } catch (error) {
      this.notifyProgress({
        type: 'error',
        path: tsconfigPath,
        message: 'Build error',
        error: error instanceof Error ? error : new Error(String(error))
      })

      return {
        success: false,
        outputs: new Map(),
        dependencies: []
      }
    }
  }

  /**
   * Build specific entry files directly (without tsconfig)
   */
  async buildEntries(request: DirectBuildRequest): Promise<ProjectBuildResult> {
    await this.ensureInitialized()

    const { projectRoot, entryFiles, options = {} } = request

    this.notifyProgress({
      type: 'start',
      path: projectRoot,
      message: `Starting build: ${entryFiles.length} entries`
    })

    try {
      const buildResult = await this.workerAPI!.build({ projectRoot, entryFiles, options })

      this.notifyProgress({
        type: 'complete',
        path: projectRoot,
        message: buildResult.success ? 'Build successful' : 'Build failed',
        result: buildResult
      })

      return buildResult
    } catch (error) {
      this.notifyProgress({
        type: 'error',
        path: projectRoot,
        message: 'Build error',
        error: error instanceof Error ? error : new Error(String(error))
      })

      return {
        success: false,
        outputs: new Map(),
        dependencies: []
      }
    }
  }

  /**
   * Setup file watching for automatic rebuild
   */
  watch(options: WatchOptions): () => void {
    const { tsconfigPath, onRebuild, onFileChange } = options

    // Cancel previous watching for this tsconfig
    const previousUnsub = this.fileWatchUnsubscribers.get(tsconfigPath)
    if (previousUnsub) {
      previousUnsub()
    }

    // First build to get dependencies
    let dependencies: string[] = []
    let isWatching = true

    const setupWatch = async () => {
      try {
        const result = await this.build({ tsconfigPath })
        dependencies = result.dependencies

        if (!isWatching) return

        // Watch dependencies + tsconfig itself
        const pathsToWatch = new Set([...dependencies, tsconfigPath])

        const handleFileChange = async (changedPath: string) => {
          if (!pathsToWatch.has(changedPath)) return
          
          console.log(`[BundlerService] File changed: ${changedPath}`)
          
          // Notify file change
          if (onFileChange) {
            try {
              onFileChange(changedPath)
            } catch (error) {
              console.error('[BundlerService] onFileChange callback error:', error)
            }
          }
          
          // Invalidate worker cache
          await this.workerAPI?.invalidate(changedPath)
          
          // Rebuild
          const newResult = await this.build({ tsconfigPath })
          
          // Update watched dependencies
          dependencies = newResult.dependencies
          pathsToWatch.clear()
          for (const dep of dependencies) pathsToWatch.add(dep)
          pathsToWatch.add(tsconfigPath)
          
          // Notify rebuild
          if (onRebuild) {
            try {
              onRebuild(newResult)
            } catch (error) {
              console.error('[BundlerService] onRebuild callback error:', error)
            }
          }
        }

        // Subscribe to file events
        const unsubUpdate = this.vfs.events.on('file:updated', (event) => {
          handleFileChange(event.path)
        })
        const unsubDelete = this.vfs.events.on('file:deleted', (event) => {
          handleFileChange(event.path)
        })

        const unsub = () => {
          unsubUpdate()
          unsubDelete()
        }

        this.fileWatchUnsubscribers.set(tsconfigPath, unsub)
      } catch (error) {
        console.error('[BundlerService] Watch setup failed:', error)
      }
    }

    // Start watching asynchronously
    setupWatch()

    // Return unwatch function
    return () => {
      isWatching = false
      const unsub = this.fileWatchUnsubscribers.get(tsconfigPath)
      if (unsub) {
        unsub()
        this.fileWatchUnsubscribers.delete(tsconfigPath)
      }
    }
  }

  /**
   * Invalidate cache for a specific file
   */
  async invalidate(path: string): Promise<void> {
    await this.ensureInitialized()
    await this.workerAPI!.invalidate(path)
  }

  /**
   * Invalidate all cached data
   */
  async invalidateAll(): Promise<void> {
    await this.ensureInitialized()
    
    // Cancel all file watching
    for (const unsub of this.fileWatchUnsubscribers.values()) {
      unsub()
    }
    this.fileWatchUnsubscribers.clear()
    
    await this.workerAPI!.invalidateAll()
  }

  /**
   * Get the dependency graph
   */
  async getDependencyGraph(): Promise<Map<string, DependencyEntry>> {
    await this.ensureInitialized()
    return this.workerAPI!.getDependencyGraph()
  }

  /**
   * Get cached build output for a project
   */
  async getLastBuildOutput(projectRoot: string): Promise<ProjectBuildResult | null> {
    await this.ensureInitialized()
    return this.workerAPI!.getLastBuildOutput(projectRoot)
  }

  /**
   * Subscribe to build progress events
   */
  onBuildProgress(callback: BuildProgressCallback): () => void {
    this.progressSubscribers.add(callback)
    return () => this.progressSubscribers.delete(callback)
  }

  /**
   * Terminate the bundler worker
   */
  terminate(): void {
    for (const unsub of this.fileWatchUnsubscribers.values()) {
      unsub()
    }
    this.fileWatchUnsubscribers.clear()
    this.cleanup()
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized
  }

  // --- Internal helpers ---

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('[BundlerService] Not initialized. Call initialize() first.')
    }
  }

  private cleanup(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.workerAPI = null
    this.isInitialized = false
    this.initPromise = null
  }

  private notifyProgress(event: BuildProgressEvent): void {
    for (const subscriber of this.progressSubscribers) {
      try {
        subscriber(event)
      } catch (error) {
        console.error('[BundlerService] Progress callback error:', error)
      }
    }
  }
}
