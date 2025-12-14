/**
 * Message Types - Core message types for pubchat-core
 * 
 * Based on Immutable Linked List model for branching support
 */

/**
 * Message block types
 */
export type MessageBlockType = 
  | 'text'           // Plain text
  | 'markdown'       // Markdown content
  | 'code'           // Code block
  | 'tool_call'      // Tool call request
  | 'tool_result'    // Tool call result
  | 'image'          // Image (reserved for future)
  | 'reasoning'      // Reasoning content

/**
 * Tool call status
 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error'

/**
 * Message block - atomic content unit
 */
export interface MessageBlock {
  /** Unique block ID */
  id: string
  
  /** Block type */
  type: MessageBlockType
  
  /** Block content */
  content: string
  
  /** Additional metadata */
  metadata?: Record<string, unknown>
  
  // Tool Call specific fields
  /** Tool call ID (for tool_call and tool_result types) */
  toolCallId?: string
  
  /** Tool name (for tool_call type) */
  toolName?: string
  
  /** Tool arguments (for tool_call type) */
  toolArgs?: unknown
  
  /** Tool call status (for tool_call type) */
  toolStatus?: ToolCallStatus
}

/**
 * Message role
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Reasoning detail type - for models with reasoning capabilities
 */
export interface ReasoningDetail {
  type: 'reasoning.text' | 'reasoning.summary' | 'reasoning.encrypted'
  text?: string
  summary?: string
  data?: string
  signature?: string
  id?: string
  format?: string
  index?: number
}

/**
 * Message Node - Immutable linked list node
 * 
 * Design philosophy:
 * - Each message is an immutable node
 * - Linked via parentId to form a list structure
 * - Same parentId can have multiple children (branching)
 */
export interface MessageNode {
  /** Unique message ID */
  id: string
  
  /** Parent message ID (null for conversation root) */
  parentId: string | null
  
  /** Message role */
  role: MessageRole
  
  /** Message content blocks */
  blocks: MessageBlock[]
  
  /** Creation timestamp */
  timestamp: number
  
  /** Model used (assistant messages only) */
  model?: string
  
  /** Metadata */
  metadata?: {
    /** Reasoning content (legacy text format) */
    reasoning?: string
    /** Reasoning details (OpenRouter format) */
    reasoning_details?: ReasoningDetail[]
    /** Custom metadata */
    [key: string]: unknown
  }
}

/**
 * Conversation snapshot
 * 
 * Represents a complete path from root to a leaf node
 */
export interface ConversationSnapshot {
  /** Snapshot ID (usually the last message's ID) */
  id: string
  
  /** Message chain (from oldest to newest) */
  messages: MessageNode[]
  
  /** Root message ID */
  rootId: string
  
  /** Leaf message ID (current conversation position) */
  leafId: string
}

/**
 * Generate unique block ID
 */
export function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Create a text block
 */
export function createTextBlock(content: string): MessageBlock {
  return {
    id: generateBlockId(),
    type: 'text',
    content
  }
}

/**
 * Create a markdown block
 */
export function createMarkdownBlock(content: string): MessageBlock {
  return {
    id: generateBlockId(),
    type: 'markdown',
    content
  }
}

/**
 * Create a tool_call block
 */
export function createToolCallBlock(
  toolCallId: string,
  toolName: string,
  toolArgs: unknown,
  status: ToolCallStatus = 'running'
): MessageBlock {
  return {
    id: generateBlockId(),
    type: 'tool_call',
    content: '',
    toolCallId,
    toolName,
    toolArgs,
    toolStatus: status
  }
}

/**
 * Create a tool_result block
 */
export function createToolResultBlock(
  toolCallId: string,
  content: string | unknown
): MessageBlock {
  return {
    id: generateBlockId(),
    type: 'tool_result',
    content: typeof content === 'string' ? content : JSON.stringify(content),
    toolCallId
  }
}

/**
 * Create a reasoning block
 */
export function createReasoningBlock(content: string): MessageBlock {
  return {
    id: generateBlockId(),
    type: 'reasoning',
    content
  }
}

/**
 * Extract text content from blocks
 */
export function blocksToContent(blocks: MessageBlock[]): string {
  return blocks
    .filter(b => b.type === 'text' || b.type === 'markdown')
    .map(b => b.content)
    .join('')
}
