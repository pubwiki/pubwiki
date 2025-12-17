/**
 * @pubwiki/svelte-chat
 * 
 * Svelte 5 chat UI components built on @pubwiki/chat core library.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { ChatUI } from '@pubwiki/svelte-chat'
 *   import { PubChat, MemoryMessageStore } from '@pubwiki/chat'
 *   
 *   const pubchat = new PubChat({
 *     llm: {
 *       apiKey: 'your-api-key',
 *       model: 'gpt-4',
 *     },
 *     messageStore: new MemoryMessageStore(),
 *   })
 * </script>
 * 
 * <ChatUI {pubchat} />
 * ```
 */

// Components
export {
  ChatUI,
  ChatInput,
  ChatMessages,
  Message,
  CHAT_CONTEXT_KEY,
  type ChatContext
} from './components'

// Block renderers
export {
  BlockRenderer,
  MarkdownBlock,
  CodeBlock,
  ToolCallBlock,
  ReasoningBlock,
  TableBlock,
  ListBlock,
  ImageBlock,
  HtmlBlock,
  CustomBlock,
  IterationLimitPrompt
} from './blocks'

// Stores
export {
  createChatInputStore,
  createActiveChatStore,
  createMessagesStore,
  type ChatInputStore,
  type ActiveChatStore,
  type MessagesStore,
  type DisplayMessage,
  type StreamingMessage
} from './stores'

// UI Types (defined in this package)
export {
  type UIMessageBlockType,
  type UIMessageBlock,
  type RenderGroup,
  type PreprocessParams,
  type PreprocessFn,
  groupBlocksForRender,
  createImageBlock,
  blocksToContent,
  blocksToCode
} from './types'

// Re-export commonly used types from @pubwiki/chat
export type {
  MessageBlock,
  MessageBlockType,
  MessageNode,
  MessageRole,
  ToolCallStatus,
  PubChat,
  PubChatConfig,
  ChatStreamEvent
} from '@pubwiki/chat'
