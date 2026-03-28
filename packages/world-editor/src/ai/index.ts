/**
 * AI Subsystem Public API
 *
 * Exports the orchestrator, types, and utilities for the world editor AI copilot.
 */

// Types
export type {
  StateOperation,
  UpsertCreatureOp,
  ReplaceCreatureOp,
  DeleteCreatureOp,
  UpsertRegionOp,
  ReplaceRegionOp,
  DeleteRegionOp,
  UpsertOrganizationOp,
  ReplaceOrganizationOp,
  DeleteOrganizationOp,
  UpdateWorldOp,
  SetInitialStoryOp,
  SetStoryHistoryOp,
  WorldEditorAIContext,
  SkillListItem,
  MemoryListItem,
  WorkspaceFileInfo,
  WorkspaceFileProvider,
  ValidationWarning,
  FullStateValidationResult,
  QueryUserField,
  QueryUserRequest,
  WorldEditorStreamEvent,
} from './types'

// Orchestrator
export {
  WorldEditorCopilotOrchestrator,
  type WorldEditorCopilotConfig,
} from './copilot/orchestrator'

// Skill provider interface (for external implementations)
export type { SkillProvider } from './copilot/tools/skill-tools'

// Services
export { MemoryStore, type MemoryEntry } from './services/memory-store'
export { SkillStore, type UserSkillEntry } from './services/skill-store'
export { parseSillyTavernLorebook } from './services/lorebook-parser'

// State bridge utilities (for direct use if needed)
export {
  validateFullState,
  formatValidationWarnings,
  generateStateOverview,
} from './state-bridge'

// WorldBuilder engine (headless 6-phase pipeline)
export {
  streamWorldBuilderPhase,
  streamAndApplyPhase,
  type WorldBuilderConfig,
  type WorldBuilderContext,
} from './world-builder/engine'
export { streamWorldBuilderRevision } from './world-builder/revision-tools'
export {
  type WBNPhaseId,
  type WBNSession,
  type WBNStreamEvent,
  type WBNDraftOutput,
  type WBNPhaseData,
  type WBNPhaseStatus,
  type WBNReferenceFile,
  type LorebookData,
  type LorebookEntry,
  type StateChangeEntry,
  type StateChangeChild,
  WBN_PHASE_IDS,
  WBN_PHASE_LABELS,
  createWBNSession,
  initCreatureBatching,
  getNextPhase,
  advancePhase,
} from './world-builder/types'
export {
  validatePhaseOutput,
  formatValidationErrorsForAI,
  type PhaseValidationResult,
} from './world-builder/validation'
export {
  buildPhaseMessages,
  applyPhaseOutput,
  applyRevisionPatch,
  computePhaseChanges,
} from './world-builder/service'
export { WBNSessionStore } from './world-builder/session-store'

// Designer Agent
export {
  DesignerOrchestrator,
  type DesignerConfig,
} from './designer/orchestrator'
export type {
  SandboxConnectionLike,
  SandboxConnectionGetter,
} from './designer/tools/sandbox-tools'
