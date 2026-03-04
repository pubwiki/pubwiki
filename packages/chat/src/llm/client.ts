/**
 * LLM Client - OpenAI API client supporting both Responses API and Chat Completions API
 * 
 * Simplified version for pubchat-core, supporting:
 * - OpenAI compatible APIs (Chat Completions API - widely supported)
 * - OpenAI native Responses API (for reasoning models)
 * - Streaming and non-streaming chat
 * - Function/tool calling
 * - Reasoning tokens (Claude, Gemini, etc.)
 */

import OpenAI from 'openai'
import type { 
  ResponseCreateParamsStreaming, 
  ResponseCreateParamsNonStreaming,
  ResponseStreamEvent,
  Tool as OpenAITool,
  EasyInputMessage,
  ResponseInputItem,
  ResponseReasoningItem,
  ResponseFunctionToolCallItem
} from 'openai/resources/responses/responses'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletion
} from 'openai/resources/chat/completions'
import type {
  ChatMessage,
  StreamChunk,
  ChatResponse,
  ToolDefinition,
  ToolCall,
  ReasoningDetail
} from '../types'

/**
 * API mode for LLM client
 * - 'chat-completions': Standard Chat Completions API (widely compatible with OpenRouter, Azure, Ollama, etc.)
 * - 'responses': OpenAI Responses API (native support for reasoning tokens, only OpenAI)
 */
export type ApiMode = 'chat-completions' | 'responses'

export interface LLMClientConfig {
  apiKey: string
  baseURL?: string
  organization?: string
  defaultHeaders?: Record<string, string>
  /**
   * API mode to use
   * - 'chat-completions': Standard Chat Completions API (widely compatible)
   * - 'responses': OpenAI Responses API (default, for reasoning models)
   * @default 'responses'
   */
  apiMode?: ApiMode
}

/**
 * JSON Schema for structured output
 * @see https://platform.openai.com/docs/guides/structured-outputs
 */
export interface ResponseFormatJsonSchema {
  type: 'json_schema'
  json_schema: {
    name: string
    description?: string
    schema: Record<string, unknown>  // JSON Schema object
    strict?: boolean
  }
}

/**
 * JSON object format (basic JSON mode)
 */
export interface ResponseFormatJsonObject {
  type: 'json_object'
}

/**
 * Text format (default)
 */
export interface ResponseFormatText {
  type: 'text'
}

/**
 * Response format types for structured output
 */
export type ResponseFormat = ResponseFormatJsonSchema | ResponseFormatJsonObject | ResponseFormatText

/**
 * Reasoning effort level for reasoning models
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Reasoning configuration for reasoning models
 */
export interface ReasoningConfig {
  effort?: ReasoningEffort
  summary?: 'auto' | 'concise' | 'detailed'
}

export interface ChatCompletionOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  tools?: ToolDefinition[]
  tool_choice?: 'none' | 'auto' | 'required'
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
   * Extra body parameters to include in the API request.
   * Useful for provider-specific parameters like OpenRouter's `provider` preferences
   * or Gemini's `safety_settings`.
   * These are merged into the request body as-is.
   */
  extraBody?: Record<string, unknown>
}

/**
 * Extended function call input item
 */
interface FunctionCallInputItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

/**
 * Extended function call output item
 */
interface FunctionCallOutputItemExtended extends ResponseFunctionToolCallItem {
  // Inherits from ResponseFunctionToolCallItem
}

/**
 * Extended reasoning item supporting multiple formats
 */
interface ExtendedReasoningItem {
  type: 'reasoning'
  id: string
  summary?: Array<{ type: string; text: string }>
  content?: Array<{ type: string; text: string }>
  encrypted_content?: string
  format?: string
}

/**
 * Type guard for reasoning item
 */
function isReasoningItem(item: unknown): item is ExtendedReasoningItem {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  return obj.type === 'reasoning' && typeof obj.id === 'string'
}

/**
 * Type guard for function call
 */
function isFunctionCall(item: unknown): item is FunctionCallOutputItemExtended {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  return obj.type === 'function_call'
}

/**
 * Build EasyInputMessage
 */
function buildEasyInputMessage(
  role: 'user' | 'assistant' | 'system' | 'developer',
  content: string
): EasyInputMessage {
  return { role, content }
}

/**
 * Get string content from ChatMessage
 */
function getStringContent(msg: ChatMessage): string {
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map(part => part.text || '')
      .join('')
  }
  return msg.content
}

/**
 * LLM Client - Supporting both Chat Completions API and Responses API
 */
export class LLMClient {
  private client: OpenAI
  private apiMode: ApiMode

  constructor(config: LLMClientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      defaultHeaders: config.defaultHeaders,
      dangerouslyAllowBrowser: true
    })
    this.apiMode = config.apiMode ?? 'responses'
  }

  /**
   * Streaming chat completion - dispatches to appropriate API
   */
  async *streamChat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    if (this.apiMode === 'responses') {
      yield* this.streamChatResponses(options)
    } else {
      yield* this.streamChatCompletions(options)
    }
  }

  /**
   * Chat Completions API - Streaming implementation
   * Compatible with OpenRouter, Azure, Ollama, and other OpenAI-compatible providers
   */
  private async *streamChatCompletions(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const messages = this.convertToChatCompletionMessages(options.messages)
    const tools = this.convertToChatCompletionTools(options.tools)

    const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: options.model,
      messages,
      temperature: options.temperature ?? undefined,
      max_tokens: options.max_tokens ?? undefined,
      tools: tools,
      tool_choice: options.tool_choice,
      stream: true,
      ...(options.responseFormat && { response_format: this.convertResponseFormat(options.responseFormat) }),
      ...(options.extraBody),
    }

    let stream: AsyncIterable<ChatCompletionChunk>
    try {
      stream = await this.client.chat.completions.create(params, {
        signal: options.signal
      })
    } catch (error: unknown) {
      if (error && typeof error === 'object') {
        const err = error as { status?: number; message?: string; error?: unknown; body?: unknown }
        console.error('[LLMClient] Chat Completions API Error:', {
          status: err.status,
          message: err.message,
          error: err.error,
          body: err.body
        })
      }
      throw error
    }

    const currentToolCalls: Map<number, ToolCall> = new Map()

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue

      const delta = choice.delta

      // Text content
      if (delta.content) {
        yield {
          content: delta.content,
          tool_calls: undefined,
          finish_reason: null
        }
      }

      // Tool calls (incremental accumulation)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = currentToolCalls.get(tc.index)
          if (existing) {
            existing.function.arguments += tc.function?.arguments || ''
          } else {
            currentToolCalls.set(tc.index, {
              id: tc.id || '',
              type: 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || ''
              }
            })
          }
        }
      }

      // Completion
      if (choice.finish_reason) {
        // Emit completed tool calls
        for (const [, toolCall] of currentToolCalls) {
          yield {
            content: '',
            tool_calls: [toolCall],
            finish_reason: null
          }
        }
        
        yield {
          content: '',
          tool_calls: undefined,
          finish_reason: choice.finish_reason
        }
      }
    }
  }

  /**
   * Responses API - Streaming implementation (original)
   * For OpenAI native API with reasoning token support
   */
  private async *streamChatResponses(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const input: Array<ResponseInputItem | EasyInputMessage | FunctionCallInputItem> = []
    
    for (const msg of options.messages) {
      if (msg.role === 'tool') {
        // Tool response message
        input.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id || '',
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        })
      } else {
        const content = getStringContent(msg)
        const role = msg.role === 'system' ? 'system' 
          : msg.role === 'user' ? 'user' 
          : msg.role === 'assistant' ? 'assistant' 
          : 'developer'

        // For assistant messages, preserve reasoning blocks in the correct order:
        // 1. Reasoning items (thinking process)
        // 2. Assistant message content (text output) - ONLY if non-empty
        // 3. Function call items (tool calls)
        // This order matches the model's response generation flow and is required
        // by Gemini and other reasoning models for proper context preservation.
        
        // Handle reasoning_details for assistant messages (BEFORE text content)
        if (msg.role === 'assistant' && msg.reasoning_details && msg.reasoning_details.length > 0) {
          for (const detail of msg.reasoning_details) {
            const reasoningItem: ResponseReasoningItem & { encrypted_content?: string } = {
              id: detail.id || `reasoning_${Date.now()}`,
              type: 'reasoning',
              summary: []
            }
            
            if (detail.type === 'reasoning.summary' && detail.summary) {
              reasoningItem.summary = [{ type: 'summary_text', text: detail.summary }]
            }
            
            if (detail.type === 'reasoning.text' && detail.text) {
              (reasoningItem as ResponseReasoningItem & { content?: Array<{ type: 'reasoning_text'; text: string }> }).content = [
                { type: 'reasoning_text', text: detail.text }
              ]
            }
            
            if (detail.type === 'reasoning.encrypted' && detail.data) {
              reasoningItem.encrypted_content = detail.data
            }
            
            input.push(reasoningItem as ResponseReasoningItem)
          }
        } else if (msg.role === 'assistant' && msg.reasoning) {
          // Legacy format support
          const reasoningItem: ResponseReasoningItem = {
            id: msg.reasoning_id || `reasoning_${Date.now()}`,
            type: 'reasoning',
            summary: [{
              type: 'summary_text',
              text: msg.reasoning
            }]
          }
          input.push(reasoningItem)
        }

        // Add message content (AFTER reasoning items)
        // For assistant messages with tool_calls, skip empty content to avoid
        // sending unnecessary empty assistant messages in the input
        const shouldAddMessage = msg.role !== 'assistant' || content || !msg.tool_calls?.length
        if (shouldAddMessage) {
          input.push(buildEasyInputMessage(role, content))
        }

        // Handle tool_calls for assistant messages (AFTER text content)
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            const functionCallItem: FunctionCallInputItem = {
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments
            }
            input.push(functionCallItem)
          }
        }
      }
    }

    // Convert tool definitions
    const tools: OpenAITool[] | undefined = options.tools?.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description || undefined,
      parameters: tool.function.parameters,
      strict: null
    }))

    // Build text format for structured output
    const textFormat = options.responseFormat ? this.buildTextFormat(options.responseFormat) : undefined

    // Build reasoning config
    const reasoning = options.reasoning ? {
      effort: options.reasoning.effort ?? null,
      summary: options.reasoning.summary ?? null
    } : undefined

    const params: ResponseCreateParamsStreaming = {
      model: options.model,
      input,
      temperature: options.temperature ?? null,
      tools: tools,
      tool_choice: options.tool_choice,
      stream: true,
      ...(textFormat && { text: textFormat }),
      ...(reasoning && { reasoning }),
      ...(options.extraBody),
    }

    let stream: AsyncIterable<ResponseStreamEvent>
    try {
      stream = await this.client.responses.create(params, {
        signal: options.signal
      })
    } catch (error: unknown) {
      // Log detailed error information for debugging
      if (error && typeof error === 'object') {
        const err = error as { status?: number; message?: string; error?: unknown; body?: unknown }
        console.error('[LLMClient] API Error:', {
          status: err.status,
          message: err.message,
          error: err.error,
          body: err.body
        })
      }
      throw error
    }

    let currentToolCalls: Map<number, ToolCall> = new Map()
    let currentReasoningId = ''
    let reasoningDetails: ReasoningDetail[] = []

    for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
      if (event.type === 'response.output_text.delta') {
        yield {
          content: event.delta,
          tool_calls: undefined,
          finish_reason: null
        }
      } else if (event.type === 'response.reasoning_text.delta') {
        yield {
          content: '',
          tool_calls: undefined,
          finish_reason: null,
          reasoning_details: [{
            type: 'reasoning.text',
            text: event.delta,
            id: currentReasoningId || undefined
          }]
        }
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        yield {
          content: '',
          tool_calls: undefined,
          finish_reason: null,
          reasoning_details: [{
            type: 'reasoning.summary',
            summary: event.delta,
            id: currentReasoningId || undefined
          }]
        }
      } else if (event.type === 'response.output_item.added') {
        if (event.item.type === 'function_call' && isFunctionCall(event.item)) {
          const outputIndex = event.output_index
          const functionCallItem = event.item
          
          currentToolCalls.set(outputIndex, {
            id: functionCallItem.id || functionCallItem.call_id || '',
            type: 'function',
            function: {
              name: functionCallItem.name,
              arguments: ''
            }
          })
        } else if (event.item.type === 'reasoning') {
          currentReasoningId = event.item.id
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        const outputIndex = event.output_index
        const toolCall = currentToolCalls.get(outputIndex)
        if (toolCall) {
          toolCall.function.arguments += event.delta
        }
      } else if (event.type === 'response.completed') {
        const completedEvent = event as { type: 'response.completed'; response?: { output?: unknown[] } }
        
        if (completedEvent.response?.output) {
          for (const outputItem of completedEvent.response.output) {
            if (isReasoningItem(outputItem)) {
              const reasoningItem = outputItem
              
              if (reasoningItem.encrypted_content) {
                reasoningDetails.push({
                  type: 'reasoning.encrypted',
                  data: reasoningItem.encrypted_content,
                  id: reasoningItem.id,
                  format: reasoningItem.format
                })
              }
              
              if (reasoningItem.summary && reasoningItem.summary.length > 0) {
                const summaryText = reasoningItem.summary.map(s => s.text).join('\n')
                reasoningDetails.push({
                  type: 'reasoning.summary',
                  summary: summaryText,
                  id: reasoningItem.id,
                  format: reasoningItem.format
                })
              }
              
              if (reasoningItem.content && reasoningItem.content.length > 0) {
                const contentText = reasoningItem.content.map(c => c.text).join('\n')
                reasoningDetails.push({
                  type: 'reasoning.text',
                  text: contentText,
                  id: reasoningItem.id,
                  format: reasoningItem.format
                })
              }
            }
            
            // Update tool call arguments from completed response
            if (isFunctionCall(outputItem)) {
              const funcCall = outputItem
              for (const [, toolCall] of currentToolCalls) {
                if (toolCall.id === funcCall.id || toolCall.id === funcCall.call_id) {
                  if (funcCall.arguments) {
                    toolCall.function.arguments = funcCall.arguments
                  }
                  break
                }
              }
            }
          }
        }
        
        // Yield all completed tool calls
        for (const [, toolCall] of currentToolCalls) {
          yield {
            content: '',
            tool_calls: [toolCall],
            finish_reason: null,
            reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined
          }
        }
        
        yield {
          content: '',
          tool_calls: undefined,
          finish_reason: 'stop',
          reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined
        }
      } else if (event.type === 'error') {
        throw new Error(event.message || 'Unknown error')
      }
    }
  }

  /**
   * Non-streaming chat completion - dispatches to appropriate API
   */
  async chat(options: ChatCompletionOptions): Promise<ChatResponse> {
    if (this.apiMode === 'responses') {
      return this.chatResponses(options)
    } else {
      return this.chatCompletions(options)
    }
  }

  /**
   * Chat Completions API - Non-streaming implementation
   * Compatible with OpenRouter, Azure, Ollama, and other OpenAI-compatible providers
   */
  private async chatCompletions(options: ChatCompletionOptions): Promise<ChatResponse> {
    const messages = this.convertToChatCompletionMessages(options.messages)
    const tools = this.convertToChatCompletionTools(options.tools)

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: options.model,
      messages,
      temperature: options.temperature ?? undefined,
      max_tokens: options.max_tokens ?? undefined,
      tools: tools,
      tool_choice: options.tool_choice,
      stream: false,
      ...(options.responseFormat && { response_format: this.convertResponseFormat(options.responseFormat) }),
      ...(options.extraBody),
    }

    const response = await this.client.chat.completions.create(params, {
      signal: options.signal
    })

    const choice = response.choices[0]
    if (!choice) {
      return {
        content: '',
        tool_calls: undefined,
        finish_reason: 'stop',
        usage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        } : undefined
      }
    }

    const message = choice.message
    const toolCalls: ToolCall[] = message.tool_calls
      ?.filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      })) ?? []

    return {
      content: message.content || '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      reasoning_details: undefined, // Chat Completions API doesn't support reasoning natively
      finish_reason: choice.finish_reason,
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens
      } : undefined
    }
  }

  /**
   * Responses API - Non-streaming implementation (original)
   * For OpenAI native API with reasoning token support
   */
  private async chatResponses(options: ChatCompletionOptions): Promise<ChatResponse> {
    const input: Array<ResponseInputItem | EasyInputMessage | FunctionCallInputItem> = []
    
    for (const msg of options.messages) {
      if (msg.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id || '',
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        })
      } else {
        const content = getStringContent(msg)
        const role = msg.role === 'system' ? 'system' 
          : msg.role === 'user' ? 'user' 
          : msg.role === 'assistant' ? 'assistant' 
          : 'developer'

        // For assistant messages, preserve reasoning blocks in the correct order:
        // 1. Reasoning items (thinking process)
        // 2. Assistant message content (text output) - ONLY if non-empty
        // 3. Function call items (tool calls)
        // This order matches the model's response generation flow and is required
        // by Gemini and other reasoning models for proper context preservation.

        // Handle reasoning_details for assistant messages (BEFORE text content)
        if (msg.role === 'assistant' && msg.reasoning_details && msg.reasoning_details.length > 0) {
          for (const detail of msg.reasoning_details) {
            const reasoningItem: ResponseReasoningItem & { encrypted_content?: string } = {
              id: detail.id || `reasoning_${Date.now()}`,
              type: 'reasoning',
              summary: []
            }
            
            if (detail.type === 'reasoning.summary' && detail.summary) {
              reasoningItem.summary = [{ type: 'summary_text', text: detail.summary }]
            }
            
            if (detail.type === 'reasoning.text' && detail.text) {
              (reasoningItem as ResponseReasoningItem & { content?: Array<{ type: 'reasoning_text'; text: string }> }).content = [
                { type: 'reasoning_text', text: detail.text }
              ]
            }
            
            if (detail.type === 'reasoning.encrypted' && detail.data) {
              reasoningItem.encrypted_content = detail.data
            }
            
            input.push(reasoningItem as ResponseReasoningItem)
          }
        } else if (msg.role === 'assistant' && msg.reasoning) {
          const reasoningItem: ResponseReasoningItem = {
            id: msg.reasoning_id || `reasoning_${Date.now()}`,
            type: 'reasoning',
            summary: [{
              type: 'summary_text',
              text: msg.reasoning
            }]
          }
          input.push(reasoningItem)
        }

        // Add message content (AFTER reasoning items)
        // For assistant messages with tool_calls, skip empty content to avoid
        // sending unnecessary empty assistant messages in the input
        const shouldAddMessage = msg.role !== 'assistant' || content || !msg.tool_calls?.length
        if (shouldAddMessage) {
          input.push(buildEasyInputMessage(role, content))
        }

        // Handle tool_calls for assistant messages (AFTER text content)
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            const functionCallItem: FunctionCallInputItem = {
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments
            }
            input.push(functionCallItem)
          }
        }
      }
    }

    const tools: OpenAITool[] | undefined = options.tools?.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description || undefined,
      parameters: tool.function.parameters,
      strict: null
    }))

    // Build text format for structured output
    const textFormat = options.responseFormat ? this.buildTextFormat(options.responseFormat) : undefined

    // Build reasoning config
    const reasoning = options.reasoning ? {
      effort: options.reasoning.effort ?? null,
      summary: options.reasoning.summary ?? null
    } : undefined

    const params: ResponseCreateParamsNonStreaming = {
      model: options.model,
      input,
      temperature: options.temperature ?? null,
      tools: tools,
      tool_choice: options.tool_choice,
      stream: false,
      ...(textFormat && { text: textFormat }),
      ...(reasoning && { reasoning }),
      ...(options.extraBody),
    }

    const response = await this.client.responses.create(params, {
      signal: options.signal
    })

    let content = ''
    let toolCalls: ToolCall[] = []
    let reasoningDetails: ReasoningDetail[] = []

    for (const outputItem of response.output) {
      if (outputItem.type === 'message') {
        for (const contentItem of outputItem.content) {
          if (contentItem.type === 'output_text') {
            content += contentItem.text
          }
        }
      } else if (outputItem.type === 'function_call' && isFunctionCall(outputItem)) {
        const functionCallItem = outputItem
        toolCalls.push({
          id: functionCallItem.id || functionCallItem.call_id || '',
          type: 'function',
          function: {
            name: functionCallItem.name,
            arguments: functionCallItem.arguments
          }
        })
      } else if (outputItem.type === 'reasoning') {
        if (isReasoningItem(outputItem)) {
          const reasoningItem = outputItem
          
          if (reasoningItem.encrypted_content) {
            reasoningDetails.push({
              type: 'reasoning.encrypted',
              data: reasoningItem.encrypted_content,
              id: reasoningItem.id,
              format: reasoningItem.format
            })
          }
          
          if (reasoningItem.summary && reasoningItem.summary.length > 0) {
            const summaryText = reasoningItem.summary.map(s => s.text).join('\n')
            reasoningDetails.push({
              type: 'reasoning.summary',
              summary: summaryText,
              id: reasoningItem.id,
              format: reasoningItem.format
            })
          }
          
          if (reasoningItem.content && reasoningItem.content.length > 0) {
            const contentText = reasoningItem.content.map(c => c.text).join('\n')
            reasoningDetails.push({
              type: 'reasoning.text',
              text: contentText,
              id: reasoningItem.id,
              format: reasoningItem.format
            })
          }
        }
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined,
      finish_reason: response.status === 'completed' ? 'stop' : null,
      usage: response.usage ? {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens
      } : undefined
    }
  }

  // ============================================
  // Helper methods for Chat Completions API
  // ============================================

  /**
   * Convert ChatMessage[] to ChatCompletionMessageParam[]
   */
  private convertToChatCompletionMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        result.push({
          role: 'system',
          content: getStringContent(msg)
        })
      } else if (msg.role === 'user') {
        // Handle multimodal content
        if (Array.isArray(msg.content)) {
          result.push({
            role: 'user',
            content: msg.content.map(part => {
              if (part.type === 'text') {
                return { type: 'text' as const, text: part.text || '' }
              } else if (part.type === 'image_url' && part.image_url) {
                return { 
                  type: 'image_url' as const, 
                  image_url: { 
                    url: part.image_url.url,
                    detail: part.image_url.detail as 'auto' | 'low' | 'high' | undefined
                  }
                }
              }
              return { type: 'text' as const, text: '' }
            })
          })
        } else {
          result.push({
            role: 'user',
            content: msg.content
          })
        }
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: getStringContent(msg) || null
        }
        
        // Add tool_calls if present
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          assistantMsg.tool_calls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }))
        }
        
        result.push(assistantMsg)
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.tool_call_id || ''
        })
      }
    }

    return result
  }

  /**
   * Convert ToolDefinition[] to ChatCompletionTool[]
   */
  private convertToChatCompletionTools(tools?: ToolDefinition[]): ChatCompletionTool[] | undefined {
    if (!tools || tools.length === 0) return undefined
    
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters as Record<string, unknown>
      }
    }))
  }

  /**
   * Convert ResponseFormat to Chat Completions response_format
   */
  private convertResponseFormat(responseFormat: ResponseFormat): OpenAI.Chat.ChatCompletionCreateParams['response_format'] {
    if (responseFormat.type === 'json_schema') {
      return {
        type: 'json_schema',
        json_schema: {
          name: responseFormat.json_schema.name,
          description: responseFormat.json_schema.description,
          schema: responseFormat.json_schema.schema,
          strict: responseFormat.json_schema.strict ?? true
        }
      }
    } else if (responseFormat.type === 'json_object') {
      return {
        type: 'json_object'
      }
    } else {
      return {
        type: 'text'
      }
    }
  }

  // ============================================
  // Helper methods for Responses API
  // ============================================

  /**
   * Build text format object for OpenAI Responses API
   */
  private buildTextFormat(responseFormat: ResponseFormat): OpenAI.Responses.ResponseTextConfig {
    if (responseFormat.type === 'json_schema') {
      return {
        format: {
          type: 'json_schema' as const,
          name: responseFormat.json_schema.name,
          description: responseFormat.json_schema.description,
          schema: responseFormat.json_schema.schema,
          strict: responseFormat.json_schema.strict ?? true
        }
      }
    } else if (responseFormat.type === 'json_object') {
      return {
        format: {
          type: 'json_object' as const
        }
      }
    } else {
      return {
        format: {
          type: 'text' as const
        }
      }
    }
  }
}
