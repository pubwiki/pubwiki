/**
 * LLM Module for Loader Backend
 * 
 * Provides LLM access to Lua/TypeScript backends via PubChat.
 */

import { PubChat, MemoryMessageStore, type LLMConfig, type MessageStoreProvider, type MessageNode } from '@pubwiki/chat'
import type { RDFStore } from '@pubwiki/rdfstore'
import type { JsModuleDefinition } from '../../types'
import { RDFMessageStore, CHAT_HISTORY_GRAPH_URI } from './rdf-store'

export { RDFMessageStore, CHAT_HISTORY_GRAPH_URI }

// ============================================================================
// Types
// ============================================================================

export interface LLMModuleConfig {
  llmConfig: LLMConfig
  rdfStore?: RDFStore
}

// ============================================================================
// Module Factory
// ============================================================================

/**
 * Create PubChat instance with appropriate message store
 * Returns both the PubChat instance and the message store for use in LLM module
 */
export function createPubChat(config: LLMModuleConfig): { 
  pubchat: PubChat
  messageStore: MessageStoreProvider 
} {
  const { llmConfig, rdfStore } = config
  
  const messageStore = rdfStore
    ? new RDFMessageStore(rdfStore, CHAT_HISTORY_GRAPH_URI)
    : new MemoryMessageStore()
  
  const pubchat = new PubChat({
    llm: llmConfig,
    messageStore,
    toolCalling: { enabled: false }
  })
  
  return { pubchat, messageStore }
}

/**
 * Create a JS module definition for LLM access
 */
export function createLLMModule(
  pubchat: PubChat, 
  store: MessageStoreProvider
): JsModuleDefinition {
  return {
    /**
     * Non-streaming chat
     */
    async chat(...args: unknown[]) {
      const [prompt, historyId, overrideConfig] = args as [string, string?, Partial<LLMConfig>?]
      const result = await pubchat.chat(prompt, historyId, overrideConfig)
      const content = result.message.blocks
        .filter(b => b.type === 'markdown' || b.type === 'text')
        .map(b => b.content)
        .join('')
      return {
        content,
        historyId: result.historyId
      }
    },
    
    /**
     * Streaming chat
     */
    stream(...args: unknown[]) {
      const [prompt, historyId, overrideConfig] = args as [string, string?, Partial<LLMConfig>?]
      return pubchat.streamChat(prompt, historyId, overrideConfig)
    },
    
    /**
     * Abort current generation
     */
    abort() {
      pubchat.abort()
    },
    
    // ========== History Operations ==========
    
    /**
     * Get a message by ID
     * @param id - Message ID
     * @returns MessageNode or null
     */
    async getMessage(id: string) {
      return store.get(id)
    },
    
    /**
     * Add a message manually
     * @param content - Message content
     * @param role - Message role: 'user' | 'assistant' | 'system'
     * @param parentId - Parent message ID (null for root)
     * @returns The created message
     */
    async addMessage(content: string, role: string, parentId?: unknown) {
      // Normalize parentId - Lua nil may come as object or undefined
      const normalizedParentId = (parentId == null || typeof parentId !== 'string') 
        ? null 
        : parentId
      
      const node: MessageNode = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        parentId: normalizedParentId,
        role: role as 'user' | 'assistant' | 'system',
        blocks: [{ id: `block-${Date.now()}`, type: 'text', content }],
        timestamp: Date.now()
      }
      await store.save(node)
      return node.id
    },
    
    /**
     * List all chat roots (conversation starting points)
     * @returns Array of root MessageNodes
     */
    async listChats() {
      return store.listRoots()
    },
    
    /**
     * List all messages in a chat (from root to leaves)
     * @param rootId - Root message ID
     * @returns Array of MessageNodes in chronological order
     */
    async listMessages(rootId: string) {
      const result: MessageNode[] = []
      const queue = [rootId]
      
      while (queue.length > 0) {
        const id = queue.shift()!
        const node = await store.get(id)
        if (node) {
          result.push(node)
          const children = await store.getChildren(id)
          queue.push(...children.map(c => c.id))
        }
      }
      
      return result.sort((a, b) => a.timestamp - b.timestamp)
    },
    
    /**
     * Delete a single message (and its descendants)
     * @param id - Message ID to delete
     */
    async deleteMessage(id: string) {
      return store.delete(id, true)
    },
    
    /**
     * Delete an entire chat (root and all descendants)
     * @param rootId - Root message ID
     */
    async deleteChat(rootId: string) {
      return store.delete(rootId, true)
    }
  }
}
