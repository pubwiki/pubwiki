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
export { PubChat } from './core/pubchat';
export type { PubChatConfig, ChatStreamEvent } from './core/pubchat';
export type { ChatProvider, ChatResult, ToolRegistrationParams } from './core/chat-provider';
export { ChatStreamPipeline } from './core/pipeline';
export type { StreamEvent, CompletionSummary, PipelineConfig } from './core/pipeline';
export { messagesToChatMessages, blocksToContent, blocksToCode, createUserMessage, createSystemMessage, createAssistantMessage } from './core/converter';
export type { MessageNode, MessageBlock, MessageBlockType, MessageRole, ConversationSnapshot, ReasoningDetail, ToolCallStatus, ChatMessage, ChatResponse, StreamChunk, ToolCall, ToolDefinition, ToolCallProgress, ContentPart, ToolHandler, ToolRegistration, CustomToolDefinition } from './types';
export { generateBlockId, generateMessageId, createTextBlock, createMarkdownBlock, createToolCallBlock, createToolResultBlock, createReasoningBlock } from './types/message';
export type { MessageStoreProvider, Vfs, VersionedVfs, VfsProvider, VersionedVfsProvider, VfsFile, VfsFolder, VfsItem, VfsStat, VfsCommit, VfsDiff, VfsEventBus, VfsEvent, VfsEventType, } from './providers';
export { createVfs, isVfsFile, isVfsFolder, isVersionedProvider } from './providers';
export { MemoryMessageStore } from './stores';
export { LLMClient } from './llm/client';
export type { LLMClientConfig, ChatCompletionOptions } from './llm/client';
export { ToolRegistry } from './llm/tools';
export type { ToolHandler as ToolRegistryHandler } from './llm/tools';
export { registerVFSTools, getVFSToolDefinitions } from './tools';
//# sourceMappingURL=index.d.ts.map