/**
 * @pubwiki/sandbox-client
 * 
 * Client SDK for sandbox applications to access main site services.
 * 
 * This package provides a type-safe way for sandbox iframe applications to:
 * - Access the HMR (Hot Module Replacement) service for live reloading
 * - Access custom services registered by Loader nodes
 * - Discover available services dynamically
 * 
 * Architecture:
 * - User iframe and bootstrap iframe are same-origin
 * - Bootstrap creates a SandboxClient instance and exposes it on window
 * - User code retrieves the client via initSandboxClient()
 * - No direct RPC stub access needed - everything goes through ISandboxClient
 * 
 * @example
 * ```typescript
 * import { initSandboxClient } from '@pubwiki/sandbox-client'
 * 
 * // Initialize the client (retrieves from bootstrap)
 * const client = initSandboxClient()
 * 
 * // Access built-in HMR service
 * client.hmr.subscribe((update) => {
 *   console.log('File changed:', update.path)
 * })
 * 
 * // Access custom services from Loader nodes
 * const echo = client.getService('echo')
 * if (echo) {
 *   const result = await echo.echo('Hello')
 *   console.log(result) // "Echo: Hello"
 * }
 * 
 * // List all available services
 * const services = await client.listServices()
 * console.log('Available services:', services)
 * ```
 * 
 * @packageDocumentation
 */

// Main initialization function
export { initSandboxClient, isSandboxEnvironment } from './init'

// Types
export type {
  ISandboxClient,
  InitOptions,
  UserInfo,
  ServiceMap,
  ServiceTypeEntry,
  ITypedService
} from './types'

export { SANDBOX_CLIENT_KEY } from './types'

// Re-export useful types from sandbox-service
export type { RpcStub, IHmrService, HmrUpdate } from '@pubwiki/sandbox-service'

