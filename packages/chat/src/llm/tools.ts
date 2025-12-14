/**
 * Tool Registry - Tool management system
 * 
 * Based on OpenAI SDK tool management with Zod schema support
 */

import { z } from 'zod'
import type { ToolDefinition } from '../types'

/**
 * Tool handler function
 */
export type ToolHandler = (args: unknown) => Promise<unknown>

/**
 * Tool Registry
 */
export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>()
  private definitions = new Map<string, ToolDefinition>()

  /**
   * Register a tool with Zod schema
   */
  register(
    name: string,
    description: string,
    schema: z.ZodTypeAny,
    handler: ToolHandler
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
  }

  /**
   * Register a tool with raw JSON Schema
   */
  registerWithJsonSchema(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    handler: ToolHandler
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
  }

  /**
   * Batch register tools
   */
  registerBatch(tools: Array<{
    name: string
    description: string
    schema: z.ZodTypeAny
    handler: ToolHandler
  }>): void {
    for (const tool of tools) {
      this.register(tool.name, tool.description, tool.schema, tool.handler)
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
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.handlers.has(name)
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
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.handlers.size
  }
}
