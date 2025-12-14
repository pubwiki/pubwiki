/**
 * Mock iframe for Testing
 *
 * Simulates an iframe element for testing sandbox connection.
 */

/**
 * Stored message type
 */
export interface StoredMessage {
  message: unknown
  targetOrigin: string
  transfer: Transferable[]
}

/**
 * Mock contentWindow for iframe
 */
export interface MockContentWindow {
  postMessage: (message: unknown, targetOrigin: string, transfer?: Transferable[]) => void
  messages: StoredMessage[]
}

/**
 * Mock iframe element
 */
export interface MockIframe {
  contentWindow: MockContentWindow | null
}

/**
 * Create a mock iframe for testing
 */
export function createMockIframe(): MockIframe {
  const messages: StoredMessage[] = []
  
  const contentWindow: MockContentWindow = {
    postMessage: (message: unknown, targetOrigin: string, transfer?: Transferable[]) => {
      messages.push({ message, targetOrigin, transfer: transfer || [] })
    },
    messages
  }

  return {
    contentWindow
  }
}
