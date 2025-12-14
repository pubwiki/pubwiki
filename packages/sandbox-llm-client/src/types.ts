import type { 
  ChatOptions, 
  EntityOverview, 
  EntitiesSnapshot, 
  LLMResult, 
  StageInfo,
  ChatStreamChunk,
  StructuredChatStreamChunk,
  EntityMetadata,
  ChangeEventListener,
  ExecuteLuaResult,
  ChatMessage,
} from "@pubwiki/wiki-rag-lab"

export type {
  ChatOptions,
  EntityOverview,
  EntitiesSnapshot,
  LLMResult, 
  StageInfo,
  ChatStreamChunk,
  StructuredChatStreamChunk,
  EntityMetadata,
  ChangeEventListener,
  ExecuteLuaResult,
  ChatMessage,
}

/**
 * WikiRAG Provider Interface
 * 
 * This is the core interface that must be implemented by the provider
 * (in this case, the sandbox client that bridges to the main site).
 * 
 * NOTE: Event subscription is handled internally by WikiRAGClient.
 * The provider receives ChangeEvents via MessagePort and forwards them
 * to the client through an internal callback mechanism.
 */
export interface WikiRAGProvider {
  // ===== Chat Interfaces =====
  
  /**
   * Multi-turn chat with history
   */
  chat(
    message: string,
    options?: ChatOptions
  ): Promise<LLMResult>
  
  /**
   * Streaming chat
   */
  chatStream(
    message: string,
    options?: ChatOptions
  ): AsyncIterable<StructuredChatStreamChunk>
  
  /**
   * Single query (no history)
   */
  query(
    message: string,
    options?: ChatOptions
  ): Promise<LLMResult>
  
  // ===== Entity Interfaces =====
  
  /**
   * Get all entities snapshot (with metadata)
   */
  getEntitiesSnapshot(): Promise<EntitiesSnapshot>

  /**
   * subscribe to changes of world, returns unsubscribe handle
   */
  subscribeChanges(listener: ChangeEventListener): Promise<() => void>
  
  // ===== History Management =====
  
  /**
   * Get chat history
   */
  getHistory(historyId: string): Promise<ChatMessage[]>
  
  /**
   * Set chat history
   */
  setHistory(historyId: string, messages: ChatMessage[]): Promise<void>
  
  /**
   * Clear chat history
   */
  clearHistory(historyId: string): Promise<void>
  
  // ===== Lua Execution =====
  
  /**
   * Execute Lua code
   */
  executeLua(code: string): Promise<ExecuteLuaResult>
}
