/**
 * WorldBuilder Types
 *
 * Migrated from worldBuilderNextTypes.ts — stripped of i18next, TabType, LorebookData.
 * Types for the 6-phase world-building pipeline.
 */

import type { QueryUserRequest } from '../types'

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

export type WBNPhaseId = (typeof WBN_PHASE_IDS)[number]

export type WBNPhaseStatus = 'pending' | 'active' | 'generating' | 'completed' | 'error'

/**
 * Static English phase labels for AI prompt construction.
 * NOT i18n'd — sent to the LLM as-is.
 */
export const WBN_PHASE_LABELS: Record<WBNPhaseId, string> = {
  synopsis: 'Draft',
  world_data: 'World Data',
  regions: 'Regions',
  organizations: 'Organizations',
  creatures: 'Characters',
  initial_story: 'Opening Story',
}

// ============================================================================
// Draft Output (Synopsis phase)
// ============================================================================

export interface WBNDraftOutput {
  tone: string
  opening: string
  storyline: string
  mechanics: string
  protagonist: string
  creatures: Array<{ creature_id: string; name: string; is_player: boolean }>
  regions: Array<{ region_id: string; name: string }>
  organizations: Array<{ organization_id: string; name: string }>
}

// ============================================================================
// Phase Data
// ============================================================================

export interface WBNPhaseData {
  status: WBNPhaseStatus
  output?: unknown
  /** File extraction result cached per phase */
  fileExtractionResult?: string
  error?: string
}

function createEmptyPhaseData(): WBNPhaseData {
  return { status: 'pending' }
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
// Lorebook
// ============================================================================

export interface LorebookEntry {
  id: number
  keys: string[]
  comment: string
  content: string
  enabled: boolean
}

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

// ============================================================================
// Reference File
// ============================================================================

export interface WBNReferenceFile {
  name: string
  content: string
  type: 'md' | 'json' | 'txt' | 'image'
  size: number
  /** Base64 data URL for images */
  dataUrl?: string
  mimeType?: string
}

// ============================================================================
// Session
// ============================================================================

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
  referenceLorebook?: LorebookData,
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

/** A sub-field entry within a state change */
export interface StateChangeChild {
  /** Field key */
  key: string
  /** Human-readable label */
  label: string
}

/** A single state change entry from executing operations */
export interface StateChangeEntry {
  /** Operation type: created, updated, replaced, deleted */
  action: 'created' | 'updated' | 'replaced' | 'deleted'
  /** Entity category */
  category: 'creature' | 'region' | 'organization' | 'world' | 'story' | 'story_history'
  /** Entity ID (for creatures/regions/organizations) */
  entityId?: string
  /** Display label */
  label: string
  /** Editor tab to navigate to */
  tab: string
  /** Sub-fields that were modified */
  children?: StateChangeChild[]
}

export type WBNStreamEvent =
  | { type: 'ai_text'; text: string }
  | { type: 'extraction_progress'; message: string }
  | { type: 'streaming_progress'; charCount: number }
  | { type: 'phase_output'; phaseId: WBNPhaseId; output: unknown }
  | { type: 'phase_applied'; changes: StateChangeEntry[] }
  | { type: 'validation_retry'; attempt: number; errors: string[]; accepted: boolean }
  | { type: 'draft_review'; draft: WBNDraftOutput }
  | { type: 'query_user'; request: QueryUserRequest }
  | { type: 'done' }
  | { type: 'error'; error: string }
  // Revision-only events
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'revision_patch'; toolName: string; summary: string }
  | { type: 'revision_done'; summary: string }

// ============================================================================
// Phase Navigation Helpers
// ============================================================================

/** Initialize creature batching from synopsis output */
export function initCreatureBatching(session: WBNSession): void {
  const draft = session.phases.synopsis.output as WBNDraftOutput | undefined
  if (!draft?.creatures?.length) {
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
    batches.push({ creatureIds: batch.map((c) => c.creature_id) })
  }

  session.creatureBatching = {
    totalBatches: batches.length,
    currentBatch: 0,
    batchPlan: batches,
  }
}

/** Get the next phase (or null if completed) */
export function getNextPhase(session: WBNSession): WBNPhaseId | null {
  const idx = WBN_PHASE_IDS.indexOf(session.currentPhase)
  if (idx < 0) return null

  // Check creature batching
  if (session.currentPhase === 'creatures' && session.creatureBatching) {
    const { currentBatch, totalBatches } = session.creatureBatching
    if (currentBatch < totalBatches - 1) return 'creatures'
  }

  let nextIdx = idx + 1
  while (nextIdx < WBN_PHASE_IDS.length) {
    const nextPhase = WBN_PHASE_IDS[nextIdx]
    if (nextPhase === 'organizations' && session.skipOrganizations) {
      session.phases.organizations.status = 'completed'
      nextIdx++
      continue
    }
    return nextPhase
  }
  return null
}

/** Advance the session to the next phase. Returns false if completed. */
export function advancePhase(session: WBNSession): boolean {
  // If in creature batching, advance batch first
  if (session.currentPhase === 'creatures' && session.creatureBatching) {
    const batching = session.creatureBatching
    if (batching.currentBatch < batching.totalBatches - 1) {
      batching.currentBatch++
      session.phases.creatures.status = 'active'
      session.updatedAt = Date.now()
      return true
    }
  }

  session.phases[session.currentPhase].status = 'completed'

  const next = getNextPhase(session)
  if (!next) {
    session.status = 'completed'
    session.updatedAt = Date.now()
    return false
  }

  session.currentPhase = next
  session.phases[next].status = 'active'
  session.updatedAt = Date.now()
  return true
}
