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
export { PubChat } from './core/pubchat';
export { ChatStreamPipeline } from './core/pipeline';
export { messagesToChatMessages, blocksToContent, blocksToCode, createUserMessage, createSystemMessage, createAssistantMessage } from './core/converter';
// Message utilities
export { generateBlockId, generateMessageId, createTextBlock, createMarkdownBlock, createToolCallBlock, createToolResultBlock, createReasoningBlock } from './types/message';
// Re-export VFS utilities from @pubwiki/vfs
export { createVfs, isVfsFile, isVfsFolder, isVersionedProvider } from './providers';
// Store implementations
export { MemoryMessageStore } from './stores';
// LLM exports
export { LLMClient } from './llm/client';
export { ToolRegistry } from './llm/tools';
// Tool utilities
export { registerVFSTools, getVFSToolDefinitions } from './tools';
//# sourceMappingURL=index.js.map