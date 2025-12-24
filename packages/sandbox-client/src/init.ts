/**
 * Sandbox Client Initialization
 * 
 * Handles the initialization of the sandbox client.
 * 
 * Since user iframe and bootstrap iframe are same-origin, the bootstrap
 * can directly pass the RPC stub reference via postMessage.
 */

import { SandboxClient } from './client'
import type { ISandboxClient, SandboxContext, InitOptions } from './types'

/** Global key for sandbox context storage */
const SANDBOX_CONTEXT_KEY = '__sandboxContext__'

/**
 * Initialize the sandbox client
 * 
 * This function requests the sandbox context from the bootstrap iframe
 * via postMessage. The context includes a shared RPC stub reference.
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

  // Check if context is already available (from a previous request)
  const existingContext = (window as unknown as Record<string, unknown>)[SANDBOX_CONTEXT_KEY] as SandboxContext | undefined
  if (existingContext) {
    return new SandboxClient(existingContext)
  }

  // Request context from bootstrap iframe via postMessage
  return new Promise<ISandboxClient>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handleMessage)
      reject(new Error(`Sandbox client initialization timeout after ${timeout}ms. Make sure this code runs inside a sandbox user iframe.`))
    }, timeout)

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from parent (bootstrap iframe)
      if (event.source !== window.parent) {
        return
      }
      
      if (event.data?.type === 'SANDBOX_CONTEXT_RESPONSE') {
        clearTimeout(timeoutId)
        window.removeEventListener('message', handleMessage)
        
        if (event.data.error) {
          reject(new Error(`Failed to get sandbox context: ${event.data.error}`))
          return
        }
        
        const context = event.data.context as SandboxContext
        if (!context?.rpcStub) {
          reject(new Error('Invalid sandbox context: missing rpcStub'))
          return
        }
        
        // Cache context for potential reuse
        ;(window as unknown as Record<string, unknown>)[SANDBOX_CONTEXT_KEY] = context
        
        resolve(new SandboxClient(context))
      }
    }

    window.addEventListener('message', handleMessage)

    // Request context from parent (bootstrap iframe)
    window.parent.postMessage({ type: 'REQUEST_SANDBOX_CONTEXT' }, '*')
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
