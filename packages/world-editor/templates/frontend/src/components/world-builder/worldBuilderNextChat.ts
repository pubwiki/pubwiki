/**
 * WorldBuilderNext Chat Engine (v3)
 *
 * Architecture: pre-extraction + structured output.
 * - Synopsis: optional pre-extract → query_user tool → structured output
 * - Other phases: pre-extract → single structured output call
 * - Revision: unchanged tool-calling loop with patch tools
 *
 * Key changes from v2:
 * - No more tool-calling loop for generation (no READONLY_TOOLS, no report tools)
 * - Sub-agent pre-extraction replaces LLM-driven file exploration
 * - response_format: json_schema replaces tool-call output
 */
import OpenAI from 'openai'
import type { StateData, CopilotConfig, CopilotModelConfig } from '../../api/types'
import type {
    WBNPhaseId,
    WBNSession,
    WBNStreamEvent,
    QueryUserRequest,
    QueryUserField,
    WBNDraftOutput,
} from '../../api/worldBuilderNextTypes'
import { WBN_PHASE_IDS } from '../../api/worldBuilderNextTypes'
import {
    getPhaseSystemPrompt,
    getPhaseUserInstruction,
    getPhaseOutputSchema,
    getExtractionPrompt,
    QUERY_USER_TOOL,
    SYNOPSIS_QUERY_INSTRUCTION,
} from '../../api/worldBuilderNextPrompts'
import {
    buildPhaseMessages,
    applyRevisionToState,
} from '../../api/worldBuilderNextService'
import {
    validatePhaseOutput,
    formatValidationErrorsForAI,
} from '../../api/worldBuilderNextValidation'
import { wbLogger } from './worldBuilderLogger'

// ============================================================================
// Tool Context (simplified — no more getFiles/getLorebooks)
// ============================================================================

export interface WBNToolContext {
    state: StateData
    session: WBNSession
    config: CopilotConfig
    queryUser?: (request: QueryUserRequest) => Promise<Record<string, unknown>>
}

// ============================================================================
// Reasoning Effort Helper
// ============================================================================

function getReasoningParams(modelConfig: CopilotModelConfig): Record<string, unknown> {
    const effort = modelConfig.reasoning?.effort
    if (!effort) return {}
    return { reasoning: { effort } }
}

// ============================================================================
// Pre-Extraction: Sub-Agent File/Lorebook Processing
// ============================================================================

/**
 * Call the secondary model to extract phase-relevant content from the
 * user's reference file or lorebook. Returns extracted text or empty string.
 *
 * For lorebook: uses structured output to select relevant entry IDs, then
 * injects original entry content verbatim (lossless). The sub-agent only
 * provides an outline + which entries are relevant.
 *
 * For plain files: uses free-form extraction (lossy but necessary since
 * files are unstructured).
 */
async function extractForPhase(
    config: CopilotConfig,
    session: WBNSession,
    phaseId: WBNPhaseId,
): Promise<string> {
    const file = session.referenceFile
    const lorebook = session.referenceLorebook
    if (!file && !lorebook) return ''

    const draft = session.phases.synopsis.output as WBNDraftOutput | undefined
    const story = session.phases.initial_story?.output as { background?: string; start_story?: string } | undefined

    const extractionInstruction = getExtractionPrompt(phaseId, draft, story)

    const client = new OpenAI({
        apiKey: config.secondaryModel.apiKey || config.primaryModel.apiKey,
        baseURL: config.secondaryModel.baseUrl || config.primaryModel.baseUrl,
        dangerouslyAllowBrowser: true
    })
    const model = config.secondaryModel.model || config.primaryModel.model

    // ── Lorebook path: structured selection (lossless) ──
    if (lorebook) {
        const enabledEntries = lorebook.entries.filter(e => e.enabled)
        if (enabledEntries.length === 0) return ''

        // Build lorebook full content for the sub-agent (lorebook entries are
        // already curated & concise — send them in full, it's cheap)
        const metaParts: string[] = [`Lorebook: ${lorebook.name}`]
        if (lorebook.description) metaParts.push(`Description: ${lorebook.description}`)
        if (lorebook.scenario) metaParts.push(`Scenario: ${lorebook.scenario}`)
        if (lorebook.personality) metaParts.push(`Personality: ${lorebook.personality}`)
        if (lorebook.first_mes) metaParts.push(`First message: ${lorebook.first_mes}`)

        const entryList = enabledEntries.map(e => {
            const keysStr = e.keys.length > 0 ? ` [keys: ${e.keys.join(', ')}]` : ''
            return `--- Entry #${e.id}: ${e.comment}${keysStr} ---\n${e.content}`
        }).join('\n\n')

        const sourceForSelection = `${metaParts.join('\n')}\n\n## Entries\n\n${entryList}`

        wbLogger.log({ category: 'system', message: `extractForPhase(${phaseId}): lorebook selection — ${enabledEntries.length} entries, calling secondary model` })

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a lorebook analyst. Read the provided lorebook entries and the phase task description, then select which entries are relevant to the current phase. Output structured JSON.'
                    },
                    {
                        role: 'user',
                        content: `${sourceForSelection}\n\n---\n\n${extractionInstruction}\n\n---\n\nBased on the phase task above, select entries that are relevant or potentially useful.\nOutput JSON with:\n- "outline": brief overview of how the selected entries relate to this phase (1-3 sentences)\n- "entry_ids": array of entry IDs that are relevant\n\nBe inclusive — it's better to include marginally relevant entries than to miss important ones.`
                    }
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'lorebook_selection',
                        strict: true,
                        schema: {
                            type: 'object',
                            properties: {
                                outline: { type: 'string', description: 'Brief overview of how selected entries relate to this phase' },
                                entry_ids: { type: 'array', items: { type: 'integer' }, description: 'IDs of relevant lorebook entries' }
                            },
                            required: ['outline', 'entry_ids'],
                            additionalProperties: false
                        }
                    }
                } as any,
                max_tokens: 4096,
            })

            const content = response.choices[0]?.message?.content
            if (!content) {
                wbLogger.log({ category: 'error', message: `extractForPhase(${phaseId}): lorebook selection returned empty` })
                return ''
            }

            const selection = JSON.parse(content) as { outline: string; entry_ids: number[] }
            const entryMap = new Map(enabledEntries.map(e => [e.id, e]))
            const selectedEntries = selection.entry_ids
                .map(id => entryMap.get(id))
                .filter((e): e is NonNullable<typeof e> => e != null)

            wbLogger.log({ category: 'system', message: `extractForPhase(${phaseId}): selected ${selectedEntries.length}/${enabledEntries.length} lorebook entries` })

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
        } catch (e) {
            wbLogger.log({ category: 'error', message: `extractForPhase(${phaseId}): lorebook selection failed — ${(e as Error).message}` })
            // Fallback: inject all entries verbatim
            const fallbackParts = [`## Lorebook: ${lorebook.name}\n${metaParts.slice(1).join('\n')}`]
            for (const entry of enabledEntries) {
                const keysStr = entry.keys.length > 0 ? ` [keys: ${entry.keys.join(', ')}]` : ''
                fallbackParts.push(`--- Entry #${entry.id}: ${entry.comment}${keysStr} ---\n${entry.content}`)
            }
            return fallbackParts.join('\n\n')
        }
    }

    // ── File path: free-form extraction (lossy, file is unstructured) ──
    if (file && file.type !== 'image') {
        const sourceContent = `## File: ${file.name}\n\n${file.content}`
        if (!sourceContent.trim()) return ''

        try {
            wbLogger.log({ category: 'system', message: `extractForPhase(${phaseId}): file extraction — calling secondary model (${sourceContent.length} chars)` })

            const response = await client.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a document analysis assistant. Read the provided material and extract information according to the instructions. Output a well-structured summary. Be thorough and detailed.'
                    },
                    {
                        role: 'user',
                        content: `${sourceContent}\n\n---\n\n${extractionInstruction}`
                    }
                ],
                max_tokens: 20480,
            })

            const result = response.choices[0]?.message?.content || ''
            wbLogger.log({ category: 'system', message: `extractForPhase(${phaseId}): extracted ${result.length} chars` })
            return result
        } catch (e) {
            wbLogger.log({ category: 'error', message: `extractForPhase(${phaseId}): file extraction failed — ${(e as Error).message}` })
            return ''
        }
    }

    return ''
}

// ============================================================================
// Sub-agent Tool Execution (for revision flow)
// ============================================================================

/**
 * Execute a sub-agent tool call during revision. Dispatches to the secondary
 * model with the appropriate source material and instruction.
 *
 * - use_file_subagent: sends the file content + instruction, returns free-form summary
 * - use_lorebook_subagent: sends all lorebook entries + instruction, returns
 *   selected entry IDs via structured output, then formats original entries verbatim
 */
async function executeSubagentTool(
    toolName: string,
    instruction: string,
    config: CopilotConfig,
    session: WBNSession
): Promise<string> {
    const client = new OpenAI({
        apiKey: config.secondaryModel.apiKey || config.primaryModel.apiKey,
        baseURL: config.secondaryModel.baseUrl || config.primaryModel.baseUrl,
        dangerouslyAllowBrowser: true
    })
    const model = config.secondaryModel.model || config.primaryModel.model

    if (toolName === SUBAGENT_TOOL_NAMES.file) {
        const file = session.referenceFile
        if (!file || file.type === 'image') return 'No reference file available.'

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a document analysis assistant. Read the provided file and extract/summarize information according to the user\'s instruction. Be thorough and detailed.'
                    },
                    {
                        role: 'user',
                        content: `## File: ${file.name}\n\n${file.content}\n\n---\n\n## Instruction\n\n${instruction}`
                    }
                ],
                max_tokens: 20480,
            })
            return response.choices[0]?.message?.content || 'Sub-agent returned empty result.'
        } catch (e) {
            wbLogger.log({ category: 'error', message: `executeSubagentTool(file): ${(e as Error).message}` })
            return `Sub-agent error: ${(e as Error).message}`
        }
    }

    if (toolName === SUBAGENT_TOOL_NAMES.lorebook) {
        const lorebook = session.referenceLorebook
        if (!lorebook) return 'No lorebook available.'

        const enabledEntries = lorebook.entries.filter(e => e.enabled)
        if (enabledEntries.length === 0) return 'Lorebook has no enabled entries.'

        // Build full lorebook content for the sub-agent
        const metaParts: string[] = [`Lorebook: ${lorebook.name}`]
        if (lorebook.description) metaParts.push(`Description: ${lorebook.description}`)
        if (lorebook.scenario) metaParts.push(`Scenario: ${lorebook.scenario}`)
        if (lorebook.personality) metaParts.push(`Personality: ${lorebook.personality}`)
        if (lorebook.first_mes) metaParts.push(`First message: ${lorebook.first_mes}`)

        const entryList = enabledEntries.map(e => {
            const keysStr = e.keys.length > 0 ? ` [keys: ${e.keys.join(', ')}]` : ''
            return `--- Entry #${e.id}: ${e.comment}${keysStr} ---\n${e.content}`
        }).join('\n\n')

        const sourceContent = `${metaParts.join('\n')}\n\n## Entries\n\n${entryList}`

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a lorebook analyst. Read the lorebook entries and select those relevant to the user\'s instruction. Output structured JSON.'
                    },
                    {
                        role: 'user',
                        content: `${sourceContent}\n\n---\n\n## Instruction\n\n${instruction}\n\n---\n\nSelect entries relevant to the instruction above.\nOutput JSON with:\n- "outline": brief explanation of how the selected entries relate to the instruction (1-3 sentences)\n- "entry_ids": array of relevant entry IDs\n\nBe inclusive — include marginally relevant entries rather than missing important ones.`
                    }
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'lorebook_selection',
                        strict: true,
                        schema: {
                            type: 'object',
                            properties: {
                                outline: { type: 'string', description: 'How selected entries relate to the instruction' },
                                entry_ids: { type: 'array', items: { type: 'integer' }, description: 'Relevant entry IDs' }
                            },
                            required: ['outline', 'entry_ids'],
                            additionalProperties: false
                        }
                    }
                } as any,
                max_tokens: 4096,
            })

            const content = response.choices[0]?.message?.content
            if (!content) return 'Sub-agent returned empty result.'

            const selection = JSON.parse(content) as { outline: string; entry_ids: number[] }
            const entryMap = new Map(enabledEntries.map(e => [e.id, e]))
            const selectedEntries = selection.entry_ids
                .map(id => entryMap.get(id))
                .filter((e): e is NonNullable<typeof e> => e != null)

            if (selectedEntries.length === 0) return `No relevant entries found. Outline: ${selection.outline}`

            // Format: outline + verbatim original entries
            const parts: string[] = []
            parts.push(`## Lorebook Reference (${selectedEntries.length}/${enabledEntries.length} entries selected)`)
            parts.push(`**Relevance**: ${selection.outline}`)
            parts.push(`The following entries are provided as reference only — adapt flexibly based on user needs.\n`)
            for (const entry of selectedEntries) {
                const keysStr = entry.keys.length > 0 ? ` [keys: ${entry.keys.join(', ')}]` : ''
                parts.push(`--- Entry #${entry.id}: ${entry.comment}${keysStr} ---\n${entry.content}`)
            }
            return parts.join('\n\n')
        } catch (e) {
            wbLogger.log({ category: 'error', message: `executeSubagentTool(lorebook): ${(e as Error).message}` })
            return `Sub-agent error: ${(e as Error).message}`
        }
    }

    return `Unknown sub-agent tool: ${toolName}`
}

// ============================================================================
// Synopsis Phase: query_user → structured output
// ============================================================================

/**
 * Execute the query_user tool call and return the formatted result.
 */
async function executeQueryUser(
    args: Record<string, unknown>,
    queryUser: (request: QueryUserRequest) => Promise<Record<string, unknown>>
): Promise<string> {
    const title = args.title as string || 'Please answer the following questions'
    const fields = args.fields as QueryUserField[] || []
    if (fields.length === 0) return 'Error: form fields are empty.'

    const result = await queryUser({ title, fields })
    const answeredLines: string[] = []
    const customLines: string[] = []
    const aiDecideLines: string[] = []

    for (const field of fields) {
        const value = result[field.key]
        if (value === '__AI_DECIDE__') {
            aiDecideLines.push(`- **${field.label}**`)
        } else if (value !== undefined && value !== '' && value !== null) {
            const isCustom = (field.type === 'select' || field.type === 'multiselect')
                && typeof value === 'string'
                && !(field.options || []).includes(value)
            if (isCustom) {
                customLines.push(`- **${field.label}**: ${JSON.stringify(value)}`)
            } else {
                answeredLines.push(`- **${field.label}**: ${JSON.stringify(value)}`)
            }
        }
    }

    const sections: string[] = [`User submitted form "${title}":`]
    if (answeredLines.length > 0) { sections.push('\n**User selections:**'); sections.push(...answeredLines) }
    if (customLines.length > 0) { sections.push('\n**User custom input:**'); sections.push(...customLines) }
    if (aiDecideLines.length > 0) { sections.push('\n**The following are for you (AI) to decide:**'); sections.push(...aiDecideLines) }
    return sections.join('\n')
}

/**
 * Run the synopsis phase:
 * 1. Pre-extract file summary (if exists)
 * 2. LLM call with query_user tool → collect user preferences
 * 3. Structured output call → generate draft
 */
async function* runSynopsisPhase(
    config: CopilotConfig,
    session: WBNSession,
    context: WBNToolContext
): AsyncGenerator<WBNStreamEvent> {
    const client = new OpenAI({
        apiKey: config.primaryModel.apiKey,
        baseURL: config.primaryModel.baseUrl,
        dangerouslyAllowBrowser: true
    })

    // Step 1: Pre-extract file summary
    yield { type: 'extraction_progress', message: 'Analyzing reference materials...' }
    const extractedSummary = await extractForPhase(config, session, 'synopsis')

    // Step 2: query_user phase — collect design preferences
    const messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }> = []

    // Initial user message
    let userPrompt = session.initialPrompt
    if (extractedSummary) {
        userPrompt += `\n\n## Reference Material (for reference only — adapt flexibly based on user needs)\n\n${extractedSummary}`
    }
    messages.push({ role: 'user', content: userPrompt })

    // Add query instruction
    messages.push({ role: 'user', content: SYNOPSIS_QUERY_INSTRUCTION })

    wbLogger.log({ category: 'system', message: 'Synopsis: starting query_user phase' })

    // Call LLM with query_user tool
    const queryResponse = await client.chat.completions.create({
        model: config.primaryModel.model,
        messages: [
            { role: 'system', content: getPhaseSystemPrompt() },
            ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        ],
        tools: [QUERY_USER_TOOL],
        temperature: config.primaryModel.temperature || 0.7,
        max_tokens: 20480,
        ...getReasoningParams(config.primaryModel),
    })

    const queryChoice = queryResponse.choices[0]
    if (!queryChoice) {
        yield { type: 'error', error: 'API returned empty response.' }
        return
    }

    const queryAssistant = queryChoice.message
    const queryToolCalls = (queryAssistant.tool_calls || []).filter(tc => tc.type === 'function')

    if (queryAssistant.content?.trim()) {
        yield { type: 'ai_text', text: queryAssistant.content }
    }

    let userDesignNotes = ''

    if (queryToolCalls.length > 0 && queryToolCalls[0].function.name === 'query_user' && context.queryUser) {
        const tc = queryToolCalls[0]
        let parsedArgs: Record<string, unknown> = {}
        try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}')
        } catch {
            try {
                const { jsonrepair } = await import('jsonrepair')
                parsedArgs = JSON.parse(jsonrepair(tc.function.arguments || '{}'))
            } catch {
                parsedArgs = {}
            }
        }

        // Emit query_user event for UI
        yield { type: 'query_user', request: parsedArgs as any as QueryUserRequest }

        // Wait for user response
        userDesignNotes = await executeQueryUser(parsedArgs, context.queryUser)
        wbLogger.log({ category: 'system', message: `Synopsis: user design notes collected (${userDesignNotes.length} chars)` })

        // Save user design notes to session
        session.userDesignNotes = userDesignNotes
    }

    // Step 3: Structured output call — generate draft
    yield { type: 'extraction_progress', message: 'Generating draft...' }

    const draftMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: userPrompt },
    ]
    if (userDesignNotes) {
        draftMessages.push({ role: 'user', content: `## User Design Preferences (survey answers)\n\n${userDesignNotes}` })
    }
    draftMessages.push({ role: 'user', content: getPhaseUserInstruction('synopsis') })

    const draftSchema = getPhaseOutputSchema('synopsis')

    // Stream the draft generation to show live progress
    const draftStream = await client.chat.completions.create({
        model: config.primaryModel.model,
        messages: [
            { role: 'system', content: getPhaseSystemPrompt() },
            ...draftMessages,
        ],
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'draft_output',
                strict: true,
                schema: draftSchema,
            }
        } as any,
        temperature: config.primaryModel.temperature || 0.7,
        max_tokens: 20480,
        stream: true,
        ...getReasoningParams(config.primaryModel),
    })

    let draftContent = ''
    let draftLastProgressAt = -1

    for await (const chunk of draftStream) {
        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
            draftContent += delta
            if (draftLastProgressAt < 0 || draftContent.length - draftLastProgressAt >= 500) {
                draftLastProgressAt = draftContent.length
                yield { type: 'streaming_progress', charCount: draftContent.length }
            }
        }
    }

    if (draftContent.length > draftLastProgressAt) {
        yield { type: 'streaming_progress', charCount: draftContent.length }
    }

    if (!draftContent) {
        yield { type: 'error', error: 'Draft generation returned empty response.' }
        return
    }

    try {
        let draftOutput = JSON.parse(draftContent)
        yield { type: 'draft_review', draft: draftOutput as WBNDraftOutput }
        yield { type: 'phase_output', phaseId: 'synopsis', output: draftOutput }
        yield { type: 'done' }
    } catch (e) {
        try {
            const { jsonrepair } = await import('jsonrepair')
            let draftOutput = JSON.parse(jsonrepair(draftContent))
            yield { type: 'draft_review', draft: draftOutput as WBNDraftOutput }
            yield { type: 'phase_output', phaseId: 'synopsis', output: draftOutput }
            yield { type: 'done' }
        } catch {
            yield { type: 'error', error: `Failed to parse draft output: ${(e as Error).message}` }
        }
    }
}

// ============================================================================
// Data Phase: pre-extract → structured output
// ============================================================================

/**
 * Run a data generation phase (non-synopsis):
 * 1. Pre-extract relevant content from file/lorebook
 * 2. Build context messages (prior phases + extracted content + phase instruction)
 * 3. Single structured output call
 * 4. Validate → emit phase_output
 */
async function* runDataPhase(
    config: CopilotConfig,
    session: WBNSession,
    phaseId: WBNPhaseId,
): AsyncGenerator<WBNStreamEvent> {
    const client = new OpenAI({
        apiKey: config.primaryModel.apiKey,
        baseURL: config.primaryModel.baseUrl,
        dangerouslyAllowBrowser: true
    })

    // Step 1: Pre-extract
    yield { type: 'extraction_progress', message: 'Extracting relevant content from reference materials...' }
    const extractedContent = await extractForPhase(config, session, phaseId)

    // Step 2: Build messages
    const contextMessages = buildPhaseMessages(session, extractedContent)

    wbLogger.log({ category: 'system', message: `Phase ${phaseId}: ${contextMessages.length} context messages, ${extractedContent.length} chars extracted` })

    // Step 3: Structured output call
    yield { type: 'extraction_progress', message: 'Generating structured data...' }

    const schema = getPhaseOutputSchema(phaseId)
    const MAX_VALIDATION_RETRIES = 2

    // We may need to retry if validation fails — build a mutable message list
    const messages = [...contextMessages]
    let validationRetries = 0

    for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
        // Stream the response to show live character count
        const stream = await client.chat.completions.create({
            model: config.primaryModel.model,
            messages: [
                { role: 'system', content: getPhaseSystemPrompt() },
                ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: `${phaseId}_output`,
                    strict: true,
                    schema,
                }
            } as any,
            temperature: config.primaryModel.temperature || 0.7,
            max_tokens: 20480,
            stream: true,
            ...getReasoningParams(config.primaryModel),
        })

        let fullContent = ''
        let lastProgressAt = -1 // -1 = no progress sent yet, emit immediately on first content

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) {
                fullContent += delta
                // Emit immediately on first content, then throttle every 500 chars
                if (lastProgressAt < 0 || fullContent.length - lastProgressAt >= 500) {
                    lastProgressAt = fullContent.length
                    yield { type: 'streaming_progress', charCount: fullContent.length }
                }
            }
        }

        // Final progress
        if (fullContent.length > lastProgressAt) {
            yield { type: 'streaming_progress', charCount: fullContent.length }
        }

        if (!fullContent) {
            yield { type: 'error', error: `Phase ${phaseId}: API returned empty response.` }
            return
        }

        let output: Record<string, unknown>
        try {
            output = JSON.parse(fullContent)
        } catch (e) {
            try {
                const { jsonrepair } = await import('jsonrepair')
                output = JSON.parse(jsonrepair(fullContent))
            } catch {
                yield { type: 'error', error: `Phase ${phaseId}: Failed to parse output JSON.` }
                return
            }
        }

        // Validate
        const validationResult = validatePhaseOutput(phaseId, output, session)

        if (!validationResult.valid && attempt < MAX_VALIDATION_RETRIES) {
            validationRetries++
            yield { type: 'validation_retry', attempt: validationRetries, errors: validationResult.errors, accepted: false }

            // Add the failed output + errors as context for retry
            const errorMsg = formatValidationErrorsForAI(validationResult)
            messages.push({ role: 'assistant', content: fullContent })
            messages.push({ role: 'user', content: `The output above has validation errors. Please fix them and regenerate:\n\n${errorMsg}` })

            wbLogger.log({ category: 'system', message: `Phase ${phaseId}: validation failed (attempt ${validationRetries}), retrying` })
            continue
        }

        if (!validationResult.valid) {
            // Accept with errors after max retries
            yield { type: 'validation_retry', attempt: validationRetries + 1, errors: validationResult.errors, accepted: true }
            wbLogger.log({ category: 'system', message: `Phase ${phaseId}: accepting output with validation errors after max retries` })
        }

        if (validationResult.warnings.length > 0) {
            wbLogger.log({ category: 'system', message: `Phase ${phaseId}: ${validationResult.warnings.length} warning(s)`, data: validationResult.warnings })
        }

        yield { type: 'phase_output', phaseId, output }
        yield { type: 'done' }
        return
    }
}

// ============================================================================
// Main: streamWBNPhase (public entry point)
// ============================================================================

/**
 * Run one phase of the WorldBuilderNext pipeline.
 *
 * v3 architecture:
 * - Synopsis: pre-extract → query_user → structured output
 * - Other phases: pre-extract → structured output
 *
 * Yields WBNStreamEvent as the phase progresses.
 */
export async function* streamWBNPhase(
    config: CopilotConfig,
    session: WBNSession,
    phaseId: WBNPhaseId,
    context: WBNToolContext
): AsyncGenerator<WBNStreamEvent> {
    try {
        if (phaseId === 'synopsis') {
            yield* runSynopsisPhase(config, session, context)
        } else {
            yield* runDataPhase(config, session, phaseId)
        }
    } catch (e) {
        wbLogger.log({ category: 'error', message: `Phase ${phaseId}: unhandled error — ${(e as Error).message}` })
        yield { type: 'error', error: (e as Error).message }
    }
}

// ============================================================================
// Revision Tools (unchanged from v2)
// ============================================================================

const REVISION_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'patch_creature',
            description: 'Merge or add creature data. If creature_id exists, merge; otherwise create new.',
            parameters: {
                type: 'object',
                properties: {
                    creature_id: { type: 'string', description: 'Creature ID' },
                    creature_data: { type: 'object', description: 'Complete creature data object' },
                },
                required: ['creature_id', 'creature_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_creature',
            description: 'Completely replace a creature\'s data.',
            parameters: {
                type: 'object',
                properties: {
                    creature_id: { type: 'string', description: 'Creature ID' },
                    creature_data: { type: 'object', description: 'Complete creature data (will fully overwrite)' },
                },
                required: ['creature_id', 'creature_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_region',
            description: 'Merge or add region data. If region_id exists, merge; otherwise create new.',
            parameters: {
                type: 'object',
                properties: {
                    region_id: { type: 'string', description: 'Region ID' },
                    region_data: { type: 'object', description: 'Region data object' },
                },
                required: ['region_id', 'region_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_region',
            description: 'Completely replace a region\'s data.',
            parameters: {
                type: 'object',
                properties: {
                    region_id: { type: 'string', description: 'Region ID' },
                    region_data: { type: 'object', description: 'Complete region data' },
                },
                required: ['region_id', 'region_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_organization',
            description: 'Merge or add organization data.',
            parameters: {
                type: 'object',
                properties: {
                    organization_id: { type: 'string', description: 'Organization ID' },
                    organization_data: { type: 'object', description: 'Organization data object' },
                },
                required: ['organization_id', 'organization_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_organization',
            description: 'Completely replace an organization\'s data.',
            parameters: {
                type: 'object',
                properties: {
                    organization_id: { type: 'string', description: 'Organization ID' },
                    organization_data: { type: 'object', description: 'Complete organization data' },
                },
                required: ['organization_id', 'organization_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_document',
            description: 'Modify or add a setting document. Finds by name; merges if exists, creates if not.',
            parameters: {
                type: 'object',
                properties: {
                    doc_name: { type: 'string', description: 'Document name' },
                    document_data: { type: 'object', description: 'Document data' },
                },
                required: ['doc_name', 'document_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_document',
            description: 'Completely replace a setting document.',
            parameters: {
                type: 'object',
                properties: {
                    doc_name: { type: 'string', description: 'Document name' },
                    document_data: { type: 'object', description: 'Complete document data' },
                },
                required: ['doc_name', 'document_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_entity_document',
            description: 'Modify or add a document for an entity (creature/region/organization).',
            parameters: {
                type: 'object',
                properties: {
                    entity_type: { type: 'string', enum: ['creature', 'region', 'organization'] },
                    entity_id: { type: 'string', description: 'Entity ID' },
                    doc_name: { type: 'string', description: 'Document name' },
                    document_data: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Document content (Markdown)' },
                            condition: { type: 'string', description: 'RAG recall condition' },
                        },
                    },
                },
                required: ['entity_type', 'entity_id', 'doc_name', 'document_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_entity_document',
            description: 'Completely replace a document for an entity.',
            parameters: {
                type: 'object',
                properties: {
                    entity_type: { type: 'string', enum: ['creature', 'region', 'organization'] },
                    entity_id: { type: 'string', description: 'Entity ID' },
                    doc_name: { type: 'string', description: 'Document name' },
                    document_data: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Document content (Markdown)' },
                            condition: { type: 'string', description: 'RAG recall condition' },
                            static_priority: { type: 'number', description: 'Static priority' },
                        },
                    },
                },
                required: ['entity_type', 'entity_id', 'doc_name', 'document_data'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_story',
            description: 'Modify the opening story.',
            parameters: {
                type: 'object',
                properties: {
                    background: { type: 'string', description: 'New background narration' },
                    start_story: { type: 'string', description: 'New opening story' },
                },
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_world_data',
            description: 'Incrementally modify world data (attribute fields, time system, custom components).',
            parameters: {
                type: 'object',
                properties: {
                    creature_attr_fields: { type: 'array', items: { type: 'object' }, description: 'Attribute fields to add/update (merged by field_name)' },
                    GameTime: { type: 'object', description: 'Fields to merge into existing GameTime' },
                    CustomComponentRegistry: { type: 'object', description: 'Custom component registry to merge (by component_key)' },
                },
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remove_entry',
            description: 'Delete an entry (creature/region/organization/document/entity_document).',
            parameters: {
                type: 'object',
                properties: {
                    entity_type: {
                        type: 'string',
                        enum: ['creature', 'region', 'organization', 'document', 'entity_document'],
                    },
                    entity_id: {
                        type: 'string',
                        description: 'Entry identifier. For entity_document use "entity_type/entity_id/doc_name".',
                    },
                },
                required: ['entity_type', 'entity_id'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_draft',
            description: 'Modify draft text fields. Only pass fields you want to change.',
            parameters: {
                type: 'object',
                properties: {
                    tone: { type: 'string' },
                    opening: { type: 'string' },
                    storyline: { type: 'string' },
                    mechanics: { type: 'string' },
                    protagonist: { type: 'string' },
                },
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_synopsis_region',
            description: 'Modify or add a region in the draft.',
            parameters: {
                type: 'object',
                properties: {
                    region_id: { type: 'string' },
                    name: { type: 'string' },
                },
                required: ['region_id'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_synopsis_organization',
            description: 'Modify or add an organization in the draft.',
            parameters: {
                type: 'object',
                properties: {
                    organization_id: { type: 'string' },
                    name: { type: 'string' },
                },
                required: ['organization_id'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_synopsis_creature',
            description: 'Modify or add a character in the draft.',
            parameters: {
                type: 'object',
                properties: {
                    creature_id: { type: 'string' },
                    name: { type: 'string' },
                    is_player: { type: 'boolean' },
                },
                required: ['creature_id'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remove_synopsis_entry',
            description: 'Remove a region, organization, or character from the draft.',
            parameters: {
                type: 'object',
                properties: {
                    entry_type: {
                        type: 'string',
                        enum: ['region', 'organization', 'creature'],
                    },
                    entry_id: { type: 'string' },
                },
                required: ['entry_type', 'entry_id'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'finish_revision',
            description: 'Signal that all requested revisions are complete.',
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Revision summary' },
                },
                required: ['summary'],
            }
        }
    },
    // Sub-agent tools — dynamically included based on session.referenceFile / referenceLorebook
    {
        type: 'function',
        function: {
            name: 'use_file_subagent',
            description: 'Query the user\'s uploaded reference file via a sub-agent. The sub-agent will read the file and return a summary/extraction based on your instruction. Use this when the user\'s revision request references material from their uploaded file.',
            parameters: {
                type: 'object',
                properties: {
                    instruction: { type: 'string', description: 'What information to look for or extract from the file. Be specific about what you need.' },
                },
                required: ['instruction'],
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'use_lorebook_subagent',
            description: 'Query the user\'s uploaded lorebook via a sub-agent. The sub-agent will read all lorebook entries and select the ones relevant to your instruction, returning the original entry content verbatim. Use this when the user\'s revision request references material from their lorebook.',
            parameters: {
                type: 'object',
                properties: {
                    instruction: { type: 'string', description: 'What kind of information you need from the lorebook. Be specific about what characters, lore, or details you are looking for.' },
                },
                required: ['instruction'],
            }
        }
    },
]

/** Sub-agent tool names — only included when session has corresponding data */
const SUBAGENT_TOOL_NAMES = {
    file: 'use_file_subagent',
    lorebook: 'use_lorebook_subagent',
} as const

/** Map phaseId → which revision tool names are available */
const REVISION_TOOLS_BY_PHASE: Record<WBNPhaseId, string[]> = {
    synopsis: ['patch_draft', 'patch_synopsis_region', 'patch_synopsis_organization', 'patch_synopsis_creature', 'remove_synopsis_entry', 'finish_revision'],
    world_data: ['patch_world_data', 'patch_document', 'replace_document', 'remove_entry', 'finish_revision'],
    regions: ['patch_region', 'replace_region', 'patch_entity_document', 'replace_entity_document', 'remove_entry', 'finish_revision'],
    organizations: ['patch_organization', 'replace_organization', 'patch_entity_document', 'replace_entity_document', 'remove_entry', 'finish_revision'],
    creatures: ['patch_creature', 'replace_creature', 'patch_entity_document', 'replace_entity_document', 'remove_entry', 'finish_revision'],
    initial_story: ['patch_story', 'finish_revision'],
}

// ============================================================================
// Revision Mode (unchanged from v2)
// ============================================================================

const PHASE_LABELS: Record<WBNPhaseId, string> = {
    synopsis: 'Draft',
    world_data: 'World Data',
    regions: 'Regions',
    organizations: 'Organizations',
    creatures: 'Characters',
    initial_story: 'Opening Story',
}

/** Phase-specific format rules for revision */
const PHASE_RULES: Partial<Record<WBNPhaseId, string>> = {
    world_data: `
### World Data Format Rules
- creature_attr_fields: field_name (snake_case), hint, field_display_name (optional)
- GameTime: all 5 fields (year, month, day, hour, minute) required
- CustomComponentRegistry: do not duplicate built-in components (Inventory, Relationship, StatusEffects, Creature, LocationRef)
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

/** Build revision system prompt — minimal: role + rules only */
function getRevisionSystemPrompt(phaseId: WBNPhaseId): string {
    const label = PHASE_LABELS[phaseId]
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

/**
 * Build context messages for revision — prior phases + current output as user/assistant pairs.
 * Called once at the start of a revision conversation. Subsequent rounds only regenerate
 * the "current output" message to reflect patches applied so far.
 */
function buildRevisionContextMessages(
    phaseId: WBNPhaseId,
    session: WBNSession
): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    const label = PHASE_LABELS[phaseId]

    // 1. Prior phase outputs as reference (read-only)
    const currentIdx = WBN_PHASE_IDS.indexOf(phaseId)
    for (let i = 0; i < currentIdx; i++) {
        const priorId: WBNPhaseId = WBN_PHASE_IDS[i]
        const priorOutput = session.phases[priorId].output
        if (!priorOutput) continue

        const priorLabel = PHASE_LABELS[priorId]
        let priorJson: string
        try {
            priorJson = JSON.stringify(priorOutput, null, 2)
            // Truncate very large outputs (e.g. creatures with long docs)
            if (priorJson.length > 15000) {
                priorJson = priorJson.substring(0, 15000) + '\n\n[... truncated ...]'
            }
        } catch {
            priorJson = String(priorOutput)
        }

        messages.push({ role: 'user', content: `Here is the "${priorLabel}" data (read-only reference, do not modify):` })
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

    messages.push({ role: 'user', content: `Here is the current "${label}" output data that you can modify using the patch/replace tools:` })
    messages.push({ role: 'assistant', content: outputJson })

    return messages
}

/** Build the revision tool set for a given phase, dynamically including sub-agent tools */
function getRevisionTools(phaseId: WBNPhaseId, session: WBNSession): OpenAI.Chat.ChatCompletionTool[] {
    const allowedNames = [...REVISION_TOOLS_BY_PHASE[phaseId]]
    if (!allowedNames || allowedNames.length === 0) return []

    // Dynamically include sub-agent tools based on session data
    if (session.referenceFile && session.referenceFile.type !== 'image') {
        allowedNames.push(SUBAGENT_TOOL_NAMES.file)
    }
    if (session.referenceLorebook && session.referenceLorebook.entries.some(e => e.enabled)) {
        allowedNames.push(SUBAGENT_TOOL_NAMES.lorebook)
    }

    return REVISION_TOOLS.filter(t => t.type === 'function' && allowedNames.includes(t.function.name))
}

/**
 * Run a revision conversation for a completed phase.
 * Uses tool-calling mode with patch tools to make targeted changes.
 */
export async function* streamWBNRevision(
    config: CopilotConfig,
    session: WBNSession,
    phaseId: WBNPhaseId,
    userMessage: string,
    context: WBNToolContext
): AsyncGenerator<WBNStreamEvent> {
    const client = new OpenAI({
        apiKey: config.primaryModel.apiKey,
        baseURL: config.primaryModel.baseUrl,
        dangerouslyAllowBrowser: true
    })

    if (!session.phases[phaseId].output) {
        yield { type: 'error', error: 'No output data for this phase — cannot revise.' }
        return
    }

    const tools = getRevisionTools(phaseId, session)
    if (tools.length === 0) {
        yield { type: 'error', error: 'This phase does not support revision mode.' }
        return
    }

    wbLogger.log({ category: 'system', message: `Revision ${phaseId}: user="${userMessage.substring(0, 200)}"` })

    // Build context messages (prior phases + current output) as user/assistant pairs
    const contextMessages = buildRevisionContextMessages(phaseId, session)

    // Build messages from existing revisionHistory + new user message
    const messages: Array<{
        role: 'user' | 'assistant' | 'system' | 'tool'
        content: string | null
        tool_call_id?: string
        tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string }; thought_signature?: string }>
    }> = []

    for (const msg of session.phases[phaseId].revisionHistory) {
        messages.push({
            role: msg.role,
            content: msg.content,
            tool_call_id: msg.tool_call_id,
            tool_calls: msg.toolCalls,
        })
    }

    messages.push({ role: 'user', content: userMessage })

    const MAX_ROUNDS = 20
    for (let round = 0; round < MAX_ROUNDS; round++) {
        wbLogger.log({ category: 'system', message: `Revision ${phaseId}: round ${round + 1}/${MAX_ROUNDS}` })

        try {
            const revisionSystemPrompt = getRevisionSystemPrompt(phaseId)

            const response = await client.chat.completions.create({
                model: config.primaryModel.model,
                messages: [
                    { role: 'system', content: revisionSystemPrompt },
                    // Context: prior phases + current output as user/assistant pairs
                    ...contextMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                    // Conversation history (tool calls, prior revisions)
                    ...messages.map(m => {
                        if (m.role === 'tool') {
                            return { role: 'tool' as const, content: m.content || '', tool_call_id: m.tool_call_id || '' }
                        }
                        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                            return {
                                role: 'assistant' as const,
                                content: m.content,
                                tool_calls: m.tool_calls.map(tc => ({
                                    id: tc.id,
                                    type: tc.type,
                                    function: tc.function,
                                    ...(tc.thought_signature ? { thought_signature: tc.thought_signature } : {})
                                }))
                            }
                        }
                        return { role: m.role as 'user' | 'assistant', content: m.content || '' }
                    })
                ],
                tools,
                temperature: config.primaryModel.temperature || 0.7,
                max_tokens: 20480,
                ...getReasoningParams(config.primaryModel),
            })

            if (!response.choices || response.choices.length === 0) {
                yield { type: 'error', error: 'API returned empty response (choices.length === 0)' }
                break
            }

            const choice = response.choices[0]
            if (!choice) {
                yield { type: 'error', error: 'API returned empty response' }
                break
            }

            const assistantMessage = choice.message
            const assistantText = assistantMessage.content || ''
            const toolCalls = (assistantMessage.tool_calls || []).filter(tc => tc.type === 'function')

            if (assistantText.trim()) {
                yield { type: 'ai_text', text: assistantText }
            }

            if (toolCalls.length > 0) {
                messages.push({
                    role: 'assistant',
                    content: assistantText,
                    tool_calls: toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.function.name, arguments: tc.function.arguments },
                        ...((tc as any).thought_signature ? { thought_signature: (tc as any).thought_signature } : {})
                    }))
                })
            } else {
                messages.push({ role: 'assistant', content: assistantText })
            }

            // No tool calls → done
            if (toolCalls.length === 0) {
                session.phases[phaseId].revisionHistory = messages.map(m => ({
                    role: m.role,
                    content: m.content || '',
                    toolCalls: m.tool_calls,
                    tool_call_id: m.tool_call_id,
                }))
                yield { type: 'done' }
                return
            }

            // Process tool calls
            let revisionFinished = false
            for (const tc of toolCalls) {
                yield { type: 'tool_call_start', toolCallId: tc.id, toolName: tc.function.name }

                let parsedArgs: Record<string, unknown> = {}
                try {
                    parsedArgs = JSON.parse(tc.function.arguments || '{}')
                } catch {
                    try {
                        const { jsonrepair } = await import('jsonrepair')
                        parsedArgs = JSON.parse(jsonrepair(tc.function.arguments || '{}'))
                    } catch {
                        parsedArgs = {}
                    }
                }

                if (tc.function.name === 'finish_revision') {
                    revisionFinished = true
                    const summary = (parsedArgs.summary as string) || 'Revision complete'
                    messages.push({ role: 'tool', content: 'Revision complete.', tool_call_id: tc.id })
                    wbLogger.log({ category: 'system', message: `Revision ${phaseId}: finished — ${summary}` })
                    yield { type: 'revision_done', summary }
                } else if (tc.function.name === SUBAGENT_TOOL_NAMES.file || tc.function.name === SUBAGENT_TOOL_NAMES.lorebook) {
                    // Sub-agent tool — call secondary model
                    const instruction = (parsedArgs.instruction as string) || ''
                    wbLogger.log({ category: 'system', message: `Revision ${phaseId}: sub-agent ${tc.function.name} — "${instruction.substring(0, 100)}"` })
                    yield { type: 'extraction_progress', message: 'Querying reference material...' }

                    const subagentResult = await executeSubagentTool(
                        tc.function.name, instruction, config, session
                    )
                    messages.push({ role: 'tool', content: subagentResult, tool_call_id: tc.id })
                } else {
                    // Patch tool — apply immediately
                    const { updatedOutput, updatedState, summary } = applyRevisionToState(
                        phaseId,
                        session.phases[phaseId].output,
                        tc.function.name,
                        parsedArgs,
                        context.state
                    )
                    session.phases[phaseId].output = updatedOutput
                    context.state = updatedState

                    wbLogger.log({ category: 'system', message: `Revision ${phaseId}: patch applied — ${summary}` })
                    messages.push({ role: 'tool', content: `${summary}\n\nIf you have completed all changes, please call finish_revision now.`, tool_call_id: tc.id })
                    yield { type: 'revision_patch', toolName: tc.function.name, summary }
                }
            }

            // Save revision history
            session.phases[phaseId].revisionHistory = messages.map(m => ({
                role: m.role,
                content: m.content || '',
                toolCalls: m.tool_calls,
                tool_call_id: m.tool_call_id,
            }))

            if (revisionFinished) {
                yield { type: 'done' }
                return
            }

        } catch (e) {
            wbLogger.log({ category: 'system', message: `Revision ${phaseId}: error — ${(e as Error).message}` })
            session.phases[phaseId].revisionHistory = messages.map(m => ({
                role: m.role,
                content: m.content || '',
                toolCalls: m.tool_calls,
                tool_call_id: m.tool_call_id,
            }))
            yield { type: 'error', error: (e as Error).message }
            return
        }
    }

    // Hit MAX_ROUNDS
    session.phases[phaseId].revisionHistory = messages.map(m => ({
        role: m.role,
        content: m.content || '',
        toolCalls: m.tool_calls,
        tool_call_id: m.tool_call_id,
    }))
    yield { type: 'revision_done', summary: 'Revision conversation reached max rounds, auto-completed.' }
    yield { type: 'done' }
}
