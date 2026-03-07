/**
 * VFS Service Implementation
 *
 * Acts as a web server for sandbox iframe, providing file services.
 *
 * Core responsibilities:
 * 1. Path isolation: basePath as virtual root directory
 * 2. Transparent build output serving via BuildAwareVfs
 * 3. Direct VFS access without intermediate layer
 *
 * Build compilation logic has been moved into BuildAwareVfs (packages/bundler).
 * When the VFS passed here is a BuildAwareVfs, entry file reads transparently
 * return compiled output from multi-level cache (L0→L1→L2→L3).
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
} from '../types'
import type { Vfs } from '@pubwiki/vfs'
import { isVfsFolder } from '@pubwiki/vfs'
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
  /** VFS instance (may be a BuildAwareVfs that transparently handles build output) */
  vfs: Vfs
}

// Global counter for debugging multiple instances
let vfsServiceInstanceCounter = 0

/**
 * VFS Service Implementation
 *
 * This service runs on the main site and is consumed by the
 * sandbox Service Worker for file access.
 *
 * When the VFS is a BuildAwareVfs, entry file reads transparently return
 * compiled output. VfsServiceImpl only handles path resolution, MIME type
 * detection, and entry file routing — no bundler management.
 */
export class VfsServiceImpl extends RpcTarget implements IVfsService {
  // Instance ID for debugging
  private readonly instanceId: number
  
  // Current MessagePort for RPC (managed internally for reconnection)
  private currentPort: MessagePort | null = null

  constructor(
    private config: VfsServiceConfig
  ) {
    super()
    
    this.instanceId = ++vfsServiceInstanceCounter
    
    console.log(`[VfsServiceImpl #${this.instanceId}] Created for basePath: ${config.basePath}`, {
      projectConfig: config.projectConfig ? {
        tsconfigPath: config.projectConfig.tsconfigPath,
        isBuildable: config.projectConfig.isBuildable,
        entryFiles: config.projectConfig.entryFiles
      } : null
    })
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
   * Read a file from the virtual file system
   *
   * For entry files in buildable projects, reads from VFS which may transparently
   * return compiled output (when VFS is a BuildAwareVfs).
   * For other files, returns raw content.
   */
  async readFile(path: string, _options?: ReadFileOptions): Promise<FileInfo> {

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
   * Read entry file — delegates to VFS which transparently handles build output.
   * When VFS is a BuildAwareVfs, this returns compiled JS from cache or compilation.
   */
  private async readBundledFile(actualPath: string): Promise<FileInfo> {
    console.log("[VfsServiceImpl] Reading entry file:", actualPath)

    const file = await this.config.vfs.readFile(actualPath)

    if (file.content === null || file.content === undefined) {
      throw new Error(`No build output found for: ${actualPath}`)
    }

    // Convert to Uint8Array
    let buffer: Uint8Array
    if (file.content instanceof ArrayBuffer) {
      buffer = new Uint8Array(file.content)
    } else if (typeof file.content === 'string') {
      buffer = new TextEncoder().encode(file.content)
    } else {
      buffer = file.content as Uint8Array
    }

    return {
      path: actualPath,
      content: buffer,
      mimeType: 'application/javascript',
      size: buffer.byteLength
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
      mimeType: this.resolveRawFileMimeType(actualPath),
      size: buffer.byteLength
    }
  }

  /**
   * Resolve the MIME type for a raw file.
   * When projectConfig is null (no bundling, i.e., pre-built content),
   * .ts/.tsx/.jsx files contain pre-built JavaScript but retain their
   * original extension. Override to application/javascript so browsers
   * accept them as module scripts.
   */
  private resolveRawFileMimeType(path: string): string {
    const mimeType = getMimeType(path)
    if (
      !this.config.projectConfig?.isBuildable &&
      (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.jsx'))
    ) {
      return 'application/javascript'
    }
    return mimeType
  }

  /**
   * Check if a file or directory exists
   */
  async fileExists(path: string): Promise<FileExistsResult> {
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
    // No-op: lifecycle is managed by BuildAwareVfs (if used)
  }
}
