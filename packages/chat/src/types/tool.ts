/**
 * Tool Types - Tool system types
 */

import type { z } from 'zod'

/**
 * Tool handler function
 */
export type ToolHandler<T = unknown, R = unknown> = (args: T) => Promise<R>

/**
 * Tool definition for registration
 */
export interface ToolRegistration {
  name: string
  description: string
  schema: z.ZodTypeAny
  handler: ToolHandler
}

/**
 * Custom tool definition (without Zod schema)
 */
export interface CustomToolDefinition {
  name: string
  description: string
  /** JSON Schema for parameters */
  schema: Record<string, unknown>
  handler: ToolHandler
}
