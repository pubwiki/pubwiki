/**
 * Message Converter - Convert between MessageNode and ChatMessage
 *
 * Core conversion functions for:
 * 1. MessageNode[] → ChatMessage[] (for LLM API)
 * 2. Block extraction utilities
 */
import type { MessageNode, MessageBlock, ReasoningDetail } from '../types/message';
import type { ChatMessage } from '../types/chat';
/**
 * Extract text content from blocks
 *
 * Only extracts text and markdown type content.
 */
export declare function blocksToContent(blocks: MessageBlock[]): string;
/**
 * Extract code content from blocks
 */
export declare function blocksToCode(blocks: MessageBlock[]): {
    code: string;
    language?: string;
}[];
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
export declare function messagesToChatMessages(messages: MessageNode[]): ChatMessage[];
/**
 * Create a user MessageNode
 */
export declare function createUserMessage(content: string, parentId?: string | null): MessageNode;
/**
 * Create a system MessageNode
 */
export declare function createSystemMessage(content: string, parentId?: string | null): MessageNode;
/**
 * Create an assistant MessageNode
 */
export declare function createAssistantMessage(content: string, parentId?: string | null, model?: string, reasoning_details?: ReasoningDetail[]): MessageNode;
//# sourceMappingURL=converter.d.ts.map