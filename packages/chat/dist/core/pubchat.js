/**
 * PubChat - Core chat class
 *
 * Main entry point for pubchat-core library.
 * Provides streaming and non-streaming chat APIs with:
 * - Message history management (immutable linked list)
 * - Function/tool calling support
 * - Branch and backtrack support
 */
import { ChatStreamPipeline } from './pipeline';
import { messagesToChatMessages, createUserMessage } from './converter';
import { ToolRegistry } from '../llm/tools';
import { z } from 'zod';
/**
 * PubChat core class
 *
 * Implements ChatProvider interface
 */
export class PubChat {
    constructor(config) {
        this.abortController = null;
        this.config = config;
        this.toolRegistry = new ToolRegistry();
    }
    /**
     * Register VFS tools
     */
    registerVFSTools(vfs) {
        // read_file tool
        this.toolRegistry.register('read_file', 'Read content from a file', z.object({
            path: z.string().describe('File path to read')
        }), async (args) => {
            const { path } = args;
            const file = await vfs.readFile(path);
            if (typeof file.content === 'string') {
                return file.content;
            }
            else if (file.content instanceof ArrayBuffer) {
                return new TextDecoder().decode(file.content);
            }
            return { error: 'File content not available' };
        });
        // write_file tool
        this.toolRegistry.register('write_file', 'Write content to a file', z.object({
            path: z.string().describe('File path to write'),
            content: z.string().describe('Content to write')
        }), async (args) => {
            const { path, content } = args;
            const exists = await vfs.exists(path);
            if (exists) {
                await vfs.updateFile(path, content);
            }
            else {
                await vfs.createFile(path, content);
            }
            return { success: true, path };
        });
        // delete_file tool
        this.toolRegistry.register('delete_file', 'Delete a file', z.object({
            path: z.string().describe('File path to delete')
        }), async (args) => {
            const { path } = args;
            await vfs.deleteFile(path);
            return { success: true, path };
        });
        // list_dir tool
        this.toolRegistry.register('list_dir', 'List contents of a directory', z.object({
            path: z.string().describe('Directory path to list')
        }), async (args) => {
            const { path } = args;
            const items = await vfs.listFolder(path);
            return items.map((item) => ({
                name: item.name,
                isDirectory: 'parentFolderId' in item && !('size' in item)
            }));
        });
        // mkdir tool
        this.toolRegistry.register('mkdir', 'Create a directory', z.object({
            path: z.string().describe('Directory path to create')
        }), async (args) => {
            const { path } = args;
            await vfs.createFolder(path);
            return { success: true, path };
        });
        // file_exists tool
        this.toolRegistry.register('file_exists', 'Check if a file or directory exists', z.object({
            path: z.string().describe('Path to check')
        }), async (args) => {
            const { path } = args;
            return { exists: await vfs.exists(path), path };
        });
    }
    /**
     * Send message (streaming)
     *
     * @param prompt User input
     * @param historyId History ID (leaf node ID of message chain), creates new conversation if not provided
     * @returns AsyncGenerator<ChatStreamEvent>
     */
    async *streamChat(prompt, historyId) {
        // Create abort controller
        this.abortController = new AbortController();
        try {
            // Get conversation history
            const conversationMessages = [];
            let parentId = null;
            if (historyId) {
                const path = await this.config.messageStore.getPath(historyId);
                conversationMessages.push(...path);
                parentId = historyId;
            }
            // Create user message
            const userMessage = createUserMessage(prompt, parentId);
            await this.config.messageStore.save(userMessage);
            conversationMessages.push(userMessage);
            parentId = userMessage.id;
            // Convert to ChatMessage format
            const chatMessages = messagesToChatMessages(conversationMessages);
            // Create pipeline
            const pipeline = new ChatStreamPipeline({
                model: this.config.llm.model,
                apiKey: this.config.llm.apiKey,
                baseUrl: this.config.llm.baseUrl,
                temperature: this.config.llm.temperature,
                maxTokens: this.config.llm.maxTokens,
                organizationId: this.config.llm.organizationId,
                tools: this.config.toolCalling?.enabled ? this.toolRegistry : undefined,
                maxIterations: this.config.toolCalling?.maxIterations ?? 10,
                onIterationLimitReached: this.config.onIterationLimitReached,
                signal: this.abortController.signal
            });
            // Collect assistant response
            const assistantBlocks = [];
            let accumulatedContent = '';
            let summary;
            // Process pipeline events
            for await (const event of pipeline.stream(chatMessages)) {
                if (this.abortController.signal.aborted) {
                    yield { type: 'error', error: new Error('Aborted') };
                    return;
                }
                switch (event.type) {
                    case 'token':
                        if (event.tokenType === 'text') {
                            accumulatedContent += event.token;
                            yield { type: 'token', token: event.token };
                        }
                        else if (event.tokenType === 'reasoning') {
                            yield { type: 'reasoning', token: event.token };
                        }
                        break;
                    case 'block':
                        assistantBlocks.push(event.block);
                        break;
                    case 'block_update':
                        // Update existing block
                        const blockToUpdate = assistantBlocks.find(b => b.id === event.blockId);
                        if (blockToUpdate && event.updates) {
                            Object.assign(blockToUpdate, event.updates);
                        }
                        break;
                    case 'tool_call_start':
                        assistantBlocks.push(event.block);
                        yield {
                            type: 'tool_call',
                            id: event.block.toolCallId,
                            name: event.block.toolName,
                            args: event.block.toolArgs
                        };
                        break;
                    case 'tool_call_complete':
                        // Update tool_call block status
                        const toolCallBlock = assistantBlocks.find(b => b.type === 'tool_call' && b.id === event.toolCallId);
                        if (toolCallBlock) {
                            toolCallBlock.toolStatus = event.status;
                        }
                        // Add tool_result block
                        assistantBlocks.push(event.resultBlock);
                        yield {
                            type: 'tool_result',
                            id: event.resultBlock.toolCallId,
                            result: event.resultBlock.content
                        };
                        break;
                    case 'iteration_limit_reached':
                        yield {
                            type: 'iteration_limit_reached',
                            currentIteration: event.currentIteration,
                            maxIterations: event.maxIterations
                        };
                        break;
                    case 'complete':
                        summary = event.summary;
                        break;
                }
            }
            // Create assistant message
            const assistantMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                parentId,
                role: 'assistant',
                blocks: assistantBlocks.length > 0 ? assistantBlocks : [{
                        id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                        type: 'markdown',
                        content: accumulatedContent
                    }],
                timestamp: Date.now(),
                model: this.config.llm.model,
                metadata: summary?.reasoning_details ? {
                    reasoning_details: summary.reasoning_details
                } : undefined
            };
            // Save assistant message
            await this.config.messageStore.save(assistantMessage);
            // Yield done event
            yield {
                type: 'done',
                message: assistantMessage,
                historyId: assistantMessage.id
            };
        }
        catch (error) {
            yield {
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
        finally {
            this.abortController = null;
        }
    }
    /**
     * Send message (non-streaming, wait for completion)
     *
     * @param prompt User input
     * @param historyId History ID
     * @returns Generated message and new history ID
     */
    async chat(prompt, historyId) {
        let result;
        for await (const event of this.streamChat(prompt, historyId)) {
            if (event.type === 'done') {
                result = {
                    message: event.message,
                    historyId: event.historyId
                };
            }
            else if (event.type === 'error') {
                throw event.error;
            }
        }
        if (!result) {
            throw new Error('Chat completed without result');
        }
        return result;
    }
    /**
     * Get conversation snapshot
     *
     * @param historyId History ID
     * @returns Complete conversation snapshot
     */
    async getConversation(historyId) {
        const messages = await this.config.messageStore.getPath(historyId);
        if (messages.length === 0) {
            throw new Error(`Conversation not found: ${historyId}`);
        }
        return {
            id: historyId,
            messages,
            rootId: messages[0].id,
            leafId: messages[messages.length - 1].id
        };
    }
    /**
     * Get all branches (children) of a message
     *
     * @param messageId Message ID
     * @returns All child messages (branches)
     */
    async getBranches(messageId) {
        return await this.config.messageStore.getChildren(messageId);
    }
    /**
     * Cancel current generation
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }
    /**
     * Register a custom tool
     */
    registerTool(tool) {
        this.toolRegistry.register(tool.name, tool.description, tool.schema, tool.handler);
    }
    /**
     * Get tool registry
     */
    getToolRegistry() {
        return this.toolRegistry;
    }
    /**
     * Get the VFS instance (if configured)
     */
    getVFS() {
        return this.vfsProvider;
    }
    /**
     * Set a new VFS instance
     * This also registers VFS tools if tool calling is enabled
     */
    setVFS(vfs) {
        this.vfsProvider = vfs;
        // Register VFS tools if tool calling is enabled
        if (this.config.toolCalling?.enabled) {
            this.registerVFSTools(vfs);
        }
    }
    /**
     * Check if VFS is available
     */
    hasVFS() {
        return this.vfsProvider !== undefined;
    }
    /**
     * Add messages to create a conversation
     * Useful for importing conversations or setting up system prompts
     *
     * @param messages Array of MessageNode to add (will auto-chain parentId)
     * @param parentId Optional parent ID for the first message
     * @returns Array of history IDs (one for each message added)
     */
    async addConversation(messages, parentId) {
        const historyIds = [];
        let currentParentId = parentId ?? null;
        for (const message of messages) {
            // Set parentId to chain messages
            const messageWithParent = {
                ...message,
                parentId: currentParentId
            };
            await this.config.messageStore.save(messageWithParent);
            historyIds.push(messageWithParent.id);
            // Next message's parent is this message
            currentParentId = messageWithParent.id;
        }
        return historyIds;
    }
    /**
     * List all root conversations
     */
    async listConversations() {
        return await this.config.messageStore.listRoots();
    }
    /**
     * Delete a conversation
     *
     * @param historyId Any message ID in the conversation
     * @param deleteAll If true, deletes entire conversation; if false, only deletes from this message
     */
    async deleteConversation(historyId, deleteAll = true) {
        if (deleteAll) {
            // Find root and delete all
            const path = await this.config.messageStore.getPath(historyId);
            if (path.length > 0) {
                await this.config.messageStore.delete(path[0].id, true);
            }
        }
        else {
            await this.config.messageStore.delete(historyId, true);
        }
    }
}
//# sourceMappingURL=pubchat.js.map