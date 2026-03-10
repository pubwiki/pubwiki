/**
 * PubChat - Core chat class
 * 
 * Main entry point for pubchat-core library.
 * Provides streaming and non-streaming chat APIs with:
 * - Message history management (immutable linked list)
 * - Function/tool calling support
 * - Branch and backtrack support
 */

import { ChatStreamPipeline, type CompletionSummary } from './pipeline'
import { messagesToChatMessages, createUserMessage, createSystemMessage, createAssistantMessage } from './converter'
import { ToolRegistry } from '../llm/tools'
import type { ChatProvider, ChatResult, ToolRegistrationParams } from './chat-provider'
import type { MessageStoreProvider } from '../providers/types'
import { isVfsFolder, type Vfs, type VfsItem } from '@pubwiki/vfs'
import type { 
  MessageNode, 
  MessageBlock, 
  ConversationSnapshot,
} from '../types/message'
import { z } from 'zod'
import type { ResponseFormat, ApiMode } from '../llm/client'

/**
 * PubChat configuration
 */
export interface PubChatConfig {
  /** LLM configuration (OpenAI compatible API only) */
  llm: LLMConfig
  
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
 * Reasoning effort level for reasoning models
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Reasoning configuration for reasoning models
 */
export interface ReasoningConfig {
  /**
   * Constrains effort on reasoning for reasoning models.
   * - 'none': No reasoning (gpt-5.1 default)
   * - 'minimal', 'low', 'medium', 'high': Increasing reasoning effort
   * - 'xhigh': Only for gpt-5.1-codex-max
   */
  effort?: ReasoningEffort
  /**
   * Summary of reasoning process.
   * - 'auto': Let the model decide
   * - 'concise': Short summary
   * - 'detailed': Detailed summary
   */
  summary?: 'auto' | 'concise' | 'detailed'
}

/**
 * LLM configuration override options
 */
export interface LLMConfig {
  model?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  organizationId?: string
  /**
   * Response format for structured output
   * @see https://platform.openai.com/docs/guides/structured-outputs
   */
  responseFormat?: ResponseFormat
  /**
   * Reasoning configuration for reasoning models (gpt-5, o-series)
   * @see https://platform.openai.com/docs/guides/reasoning
   */
  reasoning?: ReasoningConfig
  /**
   * API mode to use
   * - 'chat-completions': Standard Chat Completions API (widely compatible)
   * - 'responses': OpenAI Responses API (default, for reasoning models with native reasoning token support)
   * @default 'responses'
   */
  apiMode?: ApiMode
  /**
   * Extra body parameters to include in the API request.
   * Useful for provider-specific parameters like OpenRouter's `provider` preferences
   * or Gemini's `safety_settings`.
   */
  extraBody?: Record<string, unknown>
  /**
   * Custom HTTP headers to include in API requests.
   * Useful for provider-specific authentication or routing headers.
   */
  headers?: Record<string, string>
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
          isDirectory: isVfsFolder(item)
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
   * @param overrideConfig Optional LLM configuration overrides
   * @returns AsyncGenerator<ChatStreamEvent>
   */
  async *streamChat(
    prompt: string,
    historyId?: string,
    overrideConfig?: Partial<LLMConfig>
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
      
      // Merge config with overrides
      const llmConfig = {
        model: overrideConfig?.model ?? this.config.llm.model,
        apiKey: overrideConfig?.apiKey ?? this.config.llm.apiKey,
        baseUrl: overrideConfig?.baseUrl ?? this.config.llm.baseUrl,
        temperature: overrideConfig?.temperature ?? this.config.llm.temperature,
        maxTokens: overrideConfig?.maxTokens ?? this.config.llm.maxTokens,
        organizationId: overrideConfig?.organizationId ?? this.config.llm.organizationId,
        responseFormat: overrideConfig?.responseFormat ?? this.config.llm.responseFormat,
        reasoning: overrideConfig?.reasoning ?? this.config.llm.reasoning,
        apiMode: overrideConfig?.apiMode ?? this.config.llm.apiMode,
        extraBody: overrideConfig?.extraBody ?? this.config.llm.extraBody,
      }

      if (!llmConfig.model || !llmConfig.apiKey || !llmConfig.baseUrl) {
        throw Error("Model, apiKey or baseUrl not provided")
      }
      
      // Create pipeline
      const pipeline = new ChatStreamPipeline({
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        temperature: llmConfig.temperature,
        maxTokens: llmConfig.maxTokens,
        organizationId: this.config.llm.organizationId,
        tools: this.config.toolCalling?.enabled ? this.toolRegistry : undefined,
        maxIterations: this.config.toolCalling?.maxIterations ?? 10,
        onIterationLimitReached: this.config.onIterationLimitReached,
        signal: this.abortController.signal,
        responseFormat: llmConfig.responseFormat,
        reasoning: llmConfig.reasoning,
        apiMode: llmConfig.apiMode,
        extraBody: llmConfig.extraBody,
        headers: this.config.llm.headers
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
        model: llmConfig.model,
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
   * @param overrideConfig Optional LLM configuration overrides
   * @returns Generated message and new history ID
   */
  async chat(
    prompt: string,
    historyId?: string,
    overrideConfig?: Partial<LLMConfig>
  ): Promise<ChatResult> {
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
      
      // Merge config with overrides
      const llmConfig = {
        model: overrideConfig?.model ?? this.config.llm.model,
        apiKey: overrideConfig?.apiKey ?? this.config.llm.apiKey,
        baseUrl: overrideConfig?.baseUrl ?? this.config.llm.baseUrl,
        temperature: overrideConfig?.temperature ?? this.config.llm.temperature,
        maxTokens: overrideConfig?.maxTokens ?? this.config.llm.maxTokens,
        organizationId: overrideConfig?.organizationId ?? this.config.llm.organizationId,
        responseFormat: overrideConfig?.responseFormat ?? this.config.llm.responseFormat,
        reasoning: overrideConfig?.reasoning ?? this.config.llm.reasoning,
        apiMode: overrideConfig?.apiMode ?? this.config.llm.apiMode,
        extraBody: overrideConfig?.extraBody ?? this.config.llm.extraBody,
      }

       if (!llmConfig.model || !llmConfig.apiKey || !llmConfig.baseUrl) {
        throw Error("Model, apiKey or baseUrl not provided")
      }
      
      // Create pipeline
      const pipeline = new ChatStreamPipeline({
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        temperature: llmConfig.temperature,
        maxTokens: llmConfig.maxTokens,
        organizationId: this.config.llm.organizationId,
        tools: this.config.toolCalling?.enabled ? this.toolRegistry : undefined,
        maxIterations: this.config.toolCalling?.maxIterations ?? 10,
        onIterationLimitReached: this.config.onIterationLimitReached,
        signal: this.abortController.signal,
        responseFormat: llmConfig.responseFormat,
        reasoning: llmConfig.reasoning,
        apiMode: llmConfig.apiMode,
        extraBody: llmConfig.extraBody,
        headers: this.config.llm.headers
      })
      
      // Run non-streaming pipeline
      const { blocks, summary } = await pipeline.run(chatMessages)
      
      // Create assistant message
      const assistantMessage: MessageNode = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        parentId,
        role: 'assistant',
        blocks: blocks.length > 0 ? blocks : [{
          id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          type: 'markdown',
          content: ''
        }],
        timestamp: Date.now(),
        model: llmConfig.model,
        metadata: summary?.reasoning_details ? {
          reasoning_details: summary.reasoning_details
        } : undefined
      }
      
      // Save assistant message
      await this.config.messageStore.save(assistantMessage)
      
      return {
        message: assistantMessage,
        historyId: assistantMessage.id
      }
    } finally {
      this.abortController = null
    }
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
    // Clear old VFS tools first to avoid duplicates
    if (this.vfsProvider !== undefined) {
      for (const toolName of PubChat.VFS_TOOL_NAMES) {
        this.toolRegistry.unregister(toolName)
      }
    }
    
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
   * VFS tool names that are registered when setVFS is called
   */
  private static readonly VFS_TOOL_NAMES = [
    'read_file',
    'write_file', 
    'delete_file',
    'list_dir',
    'mkdir',
    'file_exists'
  ] as const
  
  /**
   * Clear the VFS instance and unregister VFS tools
   */
  clearVFS(): void {
    this.vfsProvider = undefined
    
    // Unregister VFS tools
    for (const toolName of PubChat.VFS_TOOL_NAMES) {
      this.toolRegistry.unregister(toolName)
    }
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
