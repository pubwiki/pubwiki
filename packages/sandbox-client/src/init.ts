/**
 * Sandbox Client Initialization
 * 
 * Handles the initialization of the sandbox client.
 * 
 * Since user iframe and bootstrap iframe are same-origin, we can directly
 * access the ISandboxClient instance from parent window. The bootstrap
 * creates and exposes the client instance before loading the user iframe.
 */

import type { ISandboxClient, InitOptions } from './types'
import { SANDBOX_CLIENT_KEY } from './types'

/**
 * Initialize the sandbox client
 * 
 * This function retrieves the sandbox client instance from the bootstrap iframe.
 * Since both iframes are same-origin, we can directly access parent.window.
 * The client is guaranteed to be available when the user iframe loads.
 * 
 * @param _options - Initialization options (kept for backwards compatibility)
 * @returns The sandbox client instance
 * 
 * @example
 * ```typescript
 * import { initSandboxClient } from '@pubwiki/sandbox-client'
 * 
 * const client = initSandboxClient()
 * 
 * // Access built-in services
 * client.hmr.subscribe((update) => {
 *   console.log('File changed:', update.path)
 * })
 * 
 * // Access custom services  
 * const echo = client.getService('echo')
 * if (echo) {
 *   const result = await echo.echo('Hello')
 *   console.log(result) // "Echo: Hello"
 * }
 * ```
 */
export function initSandboxClient(_options: InitOptions = {}): ISandboxClient {
  // Get client directly from parent window (same-origin access)
  // Bootstrap guarantees this is available before user iframe loads
  return getClientFromParent()
}

/**
 * Get client from parent window (same-origin access)
 * @throws Error if client is not available
 */
function getClientFromParent(): ISandboxClient {
  try {
    // Same-origin allows direct access to parent window
    const parentWindow = window.parent as unknown as Record<string, unknown>
    const client = parentWindow[SANDBOX_CLIENT_KEY] as ISandboxClient | undefined
    
    if (client) {
      return client
    }
    
    throw new Error('Sandbox client not found on parent window. Make sure this code runs inside a sandbox user iframe.')
  } catch (e) {
    if (e instanceof Error && e.message.includes('Sandbox client')) {
      throw e
    }
    // Cross-origin access would throw SecurityError
    throw new Error(`Cannot access parent window (cross-origin?): ${e}`)
  }
}

/**
 * Check if the sandbox client is available
 * 
 * @returns true if running inside a sandbox with client available
 */
export function isSandboxEnvironment(): boolean {
  try {
    const parentWindow = window.parent as unknown as Record<string, unknown>
    const client = parentWindow[SANDBOX_CLIENT_KEY] as ISandboxClient | undefined
    return !!client
  } catch {
    return false
  }
}
