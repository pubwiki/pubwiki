/**
 * VFS Service Implementation
 *
 * Acts as a web server for sandbox iframe, providing file services.
 *
 * Core responsibilities:
 * 1. Path isolation: basePath as virtual root directory
 * 2. Bundler integration: auto bundle TypeScript/JavaScript project files
 * 3. Direct VFS access without intermediate layer
 */

import { RpcTarget, newMessagePortRpcSession } from '@pubwiki/sandbox-service'
import type {
  IVfsService,
  FileInfo,
  FileExistsResult,
  DirectoryEntry,
  ReadFileOptions
} from '@pubwiki/sandbox-service'
import type {
  ProjectConfig,
  ProjectBuildResult
} from '../types'
import type { Vfs } from '@pubwiki/vfs'
import { isVfsFolder } from '@pubwiki/vfs'
import { BundlerService } from '@pubwiki/bundler'
import type { HmrServiceImpl } from './hmr-service'
import {
  getMimeType,
  normalizePath,
  isEntryFile,
  createSimpleErrorPage
} from '../utils'

/**
 * Configuration for VfsServiceImpl
 */
export interface VfsServiceConfig {
  /** Base path within the VFS */
  basePath: string
  /** Project configuration (if running a buildable project) */
  projectConfig: ProjectConfig | null
  /** HMR service for file change notifications */
  hmrService: HmrServiceImpl
  /** VFS instance */
  vfs: Vfs
}

// Global counter for debugging multiple instances
let vfsServiceInstanceCounter = 0

/**
 * VFS Service Implementation
 *
 * This service runs on the main site and is consumed by the
 * sandbox Service Worker for file access.
 */
export class VfsServiceImpl extends RpcTarget implements IVfsService {
  private bundlerService: BundlerService
  private bundlerInitialized: boolean = false
  private initPromise: Promise<void> | null = null

  // File watching cleanup
  private fileWatchUnsub: (() => void) | null = null
  
  // Instance ID for debugging
  private readonly instanceId: number
  
  // Current MessagePort for RPC (managed internally for reconnection)
  private currentPort: MessagePort | null = null

  constructor(
    private config: VfsServiceConfig
  ) {
    super()
    
    this.instanceId = ++vfsServiceInstanceCounter
    
    // Create BundlerService
    console.log(`[VfsServiceImpl #${this.instanceId}] Creating BundlerService`)
    this.bundlerService = new BundlerService({ vfs: config.vfs })
    
    console.log(`[VfsServiceImpl #${this.instanceId}] Created for basePath: ${config.basePath}`, {
      projectConfig: config.projectConfig ? {
        tsconfigPath: config.projectConfig.tsconfigPath,
        isBuildable: config.projectConfig.isBuildable,
        entryFiles: config.projectConfig.entryFiles
      } : null
    })

    // Async initialization
    this.initPromise = this.initialize()
  }
  
  /**
   * Get the bundler service for reuse
   */
  getBundlerService(): BundlerService {
    return this.bundlerService
  }
  
  /**
   * Rebind this service to a new MessagePort (for SW reconnection)
   * Closes the old port if exists and binds to the new one
   */
  rebindPort(port: MessagePort): void {
    // Close old port if exists
    if (this.currentPort) {
      console.log(`[VfsServiceImpl #${this.instanceId}] Closing old port for rebind`)
      this.currentPort.close()
    }
    
    // Bind to new port
    this.currentPort = port
    newMessagePortRpcSession(port, this)
    console.log(`[VfsServiceImpl #${this.instanceId}] Rebound to new port`)
  }

  /**
   * Initialize bundler
   */
  private async initialize(): Promise<void> {
    try {
      await this.bundlerService.initialize()
      await this.bundlerService.invalidateAll()
      console.log(`[VfsServiceImpl] Initialized for basePath: ${this.config.basePath}`)
    } catch (error) {
      console.error('[VfsServiceImpl] Initialization failed:', error)
      throw error
    }
  }

  /**
   * Ensure initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise
    }
  }

  /**
   * Read a file from the virtual file system
   *
   * For project files, returns bundler output;
   * For other files, returns raw content.
   */
  async readFile(path: string, _options?: ReadFileOptions): Promise<FileInfo> {
    await this.ensureInitialized()

    // 1. Resolve path: sandbox's / corresponds to actual basePath
    const actualPath = this.resolveToActualPath(path)

    console.log(`[VfsServiceImpl] readFile: ${path} -> ${actualPath}`)

    try {
      // 2. Check if bundling is needed
      if (this.shouldBundle(actualPath)) {
        return await this.readBundledFile(actualPath)
      }

      // 3. Read file directly
      return await this.readRawFile(actualPath)
    } catch (error) {
      console.error(`[VfsServiceImpl] readFile error:`, error)

      // Return error page
      const errorMessage = error instanceof Error ? error.message : String(error)
      const html = createSimpleErrorPage(errorMessage)
      const content = new TextEncoder().encode(html)

      return {
        path: actualPath,
        content,
        mimeType: 'text/html',
        size: content.byteLength
      }
    }
  }

  /**
   * Resolve sandbox path to actual file system path
   * Allows directory traversal, final path just needs to be within workspace
   */
  private resolveToActualPath(sandboxPath: string): string {
    // sandboxPath: /app.js (sandbox perspective)
    // basePath: /public/demo/
    // actualPath: /public/demo/app.js (actual path)

    // Support ../ traversal, e.g. ../shared/utils.js -> /public/shared/utils.js
    const normalized = sandboxPath.startsWith('/')
      ? sandboxPath.slice(1)
      : sandboxPath

    // Use normalizePath to handle ../ traversal
    return normalizePath(this.config.basePath, normalized)
  }

  /**
   * Check if file needs to be processed through bundler
   */
  private shouldBundle(actualPath: string): boolean {
    // 1. Check extension
    const ext = actualPath.split('.').pop()?.toLowerCase()
    if (!['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
      return false
    }

    // 2. Check if within project scope
    if (!this.config.projectConfig?.isBuildable) {
      return false
    }

    return isEntryFile(actualPath, this.config.projectConfig.entryFiles)
  }

  /**
   * Read and bundle file
   */
  private async readBundledFile(actualPath: string): Promise<FileInfo> {
    if (!this.config.projectConfig) {
      throw new Error('[VfsServiceImpl] Invalid state for bundling')
    }
    console.log("[VfsServiceImpl] Reading bundled result for", actualPath)

    // Ensure bundler is initialized and watching is setup
    if (!this.bundlerInitialized) {
      await this.bundlerService.initialize()
      this.bundlerInitialized = true
      
      // Setup file watching using the new watch API
      // This will automatically track dependencies and trigger rebuilds
      this.fileWatchUnsub = this.bundlerService.watch({
        tsconfigPath: this.config.projectConfig.tsconfigPath,
        onFileChange: (changedPath: string) => {
          console.log(`[VfsServiceImpl #${this.instanceId}] File changed: ${changedPath}`)
          // Trigger HMR update notification
          this.config.hmrService.notifyUpdate({
            type: 'update',
            path: changedPath,
            timestamp: Date.now()
          })
        },
        onRebuild: (result) => {
          console.log(`[VfsServiceImpl] Rebuild completed, success: ${result.success}`)
          
          if (!result.success) {
            // Build failed: send error event via HMR
            const allErrors = Array.from(result.outputs.values())
              .flatMap(output => output.errors)
            
            console.log(`[VfsServiceImpl] Build failed, sending ${allErrors.length} error(s) via HMR:`, allErrors)
            
            this.config.hmrService.notifyUpdate({
              type: 'error',
              path: '__build__',
              timestamp: Date.now(),
              error: `Build failed with ${allErrors.length} error(s)`,
              errors: allErrors
            })
            
            console.log('[VfsServiceImpl] HMR error event sent')
          }
        }
      })
      
      console.log('[VfsServiceImpl] Bundler initialized with file watching')
    }

    // If a build is in progress, wait for it using the bundler's API
    if (this.bundlerService.isBuildInProgress()) {
      console.log('[VfsServiceImpl] Build in progress, waiting...')
      await this.bundlerService.waitForBuild()
    }

    // Try to get last build result first (API simplified - no projectRoot needed)
    let result: ProjectBuildResult | null = this.bundlerService.getLastBuildOutput()

    // If no cache, trigger build
    if (!result) {
      console.log('[VfsServiceImpl] No cached build, triggering build for:', this.config.projectConfig.tsconfigPath)
      result = await this.bundlerService.build({
        tsconfigPath: this.config.projectConfig.tsconfigPath,
        options: {}
      })
    }

    // Build failed - send error via HMR and throw
    if (!result.success) {
      console.error('[VfsServiceImpl] Build failed for:', actualPath)

      // Collect all errors and send via HMR
      const allErrors = Array.from(result.outputs.values()).flatMap(output => output.errors)
      
      console.log(`[VfsServiceImpl] Initial build failed, sending ${allErrors.length} error(s) via HMR:`, allErrors)
      
      this.config.hmrService.notifyUpdate({
        type: 'error',
        path: actualPath,
        timestamp: Date.now(),
        error: `Build failed with ${allErrors.length} error(s)`,
        errors: allErrors
      })
      
      console.log('[VfsServiceImpl] HMR error event sent for initial build failure')

      throw new Error(`Build failed: ${allErrors.map(e => e.message).join('; ')}`)
    }

    // Find corresponding output from result
    const output = result.outputs.get(actualPath)

    if (!output || !output.code) {
      // If no corresponding output found, return error
      const html = createSimpleErrorPage(`No build output found for: ${actualPath}`)
      const content = new TextEncoder().encode(html)

      return {
        path: actualPath,
        content,
        mimeType: 'text/html',
        size: content.byteLength
      }
    }

    // Return bundled code
    const content = new TextEncoder().encode(output.code)

    return {
      path: actualPath,
      content,
      mimeType: 'application/javascript',
      size: content.byteLength
    }
  }

  /**
   * Read file content directly
   */
  private async readRawFile(actualPath: string): Promise<FileInfo> {
    const file = await this.config.vfs.readFile(actualPath)

    if (file.content === null || file.content === undefined) {
      throw new Error(`File not found: ${actualPath}`)
    }

    // Convert to Uint8Array
    let buffer: Uint8Array

    if (file.content instanceof ArrayBuffer) {
      buffer = new Uint8Array(file.content)
    } else if (typeof file.content === 'string') {
      buffer = new TextEncoder().encode(file.content)
    } else {
      // Assume already Uint8Array
      buffer = file.content as Uint8Array
    }

    return {
      path: actualPath,
      content: buffer,
      mimeType: getMimeType(actualPath),
      size: buffer.byteLength
    }
  }

  /**
   * Check if a file or directory exists
   */
  async fileExists(path: string): Promise<FileExistsResult> {
    await this.ensureInitialized()

    const actualPath = this.resolveToActualPath(path)

    console.log(`[VfsServiceImpl] fileExists: ${path} -> ${actualPath}`)

    try {
      const exists = await this.config.vfs.exists(actualPath)
      return { exists }
    } catch (error) {
      console.error(`[VfsServiceImpl] fileExists error:`, error)
      return { exists: false }
    }
  }

  /**
   * List contents of a directory
   */
  async listDir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized()

    const actualPath = this.resolveToActualPath(path)

    console.log(`[VfsServiceImpl] listDir: ${path} -> ${actualPath}`)

    try {
      const entries = await this.config.vfs.listFolder(actualPath)

      return entries.map((entry) => ({
        name: entry.name,
        path: normalizePath(actualPath, entry.name),
        isDirectory: isVfsFolder(entry)
      }))
    } catch (error) {
      console.error(`[VfsServiceImpl] listDir error:`, error)
      return []
    }
  }

  /**
   * Get the MIME type for a file path
   */
  getMimeType(path: string): string {
    return getMimeType(path)
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.fileWatchUnsub) {
      this.fileWatchUnsub()
      this.fileWatchUnsub = null
    }
  }
}
