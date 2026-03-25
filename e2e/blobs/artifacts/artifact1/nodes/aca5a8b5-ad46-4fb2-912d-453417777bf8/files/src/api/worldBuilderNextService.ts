/**
 * WorldBuilderNext Service
 *
 * Session lifecycle, message building, and incremental state application.
 */

import type { StateData, UploadedFile } from './types'
import type {
    WBNPhaseId,
    WBNSession,
    WBNDraftOutput,
    WBNCreatureBatch,
    WBNReferenceFile,
    WBNGameStyle,
    LorebookData,
    LorebookEntry,
} from './worldBuilderNextTypes'
import {
    WBN_PHASE_IDS,
    WBN_PHASE_LABELS,
    CREATURES_PER_BATCH,
    createWBNSession,
    PHASE_TAB_MAP,
} from './worldBuilderNextTypes'
import { getPhaseUserInstruction } from './worldBuilderNextPrompts'
import { saveSession, getSession, deleteSession, loadSessions } from './worldBuilderStorage'
import type { TabType } from '../components/state-editor/types'

// ============================================================================
// Session Lifecycle
// ============================================================================

const CURRENT_SESSION_KEY = 'world-builder-next-current-session'

export function getCurrentSessionId(): string | null {
    return localStorage.getItem(CURRENT_SESSION_KEY)
}

function setCurrentSessionId(id: string | null): void {
    if (id) {
        localStorage.setItem(CURRENT_SESSION_KEY, id)
    } else {
        localStorage.removeItem(CURRENT_SESSION_KEY)
    }
}

export function startNewSession(
    initialPrompt: string,
    referenceFile?: WBNReferenceFile,
    referenceLorebook?: LorebookData,
    options?: { skipOrganizations?: boolean; gameStyle?: WBNGameStyle; skipExtraction?: boolean }
): WBNSession {
    const session = createWBNSession(initialPrompt, referenceFile, referenceLorebook)
    if (options?.skipOrganizations) {
        session.skipOrganizations = true
    }
    if (options?.gameStyle) {
        session.gameStyle = options.gameStyle
    }
    if (options?.skipExtraction) {
        session.skipExtraction = true
    }
    // Use the v1 storage but with wbn_ prefix IDs to distinguish
    saveSession(session as any)
    setCurrentSessionId(session.id)
    return session
}

export function saveWBNSession(session: WBNSession): void {
    session.updatedAt = Date.now()
    saveSession(session as any)
}

export function loadWBNSession(id: string): WBNSession | null {
    return getSession(id) as any as WBNSession | null
}

export function endSession(): void {
    setCurrentSessionId(null)
}

/**
 * Find the most recent recoverable WBN session (if any).
 * Matches both explicitly paused sessions AND orphaned active sessions
 * (e.g. interrupted by page refresh before completing).
 */
export function findPausedSession(): WBNSession | null {
    const currentId = getCurrentSessionId()
    const all = loadSessions() as any as WBNSession[]
    const recoverable = all
        .filter(s =>
            s.id?.startsWith('wbn_') &&
            s.id !== currentId &&
            (s.status === 'paused' || s.status === 'active')
        )
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return recoverable[0] || null
}

/** Delete a specific WBN session from storage */
export function deleteWBNSession(id: string): void {
    deleteSession(id)
}

// ============================================================================
// Phase Navigation
// ============================================================================

export function getNextPhase(session: WBNSession): WBNPhaseId | null {
    const idx = WBN_PHASE_IDS.indexOf(session.currentPhase)
    if (idx < 0) return null

    // Check if we're in creature batching and have more batches
    if (session.currentPhase === 'creatures' && session.creatureBatching) {
        const { currentBatch, totalBatches } = session.creatureBatching
        if (currentBatch < totalBatches - 1) {
            return 'creatures' // Stay on creatures for next batch
        }
    }

    // Move to next phase
    let nextIdx = idx + 1
    while (nextIdx < WBN_PHASE_IDS.length) {
        const nextPhase = WBN_PHASE_IDS[nextIdx]
        // Skip organizations if user opted out
        if (nextPhase === 'organizations' && session.skipOrganizations) {
            session.phases.organizations.status = 'completed'
            nextIdx++
            continue
        }
        return nextPhase
    }
    return null
}

export function advancePhase(session: WBNSession): boolean {
    // If in creature batching, advance batch first
    if (session.currentPhase === 'creatures' && session.creatureBatching) {
        const batching = session.creatureBatching
        if (batching.currentBatch < batching.totalBatches - 1) {
            batching.currentBatch++
            // Reset status to 'active' so the useEffect auto-trigger fires for the next batch
            session.phases.creatures.status = 'active'
            saveWBNSession(session)
            return true
        }
    }

    // Mark current phase as completed
    session.phases[session.currentPhase].status = 'completed'

    const next = getNextPhase(session)
    if (!next) {
        session.status = 'completed'
        saveWBNSession(session)
        return false
    }

    session.currentPhase = next
    session.phases[next].status = 'active'
    saveWBNSession(session)
    return true
}

// ============================================================================
// Creature Batching
// ============================================================================

/**
 * Initialize creature batching from synopsis output.
 * Call this after synopsis completes.
 */
export function initCreatureBatching(session: WBNSession): void {
    const draft = session.phases.synopsis.output as WBNDraftOutput | undefined
    if (!draft?.creatures?.length) {
        // No creatures — create single empty batch
        session.creatureBatching = {
            totalBatches: 1,
            currentBatch: 0,
            batchPlan: [{ creatureIds: [] }],
        }
        return
    }

    const creatures = draft.creatures
    const batches: WBNCreatureBatch[] = []

    for (let i = 0; i < creatures.length; i += CREATURES_PER_BATCH) {
        const batch = creatures.slice(i, i + CREATURES_PER_BATCH)
        batches.push({
            creatureIds: batch.map(c => c.creature_id),
        })
    }

    session.creatureBatching = {
        totalBatches: batches.length,
        currentBatch: 0,
        batchPlan: batches,
    }
}

/**
 * Extract user's design notes from synopsis chatHistory.
 * Collects all query_user tool responses — these contain the user's
 * questionnaire answers that may not be fully captured in the draft output.
 * Call this after synopsis completes.
 */
export function extractUserDesignNotes(session: WBNSession): void {
    const chatHistory = session.phases.synopsis.chatHistory
    if (!chatHistory?.length) return

    const notes: string[] = []
    for (const msg of chatHistory) {
        if (msg.role === 'tool' && msg.content?.startsWith('用户已提交表单')) {
            notes.push(msg.content)
        }
    }

    if (notes.length > 0) {
        session.userDesignNotes = notes.join('\n\n')
    }
}

/** Get current batch info (or null if not in creatures phase) */
export function getCurrentBatch(session: WBNSession): {
    batchIndex: number
    totalBatches: number
    batch: WBNCreatureBatch
} | null {
    if (session.currentPhase !== 'creatures' || !session.creatureBatching) return null
    const { currentBatch, totalBatches, batchPlan } = session.creatureBatching
    return { batchIndex: currentBatch, totalBatches, batch: batchPlan[currentBatch] }
}

// ============================================================================
// Phase Tab Mapping
// ============================================================================

export function getPhaseTab(phaseId: WBNPhaseId): TabType | null {
    return PHASE_TAB_MAP[phaseId] ?? null
}

export function getPhaseLabel(phaseId: WBNPhaseId): string {
    return WBN_PHASE_LABELS[phaseId]
}

/** Get overall progress as "current / total" */
export function getProgressInfo(session: WBNSession): { current: number; total: number; label: string; phaseId: WBNPhaseId; batchInfo?: { current: number; total: number } } {
    const idx = WBN_PHASE_IDS.indexOf(session.currentPhase)
    let total = WBN_PHASE_IDS.length
    if (session.skipOrganizations) total--

    let label = WBN_PHASE_LABELS[session.currentPhase]
    let batchInfo: { current: number; total: number } | undefined
    if (session.currentPhase === 'creatures' && session.creatureBatching) {
        const { currentBatch, totalBatches } = session.creatureBatching
        label += ` (${currentBatch + 1}/${totalBatches})`
        batchInfo = { current: currentBatch + 1, total: totalBatches }
    }

    return { current: idx + 1, total, label, phaseId: session.currentPhase, batchInfo }
}

// ============================================================================
// Build Context Messages for AI
// ============================================================================

/**
 * Serialize the draft output into readable Markdown text.
 */
function serializeDraftOutput(draft: WBNDraftOutput): string {
    const parts: string[] = []

    parts.push(`# 设计稿`)
    parts.push(`**游玩基调**: ${draft.tone}`)
    parts.push(`**开场时机**: ${draft.opening}`)
    parts.push(`**故事线**: ${draft.storyline}`)
    parts.push(`**游戏机制**: ${draft.mechanics}`)
    parts.push(`**主角描述**: ${draft.protagonist}`)

    if (draft.regions?.length) {
        const regionLines = draft.regions.map(r => `- \`${r.region_id}\` — ${r.name}`)
        parts.push(`## 地域清单\n${regionLines.join('\n')}`)
    }

    if (draft.organizations?.length) {
        const orgLines = draft.organizations.map(o => `- \`${o.organization_id}\` — ${o.name}`)
        parts.push(`## 组织清单\n${orgLines.join('\n')}`)
    }

    if (draft.creatures?.length) {
        const creatureLines = draft.creatures.map(c =>
            `- \`${c.creature_id}\` — ${c.name}${c.is_player ? '（玩家）' : ''}`
        )
        parts.push(`## 角色清单\n${creatureLines.join('\n')}`)
    }

    return parts.join('\n\n')
}

/**
 * Build the message chain for a phase.
 * Chains all prior phase outputs as user/assistant pairs (prompt caching friendly).
 *
 * v3: No file/lorebook injection here — pre-extraction is handled by extractForPhase().
 * Extracted content is passed separately via the `extractedContent` parameter.
 */
export function buildPhaseMessages(
    session: WBNSession,
    extractedContent?: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

    // 1. User's initial description
    messages.push({ role: 'user', content: session.initialPrompt })
    messages.push({
        role: 'assistant',
        content: `Now beginning game data generation...`
    })

    // 2. Chained prior phase outputs — only brief label + full output, no original instructions
    const currentIdx = WBN_PHASE_IDS.indexOf(session.currentPhase)
    for (let i = 0; i < currentIdx; i++) {
        const phaseId = WBN_PHASE_IDS[i]
        if (phaseId === 'organizations' && session.skipOrganizations) continue
        const phaseData = session.phases[phaseId]
        if (!phaseData.output) continue

        if (phaseId === 'synopsis') {
            messages.push({ role: 'user', content: '以下是你之前生成的设计稿，请据此继续后续步骤。' })
            messages.push({ role: 'assistant', content: serializeDraftOutput(phaseData.output as WBNDraftOutput) })
            // Inject user's design preferences from query_user questionnaire
            if (session.userDesignNotes) {
                messages.push({ role: 'user', content: `## 用户设计偏好（问卷回答）\n\n以下是用户在设计稿阶段通过问卷表达的设计偏好，请在后续步骤中充分参考：\n\n${session.userDesignNotes}` })
                messages.push({ role: 'assistant', content: '已了解用户的设计偏好，我会在后续生成中充分参考这些信息。' })
            }
        } else if (phaseId === 'initial_story') {
            // Opening story: full text as temporal anchor for subsequent phases
            const story = phaseData.output as any
            const storySummary = [
                `**背景旁白**: ${story?.background || '(无)'}`,
                `**开场第一幕**: ${story?.start_story || '(无)'}`,
            ].join('\n\n')
            messages.push({ role: 'user', content: '以下是你之前生成的开场故事。后续步骤中的所有数据应反映此时间点的状态，而非参考素材中后续发展的状态。' })
            messages.push({ role: 'assistant', content: storySummary })
        } else if (phaseId === 'world_data') {
            // Structural data in full, but doc content summarized (too long)
            const wd = phaseData.output as any
            const docSummaries = (wd?.documents || []).map((d: any) =>
                `- **${d.name}**${d.condition ? ` (条件: ${d.condition})` : ''}`
            ).join('\n')
            const summary = [
                `## 角色属性字段\n\`\`\`json\n${JSON.stringify(wd?.creature_attr_fields || [], null, 2)}\n\`\`\``,
                `## 游戏时间\n\`\`\`json\n${JSON.stringify(wd?.GameTime || {})}\n\`\`\``,
                `## 自定义组件注册表\n\`\`\`json\n${JSON.stringify(wd?.CustomComponentRegistry || {}, null, 2)}\n\`\`\``,
                `## 设定文档列表\n${docSummaries || '(无)'}`,
            ].join('\n\n')
            messages.push({ role: 'user', content: '以下是你之前生成的世界数据，请据此继续后续步骤。' })
            messages.push({ role: 'assistant', content: summary })
        } else {
            // regions / organizations / creatures: full JSON
            const label = WBN_PHASE_LABELS[phaseId]
            messages.push({ role: 'user', content: `以下是你之前生成的${label}数据，请据此继续后续步骤。` })
            messages.push({ role: 'assistant', content: JSON.stringify(phaseData.output, null, 2) })
        }
    }

    // 3. Prior creature batch data (full data, docs title-only) for consistency across batches
    if (session.currentPhase === 'creatures' && session.creatureBatching) {
        const { currentBatch, batchPlan } = session.creatureBatching
        if (currentBatch > 0) {
            const allPriorIds: string[] = []
            for (let i = 0; i < currentBatch; i++) {
                allPriorIds.push(...batchPlan[i].creatureIds)
            }
            const creaturesOutput = session.phases.creatures.output as any
            if (creaturesOutput?.creatures) {
                const priorCreatures: any[] = []
                for (const c of creaturesOutput.creatures) {
                    const cId = c.Creature?.creature_id
                    if (cId && allPriorIds.includes(cId)) {
                        const stripped = JSON.parse(JSON.stringify(c))
                        // Strip document content, keep only titles and conditions
                        if (stripped.BindSetting?.documents) {
                            stripped.BindSetting.documents = stripped.BindSetting.documents.map((d: any) => ({
                                name: d.name,
                                ...(d.condition ? { condition: d.condition } : {}),
                            }))
                        }
                        priorCreatures.push(stripped)
                    }
                }
                if (priorCreatures.length > 0) {
                    messages.push({
                        role: 'user',
                        content: `以下是前 ${currentBatch} 批次已生成的角色数据（设定文档仅保留标题），请参考这些角色的设定来保持一致性（如人物关系、外貌风格、属性数值范围等）。`,
                    })
                    messages.push({
                        role: 'assistant',
                        content: JSON.stringify({ creatures: priorCreatures }, null, 2),
                    })
                }
            }
        }
    }

    // 4. Current phase instruction with relevant draft context prepended
    let currentInstruction = getPhaseUserInstruction(session.currentPhase, session.gameStyle, { skipOrganizations: session.skipOrganizations })
    const draft = session.phases.synopsis.output as WBNDraftOutput | undefined

    if (session.currentPhase !== 'synopsis' && draft) {
        // Inject opening story context as temporal anchor for data generation phases
        if (session.currentPhase === 'initial_story') {
            // initial_story is right after synopsis — inject draft opening & storyline
            currentInstruction = `## 设计稿摘要（开场与故事线）\n\n**开场时机**: ${draft.opening}\n**故事线**: ${draft.storyline}\n**游玩基调**: ${draft.tone}\n\n---\n\n${currentInstruction}`
        }

        // For all data generation phases (after initial_story), inject opening story as temporal anchor
        const initialStory = session.phases.initial_story?.output as any
        if (initialStory && session.currentPhase !== 'initial_story') {
            const storyPreview = initialStory.start_story?.length > 200
                ? initialStory.start_story.substring(0, 200) + '...'
                : initialStory.start_story || '(无)'
            const storyAnchor = `## 时空锚定（开场故事已确定）\n\n` +
                `**背景**: ${initialStory.background || '(无)'}\n` +
                `**开场**: ${storyPreview}\n\n` +
                `> 你生成的所有数据必须反映**此时间点**的状态。从参考文件中提取数据时，注意区分"故事开头的状态"和"后续发展的状态"。未来剧情线索应写入设定文档（BindSetting），而非设为当前属性/关系值。\n\n---\n\n`
            currentInstruction = storyAnchor + currentInstruction
        }

        if (session.currentPhase === 'world_data') {
            currentInstruction = `## 设计稿摘要（基调与机制）\n\n**游玩基调**: ${draft.tone}\n**游戏机制**: ${draft.mechanics}\n\n---\n\n${currentInstruction}`
        }

        if (session.currentPhase === 'regions' && draft.regions?.length) {
            const regionList = draft.regions.map(r => `- \`${r.region_id}\` — ${r.name}`).join('\n')
            currentInstruction = `## 地域清单（来自设计稿）\n\n${regionList}\n\n---\n\n${currentInstruction}`
        }

        if (session.currentPhase === 'organizations' && draft.organizations?.length) {
            const orgList = draft.organizations.map(o => `- \`${o.organization_id}\` — ${o.name}`).join('\n')
            currentInstruction = `## 组织清单（来自设计稿）\n\n${orgList}\n\n---\n\n${currentInstruction}`
        }

        if (session.currentPhase === 'creatures' && draft.creatures && session.creatureBatching) {
            const batch = session.creatureBatching.batchPlan[session.creatureBatching.currentBatch]
            const { currentBatch, totalBatches } = session.creatureBatching

            // Inject batch-specific creature names from draft
            const batchCreatures = batch.creatureIds.map(id => {
                const c = draft.creatures.find(cr => cr.creature_id === id)
                return c ? `- \`${c.creature_id}\` — ${c.name}${c.is_player ? '（玩家角色）' : ''}` : `- \`${id}\``
            }).join('\n')
            currentInstruction = `## 本批次角色清单（批次 ${currentBatch + 1}/${totalBatches}）\n\n${batchCreatures}\n\n---\n\n${currentInstruction}`

            // Inject checklist
            currentInstruction += `\n\n### 本批次必须生成的角色清单（共 ${batch.creatureIds.length} 个）\n\n${batch.creatureIds.map(id => `- \`${id}\``).join('\n')}\n\n> 你的输出中 creatures 数组必须恰好包含以上 ${batch.creatureIds.length} 个角色，不多不少。缺少任何一个角色将被视为不合格输出。`

            // Inject organization list for creature generation
            if (session.skipOrganizations) {
                currentInstruction += `\n\n### 组织步骤已跳过\n\n所有角色的 \`organization_id\` 字段请留空。`
            } else {
                const orgsOutput = session.phases.organizations?.output as any
                if (orgsOutput?.organizations?.length) {
                    const orgList = orgsOutput.organizations.map((o: any) =>
                        `- \`${o.organization_id}\` — ${o.name}`
                    ).join('\n')
                    currentInstruction += `\n\n### 可用组织列表（来自组织阶段）\n\n以下是已生成的组织，请为每个角色考虑其组织归属：\n${orgList}\n\n> 请根据角色设定合理分配 \`organization_id\`。无组织归属的角色可以不填，但大多数角色应有所属组织。`
                }
            }

            // Prior batch creature IDs quick reference (full data already provided in message chain above)
            if (currentBatch > 0) {
                const priorCreatureIds: string[] = []
                for (let i = 0; i < currentBatch; i++) {
                    priorCreatureIds.push(...session.creatureBatching.batchPlan[i].creatureIds)
                }
                currentInstruction += `\n\n### 已生成角色（前 ${currentBatch} 批次）\n\n前批次角色完整数据已在上文提供，以下是 creature_id 速查：\n${priorCreatureIds.map(id => `- \`${id}\``).join('\n')}\n\n> 请参考前批次角色的属性数值、外貌风格、关系设定等，确保本批次角色与之保持一致性。Relationship 中可引用这些 creature_id。`
            }
        }
    }

    // 5. Inject pre-extracted reference content (from sub-agent)
    if (extractedContent) {
        messages.push({ role: 'user', content: `## Reference Material (from user's uploaded file/lorebook)\n\nThe following content is provided as reference only. Use it flexibly based on the user's requirements — you may adapt, extend, or selectively incorporate details as appropriate.\n\n${extractedContent}` })
        messages.push({ role: 'assistant', content: 'Understood. I will use this reference material as a guide while generating data, adapting details as needed.' })
    }

    messages.push({ role: 'user', content: currentInstruction })
    return messages
}

// ============================================================================
// Apply Phase Output to State (incremental)
// ============================================================================

/**
 * Normalize document content: convert literal "\n" (two chars) to real newlines.
 * LLMs often double-escape newlines in JSON tool call arguments.
 */
function normalizeDocContent(doc: any): any {
    if (!doc) return doc
    if (typeof doc.content === 'string') {
        doc.content = doc.content.replace(/\\n/g, '\n')
    }
    return doc
}

function normalizeBindSetting(bs: any): any {
    if (!bs?.documents) return bs
    bs.documents = bs.documents.map((d: any) => normalizeDocContent(d))
    return bs
}

/**
 * Parse a simplified field_type string into a JSON Schema fragment.
 * Supports: "string", "number", "boolean", "array<string>", "array<number>",
 *           "object<{k1:type,k2:type}>", "array<object<{k1:type,k2:type}>>"
 */
function parseFieldType(fieldType: string): Record<string, unknown> {
    const ft = fieldType.trim()

    // Primitives
    if (ft === 'string' || ft === 'number' || ft === 'boolean') {
        return { type: ft }
    }

    // array<object<{...}>>
    const arrayObjMatch = ft.match(/^array<object<\{(.+)\}>>$/)
    if (arrayObjMatch) {
        return { type: 'array', items: parseObjectFields(arrayObjMatch[1]) }
    }

    // array<primitive>
    const arrayMatch = ft.match(/^array<(\w+)>$/)
    if (arrayMatch) {
        return { type: 'array', items: { type: arrayMatch[1] } }
    }

    // object<{...}>
    const objMatch = ft.match(/^object<\{(.+)\}>$/)
    if (objMatch) {
        return parseObjectFields(objMatch[1])
    }

    // Fallback
    return { type: 'string' }
}

/** Parse "k1:type,k2:type" into a JSON Schema object */
function parseObjectFields(fieldsStr: string): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    // Split by comma, but be careful with nested commas inside object<{}>
    const parts = splitTopLevelCommas(fieldsStr)
    for (const part of parts) {
        const colonIdx = part.indexOf(':')
        if (colonIdx < 0) continue
        const key = part.substring(0, colonIdx).trim()
        const valType = part.substring(colonIdx + 1).trim()
        properties[key] = parseFieldType(valType)
        required.push(key)
    }
    return { type: 'object', properties, required }
}

/** Split by commas that are not inside angle brackets or curly braces */
function splitTopLevelCommas(s: string): string[] {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (const ch of s) {
        if (ch === '<' || ch === '{') depth++
        else if (ch === '>' || ch === '}') depth--
        if (ch === ',' && depth === 0) {
            parts.push(current)
            current = ''
        } else {
            current += ch
        }
    }
    if (current.trim()) parts.push(current)
    return parts
}

/**
 * Convert LLM-output simplified fields array to engine's type_schema (JSON Schema).
 * Input:  [{ field_name: "hp", field_type: "number", field_description: "生命值" }, ...]
 * Output: { type: "object", properties: { hp: { type: "number", description: "生命值" } }, required: ["hp"] }
 */
function convertFieldsToTypeSchema(fields: Array<{ field_name: string; field_type: string; field_description?: string }>): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const f of fields) {
        const schema = parseFieldType(f.field_type)
        if (f.field_description) {
            schema.description = f.field_description
        }
        properties[f.field_name] = schema
        required.push(f.field_name)
    }
    return { type: 'object', properties, required }
}

/**
 * Auto-correct common AI mistakes in creature data.
 */
async function autoCorrectCreature(c: any): Promise<any> {
    const { jsonrepair } = await import('jsonrepair')
    const result = { ...c }
    const creature = result.Creature

    if (creature) {
        if (creature.description && !creature.appearance) {
            creature.appearance = { body: creature.description, clothing: '（未描述）' }
            delete creature.description
        }
        if (!creature.titles) creature.titles = []
        else if (!Array.isArray(creature.titles)) creature.titles = [String(creature.titles)]
        delete creature.age
    }

    // Parse JSON string fields back to objects (schema uses string type for flexible keys)
    const repairAndParse = (str: string, fallback: any = {}): any => {
        const trimmed = str.trim()
        if (!trimmed || trimmed === '""') return fallback
        try { return JSON.parse(jsonrepair(trimmed)) } catch { return fallback }
    }

    if (creature && typeof creature.attrs === 'string') {
        creature.attrs = repairAndParse(creature.attrs, {})
    }

    if (result.IsPlayer === true) result.IsPlayer = {}
    else if (result.IsPlayer === false) delete result.IsPlayer

    // Fix CustomComponents/StatusEffects data: schema uses string type for flexible keys, parse back to object
    const tryParseJsonData = (item: any) => {
        if (typeof item.data === 'string') {
            item.data = repairAndParse(item.data, {})
        }
        return item
    }
    if (result.CustomComponents?.custom_components) {
        result.CustomComponents.custom_components = result.CustomComponents.custom_components.map(tryParseJsonData)
    }
    if (result.StatusEffects?.status_effects) {
        result.StatusEffects.status_effects = result.StatusEffects.status_effects.map(tryParseJsonData)
    }

    if (result.Inventory?.items) {
        result.Inventory.items = result.Inventory.items.map((item: any) => ({
            id: item.id || item.item_id,
            count: item.count ?? item.quantity ?? 1,
            name: item.name || item.id || item.item_id || '',
            description: item.description || '',
            details: item.details || [],
        }))
    }

    return result
}

/**
 * Get the max entity_id across all entities in the state.
 */
function getMaxEntityId(state: StateData): number {
    let maxId = state.World?.entity_id || 0
    for (const c of state.Creatures || []) {
        if (c.entity_id > maxId) maxId = c.entity_id
    }
    for (const r of state.Regions || []) {
        if (r.entity_id > maxId) maxId = r.entity_id
    }
    for (const o of state.Organizations || []) {
        if (o.entity_id > maxId) maxId = o.entity_id
    }
    return maxId
}

/**
 * Apply a single phase's output to the state.
 * Returns a new StateData object (does not mutate the input).
 */
export async function applyPhaseToState(
    session: WBNSession,
    phaseId: WBNPhaseId,
    currentState: StateData
): Promise<StateData> {
    const newState = JSON.parse(JSON.stringify(currentState)) as StateData
    let nextEntityId = getMaxEntityId(newState) + 1
    const phaseOutput = session.phases[phaseId].output as any
    if (!phaseOutput) return newState

    switch (phaseId) {
        case 'synopsis':
            // Synopsis doesn't apply any data
            break

        case 'world_data': {
            // creature_attr_fields → World.Registry
            if (phaseOutput.creature_attr_fields) {
                if (!newState.World.Registry) newState.World.Registry = {}
                newState.World.Registry.creature_attr_fields = phaseOutput.creature_attr_fields
            }
            // GameTime
            if (phaseOutput.GameTime) {
                newState.World.GameTime = phaseOutput.GameTime
            }
            // CustomComponentRegistry — convert simplified fields to engine format
            if (phaseOutput.CustomComponentRegistry) {
                newState.World.CustomComponentRegistry = {
                    custom_components: (phaseOutput.CustomComponentRegistry.custom_components || []).map((comp: any) => ({
                        component_key: comp.component_key,
                        component_name: comp.component_name,
                        is_array: false,
                        type_schema: convertFieldsToTypeSchema(comp.fields || []),
                    })),
                }
            }
            // BindSetting documents (replace to avoid duplication on re-apply)
            if (phaseOutput.documents?.length > 0) {
                if (!newState.World.BindSetting) newState.World.BindSetting = { documents: [] }
                const newDocs = phaseOutput.documents.map((d: any) => normalizeDocContent({
                    name: d.name || 'Untitled',
                    content: d.content || '',
                    ...(d.static_priority !== undefined ? { static_priority: d.static_priority } : {}),
                    ...(d.condition ? { condition: d.condition } : {}),
                }))
                // Replace docs with matching names, append truly new ones
                const newDocNames = new Set(newDocs.map((d: any) => d.name))
                const existingKept = (newState.World.BindSetting.documents || []).filter(
                    (d: any) => !newDocNames.has(d.name)
                )
                newState.World.BindSetting.documents = [...existingKept, ...newDocs]
            }
            break
        }

        case 'regions': {
            if (phaseOutput.regions) {
                newState.Regions = phaseOutput.regions.map((r: any) => ({
                    entity_id: nextEntityId++,
                    Metadata: { name: r.region_name || '', desc: r.description || '' },
                    Region: {
                        region_id: r.region_id,
                        region_name: r.region_name,
                        description: r.description,
                        locations: r.locations || [],
                        paths: (r.paths || []).map((p: any) => ({
                            src_location: p.src_location || p.from || '',
                            src_region: p.src_region || r.region_id,
                            discovered: p.discovered !== undefined ? p.discovered : true,
                            to_region: p.to_region || r.region_id,
                            to_location: p.to_location || p.to || '',
                            description: p.description || '',
                        })),
                    },
                    ...(r.BindSetting ? { BindSetting: normalizeBindSetting(r.BindSetting) } : {}),
                }))
            }
            break
        }

        case 'organizations': {
            if (phaseOutput.organizations) {
                newState.Organizations = phaseOutput.organizations.map((o: any) => ({
                    entity_id: nextEntityId++,
                    Organization: {
                        organization_id: o.organization_id,
                        name: o.name,
                        description: o.description,
                        territories: o.territories || [],
                    },
                    ...(o.BindSetting ? { BindSetting: normalizeBindSetting(o.BindSetting) } : {}),
                }))
            }
            break
        }

        case 'creatures': {
            if (phaseOutput.creatures) {
                const newCreatures = await Promise.all(phaseOutput.creatures.map(async (c: any) => {
                    const corrected = await autoCorrectCreature(c)
                    // Extract BindSetting from creature data
                    const bindSetting = corrected.BindSetting
                    delete corrected.BindSetting
                    return {
                        entity_id: nextEntityId++,
                        ...corrected,
                        ...(bindSetting ? { BindSetting: normalizeBindSetting(bindSetting) } : {}),
                    }
                }))
                // Merge: replace existing creatures by ID, append truly new ones
                if (!newState.Creatures) newState.Creatures = []
                const newCreatureIds = new Set(
                    newCreatures.map((c: any) => c.Creature?.creature_id).filter(Boolean)
                )
                const existingKept = newState.Creatures.filter(
                    (c: any) => !newCreatureIds.has(c.Creature?.creature_id)
                )
                newState.Creatures = [...existingKept, ...newCreatures]
            }
            break
        }

        case 'initial_story': {
            if (phaseOutput) {
                newState.GameInitialStory = phaseOutput as any
            }
            break
        }
    }

    return newState
}

// ============================================================================
// Revision Patch Application
// ============================================================================

/**
 * Apply a revision patch to both the phase output and the state.
 * Returns { updatedOutput, updatedState, summary }.
 */
export async function applyRevisionToState(
    phaseId: WBNPhaseId,
    phaseOutput: unknown,
    toolName: string,
    toolArgs: Record<string, unknown>,
    currentState: StateData
): Promise<{ updatedOutput: unknown; updatedState: StateData; summary: string }> {
    // Reuse v1 applyRevisionPatch for phase output mutation
    const output = JSON.parse(JSON.stringify(phaseOutput ?? {}))
    const newState = JSON.parse(JSON.stringify(currentState)) as StateData
    let summary = ''

    // For now, delegate to the same patch logic
    // The caller should re-apply the full phase output to state after patching
    switch (toolName) {
        // ---- Draft patch tools ----
        case 'patch_draft': {
            const fields = ['tone', 'opening', 'storyline', 'mechanics', 'protagonist'] as const
            const updated: string[] = []
            for (const f of fields) {
                if (toolArgs[f] !== undefined) {
                    output[f] = toolArgs[f] as string
                    updated.push(f)
                }
            }
            return { updatedOutput: output, updatedState: newState, summary: `已更新设计稿: ${updated.join(', ') || '无变更'}` }
        }
        case 'patch_synopsis_region': {
            if (!output.regions) output.regions = []
            const rIdx = output.regions.findIndex((r: any) => r.region_id === toolArgs.region_id)
            if (rIdx >= 0) {
                if (toolArgs.name) output.regions[rIdx].name = toolArgs.name
                return { updatedOutput: output, updatedState: newState, summary: `已更新地域 "${toolArgs.region_id}"` }
            } else {
                output.regions.push({ region_id: toolArgs.region_id, name: toolArgs.name || toolArgs.region_id })
                return { updatedOutput: output, updatedState: newState, summary: `已新增地域 "${toolArgs.region_id}"` }
            }
        }
        case 'patch_synopsis_organization': {
            if (!output.organizations) output.organizations = []
            const oIdx = output.organizations.findIndex((o: any) => o.organization_id === toolArgs.organization_id)
            if (oIdx >= 0) {
                if (toolArgs.name) output.organizations[oIdx].name = toolArgs.name
                return { updatedOutput: output, updatedState: newState, summary: `已更新组织 "${toolArgs.organization_id}"` }
            } else {
                output.organizations.push({ organization_id: toolArgs.organization_id, name: toolArgs.name || toolArgs.organization_id })
                return { updatedOutput: output, updatedState: newState, summary: `已新增组织 "${toolArgs.organization_id}"` }
            }
        }
        case 'patch_synopsis_creature': {
            if (!output.creatures) output.creatures = []
            const cIdx = output.creatures.findIndex((c: any) => c.creature_id === toolArgs.creature_id)
            if (cIdx >= 0) {
                if (toolArgs.name) output.creatures[cIdx].name = toolArgs.name
                if (toolArgs.is_player !== undefined) output.creatures[cIdx].is_player = toolArgs.is_player
                return { updatedOutput: output, updatedState: newState, summary: `已更新角色 "${toolArgs.creature_id}"` }
            } else {
                output.creatures.push({
                    creature_id: toolArgs.creature_id,
                    name: toolArgs.name || toolArgs.creature_id,
                    is_player: toolArgs.is_player || false,
                })
                return { updatedOutput: output, updatedState: newState, summary: `已新增角色 "${toolArgs.creature_id}"` }
            }
        }
        case 'remove_synopsis_entry': {
            const entryType = toolArgs.entry_type as string
            const entryId = toolArgs.entry_id as string
            if (entryType === 'region' && output.regions) {
                output.regions = output.regions.filter((r: any) => r.region_id !== entryId)
                return { updatedOutput: output, updatedState: newState, summary: `已删除地域 "${entryId}"` }
            } else if (entryType === 'organization' && output.organizations) {
                output.organizations = output.organizations.filter((o: any) => o.organization_id !== entryId)
                return { updatedOutput: output, updatedState: newState, summary: `已删除组织 "${entryId}"` }
            } else if (entryType === 'creature' && output.creatures) {
                output.creatures = output.creatures.filter((c: any) => c.creature_id !== entryId)
                return { updatedOutput: output, updatedState: newState, summary: `已删除角色 "${entryId}"` }
            }
            return { updatedOutput: output, updatedState: newState, summary: `未找到 ${entryType} "${entryId}"` }
        }
        // ---- Other phase patch tools ----
        case 'patch_creature':
        case 'replace_creature':
        case 'patch_region':
        case 'replace_region':
        case 'patch_location':
        case 'remove_location':
        case 'patch_path':
        case 'remove_path':
        case 'patch_organization':
        case 'replace_organization':
        case 'patch_territory':
        case 'remove_territory':
        case 'patch_document':
        case 'replace_document':
        case 'patch_entity_document':
        case 'replace_entity_document':
        case 'patch_story':
        case 'patch_world_data':
        case 'remove_entry': {
            const result = applyRevisionPatch(output, toolName, toolArgs)
            // Re-apply the patched output to state
            const session: any = { phases: { [phaseId]: { output: result.updatedOutput } } }
            const reapplied = await applyPhaseToState(session, phaseId, currentState)
            return { updatedOutput: result.updatedOutput, updatedState: reapplied, summary: result.summary }
        }
        default:
            return { updatedOutput: output, updatedState: newState, summary: `未知工具 "${toolName}"` }
    }
}

// ============================================================================
// Revision Patch — apply patch tool calls to phase output
// ============================================================================

/**
 * Find an entity in the phase output by type and ID.
 * Returns the entity object (mutable reference) or null.
 */
function findEntityInOutput(output: unknown, entityType: string, entityId: string): any | null {
    const o = output as any
    switch (entityType) {
        case 'creature': {
            const creatures = o.creatures as any[] || []
            return creatures.find((c: any) => c.Creature?.creature_id === entityId) || null
        }
        case 'region': {
            const regions = o.regions as any[] || []
            return regions.find((r: any) => r.region_id === entityId) || null
        }
        case 'organization': {
            const orgs = o.organizations as any[] || []
            return orgs.find((org: any) => org.organization_id === entityId) || null
        }
        default:
            return null
    }
}

/**
 * Apply a revision patch tool call directly to a phase's existing output.
 * Pure function: deep-clones output, applies the named patch, returns result.
 */
export function applyRevisionPatch(
    currentOutput: unknown,
    toolName: string,
    toolArgs: Record<string, unknown>
): { updatedOutput: unknown; summary: string } {
    const output = JSON.parse(JSON.stringify(currentOutput ?? {}))

    switch (toolName) {
        case 'patch_creature': {
            const creatureId = toolArgs.creature_id as string
            const creatureData = toolArgs.creature_data as any
            if (!creatureId || !creatureData) return { updatedOutput: output, summary: '错误: creature_id 和 creature_data 必填' }
            const creatures = (output as any).creatures as any[] || []
            const idx = creatures.findIndex((c: any) => c.Creature?.creature_id === creatureId)
            if (idx >= 0) {
                for (const [key, value] of Object.entries(creatureData)) {
                    if (key === 'Creature' && creatures[idx].Creature) {
                        Object.assign(creatures[idx].Creature, value as any)
                    } else {
                        creatures[idx][key] = value
                    }
                }
                ;(output as any).creatures = creatures
                return { updatedOutput: output, summary: `已更新角色 "${creatureId}"` }
            } else {
                // Ensure proper structure: creature_data should wrap in top-level object with Creature
                const newCreature = creatureData.Creature
                    ? { ...creatureData, Creature: { ...creatureData.Creature, creature_id: creatureId } }
                    : { Creature: { creature_id: creatureId }, ...creatureData }
                // Guard: if a player already exists, strip IsPlayer from new creature
                const hasPlayer = creatures.some((c: any) => c.IsPlayer !== undefined)
                if (hasPlayer && newCreature.IsPlayer !== undefined) {
                    delete newCreature.IsPlayer
                }
                creatures.push(newCreature)
                ;(output as any).creatures = creatures
                return { updatedOutput: output, summary: `已新增角色 "${creatureId}"` }
            }
        }

        case 'replace_creature': {
            const creatureId = toolArgs.creature_id as string
            const creatureData = toolArgs.creature_data as any
            if (!creatureId || !creatureData) return { updatedOutput: output, summary: '错误: creature_id 和 creature_data 必填' }
            const creatures = (output as any).creatures as any[] || []
            // Ensure creature_id is preserved in Creature
            if (creatureData.Creature) {
                creatureData.Creature.creature_id = creatureId
            } else {
                creatureData.Creature = { creature_id: creatureId }
            }
            const idx = creatures.findIndex((c: any) => c.Creature?.creature_id === creatureId)
            if (idx >= 0) {
                // Guard: if replacing a non-player creature and a different player exists, strip IsPlayer
                const wasPlayer = creatures[idx].IsPlayer !== undefined
                if (!wasPlayer && creatureData.IsPlayer !== undefined) {
                    const hasOtherPlayer = creatures.some((c: any, i: number) => i !== idx && c.IsPlayer !== undefined)
                    if (hasOtherPlayer) delete creatureData.IsPlayer
                }
                creatures[idx] = creatureData
                ;(output as any).creatures = creatures
                return { updatedOutput: output, summary: `已替换角色 "${creatureId}"` }
            } else {
                // Guard: if a player already exists, strip IsPlayer from new creature
                const hasPlayer = creatures.some((c: any) => c.IsPlayer !== undefined)
                if (hasPlayer && creatureData.IsPlayer !== undefined) {
                    delete creatureData.IsPlayer
                }
                creatures.push(creatureData)
                ;(output as any).creatures = creatures
                return { updatedOutput: output, summary: `已新增角色 "${creatureId}"（replace 模式）` }
            }
        }

        case 'patch_region': {
            const regionId = toolArgs.region_id as string
            const regionData = toolArgs.region_data as any
            if (!regionId || !regionData) return { updatedOutput: output, summary: '错误: region_id 和 region_data 必填' }
            const regions = (output as any).regions as any[] || []
            const idx = regions.findIndex((r: any) => r.region_id === regionId)
            if (idx >= 0) {
                if (regionData.region_name) regions[idx].region_name = regionData.region_name
                if (regionData.description) regions[idx].description = regionData.description
                if (regionData.locations) regions[idx].locations = regionData.locations
                if (regionData.paths) regions[idx].paths = regionData.paths
                if (regionData.BindSetting) regions[idx].BindSetting = regionData.BindSetting
                return { updatedOutput: output, summary: `已更新地域 "${regionId}"` }
            } else {
                regions.push({ region_id: regionId, ...regionData })
                ;(output as any).regions = regions
                return { updatedOutput: output, summary: `已新增地域 "${regionId}"` }
            }
        }

        case 'replace_region': {
            const regionId = toolArgs.region_id as string
            const regionData = toolArgs.region_data as any
            if (!regionId || !regionData) return { updatedOutput: output, summary: '错误: region_id 和 region_data 必填' }
            const regions = (output as any).regions as any[] || []
            const idx = regions.findIndex((r: any) => r.region_id === regionId)
            if (idx >= 0) {
                regions[idx] = { region_id: regionId, ...regionData }
                return { updatedOutput: output, summary: `已替换地域 "${regionId}"` }
            }
            return { updatedOutput: output, summary: `地域 "${regionId}" 未找到，无法替换` }
        }

        case 'patch_location': {
            const regionId = toolArgs.region_id as string
            const locationId = toolArgs.location_id as string
            const locationData = toolArgs.location_data as any
            if (!regionId || !locationId || !locationData) return { updatedOutput: output, summary: '错误: region_id, location_id, location_data 必填' }
            const regions = (output as any).regions as any[] || []
            const region = regions.find((r: any) => r.region_id === regionId)
            if (!region) return { updatedOutput: output, summary: `地域 "${regionId}" 未找到` }
            if (!region.locations) region.locations = []
            const locIdx = region.locations.findIndex((l: any) => l.location_id === locationId)
            if (locIdx >= 0) {
                Object.assign(region.locations[locIdx], locationData)
                return { updatedOutput: output, summary: `已更新地点 "${regionId}/${locationId}"` }
            } else {
                region.locations.push({ location_id: locationId, ...locationData })
                return { updatedOutput: output, summary: `已新增地点 "${regionId}/${locationId}"` }
            }
        }

        case 'remove_location': {
            const regionId = toolArgs.region_id as string
            const locationId = toolArgs.location_id as string
            if (!regionId || !locationId) return { updatedOutput: output, summary: '错误: region_id 和 location_id 必填' }
            const regions = (output as any).regions as any[] || []
            const region = regions.find((r: any) => r.region_id === regionId)
            if (!region) return { updatedOutput: output, summary: `地域 "${regionId}" 未找到` }
            if (region.locations) {
                const before = region.locations.length
                region.locations = region.locations.filter((l: any) => l.location_id !== locationId)
                if (region.locations.length === before) return { updatedOutput: output, summary: `地点 "${locationId}" 未找到` }
            }
            // Also remove paths referencing this location
            if (region.paths) {
                region.paths = region.paths.filter((p: any) => p.src_location !== locationId && p.to_location !== locationId)
            }
            return { updatedOutput: output, summary: `已删除地点 "${regionId}/${locationId}" 及相关路径` }
        }

        case 'patch_path': {
            const regionId = toolArgs.region_id as string
            const pathData = toolArgs.path_data as any
            if (!regionId || !pathData) return { updatedOutput: output, summary: '错误: region_id 和 path_data 必填' }
            const regions = (output as any).regions as any[] || []
            const region = regions.find((r: any) => r.region_id === regionId)
            if (!region) return { updatedOutput: output, summary: `地域 "${regionId}" 未找到` }
            if (!region.paths) region.paths = []
            const pathIdx = region.paths.findIndex((p: any) => p.src_location === pathData.src_location && p.to_location === pathData.to_location)
            if (pathIdx >= 0) {
                Object.assign(region.paths[pathIdx], pathData)
                return { updatedOutput: output, summary: `已更新路径 "${pathData.src_location}" → "${pathData.to_location}"` }
            } else {
                region.paths.push(pathData)
                return { updatedOutput: output, summary: `已新增路径 "${pathData.src_location}" → "${pathData.to_location}"` }
            }
        }

        case 'remove_path': {
            const regionId = toolArgs.region_id as string
            const srcLoc = toolArgs.src_location as string
            const toLoc = toolArgs.to_location as string
            if (!regionId || !srcLoc || !toLoc) return { updatedOutput: output, summary: '错误: region_id, src_location, to_location 必填' }
            const regions = (output as any).regions as any[] || []
            const region = regions.find((r: any) => r.region_id === regionId)
            if (!region?.paths) return { updatedOutput: output, summary: `地域 "${regionId}" 未找到或无路径` }
            const before = region.paths.length
            region.paths = region.paths.filter((p: any) => !(p.src_location === srcLoc && p.to_location === toLoc))
            if (region.paths.length === before) return { updatedOutput: output, summary: `路径 "${srcLoc}" → "${toLoc}" 未找到` }
            return { updatedOutput: output, summary: `已删除路径 "${srcLoc}" → "${toLoc}"` }
        }

        case 'patch_territory': {
            const orgId = toolArgs.organization_id as string
            const terrData = toolArgs.territory_data as any
            if (!orgId || !terrData) return { updatedOutput: output, summary: '错误: organization_id 和 territory_data 必填' }
            const orgs = (output as any).organizations as any[] || []
            const org = orgs.find((o: any) => o.organization_id === orgId)
            if (!org) return { updatedOutput: output, summary: `组织 "${orgId}" 未找到` }
            if (!org.territories) org.territories = []
            const tIdx = org.territories.findIndex((t: any) => t.region_id === terrData.region_id && t.location_id === terrData.location_id)
            if (tIdx >= 0) {
                Object.assign(org.territories[tIdx], terrData)
                return { updatedOutput: output, summary: `已更新组织 "${orgId}" 的领地 "${terrData.region_id}/${terrData.location_id}"` }
            } else {
                org.territories.push(terrData)
                return { updatedOutput: output, summary: `已新增组织 "${orgId}" 的领地 "${terrData.region_id}/${terrData.location_id}"` }
            }
        }

        case 'remove_territory': {
            const orgId = toolArgs.organization_id as string
            const regionId = toolArgs.region_id as string
            const locationId = toolArgs.location_id as string
            if (!orgId || !regionId || !locationId) return { updatedOutput: output, summary: '错误: organization_id, region_id, location_id 必填' }
            const orgs = (output as any).organizations as any[] || []
            const org = orgs.find((o: any) => o.organization_id === orgId)
            if (!org?.territories) return { updatedOutput: output, summary: `组织 "${orgId}" 未找到或无领地` }
            const before = org.territories.length
            org.territories = org.territories.filter((t: any) => !(t.region_id === regionId && t.location_id === locationId))
            if (org.territories.length === before) return { updatedOutput: output, summary: `领地 "${regionId}/${locationId}" 未找到` }
            return { updatedOutput: output, summary: `已删除组织 "${orgId}" 的领地 "${regionId}/${locationId}"` }
        }

        case 'patch_organization': {
            const orgId = toolArgs.organization_id as string
            const orgData = toolArgs.organization_data as any
            if (!orgId || !orgData) return { updatedOutput: output, summary: '错误: organization_id 和 organization_data 必填' }
            const orgs = (output as any).organizations as any[] || []
            const idx = orgs.findIndex((o: any) => o.organization_id === orgId)
            if (idx >= 0) {
                if (orgData.organization_name) orgs[idx].organization_name = orgData.organization_name
                if (orgData.description) orgs[idx].description = orgData.description
                if (orgData.territories) orgs[idx].territories = orgData.territories
                if (orgData.relationships) orgs[idx].relationships = orgData.relationships
                if (orgData.BindSetting) orgs[idx].BindSetting = orgData.BindSetting
                return { updatedOutput: output, summary: `已更新组织 "${orgId}"` }
            } else {
                orgs.push({ organization_id: orgId, ...orgData })
                ;(output as any).organizations = orgs
                return { updatedOutput: output, summary: `已新增组织 "${orgId}"` }
            }
        }

        case 'replace_organization': {
            const orgId = toolArgs.organization_id as string
            const orgData = toolArgs.organization_data as any
            if (!orgId || !orgData) return { updatedOutput: output, summary: '错误: organization_id 和 organization_data 必填' }
            const orgs = (output as any).organizations as any[] || []
            const idx = orgs.findIndex((o: any) => o.organization_id === orgId)
            if (idx >= 0) {
                orgs[idx] = { organization_id: orgId, ...orgData }
                return { updatedOutput: output, summary: `已替换组织 "${orgId}"` }
            }
            return { updatedOutput: output, summary: `组织 "${orgId}" 未找到，无法替换` }
        }

        case 'patch_document': {
            const docName = toolArgs.doc_name as string
            const docData = toolArgs.document_data as any
            if (!docName || !docData) return { updatedOutput: output, summary: '错误: doc_name 和 document_data 必填' }
            const docs = (output as any).documents as any[] || []
            const idx = docs.findIndex((d: any) => (d.name || d.path) === docName)
            if (idx >= 0) {
                Object.assign(docs[idx], docData)
                if (!docs[idx].name) docs[idx].name = docName
                return { updatedOutput: output, summary: `已更新文档 "${docName}"` }
            } else {
                docs.push({ name: docName, ...docData })
                ;(output as any).documents = docs
                return { updatedOutput: output, summary: `已新增文档 "${docName}"` }
            }
        }

        case 'replace_document': {
            const docName = toolArgs.doc_name as string
            const docData = toolArgs.document_data as any
            if (!docName || !docData) return { updatedOutput: output, summary: '错误: doc_name 和 document_data 必填' }
            const docs = (output as any).documents as any[] || []
            const idx = docs.findIndex((d: any) => (d.name || d.path) === docName)
            if (idx >= 0) {
                docs[idx] = { name: docName, ...docData }
                return { updatedOutput: output, summary: `已替换文档 "${docName}"` }
            }
            return { updatedOutput: output, summary: `文档 "${docName}" 未找到，无法替换` }
        }

        case 'patch_entity_document':
        case 'replace_entity_document': {
            const entityType = toolArgs.entity_type as string
            const entityId = toolArgs.entity_id as string
            const docName = toolArgs.doc_name as string
            const docData = toolArgs.document_data as any
            if (!entityType || !entityId || !docName || !docData) {
                return { updatedOutput: output, summary: '错误: entity_type, entity_id, doc_name, document_data 必填' }
            }
            // Find the entity in phase output
            const entity = findEntityInOutput(output, entityType, entityId)
            if (!entity) {
                return { updatedOutput: output, summary: `${entityType} "${entityId}" 未找到` }
            }
            // Ensure BindSetting.documents exists
            if (!entity.BindSetting) entity.BindSetting = { documents: [] }
            if (!entity.BindSetting.documents) entity.BindSetting.documents = []
            const docs = entity.BindSetting.documents as any[]
            const docIdx = docs.findIndex((d: any) => d.name === docName)
            if (toolName === 'replace_entity_document') {
                if (docIdx >= 0) {
                    docs[docIdx] = { name: docName, ...docData }
                    return { updatedOutput: output, summary: `已替换 "${entityId}" 的文档 "${docName}"` }
                }
                // Replace mode but doc not found — create it
                docs.push({ name: docName, ...docData })
                return { updatedOutput: output, summary: `已新增 "${entityId}" 的文档 "${docName}"` }
            } else {
                // patch mode
                if (docIdx >= 0) {
                    Object.assign(docs[docIdx], docData)
                    return { updatedOutput: output, summary: `已更新 "${entityId}" 的文档 "${docName}"` }
                } else {
                    docs.push({ name: docName, ...docData })
                    return { updatedOutput: output, summary: `已新增 "${entityId}" 的文档 "${docName}"` }
                }
            }
        }

        case 'patch_story': {
            if (toolArgs.background !== undefined) (output as any).background = toolArgs.background
            if (toolArgs.start_story !== undefined) (output as any).start_story = toolArgs.start_story
            const parts: string[] = []
            if (toolArgs.background !== undefined) parts.push('背景')
            if (toolArgs.start_story !== undefined) parts.push('开场故事')
            return { updatedOutput: output, summary: `已更新: ${parts.join(', ')}` }
        }

        case 'patch_world_data': {
            const parts: string[] = []
            // remove_attr_fields: delete by field_name (process before merge so add-back is possible)
            if (toolArgs.remove_attr_fields !== undefined) {
                const toRemove = toolArgs.remove_attr_fields as string[]
                const existing: any[] = (output as any).creature_attr_fields || []
                ;(output as any).creature_attr_fields = existing.filter((e: any) => !toRemove.includes(e.field_name))
                parts.push(`删除属性字段 (${toRemove.join(', ')})`)
            }
            // creature_attr_fields: merge by field_name
            if (toolArgs.creature_attr_fields !== undefined) {
                const existing: any[] = (output as any).creature_attr_fields || []
                const incoming: any[] = toolArgs.creature_attr_fields as any[]
                for (const inc of incoming) {
                    const idx = existing.findIndex((e: any) => e.field_name === inc.field_name)
                    if (idx >= 0) {
                        Object.assign(existing[idx], inc)
                    } else {
                        existing.push(inc)
                    }
                }
                (output as any).creature_attr_fields = existing
                parts.push(`属性字段 (${incoming.length} 个)`)
            }
            // GameTime: shallow merge
            if (toolArgs.GameTime !== undefined) {
                (output as any).GameTime = Object.assign({}, (output as any).GameTime || {}, toolArgs.GameTime)
                parts.push('时间系统')
            }
            // remove_custom_components: delete by component_key (process before merge)
            if (toolArgs.remove_custom_components !== undefined) {
                const toRemove = toolArgs.remove_custom_components as string[]
                const reg = (output as any).CustomComponentRegistry || { custom_components: [] }
                reg.custom_components = (reg.custom_components || []).filter((c: any) => !toRemove.includes(c.component_key))
                ;(output as any).CustomComponentRegistry = reg
                parts.push(`删除自定义组件 (${toRemove.join(', ')})`)
            }
            // CustomComponentRegistry: merge custom_components by component_key
            if (toolArgs.CustomComponentRegistry !== undefined) {
                const reg = (output as any).CustomComponentRegistry || { custom_components: [] }
                const existingComps: any[] = reg.custom_components || []
                const incomingComps: any[] = (toolArgs.CustomComponentRegistry as any).custom_components || []
                for (const inc of incomingComps) {
                    const idx = existingComps.findIndex((e: any) => e.component_key === inc.component_key)
                    if (idx >= 0) {
                        Object.assign(existingComps[idx], inc)
                    } else {
                        existingComps.push(inc)
                    }
                }
                reg.custom_components = existingComps
                ;(output as any).CustomComponentRegistry = reg
                parts.push(`自定义组件 (${incomingComps.length} 个)`)
            }
            return { updatedOutput: output, summary: `已更新世界数据: ${parts.join(', ') || '无变更'}` }
        }

        case 'remove_entry': {
            const entityType = toolArgs.entity_type as string
            const entityId = toolArgs.entity_id as string
            if (!entityType || !entityId) return { updatedOutput: output, summary: '错误: entity_type 和 entity_id 必填' }
            switch (entityType) {
                case 'creature': {
                    const arr = (output as any).creatures as any[] || []
                    const idx = arr.findIndex((c: any) => c.Creature?.creature_id === entityId)
                    if (idx >= 0) { arr.splice(idx, 1); return { updatedOutput: output, summary: `已删除角色 "${entityId}"` } }
                    return { updatedOutput: output, summary: `角色 "${entityId}" 未找到` }
                }
                case 'region': {
                    const arr = (output as any).regions as any[] || []
                    const idx = arr.findIndex((r: any) => r.region_id === entityId)
                    if (idx >= 0) { arr.splice(idx, 1); return { updatedOutput: output, summary: `已删除地域 "${entityId}"` } }
                    return { updatedOutput: output, summary: `地域 "${entityId}" 未找到` }
                }
                case 'organization': {
                    const arr = (output as any).organizations as any[] || []
                    const idx = arr.findIndex((o: any) => o.organization_id === entityId)
                    if (idx >= 0) { arr.splice(idx, 1); return { updatedOutput: output, summary: `已删除组织 "${entityId}"` } }
                    return { updatedOutput: output, summary: `组织 "${entityId}" 未找到` }
                }
                case 'document': {
                    const docs = (output as any).documents as any[] || []
                    const idx = docs.findIndex((d: any) => (d.name || d.path) === entityId)
                    if (idx >= 0) { docs.splice(idx, 1); return { updatedOutput: output, summary: `已删除文档 "${entityId}"` } }
                    return { updatedOutput: output, summary: `文档 "${entityId}" 未找到` }
                }
                case 'character_document':
                case 'entity_document': {
                    // Format: "entity_type/entity_id/doc_name" or legacy "creature_id/doc_name"
                    const parts = entityId.split('/')
                    let eType: string, eId: string, dname: string
                    if (parts.length === 3) {
                        [eType, eId, dname] = parts
                    } else if (parts.length === 2) {
                        // Legacy format: creature_id/doc_name
                        eType = 'creature'
                        ;[eId, dname] = parts
                    } else {
                        return { updatedOutput: output, summary: '错误: entity_document 格式应为 "entity_type/entity_id/doc_name"' }
                    }
                    const entity = findEntityInOutput(output, eType, eId)
                    if (entity?.BindSetting?.documents) {
                        const idx = entity.BindSetting.documents.findIndex((d: any) => d.name === dname)
                        if (idx >= 0) {
                            entity.BindSetting.documents.splice(idx, 1)
                            return { updatedOutput: output, summary: `已删除 "${eId}" 的文档 "${dname}"` }
                        }
                    }
                    return { updatedOutput: output, summary: `文档 "${entityId}" 未找到` }
                }
                default:
                    return { updatedOutput: output, summary: `未知实体类型 "${entityType}"` }
            }
        }

        default:
            return { updatedOutput: output, summary: `未知工具 "${toolName}"` }
    }
}

// ============================================================================
// Multi-file / Multi-lorebook Merge Helpers
// ============================================================================

/** Merge multiple reference files into a single file by concatenating text content. */
export function mergeReferenceFiles(files: WBNReferenceFile[]): WBNReferenceFile | undefined {
    const textFiles = files.filter(f => f.type !== 'image')
    if (textFiles.length === 0) return undefined
    if (textFiles.length === 1) return textFiles[0]

    const mergedContent = textFiles
        .map(f => `## File: ${f.name}\n\n${f.content}`)
        .join('\n\n---\n\n')

    return {
        name: textFiles.map(f => f.name).join(', '),
        content: mergedContent,
        type: 'txt',
        size: mergedContent.length,
    }
}

/** Convert UploadedFile[] (from fileStore) to WBNReferenceFile[] */
export function uploadedFilesToReferenceFiles(files: UploadedFile[]): WBNReferenceFile[] {
    return files.map(f => ({
        name: f.name,
        content: f.content,
        type: f.type as WBNReferenceFile['type'],
        size: f.size,
        dataUrl: f.dataUrl,
        mimeType: f.mimeType,
    }))
}

/** Merge multiple lorebooks into one, re-assigning entry IDs to avoid collisions. */
export function mergeLorebooks(lorebooks: LorebookData[]): LorebookData | undefined {
    if (lorebooks.length === 0) return undefined
    if (lorebooks.length === 1) return lorebooks[0]

    let nextId = 0
    const allEntries: LorebookEntry[] = []

    for (const lb of lorebooks) {
        for (const entry of lb.entries) {
            allEntries.push({
                ...entry,
                id: nextId++,
                comment: `[${lb.name}] ${entry.comment}`,
            })
        }
    }

    const joinField = (field: 'description' | 'personality' | 'scenario' | 'first_mes' | 'mes_example' | 'creator_notes') =>
        lorebooks.map(lb => lb[field]).filter(Boolean).join('\n\n---\n\n')

    return {
        filename: lorebooks.map(l => l.filename).join(', '),
        name: lorebooks.map(l => l.name).join(' + '),
        description: joinField('description'),
        personality: joinField('personality'),
        scenario: joinField('scenario'),
        first_mes: joinField('first_mes'),
        mes_example: joinField('mes_example'),
        creator_notes: joinField('creator_notes'),
        entries: allEntries,
        totalChars: allEntries.reduce((sum, e) => sum + e.content.length, 0),
        uploadedAt: Date.now(),
    }
}
