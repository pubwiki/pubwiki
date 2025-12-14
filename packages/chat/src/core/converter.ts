/**
 * Message Converter - Convert between MessageNode and ChatMessage
 * 
 * Core conversion functions for:
 * 1. MessageNode[] → ChatMessage[] (for LLM API)
 * 2. Block extraction utilities
 */

import type { MessageNode, MessageBlock, ReasoningDetail } from '../types/message'
import type { ChatMessage, ToolCall } from '../types/chat'

/**
 * Extract text content from blocks
 * 
 * Only extracts text and markdown type content.
 */
export function blocksToContent(blocks: MessageBlock[]): string {
  return blocks
    .filter(b => b.type === 'text' || b.type === 'markdown')
    .map(b => b.content)
    .join('')
}

/**
 * Extract code content from blocks
 */
export function blocksToCode(blocks: MessageBlock[]): { code: string; language?: string }[] {
  return blocks
    .filter(b => b.type === 'code')
    .map(b => {
      try {
        const data = JSON.parse(b.content)
        return { code: data.code || b.content, language: data.language }
      } catch {
        return { code: b.content }
      }
    })
}

/**
 * Convert MessageNode[] to ChatMessage[]
 * 
 * Core conversion function for internal MessageNode format to LLM API format.
 * 
 * Conversion rules:
 * 1. user/system messages: directly convert blocks → content
 * 2. assistant messages:
 *    - Extract text/markdown blocks as content
 *    - Extract tool_call blocks to generate tool_calls array
 *    - Extract tool_result blocks to generate independent tool messages
 */
export function messagesToChatMessages(messages: MessageNode[]): ChatMessage[] {
  const result: ChatMessage[] = []
  
  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'system') {
      // User/System messages: direct conversion
      const content = blocksToContent(msg.blocks)
      
      result.push({
        role: msg.role,
        content: content
      })
    } else if (msg.role === 'assistant') {
      // Assistant messages: handle tool_call and tool_result
      
      // 1. Extract text content
      const textContent = blocksToContent(msg.blocks)
      
      // 2. Extract tool_calls
      const toolCallBlocks = msg.blocks.filter(b => b.type === 'tool_call')
      const toolCalls: ToolCall[] | undefined = toolCallBlocks.length > 0
        ? toolCallBlocks.map(b => ({
            id: b.toolCallId!,
            type: 'function' as const,
            function: {
              name: b.toolName!,
              arguments: typeof b.toolArgs === 'string' 
                ? b.toolArgs 
                : JSON.stringify(b.toolArgs || {})
            }
          }))
        : undefined
      
      // 3. Add assistant message
      if (textContent || toolCalls) {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: textContent,
          tool_calls: toolCalls
        }
        
        // Add reasoning (if exists)
        if (msg.metadata?.reasoning) {
          assistantMessage.reasoning = msg.metadata.reasoning as string
        }
        if (msg.metadata?.reasoning_details && (msg.metadata.reasoning_details as ReasoningDetail[]).length > 0) {
          assistantMessage.reasoning_details = msg.metadata.reasoning_details as ReasoningDetail[]
        }
        
        result.push(assistantMessage)
      }
      
      // 4. Extract tool_result blocks and generate independent tool messages
      const toolResultBlocks = msg.blocks.filter(b => b.type === 'tool_result')
      for (const block of toolResultBlocks) {
        result.push({
          role: 'tool',
          content: typeof block.content === 'string' 
            ? block.content 
            : JSON.stringify(block.content),
          tool_call_id: block.toolCallId
        })
      }
    }
  }
  
  return result
}

/**
 * Create a user MessageNode
 */
export function createUserMessage(
  content: string,
  parentId: string | null = null
): MessageNode {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    parentId,
    role: 'user',
    blocks: [{
      id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type: 'text',
      content
    }],
    timestamp: Date.now()
  }
}

/**
 * Create a system MessageNode
 */
export function createSystemMessage(
  content: string,
  parentId: string | null = null
): MessageNode {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    parentId,
    role: 'system',
    blocks: [{
      id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type: 'text',
      content
    }],
    timestamp: Date.now()
  }
}

/**
 * Create an assistant MessageNode
 */
export function createAssistantMessage(
  content: string,
  parentId: string | null = null,
  model?: string,
  reasoning_details?: ReasoningDetail[]
): MessageNode {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    parentId,
    role: 'assistant',
    blocks: [{
      id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type: 'markdown',
      content
    }],
    timestamp: Date.now(),
    model,
    metadata: reasoning_details ? { reasoning_details } : undefined
  }
}
