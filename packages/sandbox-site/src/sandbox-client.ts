/**
 * SandboxClient implementation for sandbox-site
 * 
 * This implementation wraps the RPC stub and provides a clean interface
 * for user code to access sandbox services. By implementing the client here
 * in sandbox-site (same context as bootstrap), we avoid issues with RpcStub
 * not working correctly when accessed across iframes.
 */

import type { ICustomService, RpcStub, SandboxMainService, ServiceDefinition } from '@pubwiki/sandbox-service'
import { RpcTarget } from '@pubwiki/sandbox-service'
import type { ISandboxClient } from '@pubwiki/sandbox-client'

/**
 * RpcTarget wrapper for stream callback
 * 
 * This wraps the user's callback function in an RpcTarget so it can be
 * passed across the RPC boundary to the host side.
 */
class StreamCallback extends RpcTarget {
  private handler: (value: unknown) => Promise<void> | void
  
  constructor(handler: (value: unknown) => Promise<void> | void) {
    super()
    this.handler = handler
  }
  
  async on(value: unknown): Promise<void> {
    await this.handler(value)
  }
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
   * @returns The ICustomService implementation via RPC
   */
  async getService(serviceId: string): Promise<ICustomService> {
    const rpcService = await this.session.getService(serviceId)
    if (!rpcService) {
      throw new Error(`Service not found: ${serviceId}`)
    }
    
    // Get isStreaming flag from the RPC service
    const isStreaming = await rpcService.isStreaming
    
    if (isStreaming) {
      // Streaming service: return implementation with stream() method
      return {
        isStreaming: true,
        
        async call(_inputs) {
          throw new Error('Streaming service must use stream() method')
        },
        
        async stream(inputs, on) {
          const input = structuredClone(inputs)
          // Create RpcTarget wrapper for the callback
          const callback = new StreamCallback(on)
          // RPC call stream, passing the callback as RpcTarget
          // The stream method is guaranteed to exist for streaming services
          await (rpcService as any).stream(input, callback)
        },
        
        async getDefinition() {
          return await rpcService.getDefinition()
        }
      }
    } else {
      // Non-streaming service: keep original implementation
      return {
        isStreaming: false,
        
        async call(inputs) {
          const input = structuredClone(inputs)
          return await rpcService.call(input)
        },
        
        async getDefinition() {
          return await rpcService.getDefinition()
        }
      }
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
