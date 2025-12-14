/**
 * Message Types - Core message types for pubchat-core
 *
 * Based on Immutable Linked List model for branching support
 */
/**
 * Generate unique block ID
 */
export function generateBlockId() {
    return `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
/**
 * Generate unique message ID
 */
export function generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
/**
 * Create a text block
 */
export function createTextBlock(content) {
    return {
        id: generateBlockId(),
        type: 'text',
        content
    };
}
/**
 * Create a markdown block
 */
export function createMarkdownBlock(content) {
    return {
        id: generateBlockId(),
        type: 'markdown',
        content
    };
}
/**
 * Create a tool_call block
 */
export function createToolCallBlock(toolCallId, toolName, toolArgs, status = 'running') {
    return {
        id: generateBlockId(),
        type: 'tool_call',
        content: '',
        toolCallId,
        toolName,
        toolArgs,
        toolStatus: status
    };
}
/**
 * Create a tool_result block
 */
export function createToolResultBlock(toolCallId, content) {
    return {
        id: generateBlockId(),
        type: 'tool_result',
        content: typeof content === 'string' ? content : JSON.stringify(content),
        toolCallId
    };
}
/**
 * Create a reasoning block
 */
export function createReasoningBlock(content) {
    return {
        id: generateBlockId(),
        type: 'reasoning',
        content
    };
}
/**
 * Extract text content from blocks
 */
export function blocksToContent(blocks) {
    return blocks
        .filter(b => b.type === 'text' || b.type === 'markdown')
        .map(b => b.content)
        .join('');
}
//# sourceMappingURL=message.js.map