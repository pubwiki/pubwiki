/**
 * Shared Game Services API
 * 
 * Centralized, typed wrappers around `window.callService` and global functions.
 * Provides a clean, discoverable interface for all game service calls.
 * 
 * Usage:
 * ```ts
 * import { getGameState, createSave, getPlayerEntity } from '../../utils'
 * ```
 */

import type {
  GetGameStateOutput,
  StateData,
  LoadGameStateOutput,
  CreateGameSaveOutput,
  LoadGameSaveOutput,
  ListGameSavesOutput,
  SetNewStoryHistoryInput,
  GetStoryHistoryOutput,
  ClearStoryHistoryOutput,
  UpdateGameStateAndDocsInput,
  UpdateGameStateAndDocsOutput,
  CreativeWritingStreamInput,
  GameInitializeOutput,
  GetAppInfoOutput,
  PublishArticleInput,
  PublishArticleOutput,
  PublishCheckpointInput,
  PublishCheckpointOutput,
  SetAPIConfigInput,
  SetAPIConfigOutput,
  PlayerEntityOutput,
  NPCEntitiesOutput,
} from '../../api/types'

// ============================================================================
// State Management
// ============================================================================

/** Get the current game state snapshot */
export async function getGameState(): Promise<GetGameStateOutput> {
  return window.GetStateFromGame()
}

/** Load a complete game state into the engine */
export async function loadState(data: StateData): Promise<LoadGameStateOutput> {
  return window.LoadStateToGame(data)
}

// ============================================================================
// Save / Load
// ============================================================================

/** Create a new game save checkpoint */
export async function createSave(
  opts?: { title?: string; description?: string }
): Promise<CreateGameSaveOutput> {
  return window.CreateGameSave(opts)
}

/** Load a game save by checkpoint ID */
export async function loadSave(checkpointId: string): Promise<LoadGameSaveOutput> {
  return window.LoadGameSave(checkpointId)
}

/** Delete a game save by checkpoint ID */
export async function deleteSave(checkpointId: string): Promise<{ success: boolean; error?: string }> {
  return window.DeleteGameSave(checkpointId)
}

/** List all available game saves */
export async function listSaves(): Promise<ListGameSavesOutput> {
  return window.ListGameSaves()
}

// ============================================================================
// Story History
// ============================================================================

/** Retrieve the full story history */
export async function getStoryHistory(): Promise<GetStoryHistoryOutput> {
  return window.callService<GetStoryHistoryOutput>('state:GetStoryHistory', {})
}

/** Add a new story history entry */
export async function setNewStoryHistory(input: SetNewStoryHistoryInput): Promise<void> {
  return window.callService<void, SetNewStoryHistoryInput>('state:SetNewStoryHistory', input)
}

/** Clear all story history */
export async function clearStoryHistory(): Promise<ClearStoryHistoryOutput> {
  return window.callService<ClearStoryHistoryOutput>('state:ClearStoryHistory', {})
}

// ============================================================================
// Game State Updates
// ============================================================================

/** Update game state and documents based on narrative events */
export async function updateGameStateAndDocs(
  input: UpdateGameStateAndDocsInput
): Promise<UpdateGameStateAndDocsOutput> {
  return window.callService<UpdateGameStateAndDocsOutput, UpdateGameStateAndDocsInput>(
    'GameTemplate:UpdateGameStateAndDocs',
    input
  )
}

// ============================================================================
// Creative Writing
// ============================================================================

/** Start a streaming creative writing generation */
export async function creativeWritingStream(input: CreativeWritingStreamInput): Promise<void> {
  return window.callService<void, CreativeWritingStreamInput>(
    'GameTemplate:CreativeWritingStream',
    input
  )
}

// ============================================================================
// ECS Entity Queries
// ============================================================================

/** Query the player entity from ECS */
export async function getPlayerEntity(): Promise<PlayerEntityOutput> {
  return window.callService<PlayerEntityOutput>('ecs.system:Query.getPlayerEntity', {})
}

/** Query all NPC entities from ECS */
export async function getNPCEntities(): Promise<NPCEntitiesOutput> {
  return window.callService<NPCEntitiesOutput>('ecs.system:Query.getNPCEntities', {})
}

// ============================================================================
// Game Initialization
// ============================================================================

/** Initialize the game template */
export async function initializeGame(): Promise<GameInitializeOutput> {
  return window.callService<GameInitializeOutput>('GameTemplate:Initialize', {})
}

// ============================================================================
// Publishing
// ============================================================================

/** Get application info */
export async function getAppInfo(): Promise<GetAppInfoOutput> {
  return window.GetAppInfo()
}

/** Publish the application */
export async function publishApp(): Promise<{ success: boolean; error?: string; artifactId?: string }> {
  return window.PublishApp()
}

/** Publish an article */
export async function publishArticle(input: PublishArticleInput): Promise<PublishArticleOutput> {
  return window.PublishArticle(input)
}

/** Publish a game checkpoint */
export async function publishCheckpoint(input: PublishCheckpointInput): Promise<PublishCheckpointOutput> {
  return window.PublishCheckpoint(input)
}

// ============================================================================
// API Configuration
// ============================================================================

/** Set API configuration for LLM models */
export async function setAPIConfig(input: SetAPIConfigInput): Promise<SetAPIConfigOutput> {
  return window.SetAPIConfig(input)
}
