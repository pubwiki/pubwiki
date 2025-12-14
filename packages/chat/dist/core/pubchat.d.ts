/**
 * PubChat - Core chat class
 *
 * Main entry point for pubchat-core library.
 * Provides streaming and non-streaming chat APIs with:
 * - Message history management (immutable linked list)
 * - Function/tool calling support
 * - Branch and backtrack support
 */
import { ToolRegistry } from '../llm/tools';
import type { ChatProvider, ChatResult, ToolRegistrationParams } from './chat-provider';
import type { MessageStoreProvider } from '../providers/types';
import type { Vfs } from '@pubwiki/vfs';
import type { MessageNode, ConversationSnapshot } from '../types/message';
/**
 * PubChat configuration
 */
export interface PubChatConfig {
    /** LLM configuration (OpenAI compatible API only) */
    llm: {
        apiKey: string;
        baseUrl?: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        organizationId?: string;
    };
    /** Message store provider */
    messageStore: MessageStoreProvider;
    /** Tool calling configuration */
    toolCalling?: {
        enabled: boolean;
        maxIterations?: number;
    };
    /**
     * Iteration limit callback
     * Triggered when tool calls reach maxIterations
     * @param currentIteration Current iteration count
     * @param maxIterations Max iterations
     * @returns true to continue, false to stop
     */
    onIterationLimitReached?: (currentIteration: number, maxIterations: number) => Promise<boolean>;
}
/**
 * Chat stream event
 */
export type ChatStreamEvent = {
    type: 'token';
    token: string;
} | {
    type: 'reasoning';
    token: string;
} | {
    type: 'tool_call';
    id: string;
    name: string;
    args: unknown;
} | {
    type: 'tool_result';
    id: string;
    result: unknown;
} | {
    type: 'iteration_limit_reached';
    currentIteration: number;
    maxIterations: number;
} | {
    type: 'error';
    error: Error;
} | {
    type: 'done';
    message: MessageNode;
    historyId: string;
};
/**
 * PubChat core class
 *
 * Implements ChatProvider interface
 */
export declare class PubChat implements ChatProvider {
    private config;
    private toolRegistry;
    private abortController;
    private vfsProvider;
    constructor(config: PubChatConfig);
    /**
     * Register VFS tools
     */
    private registerVFSTools;
    /**
     * Send message (streaming)
     *
     * @param prompt User input
     * @param historyId History ID (leaf node ID of message chain), creates new conversation if not provided
     * @returns AsyncGenerator<ChatStreamEvent>
     */
    streamChat(prompt: string, historyId?: string): AsyncGenerator<ChatStreamEvent>;
    /**
     * Send message (non-streaming, wait for completion)
     *
     * @param prompt User input
     * @param historyId History ID
     * @returns Generated message and new history ID
     */
    chat(prompt: string, historyId?: string): Promise<ChatResult>;
    /**
     * Get conversation snapshot
     *
     * @param historyId History ID
     * @returns Complete conversation snapshot
     */
    getConversation(historyId: string): Promise<ConversationSnapshot>;
    /**
     * Get all branches (children) of a message
     *
     * @param messageId Message ID
     * @returns All child messages (branches)
     */
    getBranches(messageId: string): Promise<MessageNode[]>;
    /**
     * Cancel current generation
     */
    abort(): void;
    /**
     * Register a custom tool
     */
    registerTool(tool: ToolRegistrationParams): void;
    /**
     * Get tool registry
     */
    getToolRegistry(): ToolRegistry;
    /**
     * Get the VFS instance (if configured)
     */
    getVFS(): Vfs | undefined;
    /**
     * Set a new VFS instance
     * This also registers VFS tools if tool calling is enabled
     */
    setVFS(vfs: Vfs): void;
    /**
     * Check if VFS is available
     */
    hasVFS(): boolean;
    /**
     * Add messages to create a conversation
     * Useful for importing conversations or setting up system prompts
     *
     * @param messages Array of MessageNode to add (will auto-chain parentId)
     * @param parentId Optional parent ID for the first message
     * @returns Array of history IDs (one for each message added)
     */
    addConversation(messages: MessageNode[], parentId?: string): Promise<string[]>;
    /**
     * List all root conversations
     */
    listConversations(): Promise<MessageNode[]>;
    /**
     * Delete a conversation
     *
     * @param historyId Any message ID in the conversation
     * @param deleteAll If true, deletes entire conversation; if false, only deletes from this message
     */
    deleteConversation(historyId: string, deleteAll?: boolean): Promise<void>;
}
//# sourceMappingURL=pubchat.d.ts.map