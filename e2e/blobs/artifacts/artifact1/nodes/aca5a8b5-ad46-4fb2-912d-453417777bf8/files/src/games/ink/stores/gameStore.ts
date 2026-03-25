import { create } from 'zustand'
import i18next from 'i18next'
import type {
  UpdateGameStateAndDocsOutput,
  CreativeWritingOutput,
} from '../../../api/types'
import { formatSettingChange } from '../../../api/types'
import {
  getGameState,
  createSave,
  setNewStoryHistory,
  getStoryHistory,
  clearStoryHistory as clearStoryHistoryService,
  updateGameStateAndDocs,
  creativeWritingStream,
  listSaves,
} from '../../utils'
import { refreshAllGameData } from './refreshCoordinator'
import { showConfirm } from '../../../components/AlertDialog'
import type {
  InkTurn,
  StoryTurn,
  PlayerActionTurn,
  PlayerChoice,
  StoryHistoryData,
  CollectorResult,
  DiceResult,
  OOCInstruction
} from '../types'
import { isStoryTurn, isPlayerActionTurn } from '../types'
import type { TimelineNode } from '../types'
import { encodeTimelineDesc, parseTimelineDesc, cleanSaveTitle, formatGameTimeStr } from '../utils/timelineUtils'
import { useCreatureStore } from './creatureStore'
import { useUIStore } from './uiStore'

/**
 * 修复 Lua 空表歧义：Lua 中 {} 既是空数组也是空对象，
 * 序列化后变成 JSON {}（对象），导致应为 [] 的字段变成 {}。
 * 此函数根据 StoryHistoryData 的已知结构，将已知数组字段从 {} 纠正为 []。
 */
function normalizeStoryHistory(data: StoryHistoryData): StoryHistoryData {
  const ensureArray = <T>(val: T[] | undefined | null): T[] | undefined => {
    if (val === undefined || val === null) return undefined
    if (Array.isArray(val)) return val
    // 空对象 {} → 空数组 []
    if (typeof val === 'object' && Object.keys(val as object).length === 0) return []
    return val
  }

  const s = data.story
  if (s) {
    s.collectorResults = ensureArray(s.collectorResults)
    s.selectedEvents = ensureArray(s.selectedEvents)
    s.settingChanges = ensureArray(s.settingChanges)
    s.eventChanges = ensureArray(s.eventChanges)
    s.newEntities = ensureArray(s.newEntities)
    s.playerChoices = ensureArray(s.playerChoices)

    // collectorResults 内部的 documents 数组
    if (s.collectorResults) {
      for (const cr of s.collectorResults) {
        cr.documents = ensureArray(cr.documents)
      }
    }

    // stateChanges 内部的数组字段
    if (s.stateChanges && typeof s.stateChanges === 'object') {
      const sc = s.stateChanges
      sc.related_creature_ids = ensureArray(sc.related_creature_ids) || []
      sc.related_region_ids = ensureArray(sc.related_region_ids) || []
      sc.related_organization_ids = ensureArray(sc.related_organization_ids) || []
      sc.service_calls = ensureArray(sc.service_calls) || []
    }

    // directorNotes 内部的数组字段
    if (s.directorNotes && typeof s.directorNotes === 'object') {
      s.directorNotes.notes = ensureArray(s.directorNotes.notes) || []
      s.directorNotes.flags = ensureArray(s.directorNotes.flags) || []
    }

    // updateGameStateResult 内部的数组字段
    if (s.updateGameStateResult && typeof s.updateGameStateResult === 'object') {
      const r = s.updateGameStateResult
      r.results = ensureArray(r.results)
    }
  }

  return data
}

interface GameState {
  // 核心游戏状态
  gameStarted: boolean
  backgroundStory: string
  startStory: string
  gameInitChoice: import('../../../api/types').GameInitChoice | null
  inkTurns: InkTurn[]
  turnCounter: number
  currentPhase: 'idle' | 'generating-story' | 'updating-state' | 'waiting-choice' | 'dice-rolling'
  playerInput: string
  showCustomInput: boolean
  pendingChoiceTurnId: number | null
  errorInfo: { message: string; retryAction: () => void } | null
  oocInstructions: OOCInstruction[]

  // 掷骰子状态
  diceState: {
    choice: PlayerChoice
    storyTurnId: number
    phase: 'ready' | 'rolling' | 'result' | 'retrying' | 'retry-result'
    roll: number | null
    retryRoll: number | null
    scrollToBottom: (force: boolean) => void
  } | null

  // 分支时间线
  timelineChain: TimelineNode[]

  // 内部引用 (不触发重渲染)
  turnIdRef: number
  currentRequestId: number

  // Actions
  setGameStarted: (started: boolean) => void
  setBackgroundStory: (story: string) => void
  setStartStory: (story: string) => void
  setInkTurns: (turns: InkTurn[] | ((prev: InkTurn[]) => InkTurn[])) => void
  setTurnCounter: (counter: number) => void
  setCurrentPhase: (phase: GameState['currentPhase']) => void
  setPlayerInput: (input: string) => void
  setShowCustomInput: (show: boolean) => void
  setPendingChoiceTurnId: (id: number | null) => void
  setErrorInfo: (info: { message: string; retryAction: () => void } | null) => void
  addOOCInstruction: (content: string, duration: number | null) => void
  updateOOCInstruction: (id: string, content: string, duration: number | null) => void
  removeOOCInstruction: (id: string) => void
  tickOOCInstructions: () => void

  // 掷骰子方法
  rollDice: () => void
  retryDice: () => void
  confirmDiceResult: () => void
  cancelDice: () => void

  // 复杂业务逻辑
  buildHistoryText: () => string
  saveToState: (storyTurn: StoryTurn, actionTurn: PlayerActionTurn | undefined, checkpointId?: string) => Promise<void>
  handleChoiceSelect: (choice: PlayerChoice, storyTurnId: number, scrollToBottom: (force: boolean) => void) => void
  handleCustomInput: (input: string, storyTurnId: number, scrollToBottom: (force: boolean) => void) => void
  generateStory: (action: string, actionTurnId: number, scrollToBottom: (force: boolean) => void, diceResult?: DiceResult, reuseLastCollect?: boolean, overrides?: { createRequest?: string; thinkingInstruction?: string; thinkingExample?: string }) => Promise<void>
  rewriteHistory: (targetTurnId: number, userOpinion: string, scrollToBottom: (force: boolean) => void) => Promise<void>
  retryUpdateGameState: (storyTurnId: number) => Promise<void>
  regenerateStory: (storyTurnId: number, scrollToBottom: (force: boolean) => void) => Promise<void>
  rewindToTurn: (turnId: number) => void
  startGame: () => Promise<void>
  clearStoryHistory: () => Promise<void>
  loadInitialData: () => Promise<void>
  loadStoryHistory: () => Promise<void>
  reset: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  // 初始状态
  gameStarted: false,
  backgroundStory: '',
  startStory: '',
  gameInitChoice: null,
  inkTurns: [],
  turnCounter: 0,
  currentPhase: 'idle',
  playerInput: '',
  showCustomInput: false,
  pendingChoiceTurnId: null,
  errorInfo: null,
  diceState: null,
  oocInstructions: [],
  timelineChain: [],
  turnIdRef: 0,
  currentRequestId: 0,

  // 重置所有状态
  reset: () => set({
    gameStarted: false,
    backgroundStory: '',
    startStory: '',
    gameInitChoice: null,
    inkTurns: [],
    turnCounter: 0,
    currentPhase: 'idle',
    playerInput: '',
    showCustomInput: false,
    pendingChoiceTurnId: null,
    errorInfo: null,
    diceState: null,
    oocInstructions: [],
    timelineChain: [],
    turnIdRef: 0,
    currentRequestId: 0
  }),

  // 简单 setters
  setGameStarted: (started) => set({ gameStarted: started }),
  setBackgroundStory: (story) => set({ backgroundStory: story }),
  setStartStory: (story) => set({ startStory: story }),
  setInkTurns: (turns) => set((state) => ({
    inkTurns: typeof turns === 'function' ? turns(state.inkTurns) : turns
  })),
  setTurnCounter: (counter) => set({ turnCounter: counter }),
  setCurrentPhase: (phase) => set({ currentPhase: phase }),
  setPlayerInput: (input) => set({ playerInput: input }),
  setShowCustomInput: (show) => set({ showCustomInput: show }),
  setPendingChoiceTurnId: (id) => set({ pendingChoiceTurnId: id }),
  setErrorInfo: (info) => set({ errorInfo: info }),
  addOOCInstruction: (content, duration) => set((s) => ({
    oocInstructions: [...s.oocInstructions, {
      id: `ooc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      content,
      duration,
      createdAtTurn: s.turnIdRef
    }]
  })),
  updateOOCInstruction: (id, content, duration) => set((s) => ({
    oocInstructions: s.oocInstructions.map(inst =>
      inst.id === id ? { ...inst, content, duration } : inst
    )
  })),
  removeOOCInstruction: (id) => set((s) => ({
    oocInstructions: s.oocInstructions.filter(inst => inst.id !== id)
  })),
  tickOOCInstructions: () => set((s) => ({
    oocInstructions: s.oocInstructions
      .map(inst => inst.duration === null ? inst : { ...inst, duration: inst.duration - 1 })
      .filter(inst => inst.duration === null || inst.duration > 0)
  })),

  // 掷骰子方法
  rollDice: () => {
    const { diceState } = get()
    if (!diceState || diceState.phase !== 'ready') return
    set({ diceState: { ...diceState, phase: 'rolling' } })
    // 短暂延迟模拟骰子滚动动画
    setTimeout(() => {
      const roll = Math.floor(Math.random() * 101) // 0~100
      set({ diceState: { ...get().diceState!, phase: 'result', roll } })
    }, 600)
  },

  retryDice: () => {
    const { diceState } = get()
    if (!diceState || diceState.phase !== 'result' || diceState.retryRoll !== null) return
    // 只有失败时才能重试
    const difficulty = diceState.choice.difficulty_level!
    if (diceState.roll! >= difficulty) return // 已经成功了不需要重试
    set({ diceState: { ...diceState, phase: 'retrying' } })
    setTimeout(() => {
      const retryRoll = Math.floor(Math.random() * 101)
      set({ diceState: { ...get().diceState!, phase: 'retry-result', retryRoll } })
    }, 600)
  },

  confirmDiceResult: () => {
    const { diceState, turnIdRef } = get()
    if (!diceState) return
    const difficulty = diceState.choice.difficulty_level!
    const finalRoll = diceState.retryRoll ?? diceState.roll!
    const success = finalRoll >= difficulty

    const diceResult: DiceResult = {
      difficulty,
      roll: finalRoll,
      success,
      retried: diceState.retryRoll !== null,
      retryRoll: diceState.retryRoll ?? undefined
    }

    const choice = diceState.choice
    const actionTurnId = turnIdRef
    const scrollToBottom = diceState.scrollToBottom

    const actionTurn: InkTurn = {
      id: actionTurnId,
      type: 'action',
      playerAction: `${choice.name}: ${choice.description}`,
      selectedChoice: choice,
      isCustomInput: false,
      diceResult,
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
      diceState: null,
    }))

    const diceText = `[掷骰判定] 难度: ${difficulty}/100, 掷出: ${finalRoll}/100, 结果: ${success ? '成功' : '失败'}${diceResult.retried ? '（已重试）' : ''}`

    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(`${choice.name}: ${choice.description}\n${diceText}`, actionTurnId, scrollToBottom, diceResult)
    }, 100)
  },

  cancelDice: () => {
    const { diceState } = get()
    if (!diceState) return
    set({
      diceState: null,
      currentPhase: 'waiting-choice'
    })
  },

  // 构建历史文本
  buildHistoryText: () => {
    const { inkTurns } = get()
    const { playerEntity } = useCreatureStore.getState()
    
    const parts: string[] = []
    let recentRounds: { action?: PlayerActionTurn; story?: StoryTurn }[] = []
    let currentRound: { action?: PlayerActionTurn; story?: StoryTurn } = {}
    
    for (const turn of inkTurns) {
      if (isPlayerActionTurn(turn)) {
        if (currentRound.action || currentRound.story) {
          recentRounds.push(currentRound)
          currentRound = {}
        }
        currentRound.action = turn
      } else if (isStoryTurn(turn)) {
        currentRound.story = turn
      }
    }
    
    if (currentRound.action || currentRound.story) {
      recentRounds.push(currentRound)
    }
    
    const lastTwoRounds = recentRounds.slice(-2) // 取最近一轮（每轮包含玩家行动和对应的故事）

    console.log('Building history text from rounds:', lastTwoRounds)
    
    for (const round of lastTwoRounds) {
      if (round.action?.playerAction) {
        parts.push(`[玩家(${playerEntity?.Creature?.name})行动]\n${round.action.playerAction}`)
      }
      if (round.story) {
        const fullContent = round.story.contentPart2 
          ? `${round.story.content || ''}\n\n${round.story.contentPart2}`
          : round.story.content
        const chapterHint = round.story.chapterHint ? `（章节提示：${round.story.chapterHint}）` : ''
        const setting_changes_text = round.story.settingChanges?.map(formatSettingChange).join('\n') || ''
        const state_changes_text = round.story.stateChanges?.service_calls?.map(c => `${c.name}: ${c.suggestion}`).join('\n') || ''
        if (fullContent) {
          parts.push(`[小说内容]\n[章节:${chapterHint}]\n${fullContent}\n已发生的状态变更:\n${state_changes_text}\n已发生的设定变更:\n${setting_changes_text}\n 下一章节：`)
        }
      }
    }
    
    return parts.join('\n\n---\n\n')
  },

  // 保存剧情到状态
  saveToState: async (storyTurn, actionTurn, checkpointId) => {
    try {
      const historyData: StoryHistoryData = {
        story: {
          id: storyTurn.id,
          content: storyTurn.content,
          contentPart2: storyTurn.contentPart2,
          chapterHint: storyTurn.chapterHint,
          reasoning: storyTurn.reasoning,
          thinking: storyTurn.thinking,
          collectorResults: storyTurn.collectorResults,
          collectorOutline: storyTurn.collectorOutline,
          selectedEvents: storyTurn.selectedEvents,
          settingChanges: storyTurn.settingChanges,
          eventChanges: storyTurn.eventChanges,
          newEntities: storyTurn.newEntities,
          stateChanges: storyTurn.stateChanges,
          playerChoices: storyTurn.playerChoices,
          allowCustomInput: storyTurn.allowCustomInput,
          formUI: storyTurn.formUI,
          directorNotes: storyTurn.directorNotes,
          checkpointId: checkpointId,
          updateGameStateResult: storyTurn.updateGameStateResult
        }
      }
      
      // 保存当前活跃的 OOC 指令快照
      historyData.oocInstructions = get().oocInstructions

      if (actionTurn) {
        historyData.player = {
          id: actionTurn.id,
          playerAction: actionTurn.playerAction,
          selectedChoice: actionTurn.selectedChoice,
          isCustomInput: actionTurn.isCustomInput,
          diceResult: actionTurn.diceResult,
        }
      }
      
      await setNewStoryHistory({
          turn_id: `turn-${storyTurn.id}`,
          data: {
            content: historyData,
            checkpoint_id: checkpointId
          }
        })
      console.log(`已保存剧情历史: turn-${storyTurn.id}`, checkpointId ? `(checkpoint: ${checkpointId})` : '')
    } catch (e) {
      console.error('Failed to save story history:', e)
    }
  },

  // 处理玩家选择选项
  handleChoiceSelect: (choice, storyTurnId, scrollToBottom) => {
    const { diceMode } = useUIStore.getState()

    // visible 模式：有难度的选项进入明骰流程
    if (diceMode === 'visible' && choice.difficulty_level != null && choice.difficulty_level > 0) {
      set({
        diceState: {
          choice,
          storyTurnId,
          phase: 'ready',
          roll: null,
          retryRoll: null,
          scrollToBottom
        },
        currentPhase: 'dice-rolling'
      })
      return
    }

    const state = get()
    const actionTurnId = state.turnIdRef

    // hidden 模式：所有选项都掷暗骰
    let hiddenDice: DiceResult | undefined
    if (diceMode === 'hidden') {
      const hiddenRoll = Math.floor(Math.random() * 101)
      hiddenDice = { difficulty: -1, roll: hiddenRoll, success: hiddenRoll >= 50, retried: false }
    }

    const actionTurn: InkTurn = {
      id: actionTurnId,
      type: 'action',
      playerAction: `${choice.name}: ${choice.description}`,
      selectedChoice: choice,
      isCustomInput: false,
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
    }))

    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(`${choice.name}: ${choice.description}`, actionTurnId, scrollToBottom, hiddenDice)
    }, 100)
  },

  // 处理玩家自定义输入
  handleCustomInput: (input, storyTurnId, scrollToBottom) => {
    if (!input.trim()) return

    const state = get()
    const actionTurnId = state.turnIdRef
    const { diceMode } = useUIStore.getState()

    // hidden 模式：自由行动掷暗骰（visible 模式下自定义输入不掷骰）
    let hiddenDice: DiceResult | undefined
    if (diceMode === 'hidden') {
      const hiddenRoll = Math.floor(Math.random() * 101)
      hiddenDice = { difficulty: -1, roll: hiddenRoll, success: hiddenRoll >= 50, retried: false }
    }

    const actionTurn: InkTurn = {
      id: actionTurnId,
      type: 'action',
      playerAction: input,
      isCustomInput: true,
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      playerInput: '',
      showCustomInput: false,
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
    }))

    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(input, actionTurnId, scrollToBottom, hiddenDice)
    }, 100)
  },

  // 生成故事
  generateStory: async (action, actionTurnId, scrollToBottom, diceResult, reuseLastCollect, overrides) => {
    if (!action.trim()) return
    
    const state = get()
    const { playerEntity } = useCreatureStore.getState()
    const { totalParagraphs, narrativePerson, diceMode } = useUIStore.getState()
    const part1Paragraphs = Math.ceil(totalParagraphs / 2)
    const part2Paragraphs = totalParagraphs - part1Paragraphs
    const personInstruction = narrativePerson === 'second'
      ? `**叙事人称：第二人称**
        - 使用"你"来指代玩家角色。读者即玩家，代入感最强
        - 示例："你推开那扇沉重的木门，一股腐朽的气息扑面而来"
        - NPC对玩家说话时直接用对话，不需要"他对你说"这种转述`
      : `**叙事人称：第三人称**
        - 使用玩家角色的名字来指代玩家角色
        - 示例："${playerEntity?.Creature?.name}推开那扇沉重的木门，一股腐朽的气息扑面而来"
        - 禁止使用 “主角” “玩家” 等词汇来指代玩家角色
        - 可以偶尔展示玩家角色的内心独白，但主体是第三人称客观叙事`
    
    // 递增请求 ID
    const requestId = state.currentRequestId + 1
    set({ currentRequestId: requestId })

    // 清除错误信息，移除之前的错误块和相关的story块
    set((s) => ({
      errorInfo: null,
      playerInput: '',
      currentPhase: 'generating-story',
      inkTurns: s.inkTurns.filter(turn =>
        !(turn.type === 'error' && turn.relatedActionId === actionTurnId) &&
        !(turn.type === 'story' && turn.relatedActionId === actionTurnId)
      )
    }))

    const storyTurnId = actionTurnId + 1

    // 创建空的小说回合
    set((s) => ({
      inkTurns: [...s.inkTurns, {
        id: storyTurnId,
        type: 'story',
        content: '',
        contentPart2: '',
        chapterHint: '',
        generationPhase: 'collecting',
        typewriterEnabled: true,
        relatedActionId: actionTurnId
      } as StoryTurn]
    }))
    
    let collectorDone = false // 跟踪 RAG 收集是否已完成，用于 retry 时跳过收集

    try {
      const historyText = get().buildHistoryText()
      console.log('History text for generation:', historyText)

      const callback = (streamEvent: { event_type: string; event_data: unknown }) => {
        if (streamEvent.event_type == "done") {
          console.log('Generation done', streamEvent.event_data)
        }
        // 检查请求是否仍然有效
        if (requestId !== get().currentRequestId) {
          console.log(`Ignoring stale request callback`)
          return
        }
        
        const { event_type, event_data } = streamEvent
        
        if (event_type === 'reasoning_update') {
          
          const reasoningData = event_data as { raw_text?: string; reasoning?: string; collector_results?: CollectorResult[]; collector_outline?: string }
          if (!reasoningData) return

          set((s) => ({
            inkTurns: s.inkTurns.map(turn => {
              if (turn.id === storyTurnId && isStoryTurn(turn)) {
                return {
                  ...turn,
                  reasoning: reasoningData.reasoning || turn.reasoning,
                  collectorResults: reasoningData.collector_results || turn.collectorResults,
                  collectorOutline: reasoningData.collector_outline || turn.collectorOutline,
                  generationPhase: 'reasoning'
                } as StoryTurn
              }
              return turn
            })
          }))
          setTimeout(() => scrollToBottom(false), 50)
          
        } else if (event_type === 'result_update' || event_type === 'collector_result_update') {
          const partialResult = event_data as Partial<CreativeWritingOutput> & {
            content?: {
              novel_content_part1?: string
              novel_content_part2?: string
              chapter_hint?: string
              player_choices?: PlayerChoice[]
              allow_player_custom_input?: boolean
              form_ui?: string
            }
          }
          if (!partialResult) return
          
          // 检查收集到的文档数量
          if (event_type === 'collector_result_update' && partialResult.collector_results) {
            const totalSelectedDocs = partialResult.collector_results.reduce((sum, entity) =>
              sum + (entity.documents?.filter((d: { selected?: boolean }) => d.selected).length || 0), 0
            )

            if (totalSelectedDocs === 0) {
              set((s) => ({
                currentRequestId: s.currentRequestId + 1,
                currentPhase: 'idle',
                inkTurns: [
                  ...s.inkTurns.filter(t => t.id !== storyTurnId),
                  {
                    id: -(actionTurnId + 1),
                    type: 'error' as const,
                    errorMessage: i18next.t('game:ink.error.generateFailed', { error: 'RAG Collect No Documents Selected' }),
                    relatedActionId: actionTurnId,
                    retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, diceResult)
                  }
                ]
              }))
              return
            }
            collectorDone = true
          }
          
          set((s) => ({
            inkTurns: s.inkTurns.map(turn => {
              if (turn.id === storyTurnId && isStoryTurn(turn)) {
                const data = partialResult.content || {}
                const hasContent = !!(data.novel_content_part1 || data.novel_content_part2)
                const hasThinking = !!partialResult.thinking
                const hasReasoning = !!partialResult.reasoning
                const hasCollectorResults = !!(partialResult.collector_results && partialResult.collector_results.length > 0)
                
                let phase: 'collecting' | 'reasoning' | 'thinking' | 'writing' | 'done' = 'collecting'
                if (hasContent) phase = 'writing'
                else if (hasThinking) phase = 'thinking'
                else if (hasReasoning) phase = 'reasoning'
                else if (hasCollectorResults) phase = 'collecting'
                
                return {
                  ...turn,
                  content: data.novel_content_part1 || turn.content || '',
                  contentPart2: data.novel_content_part2 || turn.contentPart2 || '',
                  chapterHint: data.chapter_hint || turn.chapterHint || '',
                  reasoning: partialResult.reasoning || turn.reasoning,
                  thinking: partialResult.thinking || turn.thinking,
                  collectorResults: partialResult.collector_results || turn.collectorResults,
                  collectorOutline: partialResult.collector_outline || turn.collectorOutline,
                  selectedEvents: partialResult.selected_events || turn.selectedEvents,
                  settingChanges: partialResult.setting_changes || turn.settingChanges,
                  eventChanges: partialResult.event_changes || turn.eventChanges,
                  newEntities: partialResult.new_entities || turn.newEntities,
                  stateChanges: turn.stateChanges,
                  playerChoices: data.player_choices || turn.playerChoices,
                  formUI: data.form_ui || turn.formUI,
                  directorNotes: partialResult.director_notes || turn.directorNotes,
                  allowCustomInput: true,
                  generationPhase: phase
                } as StoryTurn
              }
              return turn
            })
          }))
          setTimeout(() => scrollToBottom(false), 50)
          
        } else if (event_type === 'done') {
          const result = event_data as Partial<CreativeWritingOutput> & {
            content?: {
              novel_content_part1?: string
              novel_content_part2?: string
              chapter_hint?: string
              player_choices?: PlayerChoice[]
              allow_player_custom_input?: boolean
              form_ui?: string
            }
          }

          if (!result.content) {
            set((s) => ({
              currentPhase: 'idle',
              inkTurns: [
                ...s.inkTurns.filter(t => t.id !== storyTurnId),
                {
                  id: -(actionTurnId + 1),
                  type: 'error' as const,
                  errorMessage: result.error || i18next.t('game:ink.error.generateFailed', { error: i18next.t('game:ink.error.noContent') }),
                  relatedActionId: actionTurnId,
                  retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, diceResult, collectorDone)
                }
              ]
            }))
            return
          }
          
          const data = result.content
          
          // 更新最终的小说回合数据
          set((s) => ({
            inkTurns: s.inkTurns.map(turn => {
              if (turn.id === storyTurnId && isStoryTurn(turn)) {
                return {
                  ...turn,
                  content: data.novel_content_part1 || '',
                  contentPart2: data.novel_content_part2 || '',
                  chapterHint: data.chapter_hint || '',
                  thinking: result.thinking,
                  collectorResults: result.collector_results,
                  collectorOutline: result.collector_outline,
                  selectedEvents: result.selected_events,
                  settingChanges: result.setting_changes,
                  eventChanges: result.event_changes,
                  newEntities: result.new_entities,
                  stateChanges: undefined,
                  playerChoices: data.player_choices || [],
                  formUI: data.form_ui || undefined,
                  directorNotes: result.director_notes || undefined,
                  allowCustomInput: true,
                  generationPhase: 'done'
                } as StoryTurn
              }
              return turn
            })
          }))

          // updaterMessages 仅包含 flag_is_updating_instruction 的文档，临时使用不存入 StoryTurn
          // Lua 空表 {} 到 JS 变成空对象 {}（非 undefined），需检查是否是有效数组
          const collectorBuiltMessages = Array.isArray(result.updater_messages) && result.updater_messages.length > 0
            ? result.updater_messages : undefined

          // 更新游戏状态
          set({ currentPhase: 'updating-state' })

          const updateGameStateAsync = async () => {
            try {
              const fullContent = `玩家(${playerEntity?.Creature?.name})行动: ${action}` + (data.novel_content_part2
                ? `${data.novel_content_part1 || ''}\n\n${data.novel_content_part2}`
                : data.novel_content_part1 || '')

              const updateResult = await updateGameStateAndDocs({
                  new_event: fullContent,
                  setting_changes: result.setting_changes || [],
                  event_changes: result.event_changes || [],
                  new_entities: result.new_entities || undefined,
                  director_notes: result.director_notes || undefined,
                  collector_built_messages: collectorBuiltMessages || undefined,
                })
              
              set((s) => ({
                inkTurns: s.inkTurns.map(turn => 
                  (turn.id === storyTurnId && isStoryTurn(turn))
                    ? { 
                        ...turn, 
                        updateGameStateResult: updateResult
                      } as StoryTurn
                    : turn
                )
              }))
              
              // 刷新数据（无论成功或失败都刷新）
              await refreshAllGameData()
              
              // 创建存档并保存剧情历史
              if (updateResult.success) {
                const chapterTitle = data.chapter_hint || i18next.t('game:ink.unnamedChapter')

                // 构建保存数据
                const storyTurnToSave: StoryTurn = {
                  id: storyTurnId,
                  type: 'story',
                  content: data.novel_content_part1 || '',
                  contentPart2: data.novel_content_part2 || '',
                  chapterHint: chapterTitle,
                  reasoning: result.reasoning,
                  thinking: result.thinking,
                  collectorResults: result.collector_results,
                  collectorOutline: result.collector_outline,
                  selectedEvents: result.selected_events,
                  settingChanges: result.setting_changes,
                  eventChanges: result.event_changes,
                  newEntities: result.new_entities,
                  stateChanges: undefined,
                  playerChoices: data.player_choices || [],
                  formUI: data.form_ui || undefined,
                  directorNotes: result.director_notes || undefined,
                  allowCustomInput: true,
                  generationPhase: 'done',
                  relatedActionId: actionTurnId,
                  updateGameStateResult: updateResult
                }

                // 从 inkTurns 中获取实际的 action turn（可能包含 diceResult）
                const actualActionTurn = get().inkTurns.find(
                  t => t.id === actionTurnId && isPlayerActionTurn(t)
                ) as PlayerActionTurn | undefined

                const actionTurnToSave: PlayerActionTurn = actualActionTurn || {
                  id: actionTurnId,
                  type: 'action',
                  playerAction: action,
                  isCustomInput: true
                }

                // 步骤1: 先以 "unknown" 写入剧情历史，确保内容进入游戏状态
                await get().saveToState(storyTurnToSave, actionTurnToSave, 'unknown')

                // 步骤2: 创建存档快照（此时状态中已包含完整剧情）
                let checkpointId: string | undefined
                const currentGameTime = formatGameTimeStr(useCreatureStore.getState().gameTime)
                try {
                  const saveResult = await createSave({
                    title: `[turn-${storyTurnId}] ${chapterTitle}`,
                    description: encodeTimelineDesc(get().timelineChain),
                  })

                  if (saveResult.success && saveResult.checkpointId) {
                    checkpointId = saveResult.checkpointId

                    // 更新时间线链：追加自身节点（含世界时间快照）
                    set((s) => ({
                      timelineChain: [...s.timelineChain, { id: checkpointId!, t: chapterTitle, gt: currentGameTime }],
                      inkTurns: s.inkTurns.map(turn =>
                        (turn.id === storyTurnId && isStoryTurn(turn))
                          ? { ...turn, checkpointId } as StoryTurn
                          : turn
                      )
                    }))
                  }
                } catch (e) {
                  console.error('Failed to create checkpoint:', e)
                }

                // 步骤3: 用真实的 checkpointId 再次写入，替换 "unknown"
                if (checkpointId) {
                  await get().saveToState(storyTurnToSave, actionTurnToSave, checkpointId)
                }
              }
              
            } catch (e) {
              console.error('Failed to update game state:', e)
              set((s) => ({
                inkTurns: s.inkTurns.map(turn => 
                  (turn.id === storyTurnId && isStoryTurn(turn))
                    ? { 
                        ...turn, 
                        updateGameStateResult: {
                          success: false,
                          error: (e as Error).message
                        }
                      } as StoryTurn
                    : turn
                )
              }))
            } finally {
              // 递减 OOC 指令轮次，移除过期指令
              get().tickOOCInstructions()
              set({
                pendingChoiceTurnId: storyTurnId,
                currentPhase: 'waiting-choice'
              })
            }
          }
          
          updateGameStateAsync()
          
          // 递增 turn ID
          set({ turnIdRef: actionTurnId + 2, turnCounter: actionTurnId + 2 })
          setTimeout(() => scrollToBottom(false), 100)
          
        } else if (event_type === 'error') {
          const error = event_data as { message?: string } | Error
          const errorMessage = 'message' in error ? error.message : i18next.t('game:ink.error.unknownError')

          set((s) => ({
            currentPhase: 'idle',
            inkTurns: [
              ...s.inkTurns.filter(t => t.id !== storyTurnId),
              {
                id: -(actionTurnId + 1),
                type: 'error' as const,
                errorMessage: i18next.t('game:ink.error.generateFailed', { error: errorMessage }),
                relatedActionId: actionTurnId,
                retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, diceResult, collectorDone)
              }
            ]
          }))
        }
      }
      
      // 构建骰子结果上下文（off 模式下完全跳过）
      let diceContext = ''
      if (diceResult && diceMode !== 'off') {
        if (diceResult.difficulty === -1) {
          // 暗骰：自由行动的隐藏运气值，玩家不知道
          diceContext = `\n\n[暗骰] 玩家的隐藏运气值: ${diceResult.roll}/100。这是一个隐藏的骰子结果，玩家并不知道。请根据这个运气值来微妙地影响自由行动的结果——运气高时事情更顺利、可能有意外收获；运气低时可能遇到小麻烦、不太顺利（但不要太刻意，要自然融入叙事）。不要在叙事中提及"运气"或"骰子"。`
        } else {
          // 明骰：玩家主动掷的骰子
          diceContext = `\n\n[掷骰判定结果] 难度: ${diceResult.difficulty}/100, 掷出: ${diceResult.roll}/100, 结果: ${diceResult.success ? '成功' : '失败'}${diceResult.retried ? '（玩家重试过一次）' : ''}\n请根据掷骰结果来决定行动的成败程度。成功意味着行动顺利达成，失败意味着行动受阻、出现意外或产生不利后果（但不要直接杀死玩家）。掷出的点数越接近满分，成功越完美；越接近0，失败越惨烈。`
        }
      }

      // 构建 OOC 指令上下文
      let oocContext = ''
      const activeInstructions = get().oocInstructions
      if (activeInstructions.length > 0) {
        const instrLines = activeInstructions.map((inst, i) => {
          const durLabel = inst.duration === null ? '永久' : `剩余${inst.duration}轮`
          return `${i + 1}. [${durLabel}] ${inst.content}`
        }).join('\n')
        oocContext = `\n\n[OOC Instructions — 玩家导演指令]\n${instrLines}\n（以上是玩家作为"导演"给出的叙事方向指令，不是角色在游戏世界中的行动。请在保持叙事自然的前提下，将这些方向融入你的创作中。不要在小说正文中提及或引用这些指令本身。）`
      }

      // Call streaming service
      await creativeWritingStream({
        reuse_last_collect: false, // Keep false for now, enable after stable testing
        create_request: overrides?.createRequest || `
        ⚠️ LANGUAGE: Detect the language from the game's ECS data, setting documents, and previous narrative. Output ALL content (novel text, chapter hints, player choices) in THAT language.

        Player (${playerEntity?.Creature?.name}) action: ${action}${diceContext}${oocContext}

        You are an elite web novel / light novel author who excels at writing thrilling, page-turning stories. Expand the player's action into a captivating novel chapter.

        ## Core Principles

        ${personInstruction}

        **Writing Style:**
        - “Show, don't tell” — use actions, details, and sensory descriptions instead of blunt statements
        - Give each character a distinctive voice — different tone, vocabulary, and speech patterns
        - Vary sentence rhythm: short punchy sentences for tension, longer flowing ones for atmosphere
        - **NEVER expose game mechanics in prose**: No stat names, no numbers, no system terms (e.g., ❌"your 5-point magic affinity" ❌"stamina decreased by 20" ❌"affinity reached 80"). Instead, translate them into observable narrative consequences (low stamina → heavy breathing, trembling legs; high affinity → warm smile, willing to share secrets). You are writing a novel, not a DM narration — the reader should feel the effects without seeing the spreadsheet
        - Reference director notes and markers to avoid repeating previously written scenes/information
        - Make full use of writing guidance from setting documents (character-specific body language, speech mannerisms, etc.)

        **⚠️ Director Notes & Global Narrative Pacing (MUST READ):**
        - **stage_goal is your compass**: If a stage_goal exists in DirectorNotes, your narrative MUST follow its direction and pacing guidance. It defines the current phase's tone, rhythm, and thematic focus — do not deviate
        - **Flags are hard constraints**: Check all existing flags before writing. A flag like “first_kill=true” means it already happened — never re-trigger or contradict flagged events
        - **Notes are your recent memory**: Read the rolling director notes carefully — they contain hidden plot threads, foreshadowing plans, and unresolved tensions. Weave these threads naturally into the narrative; do not let them go cold
        - **Pacing awareness**: Review the emotional arc of recent turns. If the last few turns were all combat/tension, shift toward relief or character development. If they were all calm/slice-of-life, introduce a dramatic hook. The story needs rhythm — tension → release → escalation, not monotone
        - **Hidden plot advancement**: If director notes mention off-screen subplots or NPC schemes, subtly advance them — drop hints, show consequences, or let them simmer. The world should feel alive beyond the player's immediate actions

        **Innovation & Drama — Extraordinary Experiences in a Believable World:**
        - The world is grounded (with costs, logic, and consequences), but the player's experience should be dramatic — a great story is never a bland log of events
        - Every scene needs a “hook”: a mystery, a surprise, an intriguing person, or something unusual. Blandness is the greatest enemy
        - Boldly introduce new scenes, characters, and elements — there is a vast unknown world beyond the current ECS to explore
        - Give the player's actions meaningful impact: effort should be rewarded (even in unexpected ways), and risks should lead to real discoveries
        - Setbacks and challenges are fine, but they must serve the larger narrative arc — lows exist to make the highs shine brighter, not to torment the player
        - Maintain dynamic pacing: relief after tension, a turning point after failure, warmth after loneliness

        **⚠️ State Changes & Event Recording (Do NOT Neglect):**
        - **Every narrative action has consequences**: If your story depicts movement, combat, item usage, relationship shifts, emotional changes, time passing, or status changes — you MUST output corresponding state changes in step_3. Missing state changes cause the world to desync from the narrative
        - **⚠️ Spawn before reference (CRITICAL ORDER)**: When introducing a NEW character, region, or organization in your narrative, you MUST output a spawnCharacter/spawnRegion/spawnOrganization call BEFORE any other state changes that reference that entity. Similarly, when moving a character to a NEW location, output addLocationToRegion BEFORE moveCreature. The downstream updater executes calls in order — referencing a non-existent entity will fail
        - **⚠️ Stale status cleanup (CRITICAL)**: After writing the narrative, review all characters' existing StatusEffects. If any status contradicts the new story (e.g., "exhausted" but the character just rested; "hiding" but they're in open combat; "injured" but the story shows recovery), output a removeStatusEffect call. Stale statuses that linger will corrupt future narrative. When in doubt, remove — a missing status can be re-added, but a stale one causes cascading errors
        - **Events are the primary record**: Every turn that contains meaningful narrative MUST produce at least one event entry in step_4b (create or append). Events are how the game remembers what happened — if you skip event recording, the story loses continuity
        - **Common omissions to watch for**: time advancement (advanceTime), item consumption, status effect cleanup (removing stale/resolved statuses), emotion updates, and location changes after arrival
        - **Setting docs are for permanent mechanisms ONLY**: step_4a is reserved for lasting world rules, combat techniques, character profiles, and system mechanics. Do NOT use it for plot events, scene descriptions, or anything ephemeral. When in doubt, record it as an event (step_4b) instead. Most turns should have zero or very few setting doc changes

        **Knowledge Boundaries:**
        - The player character can only know what they have personally experienced, been told, or can reasonably infer — no omniscience
        - NPC inner thoughts may be shown to the reader, but the player character must not perceive them

        **Pacing Control:**
        - Advance only one narrative beat at a time — do not jump from “setting out” to “problem solved”
        - No unjustified time skips (“a few hours later...”) unless the player explicitly requests it

        ## Output Structure

        The novel is divided into two sections of continuous narrative. The second half of Part 2 returns the perspective to the player and stops at a decision point.
        Each paragraph starts with a marker: Part 1 uses 【A1】【A2】..., Part 2 uses 【B1】【B2】...

        **novel_content_part1**: Exactly ${part1Paragraphs} paragraphs (【A1】through【A${part1Paragraphs}】), each 150–200 words, diving straight into the narrative
        **novel_content_part2**: Exactly ${part2Paragraphs} paragraphs (【B1】through【B${part2Paragraphs}】), each 150–200 words, with the latter half returning perspective to the player

        **player_choices vs form_ui — Mutually Exclusive (output ONE or the OTHER, never both):**

        **Option A: player_choices** (default) — 2–4 narrative-driven options for story branching
        - name: 2–6 words | description: 10–30 words | is_special: true when specific conditions are required
        - Choices should be differentiated and compelling — avoid generic “fight / talk / explore” templates
        ${diceMode === 'visible' ? `
        **Dice Roll (difficulty_level) — Use Sparingly:**
        - At most 1–2 choices per turn may include a dice roll; the rest should be normal options. Only assign rolls to actions with a clear chance of failure (climbing, lockpicking, persuading a hostile NPC, etc.) — never for routine actions
        - 10–30 = easy, 40–60 = moderate, 70–85 = hard, 86–100 = extreme; calculate based on ECS state and scene context
        - difficulty_reason: One sentence explaining the calculation basis` : ''}

        **Option B: form_ui** — ONLY for structured mechanical interactions. Use this INSTEAD OF player_choices when the scene involves:
        - Shopping / trading (buying items from a merchant)
        - Crafting / forging (spending materials to create equipment)
        - Skill/spell selection or equipment loadout
        - Action point / resource allocation (planning phase, combat turn)
        - Combat: spending action points, mana, or items to use skills/abilities
        Do NOT generate form_ui for: dialogue, exploration, story branching, or any purely narrative-driven decision. When in doubt, use player_choices.
        When form_ui is present: the paragraph count restriction is lifted — write as many or as few paragraphs as the scene naturally requires (but still use 【A】【B】 markers). Output form_ui as a string and leave player_choices as an empty array [].

        **⚠️ CRITICAL: form_ui is a PURE PRESENTATION LAYER — it does NOT connect to the ECS or game state.**
        The form only constructs the next player action text; it cannot read or modify game data.
        Therefore: #res values MUST be concrete numbers looked up from the current ECS state (character attributes, inventory counts, etc.), NOT template variables like {{gold}}.
        If you cannot determine the exact current value of a resource from the ECS data provided, do NOT generate form_ui — fall back to player_choices instead.

        form_ui uses GameUI DSL — a flat, line-based markup:
        \`\`\`
        ::ui resource-select        ← mode: resource-select or slot-assign
        @title 旅人杂货铺            ← panel metadata
        @desc 老板热情地展示货架上的商品
        @submit 购买
        #res gold|金币|500           ← resource: id|display_name|current_value (MUST be a concrete number from ECS, NOT a template variable)
        #item potion|回复药水|gold:50|max:5|恢复 30% 生命值  ← item: id|name|costs|constraints|desc
        ::end
        \`\`\`

        resource-select: #res {id}|{name}|{value (concrete number!)}  #item {id}|{name}|{cost res:n,...}|{max:n,...}|{desc}
        slot-assign:     #slot {id}|{label}|{required,filter:tag,default:id}  #opt {id}|{name}|{unique/reusable,tag:x}|{desc}

        Rules: one declaration per line, fields separated by |, no <>”{}. Item/opt ids should match game data where possible.
    `,
        thinking_instruction: overrides?.thinkingInstruction || `
        Think deeply before writing:
        1. **Director Notes & Pacing (FIRST)**: Read DirectorNotes — follow stage_goal's direction, respect flags as hard constraints, and weave hidden plot threads from notes into the narrative. Check the emotional tone of recent turns and plan this turn's rhythm to avoid monotony
        2. **ECS & World Consistency**: Cross-check character personalities, stats, relationships, and knowledge boundaries — ensure the narrative stays in sync with game data and setting documents. No omniscience for the player character
        3. **Innovation Check**: Does this passage introduce new elements (new characters / scenes / discoveries)? If it's all existing content, consider adding a surprise
        4. **State Change & Event Audit**: Walk through the narrative — every world-changing action (movement, combat, items, time, emotions, statuses) must appear in step_3. Every meaningful narrative must produce at least one event in step_4b. If new entities are introduced, include spawn calls before referencing them. Setting doc changes (step_4a) should be rare — only for permanent mechanisms, not plot events
        5. **form_ui vs player_choices Decision**: Does this scene involve a structured mechanical interaction where the player spends resources or assigns items to slots (shopping, crafting, equipment loadout, resource allocation, combat skill/ability selection with AP/MP costs)? If YES → output form_ui DSL and set player_choices to []. If NO (narrative branching, dialogue, exploration, reaction-based choices) → output player_choices as usual and omit form_ui. Most turns should use player_choices; form_ui is for specific mechanical moments
           `,
        thinking_example: overrides?.thinkingExample || `Following [Creative Request] and [Deep Thinking Instruction]:
    1. **Director Notes & Pacing**: stage_goal says "...", so this turn should focus on ... Recent turns were [tense/calm/...], so I'll adjust the rhythm to ...
    2. **ECS & World Consistency**: Player is at [location], has [relevant stats/items]. NPC [name] is [state]. I need to ensure ...
    3. **Innovation Check**: This scene [does/doesn't] need new elements. [If yes: I'll introduce ... because ...]
    4. **New Element Planning**: [No new entities needed / I'll create (creature/region/org) "..." because the narrative requires ...]
    5. **form_ui vs player_choices**: This scene is [narrative branching / a mechanical interaction], so I'll use [player_choices / form_ui]
    6. **Outline**: The narrative will flow as: [brief scene outline in 2-3 sentences]`,
        previous_content_overview: historyText,
        callback: callback,
        output_content_schema: `
        {
          novel_content_part1: string; // Part 1: Must contain exactly ${part1Paragraphs} paragraphs, each starting with 【A1】through【A${part1Paragraphs}】, 150–200 words each. Dive straight into the narrative — no titles or separators
          novel_content_part2: string; // Part 2: Must contain exactly ${part2Paragraphs} paragraphs, each starting with 【B1】through【B${part2Paragraphs}】, 150–200 words each. Continues from Part 1, with the latter half returning perspective to the player
          chapter_hint: string; // Chapter title hint (3–6 words, literary feel, not too literal)
          player_choices: Array<{
            name: string; // Choice name (2–6 words)
            description: string; // Choice description (10–30 words), be specific rather than vague
            is_special: boolean; // Whether this is a special choice (requires specific items/skills/relationships)${diceMode === 'visible' ? `
            difficulty_level?: number; // Optional, 0–100 dice difficulty. Only for actions requiring ability/luck checks — never for routine actions
            difficulty_reason?: string; // Optional, one sentence explaining how the difficulty level was calculated` : ''}
          }>; // 2–4 options, naturally derived from the narrative. Empty [] when form_ui is used
          form_ui?: string; // Optional GameUI DSL string. Mutually exclusive with player_choices — only output when the scene is a structured mechanical interaction (shop/craft/equip/allocate). Most turns should NOT have this field
        }`,
        output_content_schema_definition: {
          type: 'object',
          properties: {
            novel_content_part1: { type: 'string' },
            novel_content_part2: { type: 'string' },
            chapter_hint: { type: 'string' },
            player_choices: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  is_special: { type: 'boolean' },
                  ...(diceMode === 'visible' ? {
                    difficulty_level: { type: 'number', minimum: 0, maximum: 100 },
                    difficulty_reason: { type: 'string' }
                  } : {})
                }
              }
            },
            form_ui: { type: 'string' },
          }
        }
      })
      
    } catch (e) {
      console.error('Generation failed:', e)
      set((s) => {
        const storyToRemove = s.inkTurns.find(t => t.type === 'story' && t.relatedActionId === actionTurnId && !t.content)
        const filtered = storyToRemove ? s.inkTurns.filter(t => t.id !== storyToRemove.id) : s.inkTurns
        return {
          currentPhase: 'idle',
          inkTurns: [...filtered, {
            id: -(actionTurnId + 1),
            type: 'error' as const,
            errorMessage: i18next.t('game:ink.error.generateFailed', { error: (e as Error).message }),
            relatedActionId: actionTurnId,
            retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, diceResult, collectorDone)
          }]
        }
      })
    }
  },

  // 重试更新游戏状态
  retryUpdateGameState: async (storyTurnId) => {
    const { inkTurns } = get()
    const { playerEntity } = useCreatureStore.getState()

    const storyTurn = inkTurns.find(t => t.id === storyTurnId && isStoryTurn(t)) as StoryTurn | undefined
    if (!storyTurn) return

    const actionTurn = storyTurn.relatedActionId !== undefined
      ? inkTurns.find(t => t.id === storyTurn.relatedActionId && isPlayerActionTurn(t)) as PlayerActionTurn | undefined
      : undefined
    
    set({ currentPhase: 'updating-state' })
    
    // 清除之前的错误状态
    set((s) => ({
      inkTurns: s.inkTurns.map(turn => 
        (turn.id === storyTurnId && isStoryTurn(turn))
          ? { ...turn, updateGameStateResult: undefined } as StoryTurn
          : turn
      )
    }))
    
    try {
      const fullContent =  `玩家(${playerEntity?.Creature?.name})行动: ${actionTurn?.playerAction}` + (storyTurn.contentPart2 
        ? `${storyTurn.content || ''}\n\n${storyTurn.contentPart2}`
        : storyTurn.content || '')
      
      const updateResult = await updateGameStateAndDocs({
          new_event: fullContent,
          setting_changes: storyTurn.settingChanges || [],
          event_changes: storyTurn.eventChanges || [],
          director_notes: storyTurn.directorNotes || undefined,
          // retry 时 collector_built_messages 不可用（临时数据，未存入 StoryTurn），Analyzer 仍可独立工作
        })

      set((s) => ({
        inkTurns: s.inkTurns.map(turn =>
          (turn.id === storyTurnId && isStoryTurn(turn))
            ? {
                ...turn,
                updateGameStateResult: updateResult
              } as StoryTurn
            : turn
        )
      }))

      await refreshAllGameData()

      if (updateResult.success) {
        const retryChapterTitle = storyTurn.chapterHint || i18next.t('game:ink.unnamedChapter')

        const storyTurnToSave: StoryTurn = {
          ...storyTurn,
          updateGameStateResult: updateResult
        }

        // 步骤1: 先以 "unknown" 写入剧情历史
        await get().saveToState(storyTurnToSave, actionTurn, 'unknown')

        // 步骤2: 创建存档快照
        let checkpointId: string | undefined
        const retryGameTime = formatGameTimeStr(useCreatureStore.getState().gameTime)
        try {
          const saveResult = await createSave({
            title: `[turn-${storyTurnId}] ${retryChapterTitle}`,
            description: encodeTimelineDesc(get().timelineChain),
          })

          if (saveResult.success && saveResult.checkpointId) {
            checkpointId = saveResult.checkpointId
            set((s) => ({
              timelineChain: [...s.timelineChain, { id: checkpointId!, t: retryChapterTitle, gt: retryGameTime }],
              inkTurns: s.inkTurns.map(turn =>
                (turn.id === storyTurnId && isStoryTurn(turn))
                  ? { ...turn, checkpointId } as StoryTurn
                  : turn
              )
            }))
          }
        } catch (e) {
          console.error('Failed to create checkpoint after retry:', e)
        }

        // 步骤3: 用真实 checkpointId 替换 "unknown"
        if (checkpointId) {
          await get().saveToState(storyTurnToSave, actionTurn, checkpointId)
        }
      }
      
    } catch (e) {
      console.error('Retry update game state failed:', e)
      set((s) => ({
        inkTurns: s.inkTurns.map(turn => 
          (turn.id === storyTurnId && isStoryTurn(turn))
            ? { 
                ...turn, 
                updateGameStateResult: {
                  success: false,
                  error: (e as Error).message
                }
              } as StoryTurn
            : turn
        )
      }))
    } finally {
      set({ pendingChoiceTurnId: storyTurnId, currentPhase: 'waiting-choice' })
    }
  },

  // 重新生成故事（回滚到上一轮存档并重新生成）
  regenerateStory: async (storyTurnId, scrollToBottom) => {
    const { inkTurns } = get()
    const storyTurn = inkTurns.find(t => t.id === storyTurnId && isStoryTurn(t)) as StoryTurn | undefined
    if (!storyTurn) return

    // 找到对应的 action turn
    const actionTurn = storyTurn.relatedActionId !== undefined
      ? inkTurns.find(t => t.id === storyTurn.relatedActionId && isPlayerActionTurn(t)) as PlayerActionTurn | undefined
      : undefined

    if (!actionTurn) return

    // 找到上一轮（当前故事回合之前）最近的有 checkpointId 的故事回合
    const prevTurns = inkTurns.slice(0, inkTurns.findIndex(t => t.id === storyTurnId))
    const prevCheckpointTurn = [...prevTurns].reverse()
      .find(t => isStoryTurn(t) && (t as StoryTurn).checkpointId) as StoryTurn | undefined

    if (!prevCheckpointTurn?.checkpointId) return

    // 截断时间线链到上一个 checkpoint
    const idx = get().timelineChain.findIndex(n => n.id === prevCheckpointTurn.checkpointId)
    set({ timelineChain: idx >= 0 ? get().timelineChain.slice(0, idx + 1) : [] })

    // 回滚 ECS 状态到上一轮存档
    try {
      await window.LoadGameSave(prevCheckpointTurn.checkpointId)
      await refreshAllGameData()
    } catch (e) {
      console.error('Failed to load previous checkpoint:', e)
      alert(i18next.t('game:ink.regenerate.loadFailed') + (e as Error).message)
      return
    }

    // 截断 inkTurns 到 action turn（保留 action，移除 story 及之后的）
    const actionIndex = inkTurns.findIndex(t => t.id === actionTurn.id)
    if (actionIndex < 0) return
    const truncated = inkTurns.slice(0, actionIndex + 1)

    // 原子性更新状态
    set({
      inkTurns: truncated,
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
      turnIdRef: actionTurn.id + 1,
      turnCounter: actionTurn.id + 1,
      diceState: null,
      errorInfo: null,
      playerInput: '',
      showCustomInput: false,
    })

    // 重新生成
    const diceResult = actionTurn.diceResult
    await get().generateStory(actionTurn.playerAction, actionTurn.id, scrollToBottom, diceResult)
  },

  // 回档到指定回合（时光倒流）
  rewindToTurn: (turnId) => {
    const { inkTurns } = get()
    const currentIndex = inkTurns.findIndex(t => t.id === turnId)
    if (currentIndex < 0) return

    const truncated = inkTurns.slice(0, currentIndex + 1)

    // 关闭打字机动画，防止组件重新挂载时动画重播导致选项不显示
    const lastTurn = truncated[truncated.length - 1]
    if (isStoryTurn(lastTurn)) {
      truncated[truncated.length - 1] = { ...lastTurn, typewriterEnabled: false }
    }

    const maxTurnId = Math.max(...truncated.map(t => t.id))

    // 同步截断时间线链
    const targetStory = truncated.find(t => t.id === turnId && isStoryTurn(t)) as StoryTurn | undefined
    const targetCheckpointId = targetStory?.checkpointId
    let newChain = get().timelineChain
    if (targetCheckpointId) {
      const idx = newChain.findIndex(n => n.id === targetCheckpointId)
      if (idx >= 0) newChain = newChain.slice(0, idx + 1)
    } else {
      // 回档到无 checkpoint 的早期回合，尝试找最近的有 checkpoint 的回合
      const lastWithCp = [...truncated].reverse().find(t => isStoryTurn(t) && (t as StoryTurn).checkpointId) as StoryTurn | undefined
      if (lastWithCp?.checkpointId) {
        const idx = newChain.findIndex(n => n.id === lastWithCp.checkpointId)
        newChain = idx >= 0 ? newChain.slice(0, idx + 1) : []
      } else {
        newChain = []
      }
    }

    // 原子性更新所有状态，避免中间状态导致渲染异常
    set({
      inkTurns: truncated,
      timelineChain: newChain,
      pendingChoiceTurnId: turnId,
      currentPhase: 'waiting-choice',
      turnIdRef: maxTurnId + 1,
      turnCounter: maxTurnId + 1,
      diceState: null,
      errorInfo: null,
      playerInput: '',
      showCustomInput: false,
    })
  },

  // 重写岁月史书：回到过去的存档点，将中间回合压缩重写为一段高密度历史
  rewriteHistory: async (targetTurnId, userOpinion, scrollToBottom) => {
    const { inkTurns } = get()
    const { playerEntity } = useCreatureStore.getState()
    const { narrativePerson } = useUIStore.getState()

    // 1. 找到目标回合
    const targetIndex = inkTurns.findIndex(t => t.id === targetTurnId && isStoryTurn(t))
    if (targetIndex < 0) return
    const targetTurn = inkTurns[targetIndex] as StoryTurn
    if (!targetTurn.checkpointId) return

    // 2. 收集目标回合之后的中间回合（至多9轮）
    const intermediateTurns = inkTurns.slice(targetIndex + 1)
    const futureRounds: Array<{ action?: PlayerActionTurn; story?: StoryTurn }> = []
    let currentRound: { action?: PlayerActionTurn; story?: StoryTurn } = {}

    for (const turn of intermediateTurns) {
      if (isPlayerActionTurn(turn)) {
        if (currentRound.action || currentRound.story) {
          futureRounds.push(currentRound)
          currentRound = {}
        }
        currentRound.action = turn as PlayerActionTurn
      } else if (isStoryTurn(turn)) {
        currentRound.story = turn as StoryTurn
      }
    }
    if (currentRound.action || currentRound.story) {
      futureRounds.push(currentRound)
    }

    const limitedRounds = futureRounds.slice(0, 9)
    if (limitedRounds.length === 0) return

    // 3. 构建未来数据文本
    let futureDataText = ''
    for (let i = 0; i < limitedRounds.length; i++) {
      const round = limitedRounds[i]
      futureDataText += `\n=== 未来回合 ${i + 1} ===\n`
      if (round.action) {
        futureDataText += `[玩家(${playerEntity?.Creature?.name})行动] ${round.action.playerAction}\n`
        if (round.action.diceResult) {
          futureDataText += `[掷骰结果] ${round.action.diceResult.success ? '成功' : '失败'} (${round.action.diceResult.roll}/${round.action.diceResult.difficulty})\n`
        }
        if (round.action.directorNote) {
          futureDataText += `[OOC指令] ${round.action.directorNote}\n`
        }
      }
      if (round.story) {
        const fullContent = round.story.contentPart2
          ? `${round.story.content}\n\n${round.story.contentPart2}`
          : round.story.content
        futureDataText += `[章节: ${round.story.chapterHint || ''}]\n${fullContent}\n`
        if (round.story.stateChanges?.service_calls?.length) {
          futureDataText += `[状态变更]\n${round.story.stateChanges.service_calls.map(c => `${c.name}: ${c.suggestion}`).join('\n')}\n`
        }
        if (round.story.settingChanges?.length) {
          futureDataText += `[设定变更]\n${round.story.settingChanges.map(formatSettingChange).join('\n')}\n`
        }
      }
    }

    // 4. 回档到目标存档点
    try {
      await window.LoadGameSave(targetTurn.checkpointId)
      get().rewindToTurn(targetTurnId)
      await refreshAllGameData()
    } catch (e) {
      console.error('Failed to load checkpoint for rewrite:', e)
      alert(i18next.t('game:ink.rewrite.loadFailed') + (e as Error).message)
      return
    }

    // 5. 创建行动回合
    const actionTurnId = get().turnIdRef
    const actionLabel = i18next.t('game:ink.rewrite.actionLabel')
    const actionText = `${actionLabel}: ${userOpinion || i18next.t('game:ink.rewrite.defaultOpinion')}`

    const actionTurn: InkTurn = {
      id: actionTurnId,
      type: 'action',
      playerAction: actionText,
      isCustomInput: true
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      pendingChoiceTurnId: null,
      currentPhase: 'idle'
    }))

    // 6. 构建自定义创作请求
    const personInstruction = narrativePerson === 'second'
      ? '使用"你"来指代玩家角色。读者即玩家，代入感最强'
      : `使用玩家角色的名字"${playerEntity?.Creature?.name}"来指代玩家角色。禁止使用"主角""玩家"等词汇`

    const createRequest = `⚠️ LANGUAGE: Detect the language from the game's ECS data, setting documents, and previous narrative. Output ALL content in THAT language.

## 任务：重写岁月史书

你是一位掌控时间线的编年史官。玩家(${playerEntity?.Creature?.name})选择干涉过去，回到了一个较早的时间点，要求你将"尚未发生的未来"按照新的指导方针重写为一段信息密度极高的历史记录。

### 叙事人称
${personInstruction}

### 玩家的干涉意见
${userOpinion || '（无特殊意见，按照原有脉络压缩历史）'}

### 以下是尚未发生的"未来数据"（共${limitedRounds.length}个回合）
这些事件相对于当前存档来说属于未来，玩家希望将它们重写。
${futureDataText}

### 你的任务
1. **压缩重写**：将上述${limitedRounds.length}个回合的事件压缩重写为一整章高密度的小说正文。不是简单摘要，而是以文学笔法重新叙述这段历史，保留关键情节和人物互动
2. **遵循干涉意见**：严格按照玩家的干涉意见来调整事件走向。如果玩家要求某些事件不发生或以不同方式发生，必须遵守
3. **状态变更**：生成精确且必要的状态变更(state_changes)，覆盖所有在这段历史中受影响的角色、物品、关系等
4. **设定变更**：生成必要的设定变更(setting_changes)。特别是：
   - 如果玩家的干涉意见涉及创作风格、世界观调整，必须生成对应的设定变更追加到世界实体文档中
   - 每个角色经历的重大变化都应该有对应的设定文档更新
5. **衔接自然**：重写后的内容必须与当前存档点的状态无缝衔接，且为后续冒险留下合理的发展空间
6. **信息密度**：由于是多回合压缩，每段内容的信息密度应该显著高于普通章节。用精炼的叙述覆盖更多事件

### 写作风格
- "Show, don't tell" — 用行动和细节展示，而非直白陈述
- 保持角色的独特声音
- 自然融入数值变化（体力低→动作迟缓，好感高→态度温暖）
- 文笔凝练有力，避免拖沓
- 变换句式节奏：紧张时用短句，氛围渲染用长句`

    const thinkingInstruction = `
深度思考后再创作：
1. **梳理未来数据**：理清${limitedRounds.length}个回合的关键事件链，识别核心矛盾和转折点
2. **应用干涉意见**：分析玩家的干涉意见如何改变事件走向，哪些事件保留、哪些删除、哪些修改
3. **ECS一致性**：确保重写后的状态变更与当前ECS状态一致，不引入矛盾
4. **完整性检查**：确保所有重要角色的变化都有对应的状态变更和设定变更
5. **设定文档**：遵循设定文档中的思考和写作指导`

    // 7. 调用生成故事（使用自定义创作请求）
    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(actionText, actionTurnId, scrollToBottom, undefined, false, {
        createRequest,
        thinkingInstruction
      })
    }, 100)
  },

  // 开始游戏
  startGame: async () => {
    const { startStory } = get()

    set({ gameStarted: true, timelineChain: [] })

    if (startStory) {
      const initialTurn: StoryTurn = {
        id: 0,
        type: 'story',
        content: startStory,
        chapterHint: i18next.t('game:ink.prologue'),
        playerChoices: [
          { name: i18next.t('game:ink.continueOpening'), description: i18next.t('game:ink.continueWithChoices'), is_special: false }
        ],
        allowCustomInput: true,
        generationPhase: 'done',
        updateGameStateResult: { success: true, isHistorical: true } as UpdateGameStateAndDocsOutput
      }

      // 为序章创建 ECS 快照，使第一章可以重新生成
      let checkpointId: string | undefined
      try {
        const saveResult = await createSave({
          title: `[turn-0] ${i18next.t('game:ink.prologue')}`,
          description: encodeTimelineDesc([]),
        })
        if (saveResult.success && saveResult.checkpointId) {
          checkpointId = saveResult.checkpointId
          initialTurn.checkpointId = checkpointId
        }
      } catch (e) {
        console.error('Failed to create prologue checkpoint:', e)
      }

      set({
        inkTurns: [initialTurn],
        pendingChoiceTurnId: 0,
        currentPhase: 'waiting-choice',
        turnIdRef: 1,
        turnCounter: 1,
        timelineChain: checkpointId ? [{ id: checkpointId, t: i18next.t('game:ink.prologue') }] : [],
      })

      // 保存序章到剧情历史
      if (checkpointId) {
        await get().saveToState(initialTurn, undefined, checkpointId)
      }
    }
  },

  // 清空剧情历史
  clearStoryHistory: async () => {
    if (!await showConfirm(i18next.t('game:ink.confirm.clearHistory'))) {
      return
    }
    
    try {
      const result = await clearStoryHistoryService()
      if (result.success) {
        set({
          inkTurns: [],
          turnIdRef: 0,
          turnCounter: 0,
          gameStarted: false,
          pendingChoiceTurnId: null,
          showCustomInput: false
        })
        console.log('剧情历史已清空')
      } else {
        alert(i18next.t('game:ink.confirm.clearFailed', { error: result.error }))
      }
    } catch (e) {
      console.error('Failed to clear story history:', e)
      alert(i18next.t('game:ink.confirm.clearFailed', { error: (e as Error).message }))
    }
  },

  // 加载初始数据
  loadInitialData: async () => {
    const stateData = await refreshAllGameData()
    if (stateData) {
      set({
        backgroundStory: stateData.GameInitialStory?.background || i18next.t('game:ink.noBackgroundStory'),
        startStory: stateData.GameInitialStory?.start_story || "",
        gameInitChoice: stateData.GameInitChoice?.enable ? stateData.GameInitChoice : null,
      })
    }
  },

  // 加载剧情历史
  loadStoryHistory: async () => {
    try {
      const historyResponse = await getStoryHistory()
      if (historyResponse.success && historyResponse.data?.turn_ids && historyResponse.data.turn_ids.length && historyResponse.data.story) {
        const { turn_ids, story } = historyResponse.data
        
        const restoredTurns: InkTurn[] = []
        let maxTurnId = 0
        let lastStoryTurnId: number | null = null
        
        for (const turnId of turn_ids) {
          const storyEntry = story[turnId]
          if (storyEntry) {
            const historyData = normalizeStoryHistory(storyEntry.content as StoryHistoryData)
            const checkpointId = storyEntry.checkpoint_id
            
            if (historyData.player) {
              const actionTurn: PlayerActionTurn = {
                id: historyData.player.id,
                type: 'action',
                playerAction: historyData.player.playerAction,
                selectedChoice: historyData.player.selectedChoice,
                isCustomInput: historyData.player.isCustomInput,
                diceResult: historyData.player.diceResult,
              }
              restoredTurns.push(actionTurn)
              if (actionTurn.id > maxTurnId) maxTurnId = actionTurn.id
            }
            
            const storyTurn: StoryTurn = {
              id: historyData.story.id,
              type: 'story',
              content: historyData.story.content,
              contentPart2: historyData.story.contentPart2,
              chapterHint: historyData.story.chapterHint,
              reasoning: historyData.story.reasoning,
              thinking: historyData.story.thinking,
              collectorResults: historyData.story.collectorResults,
              collectorOutline: historyData.story.collectorOutline,
              selectedEvents: historyData.story.selectedEvents,
              settingChanges: historyData.story.settingChanges,
              eventChanges: historyData.story.eventChanges,
              newEntities: historyData.story.newEntities,
              stateChanges: historyData.story.stateChanges,
              playerChoices: historyData.story.playerChoices,
              allowCustomInput: historyData.story.allowCustomInput,
              directorNotes: historyData.story.directorNotes,
              generationPhase: 'done',
              relatedActionId: historyData.player?.id,
              checkpointId: checkpointId || historyData.story.checkpointId,
              updateGameStateResult: historyData.story.updateGameStateResult || { success: true, isHistorical: true } as UpdateGameStateAndDocsOutput
            }
            
            restoredTurns.push(storyTurn)
            if (storyTurn.id > maxTurnId) maxTurnId = storyTurn.id
            lastStoryTurnId = storyTurn.id
          }
        }
        
        if (restoredTurns.length > 0) {
          // 按照 id 排序，确保渲染顺序正确
          restoredTurns.sort((a, b) => a.id - b.id)
          
          const firstStoryTurn = restoredTurns.find(t => isStoryTurn(t)) as StoryTurn | undefined
          const hasProlog = firstStoryTurn?.id === 0 && (firstStoryTurn?.chapterHint === '序章' || firstStoryTurn?.chapterHint === i18next.t('game:ink.prologue'))
          
          if (!hasProlog) {
            const gameState = await getGameState()
            const prologStartStory = gameState.data?.GameInitialStory?.start_story || ''
            
            if (prologStartStory) {
              const prologTurn: StoryTurn = {
                id: 0,
                type: 'story',
                content: prologStartStory,
                chapterHint: i18next.t('game:ink.prologue'),
                playerChoices: [],
                allowCustomInput: false,
                generationPhase: 'done',
                updateGameStateResult: { success: true, isHistorical: true } as UpdateGameStateAndDocsOutput
              }
              restoredTurns.unshift(prologTurn)
            }
          }
          
          // 从最后一轮恢复 OOC 指令（向后兼容：旧数据从 player.directorNote 迁移）
          let restoredOOC: OOCInstruction[] = []
          const lastTurnId = turn_ids[turn_ids.length - 1]
          const lastEntry = story[lastTurnId]
          if (lastEntry) {
            const lastData = normalizeStoryHistory(lastEntry.content as StoryHistoryData)
            if (lastData.oocInstructions && lastData.oocInstructions.length > 0) {
              restoredOOC = lastData.oocInstructions
            } else if (lastData.player?.directorNote) {
              // 向后兼容：旧数据迁移为一条永久 OOC 指令
              restoredOOC = [{
                id: `ooc_migrated_${Date.now()}`,
                content: lastData.player.directorNote,
                duration: null,
                createdAtTurn: lastData.player.id
              }]
            }
          }

          set({
            inkTurns: restoredTurns,
            turnIdRef: maxTurnId + 1,
            turnCounter: maxTurnId + 1,
            gameStarted: true,
            oocInstructions: restoredOOC,
          })
          
          // 排序后找到最后一个故事回合（从后往前找）
          const lastStoryTurn = [...restoredTurns].reverse().find(t => isStoryTurn(t)) as StoryTurn | undefined
          if (lastStoryTurn?.playerChoices && lastStoryTurn.playerChoices.length > 0) {
            set({ pendingChoiceTurnId: lastStoryTurn.id, currentPhase: 'waiting-choice' })
          }

          // 从最后一个存档的 description 恢复时间线链
          const lastCheckpointId = lastStoryTurn?.checkpointId
            || ([...restoredTurns].reverse()
              .find(t => isStoryTurn(t) && (t as StoryTurn).checkpointId) as StoryTurn | undefined
            )?.checkpointId
          if (lastCheckpointId) {
            try {
              const savesResult = await listSaves()
              const targetSave = savesResult.saves.find(s => s.checkpointId === lastCheckpointId)
              if (targetSave) {
                const parentChain = parseTimelineDesc(targetSave.description)
                if (parentChain) {
                  const title = cleanSaveTitle(targetSave.title)
                  set({ timelineChain: [...parentChain, { id: lastCheckpointId, t: title }] })
                }
              }
            } catch (e) {
              console.warn('Failed to restore timeline chain:', e)
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load story history:', e)
    }
  }
}))
