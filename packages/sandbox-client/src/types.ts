// ============================================================================
// Core Types (formerly from sandbox-service)
// ============================================================================

/**
 * User information for play mode
 */
export interface UserInfo {
    /** Whether the user is logged in */
    isLoggedIn: boolean
    
    /** User ID (null if not logged in) */
    userId: string | null
    
    /** Username or display name (null if not logged in) */
    username: string | null
    
    /** Save ID that the user loaded from (if loading from someone else's save) */
    sourceSaveId: string | null
    
    /** Checkpoint ID that the user loaded from */
    sourceCheckpointId: string | null
    
    /** User's own save ID (created when loading from cloud) */
    userSaveId: string | null
    
    /** User's own starting checkpoint ID */
    userCheckpointId: string | null
}

/**
 * Custom service interface for sandbox applications
 * 
 * This is the unified interface for all custom services registered by Loader nodes.
 * Services expose a generic `call` method.
 * 
 * For streaming services (x-function: true with oneOf null), use `stream()` method
 * to receive values via callback.
 */
export interface ICustomService {
    /**
     * Call the service with given inputs
     * For streaming services, use stream() instead
     * @param inputs - Key-value map matching the service's input schema
     * @returns Output values matching the service's output schema
     * @throws Error if service call fails
     */
    call(inputs: Record<string, unknown>): Promise<Record<string, unknown>>
    
    /**
     * Call a streaming service with callback
     * 
     * For services that return an iterator (x-function: true with oneOf null),
     * this method iterates over all values and invokes the callback for each.
     * 
     * @param inputs - Input parameters for the service
     * @param on - Callback invoked for each yielded value
     * @returns Promise that resolves when streaming completes
     * @throws Error if service is not a streaming service
     */
    stream?(
        inputs: Record<string, unknown>,
        on: (value: unknown) => Promise<void> | void
    ): Promise<void>
    
    /**
     * Check if this is a streaming service
     * Returns true if the service returns an iterator function
     */
    readonly isStreaming: boolean
}

// ============================================================================
// Service Type Mapping (for type-safe getService)
// ============================================================================

/**
 * Service type entry in ServiceMap
 */
export interface ServiceTypeEntry {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  streaming?: boolean;
}

/**
 * Base interface for service type mapping.
 * Users can extend this via declaration merging to get type-safe service access.
 * 
 * @example
 * ```typescript
 * // In generated services.d.ts
 * declare module '@pubwiki/sandbox-client' {
 *   interface ServiceMap {
 *     'math:calculator': {
 *       inputs: { a: number; b: number; op: string };
 *       outputs: { result: number };
 *     };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ServiceMap {
  // Empty by default, extended via declaration merging
}

/**
 * Type-safe service interface for known services
 */
export interface ITypedService<TInputs, TOutputs> {
  call(inputs: TInputs): Promise<TOutputs>;
  stream?(inputs: TInputs, on: (value: TOutputs) => void): Promise<void>;
  readonly isStreaming: boolean;
}

// Type assertion: ITypedService must be a subtype of ICustomService
// This ensures type safety when using typed services
type _AssertTypedServiceExtendsCustomService = ITypedService<
  Record<string, unknown>,
  Record<string, unknown>
> extends ICustomService ? true : never;
 
const _typeCheck: _AssertTypedServiceExtendsCustomService = true;

/**
 * Options for initializing the sandbox client
 */
export interface InitOptions {
  /** Timeout in milliseconds for port injection (default: 5000) */
  timeout?: number
}

/**
 * Sandbox client interface
 * 
 * This is the interface that user code interacts with.
 * The actual implementation is provided by sandbox-site.
 */
export interface ISandboxClient {
  /**
   * Get the base path for this sandbox
   */
  readonly basePath: string

  /**
   * Get the entry file for this sandbox
   */
  readonly entryFile: string

  /**
   * Get user information for the current play session
   * Returns null if not in play mode
   */
  readonly userInfo: UserInfo | null

  /**
   * Get a service with type inference from ServiceMap
   * 
   * When the serviceId is a known key in ServiceMap (extended via declaration merging),
   * the returned service will have properly typed call() and stream() methods.
   * 
   * For unknown service IDs, returns ITypedService with generic Record types.
   * 
   * @example
   * ```typescript
   * const calc = await client.getService('math:calculator');
   * // calc.call() expects the correct input type
   * // and returns the correct output type
   * ```
   */
  getService<K extends keyof ServiceMap>(
    serviceId: K
  ): Promise<
    ITypedService<ServiceMap[K]['inputs'], ServiceMap[K]['outputs']>
  >

  getService(
    serviceId: string
  ): Promise<
    ITypedService<Record<string, unknown>, Record<string, unknown>>
  >

  /**
   * Check if a service is available
   * @param serviceId - The service identifier to check
   */
  hasService(serviceId: string): Promise<boolean>
}

/**
 * Global sandbox client storage key (used by bootstrap)
 */
export const SANDBOX_CLIENT_KEY = '__sandboxClient__'
