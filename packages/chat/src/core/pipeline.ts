/**
 * Chat Stream Pipeline - Streaming chat pipeline
 * 
 * Simplified version for chat:
 * - AsyncGenerator design for immediate event yielding
 * - Directly produces MessageBlock
 * - Tool calling produces independent block events
 * - No postprocessing (handled by consumers)
 */

import { LLMClient } from '../llm/client'
import { ToolRegistry } from '../llm/tools'
import type { ChatMessage, ToolCall } from '../types/chat'
import type { MessageBlock, ToolCallStatus, ReasoningDetail } from '../types/message'

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
      organization: config.organizationId
    })
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
    
    // Tool calling loop
    let maxIterations = this.config.maxIterations ?? 10
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Stage 1: Get LLM stream
      const llmStream = this.client.streamChat({
        model: this.config.model,
        messages: currentMessages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        tools: this.config.tools?.getDefinitions(),
        signal: this.config.signal
      })
      
      let segmentContent = ''
      let segmentReasoning = ''
      let toolCalls: ToolCall[] = []
      let segmentReasoningDetails: ReasoningDetail[] = []
      
      // Accumulate raw text for MessageBlock generation
      let pendingContent = ''
      let currentMessageBlockId: string | null = null
      
      // Stage 2: Process tokens
      for await (const chunk of llmStream) {
        if (this.config.signal?.aborted) break
        
        // Process text tokens
        if (chunk.content) {
          segmentContent += chunk.content
          pendingContent += chunk.content
          
          // Yield token event immediately
          yield { type: 'token', token: chunk.content, tokenType: 'text' }
        }
        
        // Process reasoning_details
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
            
            // Accumulate reasoning details for later use
            if (detail.type === 'reasoning.encrypted' && detail.data) {
              const existingIndex = segmentReasoningDetails.findIndex(
                d => d.id === detail.id && d.type === detail.type
              )
              if (existingIndex === -1) {
                segmentReasoningDetails.push(detail)
              }
            }
          }
        }
        
        // Accumulate tool calls
        if (chunk.tool_calls) {
          toolCalls = this.mergeToolCalls(toolCalls, chunk.tool_calls)
        }
        
        // Check end
        if (chunk.finish_reason === 'stop' || chunk.finish_reason === 'tool_calls') {
          break
        }
      }
      
      // Stage 3: Segment completion cleanup
      
      // Generate MessageBlock if we have content
      if (pendingContent) {
        const messageBlock: MessageBlock = {
          id: generateBlockId(),
          type: 'markdown',
          content: pendingContent
        }
        currentMessageBlockId = messageBlock.id
        blockCount++
        yield { type: 'block', block: messageBlock }
        pendingContent = ''
      }
      
      // Yield segment complete event
      yield { type: 'segment_complete' }
      
      // Merge reasoning details
      if (segmentReasoningDetails.length > 0) {
        accumulatedReasoningDetails = [
          ...accumulatedReasoningDetails,
          ...segmentReasoningDetails
        ]
      }
      
      // Stage 4: Handle tool calls
      if (toolCalls.length === 0) break
      
      if (!this.config.tools) {
        throw new Error('Tool calls received but no tool registry configured')
      }
      
      // Add assistant message to currentMessages (for next LLM call)
      currentMessages.push({
        role: 'assistant',
        content: segmentContent,
        tool_calls: toolCalls,
        reasoning: segmentReasoning || undefined,
        reasoning_details: segmentReasoningDetails.length > 0 ? segmentReasoningDetails : undefined
      })
      
      // Execute tools
      for (const toolCall of toolCalls) {
        const { id, function: func } = toolCall
        const name = func.name
        let args: unknown
        
        try {
          args = JSON.parse(func.arguments || '{}')
        } catch {
          args = {}
        }
        
        // Create tool_call block and yield
        const toolCallBlock: MessageBlock = {
          id: generateBlockId(),
          type: 'tool_call',
          content: '',
          toolCallId: id,
          toolName: name,
          toolArgs: args,
          toolStatus: 'running'
        }
        
        yield { type: 'tool_call_start', block: toolCallBlock }
        
        try {
          const result = await this.config.tools.execute(name, args)
          toolCallCount++
          
          // Add tool result to currentMessages
          currentMessages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: id
          })
          
          // Create tool_result block and yield complete event
          const resultBlock: MessageBlock = {
            id: generateBlockId(),
            type: 'tool_result',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            toolCallId: id
          }
          
          yield {
            type: 'tool_call_complete',
            toolCallId: toolCallBlock.id,
            status: 'completed',
            resultBlock
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          
          // Add error message to currentMessages
          currentMessages.push({
            role: 'tool',
            content: `Error: ${errorMessage}`,
            tool_call_id: id
          })
          
          // Create error result block
          const errorBlock: MessageBlock = {
            id: generateBlockId(),
            type: 'tool_result',
            content: `Error: ${errorMessage}`,
            toolCallId: id
          }
          
          yield {
            type: 'tool_call_complete',
            toolCallId: toolCallBlock.id,
            status: 'error',
            resultBlock: errorBlock
          }
        }
      }
      
      // Next iteration
      iterationCount++
      
      // Check iteration limit
      if (iteration + 1 >= maxIterations && toolCalls.length > 0) {
        yield {
          type: 'iteration_limit_reached',
          currentIteration: iteration + 1,
          maxIterations: maxIterations
        }
        
        // If callback provided, ask whether to continue
        if (this.config.onIterationLimitReached) {
          try {
            const shouldContinue = await this.config.onIterationLimitReached(
              iteration + 1,
              maxIterations
            )
            
            if (shouldContinue) {
              // Continue without limit
              maxIterations = Number.MAX_SAFE_INTEGER
            } else {
              // Stop
              break
            }
          } catch {
            // On error, stop
            break
          }
        } else {
          // No callback, stop
          break
        }
      }
    }
    
    // Stage 5: Complete
    yield {
      type: 'complete',
      summary: {
        totalSegments: iterationCount,
        totalBlocks: blockCount,
        totalToolCalls: toolCallCount,
        reasoning: accumulatedReasoning || undefined,
        reasoning_details: accumulatedReasoningDetails.length > 0 ? accumulatedReasoningDetails : undefined
      }
    }
  }
  
  /**
   * Merge tool calls
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
