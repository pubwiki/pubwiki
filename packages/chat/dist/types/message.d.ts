/**
 * Message Types - Core message types for pubchat-core
 *
 * Based on Immutable Linked List model for branching support
 */
/**
 * Message block types
 */
export type MessageBlockType = 'text' | 'markdown' | 'code' | 'tool_call' | 'tool_result' | 'image' | 'reasoning';
/**
 * Tool call status
 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';
/**
 * Message block - atomic content unit
 */
export interface MessageBlock {
    /** Unique block ID */
    id: string;
    /** Block type */
    type: MessageBlockType;
    /** Block content */
    content: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
    /** Tool call ID (for tool_call and tool_result types) */
    toolCallId?: string;
    /** Tool name (for tool_call type) */
    toolName?: string;
    /** Tool arguments (for tool_call type) */
    toolArgs?: unknown;
    /** Tool call status (for tool_call type) */
    toolStatus?: ToolCallStatus;
}
/**
 * Message role
 */
export type MessageRole = 'user' | 'assistant' | 'system';
/**
 * Reasoning detail type - for models with reasoning capabilities
 */
export interface ReasoningDetail {
    type: 'reasoning.text' | 'reasoning.summary' | 'reasoning.encrypted';
    text?: string;
    summary?: string;
    data?: string;
    signature?: string;
    id?: string;
    format?: string;
    index?: number;
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
    id: string;
    /** Parent message ID (null for conversation root) */
    parentId: string | null;
    /** Message role */
    role: MessageRole;
    /** Message content blocks */
    blocks: MessageBlock[];
    /** Creation timestamp */
    timestamp: number;
    /** Model used (assistant messages only) */
    model?: string;
    /** Metadata */
    metadata?: {
        /** Reasoning content (legacy text format) */
        reasoning?: string;
        /** Reasoning details (OpenRouter format) */
        reasoning_details?: ReasoningDetail[];
        /** Custom metadata */
        [key: string]: unknown;
    };
}
/**
 * Conversation snapshot
 *
 * Represents a complete path from root to a leaf node
 */
export interface ConversationSnapshot {
    /** Snapshot ID (usually the last message's ID) */
    id: string;
    /** Message chain (from oldest to newest) */
    messages: MessageNode[];
    /** Root message ID */
    rootId: string;
    /** Leaf message ID (current conversation position) */
    leafId: string;
}
/**
 * Generate unique block ID
 */
export declare function generateBlockId(): string;
/**
 * Generate unique message ID
 */
export declare function generateMessageId(): string;
/**
 * Create a text block
 */
export declare function createTextBlock(content: string): MessageBlock;
/**
 * Create a markdown block
 */
export declare function createMarkdownBlock(content: string): MessageBlock;
/**
 * Create a tool_call block
 */
export declare function createToolCallBlock(toolCallId: string, toolName: string, toolArgs: unknown, status?: ToolCallStatus): MessageBlock;
/**
 * Create a tool_result block
 */
export declare function createToolResultBlock(toolCallId: string, content: string | unknown): MessageBlock;
/**
 * Create a reasoning block
 */
export declare function createReasoningBlock(content: string): MessageBlock;
/**
 * Extract text content from blocks
 */
export declare function blocksToContent(blocks: MessageBlock[]): string;
//# sourceMappingURL=message.d.ts.map