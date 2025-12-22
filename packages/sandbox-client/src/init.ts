/**
 * Sandbox Client Initialization
 * 
 * Handles the initialization of the sandbox client.
 * 
 * Since user iframe and bootstrap iframe are same-origin, the bootstrap
 * can directly inject the RPC stub reference into the user iframe's window.
 * No MessagePort transfer needed.
 */

import { SandboxClient } from './client'
import type { ISandboxClient, SandboxContext, InitOptions } from './types'

/** Global key for sandbox context storage */
const SANDBOX_CONTEXT_KEY = '__sandboxContext__'

/**
 * Initialize the sandbox client
 * 
 * This function retrieves the sandbox context that was injected by the
 * sandbox bootstrap. The context includes a shared RPC stub reference.
 * 
 * @param options - Initialization options
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
export async function initSandboxClient(options: InitOptions = {}): Promise<ISandboxClient> {
  const { timeout = 5000 } = options

  // Check if context is already available (injected by bootstrap)
  const existingContext = (window as unknown as Record<string, unknown>)[SANDBOX_CONTEXT_KEY] as SandboxContext | undefined
  if (existingContext) {
    return new SandboxClient(existingContext)
  }

  // Wait for context to be injected
  // Bootstrap will inject the context directly into window when user iframe loads
  return new Promise<ISandboxClient>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Sandbox client initialization timeout after ${timeout}ms. Make sure this code runs inside a sandbox user iframe.`))
    }, timeout)

    // Poll for context injection (bootstrap injects it synchronously when iframe loads)
    const checkInterval = setInterval(() => {
      const context = (window as unknown as Record<string, unknown>)[SANDBOX_CONTEXT_KEY] as SandboxContext | undefined
      if (context) {
        clearInterval(checkInterval)
        clearTimeout(timeoutId)
        resolve(new SandboxClient(context))
      }
    }, 50)
  })
}

/**
 * Check if the sandbox client is available
 * 
 * @returns true if running inside a sandbox with client context available
 */
export function isSandboxEnvironment(): boolean {
  return typeof (window as any).__sandboxContext__ !== 'undefined'
}
