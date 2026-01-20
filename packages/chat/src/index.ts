/**
 * @pubwiki/chat
 * 
 * Core chat library with function calling, streaming, and message history support.
 * 
 * @example
 * ```typescript
 * import { PubChat, MemoryMessageStore } from '@pubwiki/chat'
 * 
 * const pubchat = new PubChat({
 *   llm: {
 *     apiKey: 'sk-xxx',
 *     model: 'gpt-4',
 *   },
 *   messageStore: new MemoryMessageStore(),
 *   toolCalling: {
 *     enabled: true,
 *     maxIterations: 10
 *   }
 * })
 * 
 * // Non-streaming chat
 * const { message, historyId } = await pubchat.chat('Hello!')
 * console.log(message.blocks[0].content)
 * 
 * // Streaming chat
 * for await (const event of pubchat.streamChat('Hello!')) {
 *   if (event.type === 'token') {
 *     process.stdout.write(event.token)
 *   } else if (event.type === 'done') {
 *     console.log('History ID:', event.historyId)
 *   }
 * }
 * ```
 */

// Core exports
export { PubChat } from './core/pubchat'
export type { PubChatConfig, ChatStreamEvent, LLMConfig, ReasoningConfig, ReasoningEffort } from './core/pubchat'
export type { ChatProvider, ChatResult, ToolRegistrationParams } from './core/chat-provider'
export { ChatStreamPipeline } from './core/pipeline'
export type { StreamEvent, CompletionSummary, PipelineConfig } from './core/pipeline'
export { 
  messagesToChatMessages, 
  blocksToContent, 
  blocksToCode,
  createUserMessage,
  createSystemMessage,
  createAssistantMessage
} from './core/converter'

// Type exports
export type {
  // Message types
  MessageNode,
  MessageBlock,
  MessageBlockType,
  MessageRole,
  ConversationSnapshot,
  ReasoningDetail,
  ToolCallStatus,
  // Chat types
  ChatMessage,
  ChatResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ToolCallProgress,
  ContentPart,
  // Tool types
  ToolHandler,
  ToolRegistration,
  CustomToolDefinition
} from './types'

// Message utilities
export {
  generateBlockId,
  generateMessageId,
  createTextBlock,
  createMarkdownBlock,
  createToolCallBlock,
  createToolResultBlock,
  createReasoningBlock
} from './types/message'

// Provider types
export type {
  MessageStoreProvider,
  // Re-exported from @pubwiki/vfs
  Vfs,
  VersionedVfs,
  VfsProvider,
  VersionedVfsProvider,
  VfsFile,
  VfsFolder,
  VfsItem,
  VfsStat,
  VfsCommit,
  VfsDiff,
  VfsEventBus,
  VfsEvent,
  VfsEventType,
} from './providers'

// Re-export VFS utilities from @pubwiki/vfs
export { createVfs, isVfsFile, isVfsFolder, isVersionedProvider } from './providers'

// Store implementations
export { MemoryMessageStore } from './stores'

// LLM exports
export { LLMClient } from './llm/client'
export type { 
  LLMClientConfig, 
  ChatCompletionOptions,
  ResponseFormat,
  ResponseFormatJsonSchema,
  ResponseFormatJsonObject,
  ResponseFormatText
} from './llm/client'
export { ToolRegistry } from './llm/tools'
export type { ToolHandler as ToolRegistryHandler } from './llm/tools'

// Tool utilities
export { registerVFSTools, getVFSToolDefinitions } from './tools'
