/**
 * SandboxClient implementation for sandbox-site
 * 
 * This implementation wraps the RPC stub and provides a clean interface
 * for user code to access sandbox services. By implementing the client here
 * in sandbox-site (same context as bootstrap), we avoid issues with RpcStub
 * not working correctly when accessed across iframes.
 */

import { ICustomService, RpcStub, SandboxMainService, UserInfo } from '@pubwiki/sandbox-service'
import { RpcTarget } from '@pubwiki/sandbox-service'
import type { ISandboxClient } from '@pubwiki/sandbox-client'

/**
 * Deep clone an object, converting functions to RpcStub instances
 * 
 * This is needed because structuredClone doesn't preserve functions,
 * but we want users to be able to pass callbacks in inputs.
 */
function cloneWithRpcStubs<T>(value: T, seen = new WeakMap()): T {
  // Primitives: return as-is
  if (value === null || typeof value !== 'object' && typeof value !== 'function') {
    return value
  }
  
  // Functions: wrap in RpcStub
  if (typeof value === 'function') {
    return new RpcStub(value as (...args: unknown[]) => unknown) as T
  }
  
  // Handle circular references
  if (typeof value === 'object' && seen.has(value)) {
    return seen.get(value)
  }
  
  // Arrays
  if (Array.isArray(value)) {
    const result: unknown[] = []
    seen.set(value, result)
    for (const item of value) {
      result.push(cloneWithRpcStubs(item, seen))
    }
    return result as T
  }
  
  // Plain objects
  const result: Record<string, unknown> = {}
  seen.set(value as object, result)
  for (const key of Object.keys(value as object)) {
    result[key] = cloneWithRpcStubs((value as Record<string, unknown>)[key], seen)
  }
  return result as T
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
  private _userInfo: UserInfo | null = null

  constructor(
    rpcStub: RpcStub<SandboxMainService>,
    basePath: string,
    entryFile: string
  ) {
    this.session = rpcStub
    this._basePath = basePath
    this._entryFile = entryFile
    
    // Parse userInfo from window.name (set by parent iframe)
    this.parseUserInfoFromWindowName()
  }

  /**
   * Parse userInfo from window.name
   * The parent page passes userInfo as JSON in the iframe's name attribute
   */
  private parseUserInfoFromWindowName(): void {
    try {
      if (window.name && window.name.startsWith('{')) {
        this._userInfo = JSON.parse(window.name) as UserInfo
      }
    } catch {
      // Invalid JSON or not in play mode
      this._userInfo = null
    }
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
   * Get user information for the current play session
   * Returns null if not in play mode or not yet loaded
   */
  get userInfo(): UserInfo | null {
    return this._userInfo
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
          const input = cloneWithRpcStubs(inputs)
          // RPC call stream, passing the callback as RpcTarget
          // The stream method is guaranteed to exist for streaming services
          // This manual construction is required to avoid some serialization errors caused by
          // different js realms on different windows
          const callback = new RpcStub(on)
          console.log("[SandboxClient] streaming service with input", input)
          await rpcService.stream!(input, callback)
        }
      }
    } else {
      // Non-streaming service: keep original implementation
      return {
        isStreaming: false,
        
        async call(inputs) {
          const input = cloneWithRpcStubs(inputs)
          return await rpcService.call(input)
        }
      }
    }
  }

  /**
   * Check if a service is available
   * 
   * @param serviceId - The service identifier to check
   */
  async hasService(serviceId: string): Promise<boolean> {
    // Try to get the service, if it exists it's available
    const service = this.session.getService(serviceId)
    return service !== undefined
  }
}
