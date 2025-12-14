/**
 * Type definitions for @pubwiki/sandbox-host
 *
 * Re-exports types from @pubwiki/bundler and defines sandbox-specific interfaces.
 */

import type { RpcTarget } from 'capnweb'
import type { z } from 'zod/v4'

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

import type { ProjectConfig } from '@pubwiki/bundler'

/**
 * Custom service factory for extending sandbox functionality
 */
export type CustomServiceFactory<TConfig = unknown> = (config: TConfig) => RpcTarget

/**
 * Service definition with zod v4 interface schema
 */
export interface ServiceDefinition<T extends z.ZodType = z.ZodType> {
  /** Unique service ID */
  id: string
  /** Zod v4 interface schema defining the service contract */
  schema: T
  /** Service implementation */
  implementation: RpcTarget
}

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
  getService: (id: string) => RpcTarget | undefined
  /** Get service schema by ID */
  getServiceSchema: (id: string) => z.ZodType | undefined
  /** Register a custom service dynamically */
  registerService: <T extends z.ZodType>(definition: ServiceDefinition<T>) => void
  /** Get all custom service schemas */
  getCustomServices?: () => Map<string, z.ZodType>
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
  /** Custom services to register (optional) */
  customServices?: Map<string, CustomServiceFactory<MainRpcHostConfig>>
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
   * Initialize: build + setup file watching + send RPC ports to sandbox
   * @param entryFile - Entry file to load
   * @returns true if initialization succeeded
   */
  initialize(entryFile: string): Promise<boolean>

  /**
   * Add a custom service dynamically
   * @param definition - Service definition with zod schema and implementation
   */
  addCustomService<T extends z.ZodType>(definition: ServiceDefinition<T>): void

  /**
   * Trigger a manual reload via HMR service
   */
  reload(): void

  /**
   * Disconnect and cleanup all resources
   */
  disconnect(): void
}

// Forward declare HmrServiceImpl to avoid circular imports
import type { HmrServiceImpl } from './services/hmr-service'
export type { HmrServiceImpl }
