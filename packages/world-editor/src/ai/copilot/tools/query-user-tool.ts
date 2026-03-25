/**
 * QueryUser Tool — Interactive form collection from the user.
 *
 * When the AI calls this tool, it blocks until the user submits a form in the UI.
 * The form is rendered inline in the chat panel as a special message block.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import type { QueryUserField, QueryUserRequest } from '../../types'

// ============================================================================
// Result Formatting
// ============================================================================

/**
 * Format query_user form submission as a readable string for the LLM.
 * Matches the original worldBuilderNextChat.ts behavior.
 */
export function formatQueryUserResult(
  title: string,
  fields: QueryUserField[],
  data: Record<string, unknown>,
): string {
  const lines: string[] = [`## User Response: ${title}`, '']

  for (const field of fields) {
    const value = data[field.key]
    const displayValue =
      value === '__AI_DECIDE__'
        ? '(Let AI decide — use your best judgment)'
        : value === undefined || value === ''
          ? '(No response)'
          : String(value)

    lines.push(`### ${field.label}`)
    lines.push(displayValue)
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================================================
// Zod Schema for QueryUserField
// ============================================================================

const QueryUserFieldSchema = z.object({
  key: z.string().describe('Unique field key'),
  label: z.string().describe('Display label'),
  type: z.enum(['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number']),
  options: z.array(z.string()).optional().describe('Options for select/multiselect'),
  default_value: z.string().optional().describe('Default value'),
  required: z.boolean().optional().describe('Whether the field is required'),
  placeholder: z.string().optional().describe('Placeholder text'),
})

const QueryUserSchema = z.object({
  title: z.string().describe('Form title displayed to the user'),
  fields: z.array(QueryUserFieldSchema).describe('Form fields to display'),
})

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create the query_user tool.
 *
 * @param showForm - Callback that renders the form in the UI and resolves
 *   when the user submits. The callback receives the QueryUserRequest and
 *   returns a Promise of the submitted key-value pairs.
 */
export function createQueryUserTool(
  showForm: (request: QueryUserRequest) => Promise<Record<string, unknown>>,
) {
  return defineTool({
    name: 'query_user',
    description:
      'Show an interactive form to the user to collect structured input. ' +
      'The form will block until the user submits their answers. ' +
      'Use this when you need specific parameters or preferences from the user.',
    schema: QueryUserSchema,
    handler: async (args) => {
      const request: QueryUserRequest = {
        title: args.title,
        fields: args.fields as QueryUserField[],
      }
      const result = await showForm(request)
      return formatQueryUserResult(args.title, request.fields, result)
    },
  })
}
