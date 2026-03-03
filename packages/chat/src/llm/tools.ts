/**
 * Tool Registry - Tool management system
 * 
 * Based on OpenAI SDK tool management with Zod schema support
 */

import { z } from 'zod'
import type { ToolDefinition, ChatMessage } from '../types'

/**
 * Tool handler function
 */
export type ToolHandler = (args: unknown) => Promise<unknown>

/**
 * Hook called after tool execution.
 * 
 * Called after a tool finishes execution and the tool result message has been
 * written to chat history, but before the next LLM call begins.
 * 
 * @param messages - Mutable reference to the current messages array in the pipeline.
 *   The hook can inspect the array (e.g., find the tool message just added) and
 *   push additional messages (e.g., a user message with image_url) that will be
 *   included in the next LLM call.
 * 
 * Typical use case: after a screenshot tool executes successfully, the hook
 * pushes a user message containing image_url to the messages array,
 * so the LLM can "see" the screenshot in the next turn.
 */
export type AfterExecutionHook = (messages: ChatMessage[]) => void | Promise<void>

/**
 * Tool Registry
 */
export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>()
  private definitions = new Map<string, ToolDefinition>()
  private afterExecutionHooks = new Map<string, AfterExecutionHook>()

  /**
   * Register a tool with Zod schema
   */
  register(
    name: string,
    description: string,
    schema: z.ZodTypeAny,
    handler: ToolHandler,
    afterExecution?: AfterExecutionHook
  ): void {
    // Convert Zod schema to JSON Schema
    const jsonSchema = z.toJSONSchema(schema)

    // Remove $schema and additionalProperties (not needed by OpenAI)
    const parameters = { ...jsonSchema }
    delete (parameters as Record<string, unknown>).$schema
    delete (parameters as Record<string, unknown>).additionalProperties

    this.definitions.set(name, {
      type: 'function',
      function: {
        name,
        description,
        parameters
      }
    })

    this.handlers.set(name, handler)
    if (afterExecution) {
      this.afterExecutionHooks.set(name, afterExecution)
    }
  }

  /**
   * Register a tool with raw JSON Schema
   */
  registerWithJsonSchema(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    handler: ToolHandler,
    afterExecution?: AfterExecutionHook
  ): void {
    this.definitions.set(name, {
      type: 'function',
      function: {
        name,
        description,
        parameters
      }
    })

    this.handlers.set(name, handler)
    if (afterExecution) {
      this.afterExecutionHooks.set(name, afterExecution)
    }
  }

  /**
   * Batch register tools
   */
  registerBatch(tools: Array<{
    name: string
    description: string
    schema: z.ZodTypeAny
    handler: ToolHandler
    afterExecution?: AfterExecutionHook
  }>): void {
    for (const tool of tools) {
      this.register(tool.name, tool.description, tool.schema, tool.handler, tool.afterExecution)
    }
  }

  /**
   * Get all tool definitions (for API calls)
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Get specific tool definition
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.definitions.get(name)
  }

  /**
   * Execute a tool
   */
  async execute(name: string, args: unknown): Promise<unknown> {
    const handler = this.handlers.get(name)
    if (!handler) {
      throw new Error(`Tool "${name}" not found`)
    }

    return await handler(args)
  }

  /**
   * Execute afterExecution hook for a tool (if registered).
   * 
   * @param name - Tool name
   * @param messages - Mutable reference to the current messages array
   */
  async executeAfterHook(name: string, messages: ChatMessage[]): Promise<void> {
    const hook = this.afterExecutionHooks.get(name)
    if (!hook) return
    await hook(messages)
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.handlers.has(name)
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const existed = this.handlers.has(name)
    this.handlers.delete(name)
    this.definitions.delete(name)
    this.afterExecutionHooks.delete(name)
    return existed
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.handlers.clear()
    this.definitions.clear()
    this.afterExecutionHooks.clear()
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.handlers.size
  }
}
