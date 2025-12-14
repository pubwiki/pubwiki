/**
 * ChatProvider - Core chat provider interface
 *
 * This interface defines the contract for chat providers.
 * PubChat implements this interface, and you can create your own implementations.
 */
import type { z } from 'zod';
import type { MessageNode, ConversationSnapshot } from '../types/message';
import type { ChatStreamEvent } from './pubchat';
import type { Vfs } from '@pubwiki/vfs';
import type { ToolRegistry } from '../llm/tools';
/**
 * Chat result from non-streaming chat
 */
export interface ChatResult {
    /** Generated assistant message */
    message: MessageNode;
    /** New history ID (the assistant message's ID) */
    historyId: string;
}
/**
 * Tool registration parameters
 */
export interface ToolRegistrationParams {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Zod schema for parameters */
    schema: z.ZodTypeAny;
    /** Tool handler function */
    handler: (args: unknown) => Promise<unknown>;
}
/**
 * ChatProvider interface
 *
 * Core interface for chat providers that support:
 * - Streaming and non-streaming chat
 * - Conversation history management
 * - Message branching
 * - Tool/function calling
 * - VFS (Virtual File System) integration
 */
export interface ChatProvider {
    /**
     * Send message (non-streaming, wait for completion)
     *
     * @param prompt User input
     * @param historyId History ID (leaf node ID of message chain), creates new conversation if not provided
     * @returns Generated message and new history ID
     */
    chat(prompt: string, historyId?: string): Promise<ChatResult>;
    /**
     * Send message (streaming)
     *
     * @param prompt User input
     * @param historyId History ID (leaf node ID of message chain), creates new conversation if not provided
     * @returns AsyncGenerator<ChatStreamEvent>
     */
    streamChat(prompt: string, historyId?: string): AsyncGenerator<ChatStreamEvent>;
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
    /**
     * Register a custom tool
     *
     * @param tool Tool registration parameters
     */
    registerTool(tool: ToolRegistrationParams): void;
    /**
     * Get the tool registry
     *
     * @returns ToolRegistry instance
     */
    getToolRegistry(): ToolRegistry;
    /**
     * Get the VFS instance (if configured)
     *
     * @returns Vfs instance or undefined
     */
    getVFS(): Vfs | undefined;
    /**
     * Set a new VFS instance
     * This also re-registers VFS tools if tool calling is enabled
     *
     * @param vfs Vfs instance
     */
    setVFS(vfs: Vfs): void;
    /**
     * Check if VFS is available
     *
     * @returns true if VFS provider is configured
     */
    hasVFS(): boolean;
}
//# sourceMappingURL=chat-provider.d.ts.map