import type { StateData, GetGameStateOutput, LoadGameStateOutput, ListGameSavesOutput, LoadGameSaveOutput, CreateGameSaveOutput, AppInfo, GetAppInfoOutput, SetAppInfoInput, SetAppInfoOutput, PublishArticleInput, PublishArticleOutput, PublishCheckpointInput, PublishCheckpointOutput, SetAPIConfigInput, SetAPIConfigOutput } from './api/types'
import type { ISandboxClient } from '@pubwiki/sandbox-client'

declare global {
  interface Window {
    /**
     * Convenient method to call Lua services
     * @example window.callService('GameTemplate:Initialize', { player_name: 'John' })
     */
    callService: <T = any,P = any>(serviceName: string, params?: P) => Promise<T>
    /**
     * Get current game state snapshot
     * @example const state = await window.GetStateFromGame()
     */
    GetStateFromGame: () => Promise<GetGameStateOutput>
    /**
     * Load game state from snapshot
     * @example await window.LoadStateToGame(stateData)
     */
    LoadStateToGame: (data: StateData) => Promise<LoadGameStateOutput>
    /**
     * List all game saves
     * @example const result = await window.ListGameSaves()
     */
    ListGameSaves: () => Promise<ListGameSavesOutput>
    /**
     * Load a specific game save
     * @example await window.LoadGameSave('checkpoint-id')
     */
    LoadGameSave: (checkpointId: string) => Promise<LoadGameSaveOutput>
    /**
     * Delete a specific game save
     * @param checkpointId 
     * @returns 
     */
    DeleteGameSave: (checkpointId: string) => Promise<{ success: boolean; error?: string }>
    /**
     * Create a new game save
     * @example await window.CreateGameSave({ title: 'My Save', description: 'Save description' })
     */
    CreateGameSave: (input?: { title?: string; description?: string }) => Promise<CreateGameSaveOutput>

    GetAppInfo: () => Promise<GetAppInfoOutput>

    /**
     * Set application info (persists to backend)
     * @example await window.SetAppInfo({ data: { name: 'My Game', slug: 'my-game' } })
     */
    SetAppInfo: (input: SetAppInfoInput) => Promise<SetAppInfoOutput>

    /**
     * Publish the application
     * @example await window.PublishApp()
     */
    PublishApp: () => Promise<{ success: boolean; error?: string; artifactId?: string }>

    /**
     * Publish a game checkpoint so others can start playing from it
     * @example await window.PublishCheckpoint({ checkpointId: 'abc', isListed: true })
     */
    PublishCheckpoint: (input: PublishCheckpointInput) => Promise<PublishCheckpointOutput>

    /**
     * Publish an article
     * @example await window.PublishArticle({ title: 'My Story', content: [...] })
     */
    PublishArticle: (input: PublishArticleInput) => Promise<PublishArticleOutput>

    /**
     * Set API configuration for LLM models
     * @example await window.SetAPIConfig({ generationModel: { model: 'gpt-4', apiKey: '...' } })
     */
    SetAPIConfig: (input: SetAPIConfigInput) => Promise<SetAPIConfigOutput>

    client: ISandboxClient
  }
}

export {}
