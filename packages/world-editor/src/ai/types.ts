/**
 * AI Subsystem Types
 *
 * Type definitions for the JSON operation dispatch scheme (replaces JS execution).
 * See llm-docs/world-editor-ai-migration-plan.md §3 for design details.
 */

import type { TripleStore } from '@pubwiki/rdfstore'
import type { TripleTranslator, TripleOperation, StateDataView } from '../rdf/index'
import type { StateData } from '../types/index'
import type { ChatStreamEvent } from '@pubwiki/chat'

// ============================================================================
// State Operations — discriminated union for update_state tool
// ============================================================================

export type StateOperation =
  | UpsertCreatureOp
  | ReplaceCreatureOp
  | DeleteCreatureOp
  | UpsertRegionOp
  | ReplaceRegionOp
  | DeleteRegionOp
  | UpsertOrganizationOp
  | ReplaceOrganizationOp
  | DeleteOrganizationOp
  | UpdateWorldOp
  | SetInitialStoryOp
  | SetStoryHistoryOp

export interface UpsertCreatureOp {
  op: 'upsert_creature'
  creature_id: string
  data: Record<string, unknown>
}

export interface ReplaceCreatureOp {
  op: 'replace_creature'
  creature_id: string
  data: Record<string, unknown>
}

export interface DeleteCreatureOp {
  op: 'delete_creature'
  creature_id: string
}

export interface UpsertRegionOp {
  op: 'upsert_region'
  region_id: string
  data: Record<string, unknown>
}

export interface ReplaceRegionOp {
  op: 'replace_region'
  region_id: string
  data: Record<string, unknown>
}

export interface DeleteRegionOp {
  op: 'delete_region'
  region_id: string
}

export interface UpsertOrganizationOp {
  op: 'upsert_organization'
  organization_id: string
  data: Record<string, unknown>
}

export interface ReplaceOrganizationOp {
  op: 'replace_organization'
  organization_id: string
  data: Record<string, unknown>
}

export interface DeleteOrganizationOp {
  op: 'delete_organization'
  organization_id: string
}

export interface UpdateWorldOp {
  op: 'update_world'
  data: Record<string, unknown>
}

export interface SetInitialStoryOp {
  op: 'set_initial_story'
  data: Record<string, unknown>
}

export interface SetStoryHistoryOp {
  op: 'set_story_history'
  entries: unknown[]
}

// ============================================================================
// World Editor AI Context — passed to tool handlers
// ============================================================================

export interface WorldEditorAIContext {
  readonly store: TripleStore
  readonly translator: TripleTranslator
  readonly view: StateDataView
  /** Get current materialized state */
  getState(): StateData
  /** Apply triple operations to the store */
  applyOps(ops: TripleOperation[]): void
}

// ============================================================================
// Skill types for dynamic prefix generation
// ============================================================================

export interface SkillListItem {
  id: string
  title: string
  description?: string
  isBuiltIn: boolean
}

export interface MemoryListItem {
  id: string
  title: string
}

export interface WorkspaceFileInfo {
  name: string
  type: string
  size: number
}

// ============================================================================
// Workspace File Provider — abstraction for file storage
// ============================================================================

export interface WorkspaceFileProvider {
  /** List all uploaded workspace files */
  listFiles(): Promise<WorkspaceFileInfo[]>
  /** Read a text file's content (UTF-8) */
  readTextFile(filename: string): Promise<string | null>
  /** Read an image file as a data URL (data:image/png;base64,...) */
  readImageAsDataUrl(filename: string): Promise<string | null>
  /** Write/upload a file */
  writeFile(filename: string, content: Uint8Array): Promise<void>
  /** Delete a file */
  deleteFile(filename: string): Promise<void>
  /** Get MIME type for a filename */
  getMimeType(filename: string): string
}

// ============================================================================
// Validation types (compatible with original stateValidation.ts)
// ============================================================================

export interface ValidationWarning {
  index?: number
  field?: string
  message: string
}

export interface FullStateValidationResult {
  valid: boolean
  errors: string[]
  warnings: ValidationWarning[]
  autoFixes: string[]
}

// ============================================================================
// QueryUser types — for interactive form collection
// ============================================================================

export interface QueryUserField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'number'
  options?: string[]
  default_value?: string
  required?: boolean
  placeholder?: string
}

export interface QueryUserRequest {
  title: string
  fields: QueryUserField[]
}

// ============================================================================
// WorldEditorStreamEvent — extends ChatStreamEvent with copilot-specific events
// ============================================================================

export type WorldEditorStreamEvent =
  | ChatStreamEvent
  | { type: 'query_user'; request: QueryUserRequest }
  | { type: 'query_user_submitted' }
