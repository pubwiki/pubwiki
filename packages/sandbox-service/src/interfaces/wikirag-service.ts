/**
 * WikiRAG Service Interface
 *
 * Defines the RPC interface for WikiRAG operations.
 * This service runs on the main site and provides access to the
 * WikiRAG knowledge base for sandbox applications.
 *
 * Uses capnweb RpcTarget for type-safe RPC communication.
 */

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
  ChatMessage,
  WikiRAGProvider,
  LuaExecutionResult
} from "@pubwiki/sandbox-llm-client"

export type {
  ChatOptions, 
  EntityOverview, 
  EntitiesSnapshot, 
  LLMResult, 
  StageInfo,
  ChatStreamChunk,
  EntityMetadata,
  StructuredChatStreamChunk,
  ChangeEventListener,
  ChatMessage,
  LuaExecutionResult,
  WikiRAGProvider
}

/**
 * WikiRAG Service - runs on main site
 *
 * Provides access to WikiRAG knowledge base features:
 * - Chat with LLM using knowledge base context
 * - Query entities and their relationships
 * - Execute Lua scripts for data manipulation
 * - Subscribe to change events
 */
export type IWikiRAGService = WikiRAGProvider
