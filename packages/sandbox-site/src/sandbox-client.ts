/**
 * SandboxClient implementation for sandbox-site
 * 
 * This implementation wraps the RPC stub and provides a clean interface
 * for user code to access sandbox services. By implementing the client here
 * in sandbox-site (same context as bootstrap), we avoid issues with RpcStub
 * not working correctly when accessed across iframes.
 */

import type { ICustomService, RpcStub, SandboxMainService, ServiceDefinition } from '@pubwiki/sandbox-service'
import type { ISandboxClient } from '@pubwiki/sandbox-client'

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
   * @returns The ICustomService implementation via RPC
   */
  async getService(serviceId: string): Promise<ICustomService> {
    const rpcService = await this.session.getService(serviceId)
    if (!rpcService) {
      throw new Error(`Service not found: ${serviceId}`)
    }
    // The RPC stub already implements ICustomService interface
    return {
      async call(inputs) {
        const input = structuredClone(inputs)
        return await rpcService.call(input)
      },
      async getDefinition() {
        return await rpcService.getDefinition()
      },
    }
  }

  /**
   * List all available custom service definitions
   * 
   * @returns Array of service definitions with JSON Schema
   */
  async listServices(): Promise<ServiceDefinition[]> {
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
    return services.some(s => s.identifier === serviceId)
  }
}
