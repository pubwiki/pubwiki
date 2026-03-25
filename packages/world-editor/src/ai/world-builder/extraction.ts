/**
 * WorldBuilder Extraction
 *
 * Pre-extraction of relevant content from user's reference file or lorebook.
 * Uses ChatStreamPipeline with structured/free-form output.
 *
 * - Lorebook path: structured entry selection (lossless) — sub-agent picks
 *   relevant entry IDs, then original content is injected verbatim.
 * - File path: free-form extraction (lossy but necessary for unstructured text).
 */

import { ChatStreamPipeline, type PipelineConfig } from '@pubwiki/chat'
import type { WBNPhaseId, WBNSession, WBNDraftOutput, LorebookData } from './types'
import { getExtractionPrompt } from './prompts'
import type { WorldBuilderConfig } from './engine'

// ============================================================================
// Lorebook Extraction (Structured Selection)
// ============================================================================

/**
 * Extract phase-relevant lorebook entries via structured selection.
 * The sub-agent selects relevant entry IDs; original content is returned verbatim.
 */
async function extractFromLorebook(
  config: WorldBuilderConfig,
  lorebook: LorebookData,
  extractionInstruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const enabledEntries = lorebook.entries.filter((e) => e.enabled)
  if (enabledEntries.length === 0) return ''

  // Build lorebook full content for the sub-agent
  const metaParts: string[] = [`Lorebook: ${lorebook.name}`]
  if (lorebook.description) metaParts.push(`Description: ${lorebook.description}`)
  if (lorebook.scenario) metaParts.push(`Scenario: ${lorebook.scenario}`)
  if (lorebook.personality) metaParts.push(`Personality: ${lorebook.personality}`)
  if (lorebook.first_mes) metaParts.push(`First message: ${lorebook.first_mes}`)

  const entryList = enabledEntries
    .map((e) => {
      const keysStr = e.keys.length > 0 ? ` [keys: ${e.keys.join(', ')}]` : ''
      return `--- Entry #${e.id}: ${e.comment}${keysStr} ---\n${e.content}`
    })
    .join('\n\n')

  const sourceForSelection = `${metaParts.join('\n')}\n\n## Entries\n\n${entryList}`

  const secondaryLlm = config.secondaryLlm ?? config.llm

  const pipelineConfig: PipelineConfig = {
    model: secondaryLlm.model ?? config.llm.model!,
    apiKey: secondaryLlm.apiKey ?? config.llm.apiKey!,
    baseUrl: secondaryLlm.baseUrl ?? config.llm.baseUrl,
    temperature: secondaryLlm.temperature ?? 0.3,
    maxTokens: 4096,
    signal,
    apiMode: secondaryLlm.apiMode ?? config.llm.apiMode,
    extraBody: secondaryLlm.extraBody,
    headers: secondaryLlm.headers,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'lorebook_selection',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            outline: {
              type: 'string',
              description: 'Brief overview of how selected entries relate to this phase',
            },
            entry_ids: {
              type: 'array',
              items: { type: 'integer' },
              description: 'IDs of relevant lorebook entries',
            },
          },
          required: ['outline', 'entry_ids'],
          additionalProperties: false,
        },
      },
    },
  }

  const pipeline = new ChatStreamPipeline(pipelineConfig)

  try {
    const { blocks } = await pipeline.run([
      {
        role: 'system',
        content:
          'You are a lorebook analyst. Read the provided lorebook entries and the phase task description, then select which entries are relevant to the current phase. Output structured JSON.',
      },
      {
        role: 'user',
        content: `${sourceForSelection}\n\n---\n\n${extractionInstruction}\n\n---\n\nBased on the phase task above, select entries that are relevant or potentially useful.\nOutput JSON with:\n- "outline": brief overview of how the selected entries relate to this phase (1-3 sentences)\n- "entry_ids": array of entry IDs that are relevant\n\nBe inclusive — it's better to include marginally relevant entries than to miss important ones.`,
      },
    ])

    const jsonText = blocks
      .filter((b) => b.type === 'text' || b.type === 'markdown')
      .map((b) => b.content)
      .join('')
      .trim()

    if (!jsonText) return ''

    const selection = JSON.parse(jsonText) as { outline: string; entry_ids: number[] }
    const entryMap = new Map(enabledEntries.map((e) => [e.id, e]))
    const selectedEntries = selection.entry_ids
      .map((id) => entryMap.get(id))
      .filter((e): e is NonNullable<typeof e> => e != null)

    if (selectedEntries.length === 0) return ''

    // Build lossless output: outline + verbatim original entries
    const parts: string[] = []
    parts.push(`## Lorebook: ${lorebook.name}`)
    if (metaParts.length > 1) {
      parts.push(metaParts.slice(1).join('\n'))
    }
    parts.push(`### Relevance Overview\n${selection.outline}`)
    parts.push(`### Selected Entries (${selectedEntries.length}/${enabledEntries.length})`)
    for (const entry of selectedEntries) {
      const keysStr = entry.keys.length > 0 ? ` [keys: ${entry.keys.join(', ')}]` : ''
      parts.push(`--- Entry #${entry.id}: ${entry.comment}${keysStr} ---\n${entry.content}`)
    }
    return parts.join('\n\n')
  } catch {
    // Fallback: inject all entries verbatim
    const fallbackParts = [
      `## Lorebook: ${lorebook.name}\n${metaParts.slice(1).join('\n')}`,
    ]
    for (const entry of enabledEntries) {
      const keysStr = entry.keys.length > 0 ? ` [keys: ${entry.keys.join(', ')}]` : ''
      fallbackParts.push(
        `--- Entry #${entry.id}: ${entry.comment}${keysStr} ---\n${entry.content}`,
      )
    }
    return fallbackParts.join('\n\n')
  }
}

// ============================================================================
// File Extraction (Free-form)
// ============================================================================

/**
 * Extract phase-relevant content from the user's reference file and/or lorebook.
 * Returns extracted text or empty string if no reference material is attached.
 *
 * Uses the secondary model (or primary as fallback) for extraction
 * to keep the primary model focused on generation.
 */
export async function extractForPhase(
  config: WorldBuilderConfig,
  session: WBNSession,
  phaseId: WBNPhaseId,
  signal?: AbortSignal,
): Promise<string> {
  const file = session.referenceFile
  const lorebook = session.referenceLorebook
  if (!file && !lorebook) return ''

  const draft = session.phases.synopsis.output as WBNDraftOutput | undefined
  const story = session.phases.initial_story?.output as
    | { background?: string; start_story?: string }
    | undefined

  const extractionInstruction = getExtractionPrompt(phaseId, draft, story)

  const results: string[] = []

  // Lorebook path: structured selection (lossless)
  if (lorebook) {
    const lorebookResult = await extractFromLorebook(
      config,
      lorebook,
      extractionInstruction,
      signal,
    )
    if (lorebookResult) results.push(lorebookResult)
  }

  // File path: free-form extraction (lossy)
  if (file && file.type !== 'image') {
    const fileResult = await extractFromFile(config, file, extractionInstruction, signal)
    if (fileResult) results.push(fileResult)
  }

  return results.join('\n\n---\n\n')
}

// ============================================================================
// File Extraction Helper
// ============================================================================

async function extractFromFile(
  config: WorldBuilderConfig,
  file: { name: string; content: string },
  extractionInstruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const sourceContent = `## File: ${file.name}\n\n${file.content}`
  if (!sourceContent.trim()) return ''

  const secondaryLlm = config.secondaryLlm ?? config.llm

  const pipelineConfig: PipelineConfig = {
    model: secondaryLlm.model ?? config.llm.model!,
    apiKey: secondaryLlm.apiKey ?? config.llm.apiKey!,
    baseUrl: secondaryLlm.baseUrl ?? config.llm.baseUrl,
    temperature: secondaryLlm.temperature ?? 0.5,
    maxTokens: 20480,
    signal,
    apiMode: secondaryLlm.apiMode ?? config.llm.apiMode,
    extraBody: secondaryLlm.extraBody,
    headers: secondaryLlm.headers,
  }

  const pipeline = new ChatStreamPipeline(pipelineConfig)

  try {
    const { blocks } = await pipeline.run([
      {
        role: 'system',
        content:
          'You are a document analysis assistant. Read the provided material and extract information according to the instructions. Output a well-structured summary. Be thorough and detailed.',
      },
      {
        role: 'user',
        content: `${sourceContent}\n\n---\n\n${extractionInstruction}`,
      },
    ])

    const text = blocks
      .filter((b) => b.type === 'text' || b.type === 'markdown')
      .map((b) => b.content)
      .join('\n')
      .trim()

    return text
  } catch {
    return ''
  }
}
