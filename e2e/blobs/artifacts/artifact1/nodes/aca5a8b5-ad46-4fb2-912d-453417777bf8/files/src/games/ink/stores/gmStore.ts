import { create } from 'zustand'
import type { CreativeWritingOutput } from '../../../api/types'
import {
  creativeWritingStream,
  updateGameStateAndDocs,
} from '../../utils'
import { refreshAllGameData } from './refreshCoordinator'
import { useCreatureStore } from './creatureStore'
import { useGameStore } from './gameStore'
import {
  initGMChatStorage,
  getGMMessages,
  saveGMMessages,
  clearGMMessages,
} from '../../../api/gmChatStorage'
import type { GMMessage, CollectorResult } from '../types'

interface GMState {
  messages: GMMessage[]
  inputText: string
  isGenerating: boolean
  currentRequestId: number

  setInputText: (text: string) => void
  sendMessage: () => Promise<void>
  approveChanges: (messageId: string) => Promise<void>
  rejectChanges: (messageId: string) => void
  clearChat: () => void
  loadMessages: () => Promise<void>
  reset: () => void
}

function generateId(): string {
  return `gm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export const useGMStore = create<GMState>((set, get) => ({
  messages: [],
  inputText: '',
  isGenerating: false,
  currentRequestId: 0,

  setInputText: (text) => set({ inputText: text }),

  loadMessages: async () => {
    await initGMChatStorage()
    const messages = getGMMessages()
    // Restore messages but reset any stuck 'applying' status
    const restored = messages.map(m =>
      m.approvalStatus === 'applying' ? { ...m, approvalStatus: 'pending' as const } : m
    )
    set({ messages: restored })
  },

  sendMessage: async () => {
    const { inputText, isGenerating, currentRequestId } = get()
    if (!inputText.trim() || isGenerating) return

    const requestId = currentRequestId + 1
    set({ currentRequestId: requestId, isGenerating: true, inputText: '' })

    // Add user message
    const userMsg: GMMessage = {
      id: generateId(),
      role: 'user',
      content: inputText.trim(),
      timestamp: Date.now(),
    }

    // Add placeholder assistant message
    const assistantMsg: GMMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      phase: 'collecting',
    }

    set((s) => {
      const msgs = [...s.messages, userMsg, assistantMsg]
      saveGMMessages(msgs)
      return { messages: msgs }
    })

    const assistantId = assistantMsg.id

    const updateAssistant = (updater: (msg: GMMessage) => GMMessage) => {
      set((s) => {
        const msgs = s.messages.map(m => m.id === assistantId ? updater(m) : m)
        saveGMMessages(msgs)
        return { messages: msgs }
      })
    }

    try {
      // Build context from game state
      const { playerEntity } = useCreatureStore.getState()
      const historyText = useGameStore.getState().buildHistoryText()
      const playerName = playerEntity?.Creature?.name || 'Player'

      // Build GM chat history context (last 10 messages)
      const recentChat = get().messages.slice(-12, -2) // exclude the just-added user+assistant
      const chatContext = recentChat
        .map(m => `[${m.role === 'user' ? 'GM' : 'System'}]: ${m.content}`)
        .join('\n')

      const callback = (streamEvent: { event_type: string; event_data: unknown }) => {
        // Check request is still current
        if (requestId !== get().currentRequestId) return

        const { event_type, event_data } = streamEvent

        if (event_type === 'reasoning_update') {
          const data = event_data as {
            reasoning?: string
            collector_results?: CollectorResult[]
            collector_outline?: string
          }
          if (!data) return
          updateAssistant(m => ({
            ...m,
            reasoning: data.reasoning || m.reasoning,
            collectorResults: data.collector_results || m.collectorResults,
            collectorOutline: data.collector_outline || m.collectorOutline,
            phase: 'reasoning',
          }))

        } else if (event_type === 'result_update' || event_type === 'collector_result_update') {
          const partial = event_data as Partial<CreativeWritingOutput> & {
            content?: {
              analysis?: string
              new_event?: string
              state_changes?: string[]
              setting_changes?: any[]
              event_changes?: any[]
            }
          }
          if (!partial) return

          const data = partial.content || {}
          let phase: GMMessage['phase'] = 'collecting'
          if (data.analysis) phase = 'analyzing'
          else if (partial.thinking) phase = 'thinking'
          else if (partial.reasoning) phase = 'reasoning'
          else if (partial.collector_results?.length) phase = 'collecting'

          updateAssistant(m => ({
            ...m,
            content: data.analysis || m.content,
            reasoning: partial.reasoning || m.reasoning,
            thinking: partial.thinking || m.thinking,
            collectorResults: partial.collector_results || m.collectorResults,
            collectorOutline: partial.collector_outline || m.collectorOutline,
            phase,
            ...(data.state_changes || data.setting_changes || data.event_changes ? {
              proposedChanges: {
                stateChanges: data.state_changes || [],
                settingChanges: data.setting_changes || [],
                eventChanges: data.event_changes || [],
                newEvent: data.new_event || '',
              }
            } : {}),
          }))

        } else if (event_type === 'done') {
          const result = event_data as Partial<CreativeWritingOutput> & {
            content?: {
              analysis?: string
              new_event?: string
              state_changes?: string[]
              setting_changes?: any[]
              event_changes?: any[]
            }
          }

          const data = result.content || {}
          const hasChanges = (data.state_changes && data.state_changes.length > 0) ||
                             (data.setting_changes && data.setting_changes.length > 0) ||
                             (data.event_changes && data.event_changes.length > 0)

          updateAssistant(m => ({
            ...m,
            content: data.analysis || m.content || '',
            reasoning: result.reasoning || m.reasoning,
            thinking: result.thinking || m.thinking,
            collectorResults: result.collector_results || m.collectorResults,
            collectorOutline: result.collector_outline || m.collectorOutline,
            phase: 'done',
            proposedChanges: hasChanges ? {
              stateChanges: data.state_changes || [],
              settingChanges: data.setting_changes || [],
              eventChanges: data.event_changes || [],
              newEvent: data.new_event || userMsg.content,
            } : undefined,
            approvalStatus: hasChanges ? 'pending' : undefined,
          }))
          set({ isGenerating: false })

        } else if (event_type === 'error') {
          const error = event_data as { message?: string } | Error
          const errorMessage = 'message' in error ? error.message : 'Unknown error'

          updateAssistant(m => ({
            ...m,
            content: `Error: ${errorMessage}`,
            phase: 'error',
          }))
          set({ isGenerating: false })
        }
      }

      await creativeWritingStream({
        create_request: `
⚠️ LANGUAGE: Detect the language from the game's ECS data and setting documents. Output ALL content in THAT language.

## Role

You are the Game Master's Assistant. The GM (Game Master) wants to modify the game world state. Your job is to:
1. Analyze the GM's instruction against the current ECS state
2. Propose concrete state_changes and setting_changes that implement the GM's intent
3. Provide a clear analysis explaining what will be changed and why

## GM Instruction

${userMsg.content}

## Context

Player character: ${playerName}
${chatContext ? `\nRecent GM conversation:\n${chatContext}` : ''}

## Output Requirements

- **analysis**: A clear explanation of what changes you'll make and why. Address the GM directly.
- **new_event**: A concise event description summarizing what happened (this will be fed to the state update system). Write it as a narrative event, not as a command.
- **state_changes**: Array of state change descriptions. Each item is a natural language instruction for the game state updater (e.g., "Add 500 gold to player inventory", "Set player HP to 100", "Move player to location X in region Y"). Be specific and reference entity IDs when possible.
- **setting_changes**: Array of setting/lore changes. Use the structured format with option (create/append/update), target entity ID, doc_name, and suggestion. Only include if the GM's instruction requires lore/setting modifications.

If the GM's request is a question or doesn't require state changes, provide only the analysis with empty arrays for changes.
`,
        thinking_instruction: `
Analyze the GM's instruction carefully:
1. **Intent**: What exactly does the GM want to achieve?
2. **Current State**: Check the ECS data — what is the current state of the entities involved?
3. **Feasibility**: Can this change be made? Are there any conflicts?
4. **Side Effects**: What other entities or systems might be affected?
5. **Specificity**: Map the GM's request to concrete ECS operations (creature IDs, item IDs, attribute names, etc.)
`,
        previous_content_overview: historyText,
        callback,
        output_content_schema: `{
  analysis: string; // Explanation of proposed changes, addressed to the GM
  new_event: string; // Narrative event summary for the state updater
  state_changes: string[]; // Array of state change instructions
  setting_changes: Array<{
    option: "create" | "append" | "update";
    creature_id?: string;
    organization_id?: string;
    region_id?: string;
    doc_name: string;
    suggestion: string;
  } | string>; // Array of setting/lore changes
}`,
        output_content_schema_definition: {
          type: 'object',
          properties: {
            analysis: { type: 'string' },
            new_event: { type: 'string' },
            state_changes: { type: 'array', items: { type: 'string' } },
            setting_changes: { type: 'array' },
          },
        },
      })

    } catch (e) {
      console.error('[GMStore] Generation failed:', e)
      updateAssistant(m => ({
        ...m,
        content: `Error: ${(e as Error).message}`,
        phase: 'error',
      }))
      set({ isGenerating: false })
    }
  },

  approveChanges: async (messageId) => {
    const msg = get().messages.find(m => m.id === messageId)
    if (!msg?.proposedChanges || msg.approvalStatus !== 'pending') return

    const { proposedChanges } = msg

    // Set applying status
    const updateMsg = (updater: (m: GMMessage) => GMMessage) => {
      set((s) => {
        const msgs = s.messages.map(m => m.id === messageId ? updater(m) : m)
        saveGMMessages(msgs)
        return { messages: msgs }
      })
    }

    updateMsg(m => ({ ...m, approvalStatus: 'applying' }))

    try {
      // GM 模式的 stateChanges 是 string[]，需要转换为 GameStateChanges 格式
      const stateChanges = {
        related_creature_ids: [] as string[],
        related_region_ids: [] as string[],
        related_organization_ids: [] as string[],
        service_calls: proposedChanges.stateChanges.map(s => ({ name: 'GM', suggestion: s })),
      }
      const result = await updateGameStateAndDocs({
        new_event: proposedChanges.newEvent,
        state_changes: stateChanges,
        setting_changes: proposedChanges.settingChanges,
        event_changes: proposedChanges.eventChanges || [],
      })

      updateMsg(m => ({
        ...m,
        approvalStatus: result.success ? 'applied' : 'apply-failed',
        applyResult: result,
      }))

      // Refresh game data after applying changes
      await refreshAllGameData()

    } catch (e) {
      console.error('[GMStore] Apply changes failed:', e)
      updateMsg(m => ({
        ...m,
        approvalStatus: 'apply-failed',
        applyResult: { success: false, error: (e as Error).message },
      }))
    }
  },

  rejectChanges: (messageId) => {
    set((s) => {
      const msgs = s.messages.map(m =>
        m.id === messageId ? { ...m, approvalStatus: 'rejected' as const } : m
      )
      saveGMMessages(msgs)
      return { messages: msgs }
    })
  },

  clearChat: () => {
    clearGMMessages()
    set({ messages: [], inputText: '' })
  },

  reset: () => {
    set({ messages: [], inputText: '', isGenerating: false, currentRequestId: 0 })
  },
}))
