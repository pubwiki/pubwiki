/**
 * useNarrative — Atomic toolkit for the AI narrative services.
 *
 * Provides independent operations that the user composes freely:
 *   - generate()     → CreativeWriting (streaming)
 *   - updateState()  → UpdateGameStateAndDocs
 *   - save/load      → Checkpoint management
 *   - history        → StoryHistory CRUD
 *
 * None of these auto-chain — call only what you need.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { usePub } from '@pubwiki/game-sdk'

// ── Types ──

export type StoryPhase =
  | 'idle'
  | 'collecting'   // RAG document retrieval
  | 'reasoning'    // AI thinking
  | 'generating'   // streaming creative content
  | 'updating'     // UpdateGameStateAndDocs running
  | 'saving'       // checkpoint creation

/** Streaming state — updates in real-time during generation. */
export interface StreamState {
  /** Partial creative content (from result_update events). */
  partialContent: unknown | null
  /** AI deep thinking process. */
  thinking: string | null
  /** AI reasoning. */
  reasoning: string | null
  /** RAG collector outline. */
  collectorOutline: string | null
}

/** Complete result from a CreativeWriting "done" event. */
export interface GenerateResult {
  content: unknown | null
  thinking: string | null
  reasoning: string | null
  settingChanges: unknown[] | null
  eventChanges: unknown[] | null
  newEntities: unknown[] | null
  directorNotes: unknown | null
  /** Pass to updateState() — pre-built messages for the Analyzer. */
  updaterMessages: unknown[] | null
  collectorResults: unknown[] | null
  collectorOutline: string | null
  /** Raw text from LLM. */
  rawText: string | null
}

/** Result from UpdateGameStateAndDocs. */
export interface UpdateResult {
  success: boolean
  /** Analyzer reasoning (debug). */
  audit?: string
  /** Short summary of affected entities. */
  outline?: string
  /** Player-friendly narrative of what changed. */
  summary?: string
  /** ECS service calls made. */
  calls?: Array<{ service: string; args: unknown }>
  /** Results of each call. */
  results?: Array<{ service: string; success?: boolean; error?: string }>
  error?: string
}

/** Checkpoint entry. */
export interface SaveEntry {
  checkpointId: string
  title: string
  description: string
  timestamp: number
}

/** Story history data (matches backend snake_case fields). */
export interface StoryHistory {
  turn_ids: string[]
  story: Record<string, { content: unknown; checkpoint_id?: string }>
}

/** Parameters for generate(). */
export interface GenerateParams {
  /** What should the AI write about? Include player action + style guidance. */
  create_request: string
  /** How should the AI think before writing? */
  thinking_instruction: string
  /** Recent story content for continuity. */
  previous_content_overview: string
  /** TypeScript interface string describing your creative content shape. */
  output_content_schema: string
  /** Optional JSON Schema for strict validation. */
  output_content_schema_definition?: unknown
  /** Example of thinking output format. */
  thinking_example?: string
  /** LLM model override. */
  model?: string
  /** Reuse last RAG results (useful for retries). */
  reuse_last_collect?: boolean
  /** Skip state change recommendations + director notes (saves tokens). */
  skip_state_updates?: boolean
}

/** Parameters for updateState(). */
export interface UpdateStateParams {
  /** The narrative text for this turn. */
  new_event: string
  /**
   * If omitted, automatically uses fields from the last generate() result.
   * Pass explicitly to override.
   */
  settingChanges?: unknown[]
  eventChanges?: unknown[]
  newEntities?: unknown[]
  directorNotes?: unknown
  updaterMessages?: unknown[]
}

// ── Hook return type ──

export interface NarrativeKit {
  // Stories (from world state, reactive)
  /** Background story — world lore / premise. */
  backgroundStory: string | null
  /** Opening story — the first narrative the player sees. */
  startStory: string | null

  // State
  phase: StoryPhase
  stream: StreamState
  lastResult: GenerateResult | null
  lastUpdate: UpdateResult | null
  error: string | null

  // Core loop operations
  generate: (params: GenerateParams) => Promise<GenerateResult>
  updateState: (params: UpdateStateParams) => Promise<UpdateResult>

  // Save/Load
  save: (title?: string, description?: string) => Promise<string>
  load: (checkpointId: string) => Promise<void>
  listSaves: () => Promise<SaveEntry[]>
  deleteSave: (checkpointId: string) => Promise<void>

  // History
  getHistory: () => Promise<StoryHistory>
  addHistory: (turnId: string, data: { content: unknown; checkpoint_id?: string }) => Promise<void>
  clearHistory: () => Promise<void>

  // Utilities
  reset: () => void
}

// ── Implementation ──

const EMPTY_STREAM: StreamState = {
  partialContent: null,
  thinking: null,
  reasoning: null,
  collectorOutline: null,
}

export function useNarrative(): NarrativeKit {
  const pub = usePub()

  const [backgroundStory, setBackgroundStory] = useState<string | null>(null)
  const [startStory, setStartStory] = useState<string | null>(null)

  // Fetch initial stories on mount via service call
  useEffect(() => {
    let cancelled = false
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .state?.GetGameInitialStory
    if (!call) return
    call({}).then((res: unknown) => {
      if (cancelled) return
      console.log('[useNarrative] GetGameInitialStory result:', res)
      const r = res as { background?: string; start_story?: string }
      setBackgroundStory(r.background ?? null)
      setStartStory(r.start_story ?? null)
    }).catch((err) => { console.warn('[useNarrative] GetGameInitialStory failed:', err) })
    return () => { cancelled = true }
  }, [pub])

  const [phase, setPhase] = useState<StoryPhase>('idle')
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM)
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null)
  const [lastUpdate, setLastUpdate] = useState<UpdateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep a ref to lastResult for updateState() to read without stale closure
  const lastResultRef = useRef<GenerateResult | null>(null)

  // ── generate ──

  const generate = useCallback(async (params: GenerateParams): Promise<GenerateResult> => {
    setError(null)
    setStream(EMPTY_STREAM)
    setPhase('collecting')

    return new Promise<GenerateResult>((resolve, reject) => {
      const callback = (event: { event_type: string; event_data: unknown }) => {
        switch (event.event_type) {
          case 'collector_result_update': {
            const data = event.event_data as Record<string, unknown>
            console.log('[useNarrative] collector_result_update:', data)
            setPhase('collecting')
            setStream(s => ({
              ...s,
              collectorOutline: (data.collector_outline as string) ?? s.collectorOutline,
            }))
            break
          }
          case 'reasoning_update': {
            const data = event.event_data as Record<string, unknown>
            setPhase('reasoning')
            setStream(s => ({
              ...s,
              reasoning: (data.reasoning as string) ?? s.reasoning,
            }))
            break
          }
          case 'result_update': {
            const data = event.event_data as Record<string, unknown>
            setPhase('generating')
            setStream(s => ({
              ...s,
              partialContent: data.content ?? s.partialContent,
              thinking: (data.thinking as string) ?? s.thinking,
            }))
            break
          }
          case 'done': {
            const data = event.event_data as Record<string, unknown>
            console.log('[useNarrative] done — writer result:', data)
            const result: GenerateResult = {
              content: data.content ?? null,
              thinking: (data.thinking as string) ?? null,
              reasoning: (data.reasoning as string) ?? null,
              settingChanges: (data.setting_changes as unknown[]) ?? null,
              eventChanges: (data.event_changes as unknown[]) ?? null,
              newEntities: (data.new_entities as unknown[]) ?? null,
              directorNotes: data.director_notes ?? null,
              updaterMessages: (data.updater_messages as unknown[]) ?? null,
              collectorResults: (data.collector_results as unknown[]) ?? null,
              collectorOutline: (data.collector_outline as string) ?? null,
              rawText: (data.raw_text as string) ?? null,
            }
            setLastResult(result)
            lastResultRef.current = result
            setPhase('idle')
            resolve(result)
            break
          }
          case 'error': {
            const msg = typeof event.event_data === 'string'
              ? event.event_data
              : JSON.stringify(event.event_data)
            setError(msg)
            setPhase('idle')
            reject(new Error(msg))
            break
          }
        }
      }

      const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
        .GameTemplate?.CreativeWriting

      if (!call) {
        const msg = 'GameTemplate:CreativeWriting service not available'
        setError(msg)
        setPhase('idle')
        reject(new Error(msg))
        return
      }

      call({
        create_request: params.create_request,
        thinking_instruction: params.thinking_instruction,
        previous_content_overview: params.previous_content_overview,
        output_content_schema: params.output_content_schema,
        output_content_schema_definition: params.output_content_schema_definition,
        thinking_example: params.thinking_example,
        model: params.model,
        reuse_last_collect: params.reuse_last_collect,
        skip_state_updates: params.skip_state_updates,
        callback,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setPhase('idle')
        reject(err)
      })
    })
  }, [pub])

  // ── updateState ──

  const updateState = useCallback(async (params: UpdateStateParams): Promise<UpdateResult> => {
    setError(null)
    setPhase('updating')

    try {
      // Merge with lastResult if fields not explicitly provided
      const prev = lastResultRef.current
      const input = {
        new_event: params.new_event,
        setting_changes: params.settingChanges ?? prev?.settingChanges,
        event_changes: params.eventChanges ?? prev?.eventChanges,
        new_entities: params.newEntities ?? prev?.newEntities,
        director_notes: params.directorNotes ?? prev?.directorNotes,
        updater_messages: params.updaterMessages ?? prev?.updaterMessages,
      }

      const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
        .GameTemplate?.UpdateGameStateAndDocs

      if (!call) throw new Error('GameTemplate:UpdateGameStateAndDocs service not available')

      console.log('[useNarrative] updateState input:', input)
      const raw = await call(input) as Record<string, unknown>
      console.log('[useNarrative] updateState result:', raw)
      const result: UpdateResult = {
        success: raw.success as boolean,
        audit: raw.audit as string | undefined,
        outline: raw.outline as string | undefined,
        summary: raw.summary as string | undefined,
        calls: raw.calls as UpdateResult['calls'],
        results: raw.results as UpdateResult['results'],
        error: raw.error as string | undefined,
      }
      setLastUpdate(result)
      setPhase('idle')
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setPhase('idle')
      throw err
    }
  }, [pub])

  // ── Save/Load ──

  const save = useCallback(async (title?: string, description?: string): Promise<string> => {
    setPhase('saving')
    try {
      const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
        .save?.CreateGameSave
      if (!call) throw new Error('save:CreateGameSave service not available')
      const result = await call({ title, description }) as { success: boolean; checkpointId: string; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Save failed')
      setPhase('idle')
      return result.checkpointId
    } catch (err) {
      setPhase('idle')
      throw err
    }
  }, [pub])

  const load = useCallback(async (checkpointId: string): Promise<void> => {
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .save?.LoadGameSave
    if (!call) throw new Error('save:LoadGameSave service not available')
    const result = await call({ checkpointId }) as { success: boolean; error?: string }
    if (!result.success) throw new Error(result.error ?? 'Load failed')
  }, [pub])

  const listSaves = useCallback(async (): Promise<SaveEntry[]> => {
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .save?.ListGameSaves
    if (!call) throw new Error('save:ListGameSaves service not available')
    const result = await call({}) as { saves: SaveEntry[] }
    return result.saves ?? []
  }, [pub])

  const deleteSave = useCallback(async (checkpointId: string): Promise<void> => {
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .save?.DeleteGameSave
    if (!call) throw new Error('save:DeleteGameSave service not available')
    const result = await call({ checkpointId }) as { success: boolean; error?: string }
    if (!result.success) throw new Error(result.error ?? 'Delete failed')
  }, [pub])

  // ── History ──

  const getHistory = useCallback(async (): Promise<StoryHistory> => {
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .state?.GetStoryHistory
    if (!call) throw new Error('state:GetStoryHistory service not available')
    const result = await call({}) as { success: boolean; data?: StoryHistory; error?: string }
    if (!result.success) throw new Error(result.error ?? 'GetStoryHistory failed')
    const d = result.data
    return {
      turn_ids: Array.isArray(d?.turn_ids) ? d.turn_ids : [],
      story: d?.story && typeof d.story === 'object' ? d.story : {},
    }
  }, [pub])

  const addHistory = useCallback(async (
    turnId: string,
    data: { content: unknown; checkpoint_id?: string },
  ): Promise<void> => {
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .state?.SetNewStoryHistory
    if (!call) throw new Error('state:SetNewStoryHistory service not available')
    const result = await call({ turn_id: turnId, data }) as { success: boolean; error?: string }
    if (!result.success) throw new Error(result.error ?? 'SetNewStoryHistory failed')
  }, [pub])

  const clearHistory = useCallback(async (): Promise<void> => {
    const call = (pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      .state?.ClearStoryHistory
    if (!call) throw new Error('state:ClearStoryHistory service not available')
    const result = await call({}) as { success: boolean; error?: string }
    if (!result.success) throw new Error(result.error ?? 'ClearStoryHistory failed')
  }, [pub])

  // ── Reset ──

  const reset = useCallback(() => {
    setPhase('idle')
    setStream(EMPTY_STREAM)
    setLastResult(null)
    setLastUpdate(null)
    setError(null)
    lastResultRef.current = null
  }, [])

  return {
    backgroundStory,
    startStory,
    phase,
    stream,
    lastResult,
    lastUpdate,
    error,
    generate,
    updateState,
    save,
    load,
    listSaves,
    deleteSave,
    getHistory,
    addHistory,
    clearHistory,
    reset,
  }
}
