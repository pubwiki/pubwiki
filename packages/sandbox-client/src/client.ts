/**
 * Sandbox Client Implementation
 * 
 * Provides type-safe access to main site services via shared RPC stub.
 * 
 * Since user iframe and bootstrap iframe are same-origin, we directly
 * share the RPC stub reference instead of creating new MessagePort channels.
 */

import type { RpcStub, SandboxMainService, IHmrService } from '@pubwiki/sandbox-service'
import type { ISandboxClient, SandboxContext } from './types'

/**
 * Internal RPC session type extending SandboxMainService with dynamic service access
 */
type ExtendedSession = RpcStub<SandboxMainService> & Record<string, unknown>

/**
 * Sandbox client implementation
 * 
 * Uses the shared RPC stub from bootstrap iframe (same-origin sharing).
 */
export class SandboxClient implements ISandboxClient {
  private session: ExtendedSession
  private context: SandboxContext
  private serviceListCache: string[] | null = null

  constructor(context: SandboxContext) {
    this.context = context
    // Directly use the shared RPC stub from bootstrap
    this.session = context.rpcStub as ExtendedSession
  }

  /**
   * Access to the HMR service
   */
  get hmr(): RpcStub<IHmrService> {
    return this.session.hmr
  }

  /**
   * Get the base path for this sandbox
   */
  get basePath(): string {
    return this.context.basePath
  }

  /**
   * Get the entry file for this sandbox
   */
  get entryFile(): string {
    return this.context.entryFile
  }

  /**
   * Get a custom service by ID
   * 
   * @param serviceId - The unique service identifier
   * @returns Service proxy, or undefined if not available
   * 
   * @example
   * ```ts
   * const echo = client.getService('echo') as RpcStub<IEchoService>
   * if (echo) {
   *   const result = await echo.echo('Hello')
   * }
   * ```
   */
  getService(serviceId: string): unknown {
    // Services are exposed as properties on the RPC session
    return this.session[serviceId]
  }

  /**
   * List all available custom services
   * 
   * @returns Array of service IDs
   */
  async listServices(): Promise<string[]> {
    // If we have a cached list, return it
    if (this.serviceListCache !== null) {
      return this.serviceListCache
    }

    // Try to call the listServices method if available
    try {
      if (typeof this.session.listServices === 'function') {
        const services = await this.session.listServices()
        this.serviceListCache = services
        return services
      }
    } catch {
      // listServices not available, return empty array
    }

    return []
  }

  /**
   * Check if a service is available
   * 
   * @param serviceId - The service identifier to check
   */
  async hasService(serviceId: string): Promise<boolean> {
    const services = await this.listServices()
    return services.includes(serviceId)
  }

  /**
   * Clear the service list cache
   * Call this if services might have changed
   */
  clearServiceCache(): void {
    this.serviceListCache = null
  }
}
