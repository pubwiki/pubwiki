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
 * - Bootstrap directly injects the RPC stub reference into user iframe's window
 * - No MessagePort transfer needed - simple JavaScript object sharing
 * 
 * @example
 * ```typescript
 * import { initSandboxClient } from '@pubwiki/sandbox-client'
 * 
 * // Initialize the client (retrieves injected context from bootstrap)
 * const client = await initSandboxClient()
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

// Client class for advanced usage
export { SandboxClient } from './client'

// Types
export type {
  ISandboxClient,
  SandboxContext,
  InitOptions
} from './types'

// Re-export useful types from sandbox-service
export type { RpcStub, IHmrService, HmrUpdate } from '@pubwiki/sandbox-service'
