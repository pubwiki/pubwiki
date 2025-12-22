/**
 * Type definitions for @pubwiki/sandbox-client
 */

import type { RpcStub, SandboxMainService, IHmrService } from '@pubwiki/sandbox-service'

/**
 * Sandbox client context injected by sandbox-bootstrap
 * 
 * Since user iframe and bootstrap iframe are same-origin,
 * we can directly share the RPC stub reference instead of creating new channels.
 */
export interface SandboxContext {
  /** Shared RPC stub from bootstrap - directly usable */
  rpcStub: RpcStub<SandboxMainService>
  /** Base path within the VFS */
  basePath: string
  /** Entry file path */
  entryFile: string
}

/**
 * Options for initializing the sandbox client
 */
export interface InitOptions {
  /** Timeout in milliseconds for port injection (default: 5000) */
  timeout?: number
}

/**
 * Sandbox client interface
 */
export interface ISandboxClient {
  /**
   * Access to the HMR service
   */
  readonly hmr: RpcStub<IHmrService>

  /**
   * Get a custom service by ID
   * @param serviceId - The unique service identifier
   * @returns Service proxy, or undefined if not available
   */
  getService(serviceId: string): unknown

  /**
   * List all available custom services
   * @returns Array of service IDs
   */
  listServices(): Promise<string[]>

  /**
   * Check if a service is available
   * @param serviceId - The service identifier to check
   */
  hasService(serviceId: string): Promise<boolean>
}

/**
 * Global sandbox context storage key
 */
export const SANDBOX_CONTEXT_KEY = '__sandboxContext__'
