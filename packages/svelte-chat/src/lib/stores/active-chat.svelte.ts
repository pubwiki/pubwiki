/**
 * Active Chat Store - Svelte 5 Runes
 * 
 * Manages the active chat session state
 */

import type { UIMessageBlock } from '../types'

/**
 * Streaming message state during generation
 */
export interface StreamingMessage {
  /** Message ID */
  id: string
  /** Message role */
  role: 'assistant'
  /** Current blocks being streamed */
  blocks: UIMessageBlock[]
  /** Model used */
  model?: string
  /** Reasoning content */
  reasoning?: string
}

/**
 * Creates a reactive active chat store
 */
export function createActiveChatStore() {
  let isGenerating = $state(false)
  let abortController = $state<AbortController | null>(null)
  let firstTokenReceived = $state(false)
  let currentIteration = $state(0)
  let maxIterations = $state(10)
  let streamingMessage = $state<StreamingMessage | null>(null)
  let error = $state<string | null>(null)

  return {
    /** Whether a response is currently being generated */
    get isGenerating() { return isGenerating },
    
    /** Current abort controller for cancellation */
    get abortController() { return abortController },
    
    /** Whether the first token has been received */
    get firstTokenReceived() { return firstTokenReceived },
    
    /** Current tool call iteration count */
    get currentIteration() { return currentIteration },
    
    /** Maximum allowed iterations */
    get maxIterations() { return maxIterations },
    
    /** Current streaming message (during generation) */
    get streamingMessage() { return streamingMessage },
    
    /** Current error message */
    get error() { return error },
    
    /** Start generation */
    startGeneration() {
      isGenerating = true
      firstTokenReceived = false
      currentIteration = 0
      error = null
      abortController = new AbortController()
      streamingMessage = {
        id: `streaming-${Date.now()}`,
        role: 'assistant',
        blocks: []
      }
    },
    
    /** Mark first token received */
    markFirstTokenReceived() {
      firstTokenReceived = true
    },
    
    /** Update streaming message blocks */
    updateStreamingBlocks(blocks: UIMessageBlock[]) {
      if (streamingMessage) {
        streamingMessage = { ...streamingMessage, blocks }
      }
    },
    
    /** Update streaming message reasoning */
    updateStreamingReasoning(reasoning: string) {
      if (streamingMessage) {
        streamingMessage = { ...streamingMessage, reasoning }
      }
    },
    
    /** Update streaming message model */
    updateStreamingModel(model: string) {
      if (streamingMessage) {
        streamingMessage = { ...streamingMessage, model }
      }
    },
    
    /** Increment iteration counter */
    incrementIteration() {
      currentIteration++
    },
    
    /** Set max iterations */
    setMaxIterations(value: number) {
      maxIterations = value
    },
    
    /** Set error */
    setError(errorMessage: string | null) {
      error = errorMessage
    },
    
    /** End generation */
    endGeneration() {
      isGenerating = false
      abortController = null
      streamingMessage = null
    },
    
    /** Abort current generation */
    abort() {
      if (abortController) {
        abortController.abort()
      }
      this.endGeneration()
    },
    
    /** Reset all state */
    reset() {
      if (abortController) {
        abortController.abort()
      }
      isGenerating = false
      abortController = null
      firstTokenReceived = false
      currentIteration = 0
      maxIterations = 10
      streamingMessage = null
      error = null
    }
  }
}

/** Active chat store type */
export type ActiveChatStore = ReturnType<typeof createActiveChatStore>
