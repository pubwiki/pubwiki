/**
 * WikiRAG Client
 * 
 * Main client class that provides a convenient API for interacting with WikiRAG
 * in the sandbox environment. All entity-related methods are directly on the client,
 * no intermediate layers.
 * 
 * Event subscription is aligned with wiki-rag-lab's subscribeChange() API.
 */

import type { ChangeEventListener, WikiRAGProvider, ChatOptions, ExecuteLuaResult, LLMResult, ChatStreamChunk, EntitiesSnapshot, ChatMessage, StructuredChatStreamChunk } from './types'

/**
 * WikiRAG Client
 * 
 * Provides a flat, easy-to-use API for WikiRAG functionality.
 * All methods are directly on the client instance.
 */
export class WikiRAGClient {
  private provider: WikiRAGProvider

  constructor(provider: WikiRAGProvider) {
    this.provider = provider
  }

  // ===== Chat Methods =====

  /**
   * Multi-turn chat with history
   * 
   * @param message - User message
   * @param options - Chat options
   * 
   * @example
   * ```typescript
   * // Basic chat
   * const result = await rag.chat("Hello", { historyId: "session_1" })
   * 
   * // With all options
   * const result = await rag.chat("Hello", {
   *   historyId: "session_1",
   *   preset: "game",
   *   needSyncing: true,
   *   needCollecting: true,
   *   additionalPaths: ["/path/to/context"]
   * })
   * ```
   */
  async chat(
    message: string,
    options: ChatOptions = {}
  ): Promise<LLMResult> {
    return this.provider.chat(message, options)
  }

  /**
   * Streaming chat
   * 
   * Yields chunks as they arrive from the server.
   * Use for real-time streaming responses.
   * 
   * @param message - User message
   * @param options - Chat options
   */
  async *chatStream(
    message: string,
    options: ChatOptions = {}
  ): AsyncIterable<StructuredChatStreamChunk> {
    yield* this.provider.chatStream(message, options)
  }

  /**
   * Single query (no history)
   * 
   * @param message - User message
   * @param options - Query options (subset of ChatOptions, no historyId or needSyncing)
   * 
   * @example
   * ```typescript
   * // Basic query
   * const result = await rag.query("What is the player's status?")
   * 
   * // With options
   * const result = await rag.query("What is the player's status?", {
   *   preset: "game",
   *   needCollecting: true,
   *   additionalPaths: ["/path/to/context"]
   * })
   * ```
   */
  async query(
    message: string,
    options: ChatOptions = {}
  ): Promise<LLMResult> {
    return this.provider.query(message, options)
  }

  // ===== Entity Methods (Flat API) =====

  /**
   * Get all entities snapshot
   * 
   * Returns a complete snapshot of all entities with their metadata and components.
   * Each call fetches the latest data from the main site (no local cache).
   * 
   * @example
   * const snapshot = await rag.getEntitiesSnapshot()
   * console.log(snapshot["2"].metadata.name)
   * console.log(snapshot["2"].components.Plan)
   */
  async getEntitiesSnapshot(): Promise<EntitiesSnapshot> {
    return this.provider.getEntitiesSnapshot()
  }

  // ===== Event Subscription (aligned with wiki-rag-lab) =====

  /**
   * Subscribe to entity/component change events
   * 
   * Events are pushed from the main site, no local polling needed.
   * The listener signature matches wiki-rag-lab's subscribeChange() API.
   * 
   * @param event - Event type to subscribe to
   * @param listener - Callback function
   * @returns Unsubscribe function
   * 
   * @example
   * // Subscribe to entity additions
   * rag.subscribeChange('entity.add', (entityId, entityData) => {
   *   console.log(`New entity: ${entityId}`)
   * })
   * 
   * // Subscribe to component updates
   * rag.subscribeChange('component.update', (entityId, componentKey, newValue, oldValue) => {
   *   console.log(`${entityId}.${componentKey} changed`)
   * })
   * 
   * // Subscribe to component additions
   * rag.subscribeChange('component.add', (entityId, componentKey, value) => {
   *   console.log(`${entityId} got new component ${componentKey}`)
   * })
   */
  async subscribeChanges(listener: ChangeEventListener): Promise<() => void> {
    return await this.provider.subscribeChanges(listener)
  }

  // ===== History Management =====

  /**
   * Get chat history for a given history ID
   */
  async getHistory(historyId: string): Promise<ChatMessage[]> {
    return this.provider.getHistory(historyId)
  }

  /**
   * Set chat history (useful for restoring from save)
   */
  async setHistory(historyId: string, messages: ChatMessage[]): Promise<void> {
    return this.provider.setHistory(historyId, messages)
  }

  /**
   * Clear chat history
   */
  async clearHistory(historyId: string): Promise<void> {
    return this.provider.clearHistory(historyId)
  }

  // ===== Lua Execution =====

  /**
   * Execute Lua code in the WikiApp runtime
   * 
   * @param code - Lua code to execute
   * @returns Result and output from Lua execution
   */
  async executeLua(code: string): Promise<ExecuteLuaResult> {
    return this.provider.executeLua(code)
  }
}
