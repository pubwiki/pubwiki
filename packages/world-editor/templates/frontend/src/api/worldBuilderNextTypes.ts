/**
 * WorldBuilderNext Types
 *
 * Simplified data model for the v2 world-building pipeline.
 * Key differences from v1:
 * - 6 phases (not 9 steps) — no registry, setting_docs, or self_check
 * - Dynamic creature batching (3 per batch)
 * - Data applied incrementally after each phase
 * - Banner-based UX (not modal)
 */

import i18next from 'i18next'

// ============================================================================
// Phase Definitions
// ============================================================================

/** All phase IDs in pipeline order */
export const WBN_PHASE_IDS = [
    'synopsis',
    'initial_story',
    'world_data',
    'regions',
    'organizations',
    'creatures',
] as const

export type WBNPhaseId = typeof WBN_PHASE_IDS[number]

export type WBNPhaseStatus = 'pending' | 'active' | 'generating' | 'completed' | 'error'

/** Human-readable phase labels (i18n) */
export function getWBNPhaseLabel(phaseId: WBNPhaseId): string {
    return i18next.t(`editor:worldBuilder.phases.${phaseId}`)
}

/** Get all phase labels as a record (i18n, resolved at call time) */
export function getWBNPhaseLabels(): Record<WBNPhaseId, string> {
    const labels = {} as Record<WBNPhaseId, string>
    for (const id of WBN_PHASE_IDS) {
        labels[id] = getWBNPhaseLabel(id)
    }
    return labels
}

/**
 * Static English phase labels for AI prompt construction.
 * These are intentionally NOT i18n'd because they are sent to the LLM.
 */
export const WBN_PHASE_LABELS_EN: Record<WBNPhaseId, string> = {
    synopsis: 'Draft',
    world_data: 'World Data',
    regions: 'Regions',
    organizations: 'Organizations',
    creatures: 'Characters',
    initial_story: 'Opening Story',
}

/**
 * Static Chinese phase labels for AI prompt construction (legacy).
 */
export const WBN_PHASE_LABELS_ZH: Record<WBNPhaseId, string> = {
    synopsis: '设计稿',
    world_data: '世界数据',
    regions: '地域',
    organizations: '组织',
    creatures: '角色',
    initial_story: '开场故事',
}

/** Phase labels used in AI prompts */
export const WBN_PHASE_LABELS = WBN_PHASE_LABELS_EN


// ============================================================================
// Draft Output (replaces Synopsis)
// ============================================================================

export interface WBNDraftOutput {
    tone: string           // 游玩基调
    opening: string        // 开场时机
    storyline: string      // 故事线
    mechanics: string      // 游戏机制
    protagonist: string    // 主角描述
    creatures: Array<{ creature_id: string; name: string; is_player: boolean }>
    regions: Array<{ region_id: string; name: string }>
    organizations: Array<{ organization_id: string; name: string }>
}

// ============================================================================
// Chat Message (reuse v1 format for API compatibility)
// ============================================================================

export interface WBNChatMessage {
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    toolCalls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
        thought_signature?: string
    }>
    tool_call_id?: string
}

// ============================================================================
// Phase Data
// ============================================================================

export interface WBNPhaseData {
    status: WBNPhaseStatus
    output?: unknown
    chatHistory: WBNChatMessage[]
    revisionHistory: WBNChatMessage[]
    error?: string
    fileExtractionResult?: string
}

function createEmptyPhaseData(): WBNPhaseData {
    return {
        status: 'pending',
        chatHistory: [],
        revisionHistory: [],
    }
}

// ============================================================================
// Creature Batching
// ============================================================================

export interface WBNCreatureBatch {
    creatureIds: string[]
}

export interface WBNCreatureBatching {
    totalBatches: number
    currentBatch: number
    batchPlan: WBNCreatureBatch[]
}

/** How many creatures per batch */
export const CREATURES_PER_BATCH = 3

// ============================================================================
// Session
// ============================================================================

/** A single uploaded reference file for WorldBuilder */
export interface WBNReferenceFile {
    name: string
    content: string
    type: 'md' | 'json' | 'txt' | 'image'
    size: number
    /** Base64 data URL for images */
    dataUrl?: string
    mimeType?: string
}

export interface WBNSession {
    id: string
    status: 'active' | 'paused' | 'completed' | 'error'
    currentPhase: WBNPhaseId
    createdAt: number
    updatedAt: number

    initialPrompt: string

    /** Single reference file (optional) */
    referenceFile?: WBNReferenceFile
    /** Single lorebook (optional) */
    referenceLorebook?: LorebookData

    skipOrganizations?: boolean

    /** User's design preferences collected via query_user in synopsis phase */
    userDesignNotes?: string

    phases: Record<WBNPhaseId, WBNPhaseData>

    /** Creature batching state — initialized after synopsis completes */
    creatureBatching?: WBNCreatureBatching
}

/** Create a new empty session */
export function createWBNSession(
    initialPrompt: string,
    referenceFile?: WBNReferenceFile,
    referenceLorebook?: LorebookData
): WBNSession {
    const now = Date.now()
    const phases = {} as Record<WBNPhaseId, WBNPhaseData>
    for (const phaseId of WBN_PHASE_IDS) {
        phases[phaseId] = createEmptyPhaseData()
    }
    phases.synopsis.status = 'active'

    return {
        id: `wbn_${now}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'active',
        currentPhase: 'synopsis',
        createdAt: now,
        updatedAt: now,
        initialPrompt,
        ...(referenceFile ? { referenceFile } : {}),
        ...(referenceLorebook ? { referenceLorebook } : {}),
        phases,
    }
}

// ============================================================================
// Stream Events
// ============================================================================

export type WBNStreamEvent =
    | { type: 'ai_text'; text: string }
    | { type: 'extraction_progress'; message: string }
    | { type: 'streaming_progress'; charCount: number }
    | { type: 'phase_output'; phaseId: WBNPhaseId; output: unknown }
    | { type: 'validation_retry'; attempt: number; errors: string[]; accepted: boolean }
    | { type: 'draft_review'; draft: WBNDraftOutput }
    | { type: 'query_user'; request: QueryUserRequest }
    | { type: 'done' }
    | { type: 'error'; error: string }
    // Revision-only events
    | { type: 'tool_call_start'; toolCallId: string; toolName: string }
    | { type: 'revision_patch'; toolName: string; summary: string }
    | { type: 'revision_done'; summary: string }

/** Query user request (reuse from copilot) */
export interface QueryUserRequest {
    title: string
    fields: QueryUserField[]
}

export interface QueryUserField {
    key: string
    label: string
    type: 'text' | 'select' | 'multiselect'
    options?: string[]
    default_value?: string
}

// ============================================================================
// Phase → Tab Mapping
// ============================================================================

import type { TabType } from '../components/state-editor/types'

/** Map phase completion to which editor tab to switch to */
export const PHASE_TAB_MAP: Partial<Record<WBNPhaseId, TabType>> = {
    world_data: 'world',
    regions: 'regions',
    organizations: 'organizations',
    creatures: 'creatures',
    initial_story: 'initial-story',
}

// ============================================================================
// Lorebook (SillyTavern)
// ============================================================================

/** A single lorebook entry parsed from SillyTavern character_book.entries */
export interface LorebookEntry {
    id: number
    keys: string[]
    comment: string
    content: string
    enabled: boolean
}

/** Parsed lorebook data from a SillyTavern character card JSON */
export interface LorebookData {
    filename: string
    name: string
    description: string
    personality: string
    scenario: string
    first_mes: string
    mes_example: string
    creator_notes: string
    entries: LorebookEntry[]
    totalChars: number
    uploadedAt: number
}
