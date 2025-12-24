/**
 * SandboxClient implementation for sandbox-site
 * 
 * This implementation wraps the RPC stub and provides a clean interface
 * for user code to access sandbox services. By implementing the client here
 * in sandbox-site (same context as bootstrap), we avoid issues with RpcStub
 * not working correctly when accessed across iframes.
 */

import type { RpcStub, SandboxMainService } from '@pubwiki/sandbox-service'
import type { ISandboxClient } from '@pubwiki/sandbox-client'

/**
 * Create a proxy that wraps an RPC stub service.
 * This allows method calls to be forwarded without exposing the raw RPC stub.
 * 
 * @param rpcService - The RPC stub service to wrap
 * @returns A proxy that forwards all method calls to the underlying service
 */
function createServiceProxy(rpcService: unknown): unknown {
  if (!rpcService) {
    return undefined
  }
  
  return new Proxy({}, {
    get(_target, prop) {
      const service = rpcService as Record<string | symbol, unknown>
      const value = service[prop]
      
      // If it's a function, return a wrapper that calls it directly
      // Note: RPC stub methods may be Proxies themselves, so we can't use .apply()
      if (typeof value === 'function') {
        return (...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args)
      }
      
      // For nested properties (like nested services), create another proxy
      if (value && typeof value === 'object') {
        return createServiceProxy(value)
      }
      
      return value
    }
  })
}

/**
 * Sandbox client implementation
 * 
 * Uses the RPC stub from bootstrap and provides a type-safe interface
 * for accessing sandbox services.
 */
export class SandboxClient implements ISandboxClient {
  private session: RpcStub<SandboxMainService>
  private _basePath: string
  private _entryFile: string

  constructor(
    rpcStub: RpcStub<SandboxMainService>,
    basePath: string,
    entryFile: string
  ) {
    this.session = rpcStub
    this._basePath = basePath
    this._entryFile = entryFile
  }

  /**
   * Get the base path for this sandbox
   */
  get basePath(): string {
    return this._basePath
  }

  /**
   * Get the entry file for this sandbox
   */
  get entryFile(): string {
    return this._entryFile
  }

  /**
   * Get a custom service by ID
   * 
   * @param serviceId - The unique service identifier
   * @returns A promise that resolves to a proxy forwarding calls to the underlying RPC service
   */
  async getService(serviceId: string): Promise<unknown> {
    const rpcService = await this.session.getService(serviceId)
    return createServiceProxy(rpcService)
  }

  /**
   * List all available custom services
   * 
   * @returns Array of service IDs
   */
  async listServices(): Promise<string[]> {
    try {
      return await this.session.listServices()
    } catch {
      return []
    }
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
}
