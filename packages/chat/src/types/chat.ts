/**
 * Chat Types - LLM API related types
 */

import type { ReasoningDetail } from './message'

/**
 * Content part (for multimodal messages - reserved for future)
 */
export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: string }
}

/**
 * Chat message - LLM API format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  name?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  /** Reasoning content (legacy text format) */
  reasoning?: string
  /** Reasoning ID (for API passing) */
  reasoning_id?: string
  /** Reasoning details (OpenRouter format, for multi-turn conversation) */
  reasoning_details?: ReasoningDetail[]
}

/**
 * Tool call information
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * Stream chunk
 */
export interface StreamChunk {
  content: string
  tool_calls?: ToolCall[]
  finish_reason?: string | null
  reasoning_details?: ReasoningDetail[]
}

/**
 * Chat response
 */
export interface ChatResponse {
  content: string
  tool_calls?: ToolCall[]
  finish_reason: string | null
  reasoning_details?: ReasoningDetail[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Tool definition
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
}

/**
 * Tool call progress
 */
export interface ToolCallProgress {
  id: string
  name: string
  args: unknown
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: unknown
  error?: string
}
