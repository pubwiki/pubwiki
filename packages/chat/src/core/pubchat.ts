/**
 * PubChat - Core chat class
 * 
 * Main entry point for pubchat-core library.
 * Provides streaming and non-streaming chat APIs with:
 * - Message history management (immutable linked list)
 * - Function/tool calling support
 * - Branch and backtrack support
 */

import { ChatStreamPipeline, StreamEvent as PipelineStreamEvent, CompletionSummary } from './pipeline'
import { messagesToChatMessages, createUserMessage, createSystemMessage, createAssistantMessage } from './converter'
import { ToolRegistry } from '../llm/tools'
import type { ChatProvider, ChatResult, ToolRegistrationParams } from './chat-provider'
import type { MessageStoreProvider } from '../providers/types'
import type { Vfs, VfsItem } from '@pubwiki/vfs'
import type { 
  MessageNode, 
  MessageBlock, 
  ConversationSnapshot,
} from '../types/message'
import { z } from 'zod'

/**
 * PubChat configuration
 */
export interface PubChatConfig {
  /** LLM configuration (OpenAI compatible API only) */
  llm: {
    apiKey: string
    baseUrl?: string  // Default OpenAI, can configure OpenRouter etc.
    model: string
    temperature?: number
    maxTokens?: number
    organizationId?: string
  }
  
  /** Message store provider */
  messageStore: MessageStoreProvider
  
  /** Tool calling configuration */
  toolCalling?: {
    enabled: boolean
    maxIterations?: number  // Default 10
  }
  
  /**
   * Iteration limit callback
   * Triggered when tool calls reach maxIterations
   * @param currentIteration Current iteration count
   * @param maxIterations Max iterations
   * @returns true to continue, false to stop
   */
  onIterationLimitReached?: (currentIteration: number, maxIterations: number) => Promise<boolean>
}

/**
 * Chat stream event
 */
export type ChatStreamEvent = 
  | { type: 'token'; token: string }
  | { type: 'reasoning'; token: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'iteration_limit_reached'; currentIteration: number; maxIterations: number }
  | { type: 'error'; error: Error }
  | { type: 'done'; message: MessageNode; historyId: string }

/**
 * PubChat core class
 * 
 * Implements ChatProvider interface
 */
export class PubChat implements ChatProvider {
  private config: PubChatConfig
  private toolRegistry: ToolRegistry
  private abortController: AbortController | null = null
  private vfsProvider: Vfs | undefined
  
  constructor(config: PubChatConfig) {
    this.config = config
    this.toolRegistry = new ToolRegistry()
  }
  
  /**
   * Register VFS tools
   */
  private registerVFSTools(vfs: Vfs): void {
    // read_file tool
    this.toolRegistry.register(
      'read_file',
      'Read content from a file',
      z.object({
        path: z.string().describe('File path to read')
      }),
      async (args: unknown) => {
        const { path } = args as { path: string }
        const file = await vfs.readFile(path)
        if (typeof file.content === 'string') {
          return file.content
        } else if (file.content instanceof ArrayBuffer) {
          return new TextDecoder().decode(file.content)
        }
        return { error: 'File content not available' }
      }
    )
    
    // write_file tool
    this.toolRegistry.register(
      'write_file',
      'Write content to a file',
      z.object({
        path: z.string().describe('File path to write'),
        content: z.string().describe('Content to write')
      }),
      async (args: unknown) => {
        const { path, content } = args as { path: string; content: string }
        const exists = await vfs.exists(path)
        if (exists) {
          await vfs.updateFile(path, content)
        } else {
          await vfs.createFile(path, content)
        }
        return { success: true, path }
      }
    )
    
    // delete_file tool
    this.toolRegistry.register(
      'delete_file',
      'Delete a file',
      z.object({
        path: z.string().describe('File path to delete')
      }),
      async (args: unknown) => {
        const { path } = args as { path: string }
        await vfs.deleteFile(path)
        return { success: true, path }
      }
    )
    
    // list_dir tool
    this.toolRegistry.register(
      'list_dir',
      'List contents of a directory',
      z.object({
        path: z.string().describe('Directory path to list')
      }),
      async (args: unknown) => {
        const { path } = args as { path: string }
        const items = await vfs.listFolder(path)
        return items.map((item: VfsItem) => ({
          name: item.name,
          isDirectory: 'parentFolderId' in item && !('size' in item)
        }))
      }
    )
    
    // mkdir tool
    this.toolRegistry.register(
      'mkdir',
      'Create a directory',
      z.object({
        path: z.string().describe('Directory path to create')
      }),
      async (args: unknown) => {
        const { path } = args as { path: string }
        await vfs.createFolder(path)
        return { success: true, path }
      }
    )
    
    // file_exists tool
    this.toolRegistry.register(
      'file_exists',
      'Check if a file or directory exists',
      z.object({
        path: z.string().describe('Path to check')
      }),
      async (args: unknown) => {
        const { path } = args as { path: string }
        return { exists: await vfs.exists(path), path }
      }
    )
  }
  
  /**
   * Send message (streaming)
   * 
   * @param prompt User input
   * @param historyId History ID (leaf node ID of message chain), creates new conversation if not provided
   * @returns AsyncGenerator<ChatStreamEvent>
   */
  async *streamChat(
    prompt: string,
    historyId?: string
  ): AsyncGenerator<ChatStreamEvent> {
    // Create abort controller
    this.abortController = new AbortController()
    
    try {
      // Get conversation history
      const conversationMessages: MessageNode[] = []
      let parentId: string | null = null
      
      if (historyId) {
        const path = await this.config.messageStore.getPath(historyId)
        conversationMessages.push(...path)
        parentId = historyId
      }
      
      // Create user message
      const userMessage = createUserMessage(prompt, parentId)
      await this.config.messageStore.save(userMessage)
      conversationMessages.push(userMessage)
      parentId = userMessage.id
      
      // Convert to ChatMessage format
      const chatMessages = messagesToChatMessages(conversationMessages)
      
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
      })
      
      // Collect assistant response
      const assistantBlocks: MessageBlock[] = []
      let accumulatedContent = ''
      let summary: CompletionSummary | undefined
      
      // Process pipeline events
      for await (const event of pipeline.stream(chatMessages)) {
        if (this.abortController.signal.aborted) {
          yield { type: 'error', error: new Error('Aborted') }
          return
        }
        
        switch (event.type) {
          case 'token':
            if (event.tokenType === 'text') {
              accumulatedContent += event.token
              yield { type: 'token', token: event.token }
            } else if (event.tokenType === 'reasoning') {
              yield { type: 'reasoning', token: event.token }
            }
            break
            
          case 'block':
            assistantBlocks.push(event.block)
            break
            
          case 'block_update':
            // Update existing block
            const blockToUpdate = assistantBlocks.find(b => b.id === event.blockId)
            if (blockToUpdate && event.updates) {
              Object.assign(blockToUpdate, event.updates)
            }
            break
            
          case 'tool_call_start':
            assistantBlocks.push(event.block)
            yield {
              type: 'tool_call',
              id: event.block.toolCallId!,
              name: event.block.toolName!,
              args: event.block.toolArgs
            }
            break
            
          case 'tool_call_complete':
            // Update tool_call block status
            const toolCallBlock = assistantBlocks.find(
              b => b.type === 'tool_call' && b.id === event.toolCallId
            )
            if (toolCallBlock) {
              toolCallBlock.toolStatus = event.status
            }
            
            // Add tool_result block
            assistantBlocks.push(event.resultBlock)
            
            yield {
              type: 'tool_result',
              id: event.resultBlock.toolCallId!,
              result: event.resultBlock.content
            }
            break
            
          case 'iteration_limit_reached':
            yield {
              type: 'iteration_limit_reached',
              currentIteration: event.currentIteration,
              maxIterations: event.maxIterations
            }
            break
            
          case 'complete':
            summary = event.summary
            break
        }
      }
      
      // Create assistant message
      const assistantMessage: MessageNode = {
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
      }
      
      // Save assistant message
      await this.config.messageStore.save(assistantMessage)
      
      // Yield done event
      yield {
        type: 'done',
        message: assistantMessage,
        historyId: assistantMessage.id
      }
      
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      }
    } finally {
      this.abortController = null
    }
  }
  
  /**
   * Send message (non-streaming, wait for completion)
   * 
   * @param prompt User input
   * @param historyId History ID
   * @returns Generated message and new history ID
   */
  async chat(
    prompt: string,
    historyId?: string
  ): Promise<ChatResult> {
    let result: ChatResult | undefined
    
    for await (const event of this.streamChat(prompt, historyId)) {
      if (event.type === 'done') {
        result = {
          message: event.message,
          historyId: event.historyId
        }
      } else if (event.type === 'error') {
        throw event.error
      }
    }
    
    if (!result) {
      throw new Error('Chat completed without result')
    }
    
    return result
  }
  
  /**
   * Get conversation snapshot
   * 
   * @param historyId History ID
   * @returns Complete conversation snapshot
   */
  async getConversation(historyId: string): Promise<ConversationSnapshot> {
    const messages = await this.config.messageStore.getPath(historyId)
    
    if (messages.length === 0) {
      throw new Error(`Conversation not found: ${historyId}`)
    }
    
    return {
      id: historyId,
      messages,
      rootId: messages[0].id,
      leafId: messages[messages.length - 1].id
    }
  }
  
  /**
   * Get all branches (children) of a message
   * 
   * @param messageId Message ID
   * @returns All child messages (branches)
   */
  async getBranches(messageId: string): Promise<MessageNode[]> {
    return await this.config.messageStore.getChildren(messageId)
  }
  
  /**
   * Cancel current generation
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }
  
  /**
   * Register a custom tool
   */
  registerTool(tool: ToolRegistrationParams): void {
    this.toolRegistry.register(
      tool.name,
      tool.description,
      tool.schema,
      tool.handler
    )
  }
  
  /**
   * Get tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry
  }
  
  /**
   * Get the VFS instance (if configured)
   */
  getVFS(): Vfs | undefined {
    return this.vfsProvider
  }
  
  /**
   * Set a new VFS instance
   * This also registers VFS tools if tool calling is enabled
   */
  setVFS(vfs: Vfs): void {
    this.vfsProvider = vfs
    
    // Register VFS tools if tool calling is enabled
    if (this.config.toolCalling?.enabled) {
      this.registerVFSTools(vfs)
    }
  }
  
  /**
   * Check if VFS is available
   */
  hasVFS(): boolean {
    return this.vfsProvider !== undefined
  }
  
  /**
   * Add messages to create a conversation
   * Useful for importing conversations or setting up system prompts
   * 
   * @param messages Array of MessageNode to add (will auto-chain parentId)
   * @param parentId Optional parent ID for the first message
   * @returns Array of history IDs (one for each message added)
   */
  async addConversation(messages: MessageNode[], parentId?: string): Promise<string[]> {
    const historyIds: string[] = []
    let currentParentId: string | null = parentId ?? null
    
    for (const message of messages) {
      // Set parentId to chain messages
      const messageWithParent: MessageNode = {
        ...message,
        parentId: currentParentId
      }
      
      await this.config.messageStore.save(messageWithParent)
      historyIds.push(messageWithParent.id)
      
      // Next message's parent is this message
      currentParentId = messageWithParent.id
    }
    
    return historyIds
  }
  
  /**
   * List all root conversations
   */
  async listConversations(): Promise<MessageNode[]> {
    return await this.config.messageStore.listRoots()
  }
  
  /**
   * Delete a conversation
   * 
   * @param historyId Any message ID in the conversation
   * @param deleteAll If true, deletes entire conversation; if false, only deletes from this message
   */
  async deleteConversation(historyId: string, deleteAll: boolean = true): Promise<void> {
    if (deleteAll) {
      // Find root and delete all
      const path = await this.config.messageStore.getPath(historyId)
      if (path.length > 0) {
        await this.config.messageStore.delete(path[0].id, true)
      }
    } else {
      await this.config.messageStore.delete(historyId, true)
    }
  }
}
