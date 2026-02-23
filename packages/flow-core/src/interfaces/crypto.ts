/**
 * Crypto Provider Interface
 * 
 * Platform-independent interface for cryptographic operations.
 * Allows flow-core to work in both browser and Node.js environments.
 */

// ============================================================================
// Crypto Provider Interface
// ============================================================================

/**
 * Cryptographic operations abstraction.
 * 
 * Implementations:
 * - WebCryptoProvider (browser)
 * - NodeCryptoProvider (Node.js)
 */
export interface ICryptoProvider {
  /**
   * Generate a random UUID v4
   */
  randomUUID(): string

  /**
   * Compute SHA-256 hash of data
   * @returns Hex-encoded hash string
   */
  sha256(data: string): Promise<string>
}

// ============================================================================
// Default Implementation (Web Crypto API)
// ============================================================================

/**
 * Default crypto provider using Web Crypto API.
 * Works in browsers and modern Node.js (18+).
 */
export const WebCryptoProvider: ICryptoProvider = {
  randomUUID: () => crypto.randomUUID(),

  sha256: async (data: string): Promise<string> => {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

// Note: Node.js implementation would use require('crypto') module
// but since this package targets environments with Web Crypto API support,
// we only provide the web implementation here.
