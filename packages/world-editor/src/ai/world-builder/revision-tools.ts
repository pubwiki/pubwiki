/**
 * WorldBuilder Revision Tools
 *
 * Phase-appropriate revision tools and the revision streaming loop.
 * Uses ChatStreamPipeline with ToolRegistry for tool-calling.
 *
 * Migrated from worldBuilderNextChat.ts streamWBNRevision().
 */

import { ChatStreamPipeline, ToolRegistry, type PipelineConfig } from '@pubwiki/chat'
import { z } from 'zod'
import type { WBNPhaseId, WBNSession, WBNStreamEvent, LorebookData } from './types'
import { WBN_PHASE_IDS, WBN_PHASE_LABELS } from './types'
import type { WorldEditorAIContext } from '../types'
import { applyRevisionToState } from './service'
import type { WorldBuilderConfig } from './engine'

// ============================================================================
// Revision Tool Definitions
// ============================================================================

/** Map phaseId → which revision tool names are available */
const REVISION_TOOLS_BY_PHASE: Record<WBNPhaseId, string[]> = {
  synopsis: [
    'patch_draft',
    'patch_synopsis_region',
    'patch_synopsis_organization',
    'patch_synopsis_creature',
    'remove_synopsis_entry',
    'finish_revision',
  ],
  world_data: [
    'patch_world_data',
    'patch_document',
    'replace_document',
    'remove_entry',
    'finish_revision',
  ],
  regions: [
    'patch_region',
    'replace_region',
    'patch_entity_document',
    'replace_entity_document',
    'remove_entry',
    'finish_revision',
  ],
  organizations: [
    'patch_organization',
    'replace_organization',
    'patch_entity_document',
    'replace_entity_document',
    'remove_entry',
    'finish_revision',
  ],
  creatures: [
    'patch_creature',
    'replace_creature',
    'patch_entity_document',
    'replace_entity_document',
    'remove_entry',
    'finish_revision',
  ],
  initial_story: ['patch_story', 'finish_revision'],
}

/** Phase-specific format rules for revision */
const PHASE_RULES: Partial<Record<WBNPhaseId, string>> = {
  world_data: `
### World Data Format Rules
- creature_attr_fields: field_name (snake_case), hint, field_display_name (optional)
- GameTime: all 5 fields (year, month, day, hour, minute) required
- CustomComponentRegistry: do not duplicate built-in components (Inventory, Interaction, StatusEffects, Creature, LocationRef)
- documents: each at least 500 words; important ones 800+`,
  regions: `
### Region Format Rules
- paths must use: { src_location, src_region, discovered, to_region, to_location, description } — all 6 fields required`,
  organizations: `
### Organization Format Rules
- territories: region_id and location_id must reference valid IDs from the regions phase`,
  creatures: `
### Character Format Rules
- IsPlayer: only ONE player character gets \`IsPlayer: {}\`. New NPCs must NOT have it
- Inventory items: all 5 fields (id, count, name, description, details)
- appearance: { body: "physical description", clothing: "..." }
- attrs keys must match creature_attr_fields; CustomComponents must use registered component_keys`,
  initial_story: `
### Opening Story Format Rules
- background: 100-200 words; start_story: 200-500 words; no options/choices`,
}

function getRevisionSystemPrompt(phaseId: WBNPhaseId): string {
  const label = WBN_PHASE_LABELS[phaseId]
  const rules = PHASE_RULES[phaseId] || ''

  return `You are a game world-building assistant, currently **revising** the "${label}" phase output.

## Revision Rules
1. **Precise changes only**: Only modify what the user mentions; preserve everything else
2. Use patch_* tools for field-level merge/add operations
3. Use replace_* tools for full replacement operations
4. Use remove_entry for deletions
5. Call finish_revision when all changes are done
6. Explain your understanding and changes in natural language before/after modifying

Important: Prefer patch_* for partial changes. Only use replace_* when completely rewriting an entity.
${rules}`
}

// ============================================================================
// Build Revision Context
// ============================================================================

function buildRevisionContextMessages(
  phaseId: WBNPhaseId,
  session: WBNSession,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  const label = WBN_PHASE_LABELS[phaseId]

  // 1. Prior phase outputs as reference (read-only)
  const currentIdx = WBN_PHASE_IDS.indexOf(phaseId)
  for (let i = 0; i < currentIdx; i++) {
    const priorId = WBN_PHASE_IDS[i]
    const priorOutput = session.phases[priorId].output
    if (!priorOutput) continue

    const priorLabel = WBN_PHASE_LABELS[priorId]
    let priorJson: string
    try {
      priorJson = JSON.stringify(priorOutput, null, 2)
      if (priorJson.length > 15000) {
        priorJson = priorJson.substring(0, 15000) + '\n\n[... truncated ...]'
      }
    } catch {
      priorJson = String(priorOutput)
    }

    messages.push({
      role: 'user',
      content: `Here is the "${priorLabel}" data (read-only reference, do not modify):`,
    })
    messages.push({ role: 'assistant', content: priorJson })
  }

  // 2. Current phase output (the one being revised)
  const currentOutput = session.phases[phaseId].output
  let outputJson: string
  try {
    outputJson = JSON.stringify(currentOutput, null, 2)
    if (outputJson.length > 30000) {
      outputJson = outputJson.substring(0, 30000) + '\n\n[... data truncated ...]'
    }
  } catch {
    outputJson = String(currentOutput)
  }

  messages.push({
    role: 'user',
    content: `Here is the current "${label}" output data that you can modify using the patch/replace tools:`,
  })
  messages.push({ role: 'assistant', content: outputJson })

  return messages
}

// ============================================================================
// Sub-Agent Execution
// ============================================================================

/**
 * Execute a sub-agent call during revision for file or lorebook queries.
 */
async function executeFileSubagent(
  config: WorldBuilderConfig,
  session: WBNSession,
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const file = session.referenceFile
  if (!file || file.type === 'image') return 'No reference file available.'

  const secondaryLlm = config.secondaryLlm ?? config.llm
  const pipelineConfig: PipelineConfig = {
    model: secondaryLlm.model ?? config.llm.model!,
    apiKey: secondaryLlm.apiKey ?? config.llm.apiKey!,
    baseUrl: secondaryLlm.baseUrl ?? config.llm.baseUrl,
    temperature: secondaryLlm.temperature ?? 0.5,
    maxTokens: 20480,
    apiMode: secondaryLlm.apiMode ?? config.llm.apiMode,
    extraBody: secondaryLlm.extraBody,
    headers: secondaryLlm.headers,
    signal,
  }

  const pipeline = new ChatStreamPipeline(pipelineConfig)

  try {
    const { blocks } = await pipeline.run([
      {
        role: 'system',
        content:
          "You are a document analysis assistant. Read the provided file and extract/summarize information according to the user's instruction. Be thorough and detailed.",
      },
      {
        role: 'user',
        content: `## File: ${file.name}\n\n${file.content}\n\n---\n\n## Instruction\n\n${instruction}`,
      },
    ])

    return (
      blocks
        .filter((b) => b.type === 'text' || b.type === 'markdown')
        .map((b) => b.content)
        .join('\n')
        .trim() || 'Sub-agent returned empty result.'
    )
  } catch (e) {
    return `Sub-agent error: ${(e as Error).message}`
  }
}

async function executeLorebookSubagent(
  config: WorldBuilderConfig,
  lorebook: LorebookData,
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const enabledEntries = lorebook.entries.filter((e) => e.enabled)
  if (enabledEntries.length === 0) return 'Lorebook has no enabled entries.'

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

  const sourceContent = `${metaParts.join('\n')}\n\n## Entries\n\n${entryList}`

  const secondaryLlm = config.secondaryLlm ?? config.llm
  const pipelineConfig: PipelineConfig = {
    model: secondaryLlm.model ?? config.llm.model!,
    apiKey: secondaryLlm.apiKey ?? config.llm.apiKey!,
    baseUrl: secondaryLlm.baseUrl ?? config.llm.baseUrl,
    temperature: secondaryLlm.temperature ?? 0.3,
    maxTokens: 4096,
    apiMode: secondaryLlm.apiMode ?? config.llm.apiMode,
    extraBody: secondaryLlm.extraBody,
    headers: secondaryLlm.headers,
    signal,
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
              description: 'How selected entries relate to the instruction',
            },
            entry_ids: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Relevant entry IDs',
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
          "You are a lorebook analyst. Read the lorebook entries and select those relevant to the user's instruction. Output structured JSON.",
      },
      {
        role: 'user',
        content: `${sourceContent}\n\n---\n\n## Instruction\n\n${instruction}\n\n---\n\nSelect entries relevant to the instruction above.\nOutput JSON with:\n- "outline": brief explanation of how the selected entries relate to the instruction (1-3 sentences)\n- "entry_ids": array of relevant entry IDs\n\nBe inclusive — include marginally relevant entries rather than missing important ones.`,
      },
    ])

    const jsonText = blocks
      .filter((b) => b.type === 'text' || b.type === 'markdown')
      .map((b) => b.content)
      .join('')
      .trim()

    if (!jsonText) return 'Sub-agent returned empty result.'

    const selection = JSON.parse(jsonText) as { outline: string; entry_ids: number[] }
    const entryMap = new Map(enabledEntries.map((e) => [e.id, e]))
    const selectedEntries = selection.entry_ids
      .map((id) => entryMap.get(id))
      .filter((e): e is NonNullable<typeof e> => e != null)

    if (selectedEntries.length === 0)
      return `No relevant entries found. Outline: ${selection.outline}`

    const parts: string[] = []
    parts.push(
      `## Lorebook Reference (${selectedEntries.length}/${enabledEntries.length} entries selected)`,
    )
    parts.push(`**Relevance**: ${selection.outline}`)
    parts.push(
      `The following entries are provided as reference only — adapt flexibly based on user needs.\n`,
    )
    for (const entry of selectedEntries) {
      const keysStr = entry.keys.length > 0 ? ` [keys: ${entry.keys.join(', ')}]` : ''
      parts.push(`--- Entry #${entry.id}: ${entry.comment}${keysStr} ---\n${entry.content}`)
    }
    return parts.join('\n\n')
  } catch (e) {
    return `Sub-agent error: ${(e as Error).message}`
  }
}

// ============================================================================
// Build Revision Tool Registry
// ============================================================================

function buildRevisionToolRegistry(
  phaseId: WBNPhaseId,
  session: WBNSession,
  ctx: WorldEditorAIContext,
  config: WorldBuilderConfig,
  onPatch: (toolName: string, summary: string) => void,
  onFinish: (summary: string) => void,
  signal?: AbortSignal,
): ToolRegistry {
  const registry = new ToolRegistry()
  const allowedNames = new Set(REVISION_TOOLS_BY_PHASE[phaseId])

  // Define all tool schemas and handlers
  const allTools: Array<{
    name: string
    description: string
    schema: z.ZodType
    handler: (args: Record<string, unknown>) => Promise<string>
  }> = [
    {
      name: 'patch_draft',
      description: 'Modify draft text fields. Only pass fields you want to change.',
      schema: z.object({
        tone: z.string().optional(),
        opening: z.string().optional(),
        storyline: z.string().optional(),
        mechanics: z.string().optional(),
        protagonist: z.string().optional(),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_draft', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_draft', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_synopsis_region',
      description: 'Modify or add a region in the draft.',
      schema: z.object({ region_id: z.string(), name: z.string().optional() }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_synopsis_region', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_synopsis_region', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_synopsis_organization',
      description: 'Modify or add an organization in the draft.',
      schema: z.object({ organization_id: z.string(), name: z.string().optional() }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_synopsis_organization', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_synopsis_organization', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_synopsis_creature',
      description: 'Modify or add a character in the draft.',
      schema: z.object({
        creature_id: z.string(),
        name: z.string().optional(),
        is_player: z.boolean().optional(),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_synopsis_creature', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_synopsis_creature', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'remove_synopsis_entry',
      description: 'Remove a region, organization, or character from the draft.',
      schema: z.object({
        entry_type: z.enum(['region', 'organization', 'creature']),
        entry_id: z.string(),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'remove_synopsis_entry', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('remove_synopsis_entry', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_creature',
      description: 'Merge or add creature data.',
      schema: z.object({
        creature_id: z.string(),
        creature_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_creature', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_creature', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'replace_creature',
      description: "Completely replace a creature's data.",
      schema: z.object({
        creature_id: z.string(),
        creature_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'replace_creature', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('replace_creature', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_region',
      description: 'Merge or add region data.',
      schema: z.object({
        region_id: z.string(),
        region_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_region', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_region', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'replace_region',
      description: "Completely replace a region's data.",
      schema: z.object({
        region_id: z.string(),
        region_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'replace_region', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('replace_region', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_organization',
      description: 'Merge or add organization data.',
      schema: z.object({
        organization_id: z.string(),
        organization_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_organization', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_organization', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'replace_organization',
      description: "Completely replace an organization's data.",
      schema: z.object({
        organization_id: z.string(),
        organization_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'replace_organization', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('replace_organization', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_document',
      description: 'Modify or add a setting document.',
      schema: z.object({
        doc_name: z.string(),
        document_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_document', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_document', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'replace_document',
      description: 'Completely replace a setting document.',
      schema: z.object({
        doc_name: z.string(),
        document_data: z.record(z.string(), z.unknown()),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'replace_document', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('replace_document', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_entity_document',
      description: 'Modify or add a document for an entity.',
      schema: z.object({
        entity_type: z.enum(['creature', 'region', 'organization']),
        entity_id: z.string(),
        doc_name: z.string(),
        document_data: z.object({
          content: z.string().optional(),
          condition: z.string().optional(),
        }),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_entity_document', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_entity_document', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'replace_entity_document',
      description: 'Completely replace a document for an entity.',
      schema: z.object({
        entity_type: z.enum(['creature', 'region', 'organization']),
        entity_id: z.string(),
        doc_name: z.string(),
        document_data: z.object({
          content: z.string().optional(),
          condition: z.string().optional(),
          static_priority: z.number().optional(),
        }),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'replace_entity_document', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('replace_entity_document', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_story',
      description: 'Modify the opening story.',
      schema: z.object({
        background: z.string().optional(),
        start_story: z.string().optional(),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_story', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_story', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'patch_world_data',
      description: 'Incrementally modify world data.',
      schema: z.object({
        creature_attr_fields: z.array(z.record(z.string(), z.unknown())).optional(),
        GameTime: z.record(z.string(), z.unknown()).optional(),
        CustomComponentRegistry: z.record(z.string(), z.unknown()).optional(),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'patch_world_data', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('patch_world_data', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'remove_entry',
      description: 'Delete an entry from the phase output.',
      schema: z.object({
        entity_type: z.enum([
          'creature',
          'region',
          'organization',
          'document',
          'entity_document',
        ]),
        entity_id: z.string(),
      }),
      handler: async (args) => {
        const result = applyRevisionToState(phaseId, session.phases[phaseId].output, 'remove_entry', args, ctx)
        session.phases[phaseId].output = result.updatedOutput
        onPatch('remove_entry', result.summary)
        return `${result.summary}\n\nIf you have completed all changes, please call finish_revision now.`
      },
    },
    {
      name: 'use_file_subagent',
      description:
        'Query the reference file for specific information. Sends the file to a sub-agent with your instruction and returns the extracted information.',
      schema: z.object({
        instruction: z
          .string()
          .describe('What information to extract or analyze from the reference file'),
      }),
      handler: async (args) => {
        return executeFileSubagent(config, session, args.instruction as string, signal)
      },
    },
    {
      name: 'use_lorebook_subagent',
      description:
        'Query the reference lorebook for relevant entries. A sub-agent selects the most relevant entries and returns them verbatim.',
      schema: z.object({
        instruction: z
          .string()
          .describe(
            'What kind of information or entries to look for in the lorebook',
          ),
      }),
      handler: async (args) => {
        return executeLorebookSubagent(
          config,
          session.referenceLorebook!,
          args.instruction as string,
          signal,
        )
      },
    },
    {
      name: 'finish_revision',
      description: 'Signal that all requested revisions are complete.',
      schema: z.object({
        summary: z.string().describe('Revision summary'),
      }),
      handler: async (args) => {
        onFinish((args.summary as string) || 'Revision complete')
        return 'Revision complete.'
      },
    },
  ]

  // Conditionally allow sub-agent tools based on session references
  if (session.referenceFile) {
    allowedNames.add('use_file_subagent')
  }
  if (session.referenceLorebook) {
    allowedNames.add('use_lorebook_subagent')
  }

  // Register only the tools allowed for this phase
  for (const tool of allTools) {
    if (allowedNames.has(tool.name)) {
      registry.register(tool.name, tool.description, tool.schema, tool.handler as (args: unknown) => Promise<unknown>)
    }
  }

  return registry
}

// ============================================================================
// Revision Streaming
// ============================================================================

const MAX_ROUNDS = 20

/**
 * Run a revision conversation for a completed phase.
 * Uses tool-calling mode with patch tools for targeted changes.
 */
export async function* streamWorldBuilderRevision(
  config: WorldBuilderConfig,
  session: WBNSession,
  phaseId: WBNPhaseId,
  userMessage: string,
  ctx: WorldEditorAIContext,
  signal?: AbortSignal,
): AsyncGenerator<WBNStreamEvent> {
  if (!session.phases[phaseId].output) {
    yield { type: 'error', error: 'No output data for this phase — cannot revise.' }
    return
  }

  // Track patch and finish events from tool handlers
  const patchEvents: Array<{ toolName: string; summary: string }> = []
  let finishSummary: string | null = null

  const tools = buildRevisionToolRegistry(
    phaseId,
    session,
    ctx,
    config,
    (toolName, summary) => patchEvents.push({ toolName, summary }),
    (summary) => { finishSummary = summary },
    signal,
  )

  const contextMessages = buildRevisionContextMessages(phaseId, session)

  const pipelineConfig: PipelineConfig = {
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    temperature: config.llm.temperature ?? 0.7,
    maxTokens: config.llm.maxTokens ?? 20480,
    apiMode: config.llm.apiMode,
    reasoning: config.llm.reasoning,
    tools,
    maxIterations: MAX_ROUNDS,
    signal,
  }

  const pipeline = new ChatStreamPipeline(pipelineConfig)

  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: getRevisionSystemPrompt(phaseId) },
    ...contextMessages,
    { role: 'user', content: userMessage },
  ]

  for await (const event of pipeline.stream(messages)) {
    // Forward AI text
    if (event.type === 'token' && event.tokenType === 'text') {
      yield { type: 'ai_text', text: event.token }
    }

    // Forward tool call starts
    if (event.type === 'tool_call_start') {
      const toolName = event.block.toolName || ''
      yield { type: 'tool_call_start', toolCallId: event.block.toolCallId || '', toolName }
    }

    // After each tool completes, emit patch events and check for finish
    if (event.type === 'tool_call_complete') {
      // Emit any accumulated patch events
      for (const pe of patchEvents) {
        yield { type: 'revision_patch', toolName: pe.toolName, summary: pe.summary }
      }
      patchEvents.length = 0

      if (finishSummary !== null) {
        yield { type: 'revision_done', summary: finishSummary }
      }
    }

    // Pipeline complete
    if (event.type === 'complete') {
      if (finishSummary === null) {
        yield { type: 'revision_done', summary: 'Revision conversation completed.' }
      }
      yield { type: 'done' }
      return
    }

    if (event.type === 'iteration_limit_reached') {
      yield { type: 'revision_done', summary: 'Revision reached max rounds, auto-completed.' }
      yield { type: 'done' }
      return
    }
  }

  yield { type: 'done' }
}
