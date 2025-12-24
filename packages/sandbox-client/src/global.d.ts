/**
 * Global type declarations for sandbox environment
 */

import type { ISandboxClient } from './types'

declare global {
  interface Window {
    /**
     * Sandbox client instance exposed by bootstrap iframe.
     * Available in both bootstrap and user iframes (same-origin).
     */
    __sandboxClient__?: ISandboxClient
  }
}

export {}
