/**
 * @pubwiki/sandbox-host
 *
 * Host-side sandbox communication layer for @pubwiki ecosystem.
 *
 * This package provides the main site implementation for sandbox communication.
 * It manages RPC services to sandbox iframe and its Service Worker.
 *
 * Architecture:
 * - Main site creates SandboxConnection when opening a sandbox window
 * - SandboxConnection manages TWO independent MessageChannels:
 *   1. SW RPC channel - VFS Service for Service Worker (file access)
 *   2. Main RPC channel - HMR + Custom Services for sandbox main page
 * - Both channels use capnweb for type-safe RPC
 * - NO bridging through sandbox main page - direct connections
 *
 * @example
 * ```typescript
 * import { createSandboxConnection } from '@pubwiki/sandbox-host'
 *
 * const connection = createSandboxConnection({
 *   iframe,
 *   basePath: '/public/demo/',
 *   projectConfig,
 *   targetOrigin: 'https://sandbox.example.com',
 *   vfs: myVfs,
 *   // Optional: Register custom services
 *   customServices: new Map([
 *     ['myService', (config) => new MyServiceImpl(config)]
 *   ])
 * })
 *
 * await connection.initialize('/app.tsx')
 * ```
 *
 * @packageDocumentation
 */

// Main connection manager
export {
  createSandboxConnection,
  type SandboxConnectionConfigExt
} from './connection'

// RPC Host factories
export {
  createVfsRpcHost,
  createMainRpcHost,
  createVfsRpcChannel,
  createMainRpcChannel,
  type VfsRpcHostConfigExt,
  type MainRpcHostConfigExt
} from './rpc-host'

// Service implementations
export { HmrServiceImpl } from './services/hmr-service'
export { VfsServiceImpl, type VfsServiceConfig } from './services/vfs-service'

// Types (re-exported from @pubwiki/bundler)
export type {
  ProjectConfig,
  BuildError,
  BuildWarning,
  FileBuildResult,
  ProjectBuildResult,
  BundleRequest
} from '@pubwiki/bundler'

// Types (sandbox-host specific)
export type {
  // Configuration types
  VfsRpcHostConfig,
  MainRpcHostConfig,
  SandboxConnectionConfig,
  CustomServiceFactory,
  ServiceDefinition,

  // Host types
  VfsRpcHost,
  MainRpcHost,
  SandboxConnection
} from './types'

// Re-export Vfs class from @pubwiki/vfs
export { Vfs } from './types'

// Utility functions
export {
  getMimeType,
  normalizePath,
  isEntryFile,
  createBuildErrorPage,
  createSimpleErrorPage,
  MIME_TYPES
} from './utils'
