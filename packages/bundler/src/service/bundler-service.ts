/**
 * Bundler Service
 *
 * Single-project bundler service that directly uses esbuild.
 * No Worker layer - esbuild manages its own worker internally.
 * 
 * 职责:
 * - 单项目构建 (多入口)
 * - 依赖跟踪和缓存
 * - 文件监听，变更时重新构建
 * - 构建进度回调
 */

import type { Vfs } from '@pubwiki/vfs'
import { ESBuildEngine } from '../core/esbuild-engine'
import { DependencyResolver } from '../core/dependency-resolver'
import { BundleCache } from '../core/bundle-cache'
import type {
  BundleRequest,
  DirectBuildRequest,
  ProjectBuildResult,
  DependencyEntry,
  BuildProgressCallback,
  BuildProgressEvent,
  WatchOptions,
  BundlerOptions,
} from '../types'
import { getDirectory } from '../utils'
import { getEntryFilesFromTsConfig } from './project-detector'

/**
 * Bundler Service Class
 * 
 * Single-project bundler. One BundlerService instance = one project.
 */
// Global counter for debugging multiple instances
let instanceCounter = 0

export class BundlerService {
  private isInitialized = false
  private initPromise: Promise<void> | null = null
  
  // Instance ID for debugging
  private readonly instanceId: number

  // VFS instance
  private vfs: Vfs

  // Core components
  private cache: BundleCache
  private resolver: DependencyResolver
  private engine: ESBuildEngine

  // Single project state
  private lastBuildOutput: ProjectBuildResult | null = null

  // Build progress subscribers
  private progressSubscribers = new Set<BuildProgressCallback>()

  // File watching state (single watcher)
  private fileWatchUnsubscriber: (() => void) | null = null
  
  // Track ongoing build to avoid duplicates
  private ongoingBuild: Promise<ProjectBuildResult> | null = null
  
  // Debounce state for file watching
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingChangedPaths = new Set<string>()
  private isRebuilding = false
  private readonly DEBOUNCE_MS = 100

  constructor(options: BundlerOptions) {
    this.instanceId = ++instanceCounter
    console.log(`[BundlerService #${this.instanceId}] Created`)
    console.trace(`[BundlerService #${this.instanceId}] Creation stack trace`)
    
    this.vfs = options.vfs
    this.cache = new BundleCache()
    this.resolver = new DependencyResolver()
    this.engine = new ESBuildEngine(this.resolver, this.cache)
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
      console.log('[BundlerService] Initializing...')

      // Setup file loader from VFS
      const fileLoader = this.createFileLoader()
      const fileExistsChecker = this.createFileExistsChecker()

      this.engine.setFileLoader(fileLoader)
      this.resolver.setFileExistsChecker(fileExistsChecker)

      // Initialize cache and engine
      await this.cache.init()
      await this.engine.initialize()

      this.isInitialized = true
      console.log('[BundlerService] Initialized successfully')
    } catch (error) {
      console.error('[BundlerService] Initialization failed:', error)
      this.initPromise = null
      throw error
    }
  }

  /**
   * Build a project from tsconfig.json
   * If a build is already in progress, returns that promise.
   */
  async build(request: BundleRequest): Promise<ProjectBuildResult> {
    await this.ensureInitialized()

    const { tsconfigPath, options = {} } = request

    // Check if build is already in progress
    if (this.ongoingBuild) {
      console.log(`[BundlerService] Build already in progress, waiting...`)
      return this.ongoingBuild
    }

    // Create and track the build promise
    this.ongoingBuild = this.doBuild(tsconfigPath, options)

    try {
      return await this.ongoingBuild
    } finally {
      this.ongoingBuild = null
    }
  }

  /**
   * Internal build implementation
   */
  private async doBuild(tsconfigPath: string, options: BundleRequest['options'] = {}): Promise<ProjectBuildResult> {
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

      // Build directly
      const buildResult = await this.engine.build({ projectRoot, entryFiles, options })

      // Cache the result
      this.lastBuildOutput = buildResult

      console.log(`[BundlerService] Build finished, sending complete event, success:`, buildResult.success)
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

    // Check if build is already in progress
    if (this.ongoingBuild) {
      console.log(`[BundlerService] Build already in progress, waiting...`)
      return this.ongoingBuild
    }

    this.ongoingBuild = this.doBuildEntries(projectRoot, entryFiles, options)

    try {
      return await this.ongoingBuild
    } finally {
      this.ongoingBuild = null
    }
  }

  private async doBuildEntries(
    projectRoot: string,
    entryFiles: string[],
    options: DirectBuildRequest['options'] = {}
  ): Promise<ProjectBuildResult> {
    this.notifyProgress({
      type: 'start',
      path: projectRoot,
      message: `Starting build: ${entryFiles.length} entries`
    })

    try {
      const buildResult = await this.engine.build({ projectRoot, entryFiles, options })

      // Cache the result
      this.lastBuildOutput = buildResult

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
   * Setup file watching for automatic rebuild.
   * Only one watcher can be active at a time.
   */
  watch(options: WatchOptions): () => void {
    const { tsconfigPath, onRebuild, onFileChange } = options

    // Cancel previous watching
    if (this.fileWatchUnsubscriber) {
      this.fileWatchUnsubscriber()
      this.fileWatchUnsubscriber = null
    }

    // Reset debounce state
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingChangedPaths.clear()
    this.isRebuilding = false

    let dependencies: string[] = []
    let isWatching = true

    const setupWatch = async () => {
      try {
        const result = await this.build({ tsconfigPath })
        dependencies = result.dependencies

        if (!isWatching) return

        // Watch dependencies + tsconfig itself
        const pathsToWatch = new Set([...dependencies, tsconfigPath])

        // Debounced rebuild function
        const debouncedRebuild = async () => {
          if (!isWatching) return
          if (this.isRebuilding) {
            // If already rebuilding, schedule another rebuild after current one
            this.debounceTimer = setTimeout(debouncedRebuild, this.DEBOUNCE_MS)
            return
          }
          
          this.isRebuilding = true
          const changedPaths = [...this.pendingChangedPaths]
          this.pendingChangedPaths.clear()
          
          console.log(`[BundlerService] Rebuilding after ${changedPaths.length} file change(s)`)
          
          try {
            // Invalidate all changed files
            for (const changedPath of changedPaths) {
              await this.invalidate(changedPath)
            }
            
            // Rebuild once
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
          } finally {
            this.isRebuilding = false
            
            // If more changes accumulated during rebuild, schedule another
            if (this.pendingChangedPaths.size > 0) {
              this.debounceTimer = setTimeout(debouncedRebuild, this.DEBOUNCE_MS)
            }
          }
        }

        const handleFileChange = (changedPath: string) => {
          if (!pathsToWatch.has(changedPath)) return
          
          console.log(`[BundlerService #${this.instanceId}] File changed: ${changedPath}`)
          
          // Notify file change immediately (for HMR notification)
          if (onFileChange) {
            try {
              onFileChange(changedPath)
            } catch (error) {
              console.error('[BundlerService] onFileChange callback error:', error)
            }
          }
          
          // Queue for debounced rebuild
          this.pendingChangedPaths.add(changedPath)
          
          // Reset debounce timer
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
          }
          this.debounceTimer = setTimeout(debouncedRebuild, this.DEBOUNCE_MS)
        }

        // Subscribe to file events
        const unsubUpdate = this.vfs.events.on('file:updated', (event) => {
          handleFileChange(event.path)
        })
        const unsubDelete = this.vfs.events.on('file:deleted', (event) => {
          handleFileChange(event.path)
        })

        this.fileWatchUnsubscriber = () => {
          unsubUpdate()
          unsubDelete()
        }
      } catch (error) {
        console.error('[BundlerService] Watch setup failed:', error)
      }
    }

    // Start watching asynchronously
    setupWatch()

    // Return unwatch function
    return () => {
      isWatching = false
      
      // Clear debounce timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
        this.debounceTimer = null
      }
      
      if (this.fileWatchUnsubscriber) {
        this.fileWatchUnsubscriber()
        this.fileWatchUnsubscriber = null
      }
    }
  }

  /**
   * Invalidate cache for a specific file
   */
  async invalidate(path: string): Promise<void> {
    await this.ensureInitialized()
    
    console.log(`[BundlerService] Invalidating: ${path}`)
    
    // Clear transform cache for the changed file
    await this.cache.deleteTransform(path)
    
    // Clear lastBuildOutput if the file is a dependency
    if (this.lastBuildOutput?.dependencies.includes(path)) {
      console.log(`[BundlerService] Clearing cached build output`)
      this.lastBuildOutput = null
    }
  }

  /**
   * Invalidate all cached data
   */
  async invalidateAll(): Promise<void> {
    await this.ensureInitialized()
    
    console.log('[BundlerService] Invalidating all')
    
    // Cancel file watching
    if (this.fileWatchUnsubscriber) {
      this.fileWatchUnsubscriber()
      this.fileWatchUnsubscriber = null
    }
    
    // Clear debounce state
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingChangedPaths.clear()
    
    // Clear all caches
    await this.cache.clearTransformCache()
    await this.engine.invalidateAllContexts()
    this.resolver.clearCache()
    this.lastBuildOutput = null
  }

  /**
   * Get the dependency graph
   */
  getDependencyGraph(): Map<string, DependencyEntry> {
    const graph = this.engine.getDependencyGraph()
    const result = new Map<string, DependencyEntry>()
    
    for (const [path, entry] of graph.entries()) {
      result.set(path, {
        path,
        dependencies: entry.dependencies,
        dependents: entry.dependents
      })
    }
    
    return result
  }

  /**
   * Get cached build output
   */
  getLastBuildOutput(): ProjectBuildResult | null {
    return this.lastBuildOutput
  }

  /**
   * Check if a build is currently in progress
   */
  isBuildInProgress(): boolean {
    return this.ongoingBuild !== null
  }

  /**
   * Wait for any ongoing build to complete
   */
  async waitForBuild(): Promise<ProjectBuildResult | null> {
    if (this.ongoingBuild) {
      return this.ongoingBuild
    }
    return this.lastBuildOutput
  }

  /**
   * Subscribe to build progress events
   */
  onBuildProgress(callback: BuildProgressCallback): () => void {
    this.progressSubscribers.add(callback)
    return () => this.progressSubscribers.delete(callback)
  }

  /**
   * Terminate the bundler and release resources
   */
  async terminate(): Promise<void> {
    if (this.fileWatchUnsubscriber) {
      this.fileWatchUnsubscriber()
      this.fileWatchUnsubscriber = null
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    
    await this.engine.dispose()
    this.isInitialized = false
    this.initPromise = null
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

  private notifyProgress(event: BuildProgressEvent): void {
    console.log(`[BundlerService #${this.instanceId}] notifyProgress:`, event.type, 'subscribers:', this.progressSubscribers.size)
    for (const subscriber of this.progressSubscribers) {
      try {
        subscriber(event)
      } catch (error) {
        console.error('[BundlerService] Progress callback error:', error)
      }
    }
  }

  /**
   * Create a file loader function from VFS
   */
  private createFileLoader() {
    return async (path: string): Promise<string> => {
      const file = await this.vfs.readFile(path)
      if (file.content === null) {
        throw new Error(`File not found: ${path}`)
      }
      if (file.content instanceof ArrayBuffer) {
        return new TextDecoder().decode(file.content)
      }
      return file.content as string
    }
  }

  /**
   * Create a file exists checker from VFS
   */
  private createFileExistsChecker() {
    return async (path: string): Promise<boolean> => {
      return this.vfs.exists(path)
    }
  }
}
