/**
 * Sandbox Client Initialization
 * 
 * Handles the initialization of the sandbox client.
 * 
 * Since user iframe and bootstrap iframe are same-origin, we can directly
 * access the RPC stub reference from parent window. The bootstrap guarantees
 * that the context is exposed before the user iframe is loaded.
 */

import { SandboxClient } from './client'
import type { ISandboxClient, SandboxContext, InitOptions } from './types'

/** Key used by bootstrap to expose context */
const BOOTSTRAP_CONTEXT_KEY = '__sandboxContextForClient__'

/**
 * Initialize the sandbox client
 * 
 * This function retrieves the sandbox context from the bootstrap iframe.
 * Since both iframes are same-origin, we can directly access parent.window.
 * The context is guaranteed to be available when the user iframe loads.
 * 
 * @param _options - Initialization options (kept for backwards compatibility)
 * @returns A promise that resolves to the sandbox client
 * 
 * @example
 * ```typescript
 * import { initSandboxClient } from '@pubwiki/sandbox-client'
 * 
 * const client = await initSandboxClient()
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
export async function initSandboxClient(_options: InitOptions = {}): Promise<ISandboxClient> {
  // Get context directly from parent window (same-origin access)
  // Bootstrap guarantees this is available before user iframe loads
  const context = getContextFromParent()
  return new SandboxClient(context)
}

/**
 * Get context from parent window (same-origin access)
 * @throws Error if context is not available
 */
function getContextFromParent(): SandboxContext {
  try {
    // Same-origin allows direct access to parent window
    const parentWindow = window.parent as unknown as Record<string, unknown>
    const context = parentWindow[BOOTSTRAP_CONTEXT_KEY] as SandboxContext | undefined
    
    if (context?.rpcStub) {
      return context
    }
    
    throw new Error('Sandbox context not found on parent window. Make sure this code runs inside a sandbox user iframe.')
  } catch (e) {
    if (e instanceof Error && e.message.includes('Sandbox context')) {
      throw e
    }
    // Cross-origin access would throw SecurityError
    throw new Error(`Cannot access parent window (cross-origin?): ${e}`)
  }
}

/**
 * Check if the sandbox client is available
 * 
 * @returns true if running inside a sandbox with client context available
 */
export function isSandboxEnvironment(): boolean {
  try {
    const parentWindow = window.parent as unknown as Record<string, unknown>
    const context = parentWindow[BOOTSTRAP_CONTEXT_KEY] as SandboxContext | undefined
    return !!context?.rpcStub
  } catch {
    return false
  }
}
