/**
 * Type definitions for @pubwiki/sandbox-host
 *
 * Re-exports types from @pubwiki/bundler and defines sandbox-specific interfaces.
 */

import type { ICustomService, ConsoleLogEntry } from '@pubwiki/sandbox-service'
import type { BundlerService } from '@pubwiki/bundler'

// Re-export types from @pubwiki/bundler
export type {
  ProjectConfig,
  BuildError,
  BuildWarning,
  FileBuildResult,
  ProjectBuildResult,
  BundleRequest
} from '@pubwiki/bundler'

// Re-export Vfs from @pubwiki/vfs
export { Vfs } from '@pubwiki/vfs'

// Re-export service types from @pubwiki/sandbox-service
export type { ICustomService, ServiceDefinition, JsonSchema, ConsoleLogEntry } from '@pubwiki/sandbox-service'

import type { ProjectConfig } from '@pubwiki/bundler'

/**
 * Callback type for console log events from sandbox
 */
export type OnLogCallback = (entry: ConsoleLogEntry) => void

/**
 * Custom service factory for extending sandbox functionality
 * Factory receives config and returns an ICustomService implementation
 */
export type CustomServiceFactory<TConfig = unknown> = (config: TConfig) => ICustomService

/**
 * Configuration for VFS RPC Host
 */
export interface VfsRpcHostConfig {
  /** Base path within the VFS */
  basePath: string
  /** Project configuration (if running a buildable project) */
  projectConfig: ProjectConfig | null
  /** HMR service for file change notifications */
  hmrService: HmrServiceImpl
}

/**
 * Configuration for Main RPC Host
 */
export interface MainRpcHostConfig {
  /** Base path within the VFS */
  basePath: string
}

/**
 * VFS RPC Host instance
 */
export interface VfsRpcHost {
  /** Unique host ID */
  id: string
  /** Check if host is connected */
  isConnected: boolean
  /** Get the bundler service for reuse (null when BuildAwareVfs is used) */
  getBundlerService: () => BundlerService | null
  /** Create a new MessagePort for SW reconnection, rebinding the service */
  createNewPort: () => MessagePort
  /** Disconnect and cleanup */
  disconnect: () => void
}

/**
 * Main RPC Host instance
 */
export interface MainRpcHost {
  /** Unique host ID */
  id: string
  /** Check if host is connected */
  isConnected: boolean
  /** Get HMR service for direct access */
  getHmrService: () => HmrServiceImpl
  /** Get custom service by ID */
  getService: (id: string) => ICustomService | undefined
  /** Register a custom service */
  registerService: (id: string, service: ICustomService) => void
  /** Disconnect and cleanup */
  disconnect: () => void
}

/**
 * Configuration for sandbox connection
 */
export interface SandboxConnectionConfig {
  /** The iframe element containing the sandbox */
  iframe: HTMLIFrameElement
  /** Base path within the VFS */
  basePath: string
  /** Project configuration (required for buildable projects) */
  projectConfig: ProjectConfig
  /** Target origin of the sandbox site */
  targetOrigin: string
  /** Entry file to load (e.g., 'index.html') */
  entryFile: string
  /** Initial path to navigate to instead of entryFile default (e.g., '/game/level-3') */
  initialPath?: string
  /** Custom services to register (optional) */
  customServices?: Map<string, CustomServiceFactory<MainRpcHostConfig>>
  /** Callback for console log events from sandbox (optional) */
  onLog?: OnLogCallback
  /** Callback for URL change events from sandbox (optional) */
  onUrlChange?: (path: string) => void
}

/**
 * Sandbox connection instance
 */
export interface SandboxConnection {
  /** Unique connection ID */
  id: string

  /** Check if connection is established */
  isConnected: boolean

  /**
   * Get the bundler service for build progress tracking
   * Returns null if not connected or no buildable project
   */
  getBundlerService(): BundlerService | null

  /**
   * Wait for sandbox to be ready and initialized
   * @returns true if initialization succeeded
   */
  waitForReady(): Promise<boolean>

  /**
   * Trigger a manual reload via HMR service
   */
  reload(): void

  /**
   * Add a custom service to the connection
   * @param id - Unique service identifier
   * @param service - ICustomService implementation
   */
  addCustomService(id: string, service: ICustomService): void

  /**
   * Get all stored console logs
   */
  getLogs(): ConsoleLogEntry[]

  /**
   * Clear all stored console logs
   */
  clearLogs(): void

  /**
   * Set callback for new log events
   */
  setOnLogCallback(callback: OnLogCallback | null): void

  /**
   * Disconnect and cleanup all resources
   */
  disconnect(): void
}

// Forward declare HmrServiceImpl to avoid circular imports
import type { HmrServiceImpl } from './services/hmr-service'
export type { HmrServiceImpl }
