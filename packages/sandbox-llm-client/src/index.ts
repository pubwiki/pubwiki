/**
 * Sandbox LLM Client
 * 
 * Public API for accessing WikiRAG from within the sandbox (user's game code).
 * This library provides a convenient interface for:
 * - Multi-turn chat conversations
 * - Entity queries and management
 * - Event-based data synchronization
 * - Lua code execution
 * 
 * @example
 * ```typescript
 * import { initWikiRAG } from 'sandbox-llm-client'
 * 
 * // Provider is injected by sandbox-client
 * const provider = (window as any).__wikiRAGProvider
 * const rag = initWikiRAG(provider)
 * 
 * // Chat with history
 * const result = await rag.chat("Tell me about the world", "session_1")
 * console.log(result.text)
 * 
 * // Streaming chat
 * for await (const chunk of rag.chatStream("Continue the story", "session_1")) {
 *   if (chunk.type === 'stream_chunk') {
 *     process(chunk.chunk)
 *   }
 * }
 * 
 * // Get entities snapshot (flat API)
 * const snapshot = await rag.getEntitiesSnapshot()
 * const protagonist = snapshot["2"]
 * console.log(protagonist.metadata.name)
 * console.log(protagonist.components.Plan)
 * 
 * // Subscribe to changes (aligned with wiki-rag-lab API)
 * rag.subscribeChange('component.update', (entityId, componentKey, newValue, oldValue) => {
 *   console.log(`${entityId}.${componentKey} changed`)
 * })
 * 
 * rag.subscribeChange('entity.add', (entityId, entityData) => {
 *   console.log(`New entity: ${entityId}`)
 * })
 * ```
 */

// Export main client
export { WikiRAGClient } from './client'
export { provideWikiRag as iframeProvideWikiRag, initWikiRAG as iframeCreateWikiRag } from './providers/iframe'

// Export all types
export type * from './types'
