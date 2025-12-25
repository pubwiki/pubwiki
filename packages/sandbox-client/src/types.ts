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
   * Get a custom service by ID
   * @param serviceId - The unique service identifier
   * @returns Promise resolving to service proxy, or undefined if not available
   */
  getService(serviceId: string): Promise<unknown>

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
 * Global sandbox client storage key (used by bootstrap)
 */
export const SANDBOX_CLIENT_KEY = '__sandboxClient__'
