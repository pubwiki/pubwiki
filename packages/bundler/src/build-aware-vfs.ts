/**
 * BuildAwareVfs — Transparent build output VFS layer
 *
 * Wraps a source VFS and transparently intercepts reads on entry files
 * to resolve compiled output through a multi-level cache:
 *
 *   L0: In-memory cache (current session)
 *   L1: OPFS (BuildCacheStorage)
 *   L2: Remote (R2 via build-cache API) — optional
 *   L3: Local compilation (BundlerService)
 *
 * Non-entry files are delegated directly to the source VFS.
 */

import { Vfs, type VfsProvider } from '@pubwiki/vfs'
import { BundlerService } from './service/bundler-service'
import type { ProjectConfig } from './service/project-detector'
import type { ProjectBuildResult, BuildManifest } from './types/result'
import type { BuildProgressEvent } from './types/service'
import type { BundleOptions } from './types/options'
import type { BuildCacheStorage, BuildCacheFile } from './cache'

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for fetching build cache from remote (L2).
 * Returns the extracted files + manifest from the remote archive.
 */
export interface RemoteBuildFetcher {
  /**
   * Look up build cache metadata from backend.
   * @returns releaseHash + fileHashes, or null if not found
   */
  getMetadata(cacheKey: string): Promise<{
    releaseHash: string
    fileHashes: Record<string, string>
  } | null>

  /**
   * Download and extract the build archive from R2.
   * @returns extracted files, or null if not available
   */
  fetchArchive(cacheKey: string): Promise<{
    manifest: BuildManifest
    files: BuildCacheFile[]
  } | null>
}

export interface BuildAwareVfsConfig {
  /** The underlying source VFS (contains original TypeScript/JS source files) */
  sourceVfs: Vfs
  /** Detected project configuration (entry files, tsconfig path) */
  projectConfig: ProjectConfig
  /** Build cache storage (OPFS or IndexedDB) */
  buildCacheStorage: BuildCacheStorage
  /** Pre-computed buildCacheKey (Play route has it from graph; Studio may compute lazily) */
  buildCacheKey?: string | null
  /** Hash of the source files content (used in manifest and cache metadata) */
  filesHash?: string
  /** Per-file hashes at build time { [filePath]: oid } — passed to put() for dep matching */
  fileHashes?: Record<string, string>
  /** SHA-256 of build config (entryFiles + target + ...) — used for dep matching in resolve() */
  configKey?: string
  /** Optional remote fetcher for L2 resolution */
  remoteFetcher?: RemoteBuildFetcher
  /** Callback when a file changes during HMR (L3 watch mode) */
  onFileChange?: (changedPath: string) => void
  /** Callback when rebuild completes during HMR */
  onRebuild?: (result: ProjectBuildResult) => void
  /** Function to compute buildCacheKey lazily (for Studio when key is unknown) */
  computeBuildCacheKey?: () => Promise<string>
  /** Callback for build progress events (start/complete/error) — used by UI for compilation indicator */
  onBuildProgress?: (event: BuildProgressEvent) => void
  /** Bundle options forwarded to the bundler (e.g. development mode, minify, define) */
  bundleOptions?: BundleOptions
}

// ============================================================================
// BuildAwareVfsProvider — intercepts readFile for entry files
// ============================================================================

/**
 * Custom VfsProvider wrapping the source VFS provider.
 * Intercepts readFile for entry file paths and returns compiled output.
 */
class BuildAwareVfsProvider implements VfsProvider {
  private sourceProvider: VfsProvider
  private entryFilePaths: Set<string>

  /**
   * L0: In-memory compiled output cache.
   *
   * NOTE: This Map grows unboundedly for the lifetime of the
   * BuildAwareVfsProvider instance. Each entry holds a full compiled
   * Uint8Array.  In practice this is bounded by the number of entry
   * files (typically 1–3), but if the entry set grows large, consider
   * adding an LRU eviction policy or a size cap.
   */
  private compiledCache = new Map<string, Uint8Array>()

  private config: BuildAwareVfsConfig
  private buildCacheKey: string | null
  private bundlerService: BundlerService | null = null
  private bundlerInitialized = false
  private watchUnsub: (() => void) | null = null

  constructor(config: BuildAwareVfsConfig) {
    this.config = config
    this.sourceProvider = config.sourceVfs.getProvider()
    this.buildCacheKey = config.buildCacheKey ?? null
    this.entryFilePaths = new Set(
      config.projectConfig.entryFiles.map((f: string) => f.startsWith('/') ? f : `/${f}`)
    )
  }

  // ---- Entry file detection ----

  private isEntryFile(path: string): boolean {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return this.entryFilePaths.has(normalized)
  }

  // ---- Multi-level cache resolution ----

  private async resolveCompiledOutput(path: string): Promise<Uint8Array> {
    // L0: In-memory cache
    const cached = this.compiledCache.get(path)
    if (cached) {
      console.log(`[BuildAwareVfs] L0 hit for ${path}`)
      return cached
    }

    // Ensure buildCacheKey is available
    if (!this.buildCacheKey && this.config.computeBuildCacheKey) {
      this.buildCacheKey = await this.config.computeBuildCacheKey()
    }

    console.log(`[BuildAwareVfs] resolving ${path}, buildCacheKey: ${this.buildCacheKey ? this.buildCacheKey.slice(0, 12) + '...' : 'null'}`)

    if (this.buildCacheKey) {
      // L1: OPFS cache
      const opfsResult = await this.resolveFromOpfs(path, this.buildCacheKey)
      if (opfsResult) {
        console.log(`[BuildAwareVfs] L1 (OPFS) hit for ${path}`)
        return opfsResult
      }

      // L2: Remote cache
      if (this.config.remoteFetcher) {
        const remoteResult = await this.resolveFromRemote(path, this.buildCacheKey)
        if (remoteResult) {
          console.log(`[BuildAwareVfs] L2 (remote) hit for ${path}`)
          return remoteResult
        }
        console.log(`[BuildAwareVfs] L2 (remote) miss for ${path}`)
      }
    }

    // L3: Local compilation
    console.log(`[BuildAwareVfs] L3 (compile) fallback for ${path}`)
    return this.resolveFromBundler(path)
  }

  /** L1: Read compiled output from OPFS BuildCacheStorage */
  private async resolveFromOpfs(path: string, cacheKey: string): Promise<Uint8Array | null> {
    const handle = await this.config.buildCacheStorage.get(cacheKey)
    if (!handle) return null

    // Find the output file path from manifest
    const outputPath = this.findOutputPath(handle.manifest, path)
    if (!outputPath) return null

    const content = await this.config.buildCacheStorage.readFile(cacheKey, outputPath)
    if (!content) return null

    // Write-through to L0
    this.compiledCache.set(path, content)
    return content
  }

  /** L2: Fetch from remote and write-through to L1 + L0 */
  private async resolveFromRemote(path: string, cacheKey: string): Promise<Uint8Array | null> {
    const fetcher = this.config.remoteFetcher!

    try {
      const result = await fetcher.fetchArchive(cacheKey)
      if (!result) return null

      // Write-through to L1 (OPFS)
      const totalSize = result.files.reduce((sum, f) => sum + f.content.byteLength, 0)
      const metadata = await fetcher.getMetadata(cacheKey)

      await this.config.buildCacheStorage.put(cacheKey, result.manifest, result.files, {
        buildCacheKey: cacheKey,
        filesHash: result.manifest.filesHash,
        totalSize,
        builtAt: Date.now(),
        lastAccessedAt: Date.now(),
        dependencies: result.manifest.dependencies ?? [],
        fileHashes: metadata?.fileHashes ?? {},
        configKey: this.config.configKey ?? '',
        verified: true, // just fetched from authoritative source
      })

      // LRU eviction — best-effort, don't block
      this.config.buildCacheStorage.evict().catch(() => {})

      // Find the file for this entry path
      const outputPath = this.findOutputPath(result.manifest, path)
      if (!outputPath) return null

      const file = result.files.find(f => f.path === outputPath)
      if (!file) return null

      // Write-through to L0
      this.compiledCache.set(path, file.content)
      return file.content
    } catch (err) {
      console.warn('[BuildAwareVfs] L2 remote fetch failed:', err)
      return null
    }
  }

  /** L3: Compile using BundlerService and write-through to L1 + L0 */
  private async resolveFromBundler(path: string): Promise<Uint8Array> {
    // Lazy-initialize bundler
    if (!this.bundlerService) {
      this.bundlerService = new BundlerService({ vfs: this.config.sourceVfs })
    }
    if (!this.bundlerInitialized) {
      await this.bundlerService.initialize()
      this.bundlerInitialized = true

      // Set up watch for HMR if callbacks are provided
      if (this.config.onFileChange || this.config.onRebuild) {
        this.setupWatch()
      }

      // Forward build progress events from BundlerService
      if (this.config.onBuildProgress) {
        this.bundlerService.onBuildProgress(this.config.onBuildProgress)
      }
    }

    // Notify build start
    this.config.onBuildProgress?.({
      type: 'start',
      path: this.config.projectConfig.tsconfigPath,
      message: 'Compiling...',
    })

    // Execute build
    const buildResult = await this.bundlerService.build({
      tsconfigPath: this.config.projectConfig.tsconfigPath,
      options: this.config.bundleOptions,
    })

    if (!buildResult.success) {
      const errors = [...buildResult.outputs.values()]
        .flatMap(o => o.errors)
        .map(e => e.message)
        .join('\n')
      this.config.onBuildProgress?.({
        type: 'error',
        path: this.config.projectConfig.tsconfigPath,
        message: errors || 'Unknown error',
      })
      throw new Error(`Build failed: ${errors || 'Unknown error'}`)
    }

    // Notify build complete
    this.config.onBuildProgress?.({
      type: 'complete',
      path: this.config.projectConfig.tsconfigPath,
      result: buildResult,
    })

    // Extract build files and populate L0 cache
    const buildFiles = this.extractBuildFiles(buildResult)
    for (const file of buildFiles) {
      const entryPath = this.findEntryPathForOutput(file.path, buildResult)
      if (entryPath) {
        this.compiledCache.set(entryPath, file.content)
      }
    }

    // Write-through to L1 (OPFS) if we know the cacheKey
    if (this.buildCacheKey) {
      const manifest = this.buildManifestFromResult(buildResult)
      const totalSize = buildFiles.reduce((sum, f) => sum + f.content.byteLength, 0)

      this.config.buildCacheStorage.put(this.buildCacheKey, manifest, buildFiles, {
        buildCacheKey: this.buildCacheKey,
        filesHash: this.config.filesHash ?? '',
        totalSize,
        builtAt: Date.now(),
        lastAccessedAt: Date.now(),
        dependencies: buildResult.dependencies,
        fileHashes: this.config.fileHashes ?? {},
        configKey: this.config.configKey ?? '',
        verified: true,
      }).then(() => {
        // LRU eviction — best-effort
        return this.config.buildCacheStorage.evict()
      }).catch((err: unknown) => {
        console.warn('[BuildAwareVfs] Failed to write-through to L1:', err)
      })
    }

    // Return the requested entry file's compiled output
    const result = this.compiledCache.get(path)
    if (!result) {
      throw new Error(`Build succeeded but no output found for entry: ${path}`)
    }
    return result
  }

  // ---- Helper methods ----

  /** Find the compiled output file path from a manifest for a given entry source path */
  private findOutputPath(manifest: BuildManifest, entrySourcePath: string): string | null {
    const normalized = entrySourcePath.startsWith('/') ? entrySourcePath : `/${entrySourcePath}`
    for (const [entryPath, info] of Object.entries(manifest.entries) as [string, { jsPath: string; cssPath?: string }][]) {
      const normalizedEntry = entryPath.startsWith('/') ? entryPath : `/${entryPath}`
      if (normalizedEntry === normalized) {
        return info.jsPath
      }
    }
    return null
  }

  /** Find the entry source path that produced a given output path */
  private findEntryPathForOutput(
    outputPath: string,
    buildResult: ProjectBuildResult
  ): string | null {
    for (const [entryPath, _output] of buildResult.outputs.entries()) {
      const normalized = entryPath.startsWith('/') ? entryPath : `/${entryPath}`
      // The output file name is typically the entry file name with a .js extension
      const expectedOutput = normalized.replace(/\.[^.]+$/, '.js')
      if (outputPath === expectedOutput || outputPath === normalized) {
        return normalized
      }
    }
    return null
  }

  /** Extract build output files (JS, CSS) from a ProjectBuildResult */
  private extractBuildFiles(buildResult: ProjectBuildResult): BuildCacheFile[] {
    const files: BuildCacheFile[] = []
    const encoder = new TextEncoder()

    for (const [entryPath, output] of buildResult.outputs.entries()) {
      const baseName = entryPath.replace(/\.[^.]+$/, '')

      if (output.code) {
        files.push({
          path: `${baseName}.js`,
          content: encoder.encode(output.code),
        })
      }
      if (output.css) {
        files.push({
          path: `${baseName}.css`,
          content: encoder.encode(output.css),
        })
      }
    }

    return files
  }

  /** Build a manifest from a ProjectBuildResult */
  private buildManifestFromResult(buildResult: ProjectBuildResult): BuildManifest {
    const entries: Record<string, { jsPath: string; cssPath?: string }> = {}

    for (const [entryPath, output] of buildResult.outputs.entries()) {
      const baseName = entryPath.replace(/\.[^.]+$/, '')
      entries[entryPath] = {
        jsPath: `${baseName}.js`,
        ...(output.css ? { cssPath: `${baseName}.css` } : {}),
      }
    }

    return {
      version: 1,
      buildCacheKey: this.buildCacheKey ?? '',
      filesHash: this.config.filesHash ?? '',
      entries,
      dependencies: buildResult.dependencies,
    }
  }

  /** Set up file watching for HMR (only triggered when L3 bundler is active) */
  private setupWatch(): void {
    if (!this.bundlerService) return

    this.watchUnsub = this.bundlerService.watch({
      tsconfigPath: this.config.projectConfig.tsconfigPath,
      bundleOptions: this.config.bundleOptions,
      onRebuild: (result: ProjectBuildResult) => {
        if (result.success) {
          // Update L0 cache with new build output
          const buildFiles = this.extractBuildFiles(result)
          for (const file of buildFiles) {
            const entryPath = this.findEntryPathForOutput(file.path, result)
            if (entryPath) {
              this.compiledCache.set(entryPath, file.content)
              this.config.onFileChange?.(entryPath)
            }
          }
        }
        this.config.onRebuild?.(result)
      },
    })
  }

  // ---- VfsProvider interface ----

  async readFile(path: string): Promise<Uint8Array> {
    if (this.isEntryFile(path)) {
      return this.resolveCompiledOutput(path)
    }
    return this.sourceProvider.readFile(path)
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    // Invalidate L0 cache on write (source file changed)
    this.compiledCache.clear()
    return this.sourceProvider.writeFile(path, content)
  }

  async unlink(path: string): Promise<void> {
    this.compiledCache.clear()
    return this.sourceProvider.unlink(path)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.sourceProvider.mkdir(path, options)
  }

  async readdir(path: string): Promise<string[]> {
    return this.sourceProvider.readdir(path)
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.sourceProvider.rmdir(path, options)
  }

  async stat(path: string) {
    return this.sourceProvider.stat(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.sourceProvider.exists(path)
  }

  async rename(from: string, to: string): Promise<void> {
    this.compiledCache.clear()
    return this.sourceProvider.rename(from, to)
  }

  async copyFile(from: string, to: string): Promise<void> {
    return this.sourceProvider.copyFile(from, to)
  }

  // ---- Lifecycle ----

  /**
   * Eagerly resolve all entry files through the cache hierarchy (L1→L2→L3).
   * Call this before the consumer starts reading entry files so that
   * compiled output is already warm in L0 by the time readFile() is invoked.
   *
   * This turns the otherwise-lazy cache resolution into an upfront cost
   * that can be shown to the user via a progress indicator.
   */
  async warmup(): Promise<void> {
    const entries = [...this.entryFilePaths]
    console.log(`[BuildAwareVfs] Warming up ${entries.length} entry file(s)`)
    for (const path of entries) {
      await this.resolveCompiledOutput(path)
    }
    console.log('[BuildAwareVfs] Warmup complete')
  }

  async dispose(): Promise<void> {
    if (this.watchUnsub) {
      this.watchUnsub()
      this.watchUnsub = null
    }
    if (this.bundlerService) {
      await this.bundlerService.terminate()
      this.bundlerService = null
      this.bundlerInitialized = false
    }
    this.compiledCache.clear()
  }

  /**
   * Invalidate all cached state so the next readFile() falls through
   * to L3 live compilation.  Called when the source VFS reports file
   * changes that did NOT go through this provider's writeFile().
   */
  invalidate(): void {
    this.compiledCache.clear()
    this.buildCacheKey = null
  }

  /**
   * Get all resolved npm package versions from the bundler.
   * Returns an empty map if no L3 build was performed (cache hit).
   */
  getResolvedPackageVersions(): ReadonlyMap<string, string> {
    return this.bundlerService?.getResolvedPackageVersions() ?? new Map()
  }
}

// ============================================================================
// BuildAwareVfs — extends Vfs with the intercepting provider
// ============================================================================

/**
 * Creates a BuildAwareVfs — a Vfs instance that transparently provides
 * compiled build output for entry files through a multi-level cache.
 *
 * The returned Vfs instance can be used as a drop-in replacement wherever
 * a regular Vfs is expected (VfsServiceConfig, BundlerService, etc.)
 *
 * @param config - Configuration including source VFS, project config, cache storage
 * @returns A Vfs instance backed by the BuildAwareVfsProvider
 */
export function createBuildAwareVfs(config: BuildAwareVfsConfig): Vfs<BuildAwareVfsProvider> & { warmup(): Promise<void>; getResolvedPackageVersions(): ReadonlyMap<string, string> } {
  const provider = new BuildAwareVfsProvider(config)
  const vfs = new Vfs(provider) as Vfs<BuildAwareVfsProvider> & { warmup(): Promise<void>; getResolvedPackageVersions(): ReadonlyMap<string, string> }

  // Forward events from source VFS to the new VFS, invalidating
  // the compiled cache so stale L0/L1 entries are not served.
  // Also trigger onFileChange so consumers (e.g. sandbox) reload.
  // When HMR watch is active it will fire onFileChange again after
  // its debounced rebuild; the redundant reload is harmless.
  const unsubCreate = config.sourceVfs.events.on('file:created', (event) => {
    provider.invalidate()
    vfs.events.emit(event)
  })
  const unsubUpdate = config.sourceVfs.events.on('file:updated', (event) => {
    provider.invalidate()
    config.onFileChange?.(event.path)
    vfs.events.emit(event)
  })
  const unsubDelete = config.sourceVfs.events.on('file:deleted', (event) => {
    provider.invalidate()
    config.onFileChange?.(event.path)
    vfs.events.emit(event)
  })

  // Extend dispose to clean up event forwarding and provider
  const originalDispose = vfs.dispose.bind(vfs)
  vfs.dispose = async () => {
    unsubCreate()
    unsubUpdate()
    unsubDelete()
    await provider.dispose()
    await originalDispose()
  }

  // Expose warmup — eagerly resolves all entry files through cache hierarchy
  vfs.warmup = () => provider.warmup()

  // Expose resolved package versions — available after L3 build
  vfs.getResolvedPackageVersions = () => provider.getResolvedPackageVersions()

  return vfs
}
