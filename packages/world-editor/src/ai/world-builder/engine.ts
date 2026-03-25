/**
 * WorldBuilder Engine
 *
 * Core orchestrator for the 6-phase world-building pipeline.
 * Uses ChatStreamPipeline for streaming structured output.
 *
 * Migrated from worldBuilderNextChat.ts — replaced direct OpenAI calls
 * with ChatStreamPipeline, removed lorebook paths.
 */

import {
  ChatStreamPipeline,
  ToolRegistry,
  type PipelineConfig,
  type ResponseFormatJsonSchema,
} from '@pubwiki/chat'
import type { LLMConfig } from '@pubwiki/chat'
import { z } from 'zod'
import type {
  WBNPhaseId,
  WBNSession,
  WBNStreamEvent,
  WBNDraftOutput,
} from './types'
import type { QueryUserRequest, QueryUserField, WorldEditorAIContext } from '../types'
import {
  getPhaseSystemPrompt,
  getPhaseUserInstruction,
  getPhaseOutputSchema,
  SYNOPSIS_QUERY_INSTRUCTION,
} from './prompts'
import { buildPhaseMessages, applyPhaseOutput } from './service'
import { extractForPhase } from './extraction'
import { validatePhaseOutput, formatValidationErrorsForAI } from './validation'

// ============================================================================
// Configuration
// ============================================================================

export interface WorldBuilderConfig {
  llm: LLMConfig & { model: string; apiKey: string }
  secondaryLlm?: Partial<LLMConfig> & {
    extraBody?: Record<string, unknown>
    headers?: Record<string, string>
  }
}

export interface WorldBuilderContext {
  ctx: WorldEditorAIContext
  session: WBNSession
  /** Callback to collect user input via query_user form */
  queryUser?: (request: QueryUserRequest) => Promise<Record<string, unknown>>
  signal?: AbortSignal
}

// ============================================================================
// Helpers
// ============================================================================

const MAX_VALIDATION_RETRIES = 2

function buildPipelineConfig(
  config: WorldBuilderConfig,
  overrides?: Partial<PipelineConfig>,
): PipelineConfig {
  return {
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    temperature: config.llm.temperature ?? 0.7,
    maxTokens: config.llm.maxTokens ?? 20480,
    apiMode: config.llm.apiMode,
    reasoning: config.llm.reasoning,
    ...overrides,
  }
}

function makeResponseFormat(
  phaseId: WBNPhaseId,
): ResponseFormatJsonSchema {
  return {
    type: 'json_schema',
    json_schema: {
      name: `${phaseId}_output`,
      strict: true,
      schema: getPhaseOutputSchema(phaseId),
    },
  }
}

/**
 * Format query_user results back for the AI.
 */
function formatQueryUserResult(
  fields: QueryUserField[],
  result: Record<string, unknown>,
): string {
  const answeredLines: string[] = []
  const customLines: string[] = []
  const aiDecideLines: string[] = []

  for (const field of fields) {
    const value = result[field.key]
    if (value === '__AI_DECIDE__') {
      aiDecideLines.push(`- **${field.label}**`)
    } else if (value !== undefined && value !== '' && value !== null) {
      const isCustom =
        (field.type === 'select' || field.type === 'multiselect') &&
        typeof value === 'string' &&
        !(field.options || []).includes(value)
      if (isCustom) {
        customLines.push(`- **${field.label}**: ${JSON.stringify(value)}`)
      } else {
        answeredLines.push(`- **${field.label}**: ${JSON.stringify(value)}`)
      }
    }
  }

  const sections: string[] = []
  if (answeredLines.length > 0) {
    sections.push('**User selections:**')
    sections.push(...answeredLines)
  }
  if (customLines.length > 0) {
    sections.push('**User custom input:**')
    sections.push(...customLines)
  }
  if (aiDecideLines.length > 0) {
    sections.push('**The following are for you (AI) to decide:**')
    sections.push(...aiDecideLines)
  }
  return sections.join('\n')
}

/**
 * Try to parse JSON, with jsonrepair fallback.
 */
async function tryParseJson(text: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(text)
  } catch {
    try {
      // @ts-expect-error jsonrepair is provided by the host app
      const { jsonrepair } = await import('jsonrepair')
      return JSON.parse(jsonrepair(text))
    } catch {
      return null
    }
  }
}

// ============================================================================
// Synopsis Phase
// ============================================================================

/**
 * Run the synopsis phase:
 * 1. Pre-extract file summary (if exists)
 * 2. Direct query_user (no LLM tool call — we invoke it manually)
 * 3. Structured output call → generate draft
 */
async function* runSynopsisPhase(
  config: WorldBuilderConfig,
  wbCtx: WorldBuilderContext,
): AsyncGenerator<WBNStreamEvent> {
  const { session, queryUser, signal } = wbCtx

  // Step 1: Pre-extract file summary
  yield { type: 'extraction_progress', message: 'Analyzing reference materials...' }
  const extractedSummary = await extractForPhase(config, session, 'synopsis', signal)

  // Step 2: query_user — collect design preferences
  let userDesignNotes = ''

  if (queryUser) {
    // Build a query instruction and call LLM with tool to get query_user args
    const pipelineConfig = buildPipelineConfig(config, {
      signal,
      maxTokens: 20480,
    })

    let userPrompt = session.initialPrompt
    if (extractedSummary) {
      userPrompt += `\n\n## Reference Material (for reference only — adapt flexibly)\n\n${extractedSummary}`
    }

    // Use pipeline.run() to get the query_user tool call
    const queryPipeline = new ChatStreamPipeline({
      ...pipelineConfig,
      maxIterations: 1,
      // Use ToolRegistry for query_user tool
      tools: createQueryUserToolRegistry(),
    })

    const { blocks } = await queryPipeline.run([
      { role: 'system', content: getPhaseSystemPrompt() },
      { role: 'user', content: userPrompt },
      { role: 'user', content: SYNOPSIS_QUERY_INSTRUCTION },
    ])

    // Find the tool result block that contains the query_user args
    const toolCallBlock = blocks.find(
      (b) => b.type === 'tool_call' && b.toolName === 'query_user',
    )

    if (toolCallBlock?.toolArgs) {
      const args = toolCallBlock.toolArgs as { title?: string; fields?: QueryUserField[] }
      const title = args.title || 'Please answer the following questions'
      const fields = args.fields || []

      if (fields.length > 0) {
        yield { type: 'query_user', request: { title, fields } }
        const result = await queryUser({ title, fields })
        userDesignNotes = formatQueryUserResult(fields, result)
        session.userDesignNotes = userDesignNotes
      }
    }

    // Emit any text from the AI
    for (const block of blocks) {
      if ((block.type === 'text' || block.type === 'markdown') && block.content?.trim()) {
        yield { type: 'ai_text', text: block.content }
      }
    }
  }

  // Step 3: Structured output call — generate draft
  yield { type: 'extraction_progress', message: 'Generating draft...' }

  let userPrompt = session.initialPrompt
  if (extractedSummary) {
    userPrompt += `\n\n## Reference Material\n\n${extractedSummary}`
  }

  const draftMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: getPhaseSystemPrompt() },
    { role: 'user', content: userPrompt },
  ]
  if (userDesignNotes) {
    draftMessages.push({
      role: 'user',
      content: `## User Design Preferences (survey answers)\n\n${userDesignNotes}`,
    })
  }
  draftMessages.push({ role: 'user', content: getPhaseUserInstruction('synopsis') })

  const draftPipeline = new ChatStreamPipeline(
    buildPipelineConfig(config, {
      signal,
      responseFormat: makeResponseFormat('synopsis'),
    }),
  )

  let draftContent = ''
  let lastProgressAt = -1
  let reasoningDetected = false

  for await (const event of draftPipeline.stream(draftMessages)) {
    if (event.type === 'token' && event.tokenType === 'reasoning' && !reasoningDetected) {
      reasoningDetected = true
      yield { type: 'extraction_progress', message: 'AI is thinking...' }
    }
    if (event.type === 'token' && event.tokenType === 'text') {
      if (reasoningDetected && draftContent.length === 0) {
        yield { type: 'extraction_progress', message: 'Generating output...' }
      }
      draftContent += event.token
      if (lastProgressAt < 0 || draftContent.length - lastProgressAt >= 200) {
        lastProgressAt = draftContent.length
        yield { type: 'streaming_progress', charCount: draftContent.length }
      }
    }
  }

  if (draftContent.length > lastProgressAt) {
    yield { type: 'streaming_progress', charCount: draftContent.length }
  }

  if (!draftContent) {
    yield { type: 'error', error: 'Draft generation returned empty response.' }
    return
  }

  const draftOutput = await tryParseJson(draftContent)
  if (!draftOutput) {
    yield { type: 'error', error: 'Failed to parse draft output.' }
    return
  }

  yield { type: 'draft_review', draft: draftOutput as unknown as WBNDraftOutput }
  yield { type: 'phase_output', phaseId: 'synopsis', output: draftOutput }
  yield { type: 'done' }
}

// ============================================================================
// Data Phase (non-synopsis)
// ============================================================================

async function* runDataPhase(
  config: WorldBuilderConfig,
  wbCtx: WorldBuilderContext,
  phaseId: WBNPhaseId,
): AsyncGenerator<WBNStreamEvent> {
  const { session, signal } = wbCtx

  // Step 1: Pre-extract
  yield { type: 'extraction_progress', message: 'Extracting relevant content...' }
  const extractedContent = await extractForPhase(config, session, phaseId, signal)

  // Step 2: Build messages
  const contextMessages = buildPhaseMessages(session, extractedContent)

  // Step 3: Structured output call with validation retry
  yield { type: 'extraction_progress', message: 'Generating structured data...' }

  const messages = [...contextMessages]
  let validationRetries = 0

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    const pipeline = new ChatStreamPipeline(
      buildPipelineConfig(config, {
        signal,
        responseFormat: makeResponseFormat(phaseId),
      }),
    )

    let fullContent = ''
    let lastProgressAt = -1
    let reasoningDetected = false

    const allMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: getPhaseSystemPrompt() },
      ...messages,
    ]

    for await (const event of pipeline.stream(allMessages)) {
      if (event.type === 'token' && event.tokenType === 'reasoning' && !reasoningDetected) {
        reasoningDetected = true
        yield { type: 'extraction_progress', message: 'AI is thinking...' }
      }
      if (event.type === 'token' && event.tokenType === 'text') {
        if (reasoningDetected && fullContent.length === 0) {
          yield { type: 'extraction_progress', message: 'Generating output...' }
        }
        fullContent += event.token
        if (lastProgressAt < 0 || fullContent.length - lastProgressAt >= 200) {
          lastProgressAt = fullContent.length
          yield { type: 'streaming_progress', charCount: fullContent.length }
        }
      }
    }

    if (fullContent.length > lastProgressAt) {
      yield { type: 'streaming_progress', charCount: fullContent.length }
    }

    if (!fullContent) {
      yield { type: 'error', error: `Phase ${phaseId}: API returned empty response.` }
      return
    }

    const output = await tryParseJson(fullContent)
    if (!output) {
      yield { type: 'error', error: `Phase ${phaseId}: Failed to parse output JSON.` }
      return
    }

    // Validate
    const validationResult = validatePhaseOutput(phaseId, output, session)

    if (!validationResult.valid && attempt < MAX_VALIDATION_RETRIES) {
      validationRetries++
      yield {
        type: 'validation_retry',
        attempt: validationRetries,
        errors: validationResult.errors,
        accepted: false,
      }

      const errorMsg = formatValidationErrorsForAI(validationResult)
      messages.push({ role: 'assistant', content: fullContent })
      messages.push({
        role: 'user',
        content: `The output above has validation errors. Please fix them and regenerate:\n\n${errorMsg}`,
      })
      continue
    }

    if (!validationResult.valid) {
      yield {
        type: 'validation_retry',
        attempt: validationRetries + 1,
        errors: validationResult.errors,
        accepted: true,
      }
    }

    yield { type: 'phase_output', phaseId, output }
    yield { type: 'done' }
    return
  }
}

// ============================================================================
// Query User Tool Registry (for synopsis phase)
// ============================================================================

function createQueryUserToolRegistry() {
  const registry = new ToolRegistry()
  registry.register(
    'query_user',
    'Present a form to the user and collect their preferences.',
    z.object({
      title: z.string().describe('Form title'),
      fields: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          type: z
            .enum(['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number'])
            .describe('Field type'),
          options: z.array(z.string()).optional().describe('Options for select/multiselect'),
          default_value: z.string().optional(),
          required: z.boolean().optional(),
          placeholder: z.string().optional(),
        }),
      ),
    }),
    // Handler returns immediately — actual query_user is handled outside
    async (args) => args,
  )

  return registry
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run one phase of the WorldBuilder pipeline.
 * Yields WBNStreamEvent as the phase progresses.
 */
export async function* streamWorldBuilderPhase(
  config: WorldBuilderConfig,
  wbCtx: WorldBuilderContext,
  phaseId: WBNPhaseId,
): AsyncGenerator<WBNStreamEvent> {
  try {
    if (phaseId === 'synopsis') {
      yield* runSynopsisPhase(config, wbCtx)
    } else {
      yield* runDataPhase(config, wbCtx, phaseId)
    }
  } catch (e) {
    yield { type: 'error', error: (e as Error).message }
  }
}

/**
 * Run a phase and apply its output to state.
 * Convenience wrapper around streamWorldBuilderPhase + applyPhaseOutput.
 */
export async function* streamAndApplyPhase(
  config: WorldBuilderConfig,
  wbCtx: WorldBuilderContext,
  phaseId: WBNPhaseId,
): AsyncGenerator<WBNStreamEvent> {
  const { session, ctx } = wbCtx

  for await (const event of streamWorldBuilderPhase(config, wbCtx, phaseId)) {
    yield event

    // When we get phase_output, store it and apply to state
    if (event.type === 'phase_output') {
      console.log('[WBN] phase_output received for', phaseId, '— applying to state')
      session.phases[phaseId].output = event.output
      session.phases[phaseId].status = 'completed'
      session.updatedAt = Date.now()
      const { changes } = applyPhaseOutput(session, phaseId, ctx)
      console.log('[WBN] applyPhaseOutput returned', changes.length, 'changes')
      if (changes.length > 0) {
        yield { type: 'phase_applied', changes }
      }
    }

    if (event.type === 'error') {
      session.phases[phaseId].status = 'error'
      session.phases[phaseId].error = event.error
      session.updatedAt = Date.now()
    }
  }
}
