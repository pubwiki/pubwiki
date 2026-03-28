/**
 * Tool Types - Tool system types
 */

import type { z } from 'zod'
import type { AfterExecutionHook } from '../llm/tools'

/**
 * Tool handler function
 */
export type ToolHandler<T = unknown, R = unknown> = (args: T) => Promise<R>

/**
 * Tool definition for registration (generic version for type inference)
 */
export interface ToolRegistration<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  schema: T
  handler: (args: z.infer<T>) => Promise<unknown>
  afterExecution?: AfterExecutionHook
}

/**
 * Helper function to define a tool with full type inference.
 * The handler's argument type is automatically inferred from the Zod schema.
 * 
 * @example
 * ```typescript
 * const myTool = defineTool({
 *   name: 'my_tool',
 *   description: 'Does something',
 *   schema: z.object({ foo: z.string() }),
 *   handler: async ({ foo }) => {
 *     // foo is typed as string
 *     return { result: foo.toUpperCase() }
 *   }
 * })
 * ```
 */
export function defineTool<T extends z.ZodTypeAny>(
  tool: ToolRegistration<T>
): ToolRegistration<T> {
  return tool
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
