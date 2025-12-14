import { WikiRAGClient } from "../client"
import type { WikiRAGProvider } from "../types"

/**
 * This function should spawn a event listener that satisfies what initWikiRAG function expects
 * This function should be invoked in the parent window
 * @param iframe the iframe window to inject the provider into
 * @param getter the getter of WikiRAGProvider instance
 */
export async function provideWikiRag(iframe: Window, getter: () => Promise<WikiRAGProvider | null>): Promise<void> {
  // Listen for WikiRAG provider requests from iframe
  const messageHandler = async (event: MessageEvent) => {
    // Verify the message is from the target iframe
    if (event.source !== iframe) {
      return
    }
    
    // Handle WikiRAG provider request
    if (event.data?.type === 'REQUEST_WIKIRAG_PROVIDER') {
      console.log('[provideWikiRag] Received provider request from iframe')
      
      try {
        // Get the provider
        const provider = await getter()
        
        if (!provider) {
          // Send refusal if provider is not available
          iframe.postMessage({
            type: 'WIKIRAG_PROVIDER_RESPONSE',
            success: false,
            error: 'WikiRAG provider not available'
          }, '*')
          console.warn('[provideWikiRag] Provider not available, sent refusal')
          return
        }
        
        // Inject provider into iframe
        (iframe as any).__wikiRAGProvider = provider
        
        // Send confirmation to iframe
        iframe.postMessage({
          type: 'WIKIRAG_PROVIDER_RESPONSE',
          success: true
        }, '*')
        
        console.log('[provideWikiRag] Provider injected and confirmed')
      } catch (error) {
        // Send error response
        iframe.postMessage({
          type: 'WIKIRAG_PROVIDER_RESPONSE',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, '*')
        console.error('[provideWikiRag] Error providing WikiRAG:', error)
      }
    }
  }
  
  // Add event listener
  window.addEventListener('message', messageHandler)
  
  console.log('[provideWikiRag] Listener registered for iframe')
}

/**
 * Expected to be executed in iframe, it should request a wikirag provider from parent window 
 * via postmessage. The parent window will send a confirmation and then set window.__wikiRagProvider
 * The parent window can respond with an refusal, we should throw an error if that occurrs
 */ 
export async function initWikiRAG(): Promise<WikiRAGClient> {
  console.log('[initWikiRAG] Requesting WikiRAG provider from parent')
  
  // Check if provider is already injected
  if ((window as any).__wikiRAGProvider) {
    console.log('[initWikiRAG] Provider already available')
    return new WikiRAGClient((window as any).__wikiRAGProvider)
  }
  
  // Request provider from parent window
  window.parent.postMessage({
    type: 'REQUEST_WIKIRAG_PROVIDER'
  }, '*')
  
  // Wait for response
  return new Promise<WikiRAGClient>((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', messageHandler)
      reject(new Error('WikiRAG provider request timeout'))
    }, 5000) // 5 second timeout
    
    const messageHandler = (event: MessageEvent) => {
      // Only accept messages from parent
      if (event.source !== window.parent) {
        return
      }
      
      // Handle provider response
      if (event.data?.type === 'WIKIRAG_PROVIDER_RESPONSE') {
        clearTimeout(timeout)
        window.removeEventListener('message', messageHandler)
        
        if (event.data.success) {
          // Provider should now be available
          const provider = (window as any).__wikiRAGProvider
          
          if (!provider) {
            reject(new Error('Provider confirmation received but __wikiRAGProvider not found'))
            return
          }
          
          console.log('[initWikiRAG] Provider received successfully')
          resolve(new WikiRAGClient(provider))
        } else {
          // Parent refused to provide WikiRAG
          const error = event.data.error || 'Provider request refused'
          console.error('[initWikiRAG] Provider request refused:', error)
          reject(new Error(`WikiRAG not available: ${error}`))
        }
      }
    }
    
    window.addEventListener('message', messageHandler)
  })
}