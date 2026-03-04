/**
 * Chat Stream Pipeline - Streaming chat pipeline
 * 
 * Simplified version for chat:
 * - AsyncGenerator design for immediate event yielding
 * - Directly produces MessageBlock
 * - Tool calling produces independent block events
 * - No postprocessing (handled by consumers)
 */

import { LLMClient, type ResponseFormat, type ApiMode } from '../llm/client'
import { ToolRegistry } from '../llm/tools'
import type { ChatMessage, ToolCall } from '../types/chat'
import type { MessageBlock, ToolCallStatus, ReasoningDetail } from '../types/message'
import type { ReasoningConfig } from './pubchat'

/**
 * Generate block ID
 */
function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Stream event types
 */
export type StreamEvent = 
  | { type: 'token'; token: string; tokenType: 'text' | 'reasoning' }
  | { type: 'block'; block: MessageBlock }
  | { type: 'block_update'; blockId: string; updates?: Partial<MessageBlock> }
  | { type: 'tool_call_start'; block: MessageBlock }
  | { type: 'tool_call_complete'; toolCallId: string; status: ToolCallStatus; resultBlock: MessageBlock }
  | { type: 'segment_complete' }
  | { type: 'iteration_limit_reached'; currentIteration: number; maxIterations: number }
  | { type: 'complete'; summary: CompletionSummary }

/**
 * Completion summary
 */
export interface CompletionSummary {
  totalSegments: number
  totalBlocks: number
  totalToolCalls: number
  reasoning?: string
  reasoning_details?: ReasoningDetail[]
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  // LLM configuration
  model: string
  apiKey: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  organizationId?: string
  
  // Tool configuration
  tools?: ToolRegistry
  
  // Iteration limit configuration
  maxIterations?: number  // Default 10
  
  // Iteration limit callback
  onIterationLimitReached?: (currentIteration: number, maxIterations: number) => Promise<boolean>
  
  // Abort signal
  signal?: AbortSignal
  
  /**
   * Response format for structured output
   * @see https://platform.openai.com/docs/guides/structured-outputs
   */
  responseFormat?: ResponseFormat
  
  /**
   * Reasoning configuration for reasoning models
   * @see https://platform.openai.com/docs/guides/reasoning
   */
  reasoning?: ReasoningConfig
  
  /**
   * API mode to use
   * - 'chat-completions': Standard Chat Completions API (widely compatible)
   * - 'responses': OpenAI Responses API (default, for reasoning models)
   * @default 'responses'
   */
  apiMode?: ApiMode
  
  /**
   * Extra body parameters to include in the API request.
   * Useful for provider-specific parameters like OpenRouter's `provider` preferences
   * or Gemini's `safety_settings`.
   */
  extraBody?: Record<string, unknown>
}

/**
 * Tool execution result
 */
interface ToolExecutionResult {
  toolCallBlock: MessageBlock
  resultBlock: MessageBlock
  status: ToolCallStatus
  toolMessage: ChatMessage
}

/**
 * Segment result from LLM response
 */
interface SegmentResult {
  content: string
  reasoning: string
  reasoningDetails: ReasoningDetail[]
  toolCalls: ToolCall[]
}

/**
 * Chat Stream Pipeline
 * 
 * Core features:
 * 1. AsyncGenerator design, each event yields immediately
 * 2. Directly produces MessageBlock
 * 3. Tool calling produces independent block events
 */
export class ChatStreamPipeline {
  private client: LLMClient
  private config: PipelineConfig
  
  constructor(config: PipelineConfig) {
    this.config = config
    this.client = new LLMClient({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      organization: config.organizationId,
      apiMode: config.apiMode
    })
  }

  /**
   * Build LLM request options
   */
  private buildRequestOptions() {
    return {
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      tools: this.config.tools?.getDefinitions(),
      signal: this.config.signal,
      responseFormat: this.config.responseFormat,
      reasoning: this.config.reasoning,
      extraBody: this.config.extraBody
    }
  }

  /**
   * Process reasoning details and accumulate
   */
  private processReasoningDetails(
    details: ReasoningDetail[],
    accumulated: ReasoningDetail[]
  ): { reasoning: string; accumulated: ReasoningDetail[] } {
    let reasoning = ''
    const newAccumulated = [...accumulated]
    
    for (const detail of details) {
      if (detail.type === 'reasoning.text' && detail.text) {
        reasoning += detail.text
      } else if (detail.type === 'reasoning.summary' && detail.summary) {
        reasoning += detail.summary
      }
      
      if (detail.type === 'reasoning.encrypted' && detail.data) {
        const exists = newAccumulated.some(
          d => d.id === detail.id && d.type === detail.type
        )
        if (!exists) {
          newAccumulated.push(detail)
        }
      }
    }
    
    return { reasoning, accumulated: newAccumulated }
  }

  /**
   * Create content block from segment content
   */
  private createContentBlock(content: string): MessageBlock {
    return {
      id: generateBlockId(),
      type: 'markdown',
      content
    }
  }

  /**
   * Create assistant message for tool calling context
   */
  private createAssistantMessage(segment: SegmentResult): ChatMessage {
    return {
      role: 'assistant',
      content: segment.content,
      tool_calls: segment.toolCalls,
      reasoning: segment.reasoning || undefined,
      reasoning_details: segment.reasoningDetails.length > 0 ? segment.reasoningDetails : undefined
    }
  }

  /**
   * Prepare a tool call block before execution
   */
  private prepareToolCall(toolCall: ToolCall): MessageBlock {
    const { id, function: func } = toolCall
    const name = func.name
    let args: unknown
    
    try {
      args = JSON.parse(func.arguments || '{}')
    } catch {
      args = {}
    }
    
    return {
      id: generateBlockId(),
      type: 'tool_call',
      content: '',
      toolCallId: id,
      toolName: name,
      toolArgs: args,
      toolStatus: 'running'
    }
  }

  /**
   * Execute a prepared tool call
   */
  private async executeToolCall(toolCallBlock: MessageBlock): Promise<ToolExecutionResult> {
    const id = toolCallBlock.toolCallId!
    const name = toolCallBlock.toolName!
    const args = toolCallBlock.toolArgs
    
    try {
      const result = await this.config.tools!.execute(name, args)
      const resultContent = typeof result === 'string' ? result : JSON.stringify(result)
      
      toolCallBlock.toolStatus = 'completed'
      
      return {
        toolCallBlock,
        resultBlock: {
          id: generateBlockId(),
          type: 'tool_result',
          content: resultContent,
          toolCallId: id
        },
        status: 'completed',
        toolMessage: {
          role: 'tool',
          content: resultContent,
          tool_call_id: id
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorContent = `Error: ${errorMessage}`
      
      toolCallBlock.toolStatus = 'error'
      
      return {
        toolCallBlock,
        resultBlock: {
          id: generateBlockId(),
          type: 'tool_result',
          content: errorContent,
          toolCallId: id
        },
        status: 'error',
        toolMessage: {
          role: 'tool',
          content: errorContent,
          tool_call_id: id
        }
      }
    }
  }

  /**
   * Check and handle iteration limit
   * @returns new maxIterations value, or null to stop
   */
  private async checkIterationLimit(
    iteration: number,
    maxIterations: number
  ): Promise<number | null> {
    if (iteration + 1 < maxIterations) {
      return maxIterations
    }
    
    if (!this.config.onIterationLimitReached) {
      return null
    }
    
    try {
      const shouldContinue = await this.config.onIterationLimitReached(
        iteration + 1,
        maxIterations
      )
      return shouldContinue ? Number.MAX_SAFE_INTEGER : null
    } catch {
      return null
    }
  }

  /**
   * Build completion summary
   */
  private buildSummary(
    iterationCount: number,
    blockCount: number,
    toolCallCount: number,
    reasoning: string,
    reasoningDetails: ReasoningDetail[]
  ): CompletionSummary {
    return {
      totalSegments: iterationCount,
      totalBlocks: blockCount,
      totalToolCalls: toolCallCount,
      reasoning: reasoning || undefined,
      reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined
    }
  }
  
  /**
   * Execute streaming chat
   */
  async *stream(messages: ChatMessage[]): AsyncGenerator<StreamEvent> {
    let iterationCount = 0
    let blockCount = 0
    let toolCallCount = 0
    let currentMessages = [...messages]
    let accumulatedReasoning = ''
    let accumulatedReasoningDetails: ReasoningDetail[] = []
    let maxIterations = this.config.maxIterations ?? 10
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const llmStream = this.client.streamChat({
        ...this.buildRequestOptions(),
        messages: currentMessages
      })
      
      let segmentContent = ''
      let segmentReasoning = ''
      let toolCalls: ToolCall[] = []
      let segmentReasoningDetails: ReasoningDetail[] = []
      
      // Process tokens
      for await (const chunk of llmStream) {
        if (this.config.signal?.aborted) break
        
        if (chunk.content) {
          segmentContent += chunk.content
          yield { type: 'token', token: chunk.content, tokenType: 'text' }
        }
        
        if (chunk.reasoning_details && chunk.reasoning_details.length > 0) {
          for (const detail of chunk.reasoning_details) {
            if (detail.type === 'reasoning.text' && detail.text) {
              segmentReasoning += detail.text
              accumulatedReasoning += detail.text
              yield { type: 'token', token: detail.text, tokenType: 'reasoning' }
            } else if (detail.type === 'reasoning.summary' && detail.summary) {
              segmentReasoning += detail.summary
              accumulatedReasoning += detail.summary
              yield { type: 'token', token: detail.summary, tokenType: 'reasoning' }
            }
            
            if (detail.type === 'reasoning.encrypted' && detail.data) {
              const exists = segmentReasoningDetails.some(
                d => d.id === detail.id && d.type === detail.type
              )
              if (!exists) {
                segmentReasoningDetails.push(detail)
              }
            }
          }
        }
        
        if (chunk.tool_calls) {
          toolCalls = this.mergeToolCalls(toolCalls, chunk.tool_calls)
        }
        
        if (chunk.finish_reason === 'stop' || chunk.finish_reason === 'tool_calls') {
          break
        }
      }
      
      // Generate content block
      if (segmentContent) {
        const messageBlock = this.createContentBlock(segmentContent)
        blockCount++
        yield { type: 'block', block: messageBlock }
      }
      
      yield { type: 'segment_complete' }
      
      // Merge reasoning details
      if (segmentReasoningDetails.length > 0) {
        accumulatedReasoningDetails = [...accumulatedReasoningDetails, ...segmentReasoningDetails]
      }
      
      // No tool calls, done
      if (toolCalls.length === 0) break
      
      if (!this.config.tools) {
        throw new Error('Tool calls received but no tool registry configured')
      }
      
      // Add assistant message
      currentMessages.push(this.createAssistantMessage({
        content: segmentContent,
        reasoning: segmentReasoning,
        reasoningDetails: segmentReasoningDetails,
        toolCalls
      }))
      
      // Execute tools
      for (const toolCall of toolCalls) {
        // Prepare tool call block first and yield immediately (shows UI loading state)
        const toolCallBlock = this.prepareToolCall(toolCall)
        yield { type: 'tool_call_start', block: toolCallBlock }
        
        // Now execute the tool (may take a long time for execute_input, etc.)
        const result = await this.executeToolCall(toolCallBlock)
        toolCallCount++
        
        yield {
          type: 'tool_call_complete',
          toolCallId: result.toolCallBlock.id,
          status: result.status,
          resultBlock: result.resultBlock
        }
        
        currentMessages.push(result.toolMessage)

        // Notify tool: execution complete, tool message written to history
        await this.config.tools!.executeAfterHook(toolCall.function.name, currentMessages)
      }
      
      iterationCount++
      
      // Check iteration limit
      if (toolCalls.length > 0) {
        const newMax = await this.checkIterationLimit(iteration, maxIterations)
        if (newMax === null) {
          yield {
            type: 'iteration_limit_reached',
            currentIteration: iteration + 1,
            maxIterations: maxIterations
          }
          break
        }
        maxIterations = newMax
      }
    }
    
    yield {
      type: 'complete',
      summary: this.buildSummary(
        iterationCount,
        blockCount,
        toolCallCount,
        accumulatedReasoning,
        accumulatedReasoningDetails
      )
    }
  }
  
  /**
   * Execute non-streaming chat
   */
  async run(messages: ChatMessage[]): Promise<{
    blocks: MessageBlock[]
    summary: CompletionSummary
  }> {
    let iterationCount = 0
    let blockCount = 0
    let toolCallCount = 0
    let currentMessages = [...messages]
    let accumulatedReasoning = ''
    let accumulatedReasoningDetails: ReasoningDetail[] = []
    const allBlocks: MessageBlock[] = []
    let maxIterations = this.config.maxIterations ?? 10
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.client.chat({
        ...this.buildRequestOptions(),
        messages: currentMessages
      })
      
      if (this.config.signal?.aborted) break
      
      const segmentContent = response.content || ''
      const toolCalls = response.tool_calls || []
      const segmentReasoningDetails = response.reasoning_details || []
      
      // Process reasoning
      const { reasoning: segmentReasoning, accumulated } = this.processReasoningDetails(
        segmentReasoningDetails,
        accumulatedReasoningDetails
      )
      accumulatedReasoning += segmentReasoning
      accumulatedReasoningDetails = accumulated
      
      // Generate content block
      if (segmentContent) {
        allBlocks.push(this.createContentBlock(segmentContent))
        blockCount++
      }
      
      // No tool calls, done
      if (toolCalls.length === 0) break
      
      if (!this.config.tools) {
        throw new Error('Tool calls received but no tool registry configured')
      }
      
      // Add assistant message
      currentMessages.push(this.createAssistantMessage({
        content: segmentContent,
        reasoning: segmentReasoning,
        reasoningDetails: segmentReasoningDetails,
        toolCalls
      }))
      
      // Execute tools
      for (const toolCall of toolCalls) {
        const toolCallBlock = this.prepareToolCall(toolCall)
        const result = await this.executeToolCall(toolCallBlock)
        toolCallCount++
        
        allBlocks.push(result.toolCallBlock)
        allBlocks.push(result.resultBlock)
        currentMessages.push(result.toolMessage)

        // Notify tool: execution complete, tool message written to history
        await this.config.tools!.executeAfterHook(toolCall.function.name, currentMessages)
      }
      
      iterationCount++
      
      // Check iteration limit
      if (toolCalls.length > 0) {
        const newMax = await this.checkIterationLimit(iteration, maxIterations)
        if (newMax === null) break
        maxIterations = newMax
      }
    }
    
    return {
      blocks: allBlocks,
      summary: this.buildSummary(
        iterationCount,
        blockCount,
        toolCallCount,
        accumulatedReasoning,
        accumulatedReasoningDetails
      )
    }
  }
  
  /**
   * Merge tool calls (for streaming)
   */
  private mergeToolCalls(existing: ToolCall[], incoming: ToolCall[]): ToolCall[] {
    const merged = [...existing]
    
    for (const incomingCall of incoming) {
      const existingCall = merged.find(c => c.id === incomingCall.id)
      if (existingCall) {
        existingCall.function.arguments += incomingCall.function.arguments
      } else {
        merged.push({
          id: incomingCall.id,
          type: incomingCall.type,
          function: {
            name: incomingCall.function.name,
            arguments: incomingCall.function.arguments
          }
        })
      }
    }
    
    return merged
  }
}
