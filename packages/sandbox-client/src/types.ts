import { ICustomService, ServiceDefinition, UserInfo } from "@pubwiki/sandbox-service"

// Re-export UserInfo from sandbox-service for convenience
export type { UserInfo } from "@pubwiki/sandbox-service"

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
   * @example
   * ```typescript
   * const calc = await client.getService('math:calculator');
   * // calc.call() expects the correct input type
   * // and returns the correct output type
   * ```
   */
  getService<K extends keyof ServiceMap>(
    serviceId: K
  ): Promise<ITypedService<ServiceMap[K]['inputs'], ServiceMap[K]['outputs']>>
  
  /**
   * Get a custom service by ID (fallback, no type inference)
   * @param serviceId - The unique service identifier
   * @returns Promise resolving to service proxy
   */
  getService(serviceId: string): Promise<ICustomService>

  /**
   * List all available custom service definitions
   * @returns Array of service definitions with JSON Schema
   */
  listServices(): Promise<ServiceDefinition[]>

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
