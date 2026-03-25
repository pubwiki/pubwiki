import { create } from 'zustand'
import i18next from 'i18next'
import type { 
  UpdateGameStateAndDocsOutput, 
  CreativeWritingOutput,
} from '../../../api/types'
import {
  getGameState,
  createSave,
  deleteSave,
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
  DiceResult
} from '../types'
import { isStoryTurn, isPlayerActionTurn } from '../types'
import type { TimelineNode } from '../types'
import { encodeTimelineDesc, parseTimelineDesc, cleanSaveTitle } from '../utils/timelineUtils'
import { useCreatureStore } from './creatureStore'
import { useUIStore } from './uiStore'

interface GameState {
  // 核心游戏状态
  gameStarted: boolean
  backgroundStory: string
  startStory: string
  inkTurns: InkTurn[]
  turnCounter: number
  currentPhase: 'idle' | 'generating-story' | 'updating-state' | 'waiting-choice' | 'dice-rolling'
  playerInput: string
  showCustomInput: boolean
  pendingChoiceTurnId: number | null
  errorInfo: { message: string; retryAction: () => void } | null
  directorNote: string
  showDirectorInput: boolean

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
  setDirectorNote: (note: string) => void
  setShowDirectorInput: (show: boolean) => void

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
  generateStory: (action: string, actionTurnId: number, scrollToBottom: (force: boolean) => void, diceResult?: DiceResult, reuseLastCollect?: boolean) => Promise<void>
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
  inkTurns: [],
  turnCounter: 0,
  currentPhase: 'idle',
  playerInput: '',
  showCustomInput: false,
  pendingChoiceTurnId: null,
  errorInfo: null,
  diceState: null,
  directorNote: '',
  showDirectorInput: false,
  timelineChain: [],
  turnIdRef: 0,
  currentRequestId: 0,

  // 重置所有状态
  reset: () => set({
    gameStarted: false,
    backgroundStory: '',
    startStory: '',
    inkTurns: [],
    turnCounter: 0,
    currentPhase: 'idle',
    playerInput: '',
    showCustomInput: false,
    pendingChoiceTurnId: null,
    errorInfo: null,
    diceState: null,
    directorNote: '',
    showDirectorInput: false,
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
  setDirectorNote: (note) => set({ directorNote: note }),
  setShowDirectorInput: (show) => set({ showDirectorInput: show }),

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
      directorNote: get().directorNote || undefined
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
      diceState: null,
      directorNote: '',
      showDirectorInput: false
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
        const setting_changes_text = round.story.settingChanges?.join('\n') || ''
        const state_changes_text = round.story.stateChanges?.join('\n') || ''
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
          settingChanges: storyTurn.settingChanges,
          stateChanges: storyTurn.stateChanges,
          playerChoices: storyTurn.playerChoices,
          allowCustomInput: storyTurn.allowCustomInput,
          directorNotes: storyTurn.directorNotes,
          checkpointId: checkpointId,
          updateGameStateResult: storyTurn.updateGameStateResult
        }
      }
      
      if (actionTurn) {
        historyData.player = {
          id: actionTurn.id,
          playerAction: actionTurn.playerAction,
          selectedChoice: actionTurn.selectedChoice,
          isCustomInput: actionTurn.isCustomInput,
          diceResult: actionTurn.diceResult,
          directorNote: actionTurn.directorNote
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
      directorNote: state.directorNote || undefined
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
      directorNote: '',
      showDirectorInput: false
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
      directorNote: state.directorNote || undefined
    }

    set((s) => ({
      inkTurns: [...s.inkTurns, actionTurn],
      playerInput: '',
      showCustomInput: false,
      pendingChoiceTurnId: null,
      currentPhase: 'idle',
      directorNote: '',
      showDirectorInput: false
    }))

    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(input, actionTurnId, scrollToBottom, hiddenDice)
    }, 100)
  },

  // 生成故事
  generateStory: async (action, actionTurnId, scrollToBottom, diceResult, reuseLastCollect) => {
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

    // 生成前创建临时存档，用于重新生成时回滚
    let preGenerationCheckpointId: string | undefined
    try {
      const preGenSave = await createSave({
        title: `[pre-gen] turn-${actionTurnId}`,
        description: `pre-generation checkpoint for regeneration`
      })
      if (preGenSave.success && preGenSave.checkpointId) {
        preGenerationCheckpointId = preGenSave.checkpointId
      }
    } catch (e) {
      console.warn('Failed to create pre-generation checkpoint:', e)
    }

    // 清理旧回合的 preGenerationCheckpointId 存档（新一轮开始后不再支持重新生成旧回合）
    const oldPreGenIds = get().inkTurns
      .filter((t): t is StoryTurn => isStoryTurn(t) && !!t.preGenerationCheckpointId)
      .map(t => t.preGenerationCheckpointId!)
    if (oldPreGenIds.length > 0) {
      set((s) => ({
        inkTurns: s.inkTurns.map(t =>
          isStoryTurn(t) && t.preGenerationCheckpointId
            ? { ...t, preGenerationCheckpointId: undefined } as StoryTurn
            : t
        )
      }))
      for (const id of oldPreGenIds) {
        deleteSave(id).catch(e => console.warn('Failed to delete old pre-gen checkpoint:', e))
      }
    }

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
        relatedActionId: actionTurnId,
        preGenerationCheckpointId
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
          
          const reasoningData = event_data as { raw_text?: string; reasoning?: string; collector_results?: CollectorResult[] }
          if (!reasoningData) return
          
          set((s) => ({
            inkTurns: s.inkTurns.map(turn => {
              if (turn.id === storyTurnId && isStoryTurn(turn)) {
                return {
                  ...turn,
                  reasoning: reasoningData.reasoning || turn.reasoning,
                  collectorResults: reasoningData.collector_results || turn.collectorResults,
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
                    errorMessage: i18next.t('game:ink.error.generateFailed', { error: 'RAG' }),
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
                  settingChanges: partialResult.setting_changes || turn.settingChanges,
                  stateChanges: partialResult.state_changes || turn.stateChanges,
                  playerChoices: data.player_choices || turn.playerChoices,
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
                  settingChanges: result.setting_changes,
                  stateChanges: result.state_changes,
                  playerChoices: data.player_choices || [],
                  directorNotes: result.director_notes || undefined,
                  allowCustomInput: true,
                  generationPhase: 'done'
                } as StoryTurn
              }
              return turn
            })
          }))

          // 更新游戏状态
          set({ currentPhase: 'updating-state' })
          
          const updateGameStateAsync = async () => {
            try {
              const fullContent = `玩家(${playerEntity?.Creature?.name})行动: ${action}` + (data.novel_content_part2 
                ? `${data.novel_content_part1 || ''}\n\n${data.novel_content_part2}`
                : data.novel_content_part1 || '')
              
              const updateResult = await updateGameStateAndDocs({
                  new_event: fullContent,
                  state_changes: result.state_changes || [],
                  setting_changes: result.setting_changes || [],
                  director_notes: result.director_notes || undefined
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
                  settingChanges: result.setting_changes,
                  stateChanges: result.state_changes,
                  playerChoices: data.player_choices || [],
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
                try {
                  const saveResult = await createSave({
                    title: `[turn-${storyTurnId}] ${chapterTitle}`,
                    description: encodeTimelineDesc(get().timelineChain),
                  })

                  if (saveResult.success && saveResult.checkpointId) {
                    checkpointId = saveResult.checkpointId

                    // 更新时间线链：追加自身节点
                    set((s) => ({
                      timelineChain: [...s.timelineChain, { id: checkpointId!, t: chapterTitle }],
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

      // 构建玩家导演指令上下文
      let directorNoteContext = ''
      const actionTurnForNote = get().inkTurns.find(
        t => t.id === actionTurnId && isPlayerActionTurn(t)
      ) as PlayerActionTurn | undefined
      if (actionTurnForNote?.directorNote) {
        directorNoteContext = `\n\n[玩家导演指令 - OOC元指令] ${actionTurnForNote.directorNote}\n（这是玩家作为"导演"给出的叙事方向指令，不是角色在游戏世界中的行动。请在保持叙事自然的前提下，将这个方向融入你的创作中。不要在小说正文中提及或引用这条指令本身。）`
      }

      // Call streaming service
      await creativeWritingStream({
        reuse_last_collect: false, // Keep false for now, enable after stable testing
        create_request: `
        ⚠️ LANGUAGE: Detect the language from the game's ECS data, setting documents, and previous narrative. Output ALL content (novel text, chapter hints, player choices) in THAT language.

        Player (${playerEntity?.Creature?.name}) action: ${action}${diceContext}${directorNoteContext}

        You are an elite web novel / light novel author who excels at writing thrilling, page-turning stories. Expand the player's action into a captivating novel chapter.

        ## Core Principles

        ${personInstruction}

        **Writing Style:**
        - “Show, don't tell” — use actions, details, and sensory descriptions instead of blunt statements
        - Give each character a distinctive voice — different tone, vocabulary, and speech patterns
        - Vary sentence rhythm: short punchy sentences for tension, longer flowing ones for atmosphere
        - Weave numerical stats naturally into the narrative (low stamina → sluggish movements, high affinity → warm attitude) — never report numbers directly
        - Reference director notes and markers to avoid repeating previously written scenes/information
        - Make full use of writing guidance from setting documents (character-specific body language, speech mannerisms, etc.)

        **Innovation & Drama — Extraordinary Experiences in a Believable World:**
        - The world is grounded (with costs, logic, and consequences), but the player's experience should be dramatic — a great story is never a bland log of events
        - Every scene needs a “hook”: a mystery, a surprise, an intriguing person, or something unusual. Blandness is the greatest enemy
        - Boldly introduce new scenes, characters, and elements — there is a vast unknown world beyond the current ECS to explore
        - Give the player's actions meaningful impact: effort should be rewarded (even in unexpected ways), and risks should lead to real discoveries
        - Setbacks and challenges are fine, but they must serve the larger narrative arc — lows exist to make the highs shine brighter, not to torment the player
        - Maintain dynamic pacing: relief after tension, a turning point after failure, warmth after loneliness

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

        **player_choices**: 2–4 options, naturally derived from the narrative
        - name: 2–6 words | description: 10–30 words | is_special: true when specific conditions are required
        - Choices should be differentiated and compelling — avoid generic “fight / talk / explore” templates
        ${diceMode === 'visible' ? `
        **Dice Roll (difficulty_level) — Use Sparingly:**
        - At most 1–2 choices per turn may include a dice roll; the rest should be normal options. Only assign rolls to actions with a clear chance of failure (climbing, lockpicking, persuading a hostile NPC, etc.) — never for routine actions
        - 10–30 = easy, 40–60 = moderate, 70–85 = hard, 86–100 = extreme; calculate based on ECS state and scene context
        - difficulty_reason: One sentence explaining the calculation basis` : ''}
    `,
        thinking_instruction: `
        Think deeply before writing:
        1. **ECS Consistency**: Cross-check character personalities, stats, and relationships — ensure the narrative stays in sync with game data
        2. **Knowledge Boundaries**: Does the player character display information they couldn't possibly know? Review logs and prior interactions
        3. **World Rules**: Are state changes plausible? Any setting violations?
        4. **Innovation Check**: Does this passage introduce new elements (new characters / scenes / discoveries)? If it's all existing content, consider adding a surprise
        5. **Setting Documents**: Follow the thinking and writing guidance in the setting documents
           `,
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
          }>; // 2–4 options, naturally derived from the narrative
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
          state_changes: storyTurn.stateChanges || [],
          setting_changes: storyTurn.settingChanges || [],
          director_notes: storyTurn.directorNotes || undefined
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
        try {
          const saveResult = await createSave({
            title: `[turn-${storyTurnId}] ${retryChapterTitle}`,
            description: encodeTimelineDesc(get().timelineChain),
          })

          if (saveResult.success && saveResult.checkpointId) {
            checkpointId = saveResult.checkpointId
            set((s) => ({
              timelineChain: [...s.timelineChain, { id: checkpointId!, t: retryChapterTitle }],
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

  // 重新生成故事（回滚到生成前状态并重新生成）
  regenerateStory: async (storyTurnId, scrollToBottom) => {
    const { inkTurns } = get()
    const storyTurn = inkTurns.find(t => t.id === storyTurnId && isStoryTurn(t)) as StoryTurn | undefined
    if (!storyTurn?.preGenerationCheckpointId) return

    // 找到对应的 action turn
    const actionTurn = storyTurn.relatedActionId !== undefined
      ? inkTurns.find(t => t.id === storyTurn.relatedActionId && isPlayerActionTurn(t)) as PlayerActionTurn | undefined
      : undefined

    if (!actionTurn) return

    // 截断时间线链到被重新生成回合的前一个 checkpoint
    const prevTurns = inkTurns.slice(0, inkTurns.findIndex(t => t.id === storyTurnId))
    const lastPrevCp = [...prevTurns].reverse()
      .find(t => isStoryTurn(t) && (t as StoryTurn).checkpointId) as StoryTurn | undefined
    if (lastPrevCp?.checkpointId) {
      const idx = get().timelineChain.findIndex(n => n.id === lastPrevCp.checkpointId)
      set({ timelineChain: idx >= 0 ? get().timelineChain.slice(0, idx + 1) : [] })
    } else {
      set({ timelineChain: [] })
    }

    // 回滚 ECS 状态到生成前
    try {
      await window.LoadGameSave(storyTurn.preGenerationCheckpointId)
      await refreshAllGameData()
    } catch (e) {
      console.error('Failed to load pre-generation checkpoint:', e)
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
      directorNote: '',
      showDirectorInput: false
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
      directorNote: '',
      showDirectorInput: false
    })
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
      
      set({
        inkTurns: [initialTurn],
        pendingChoiceTurnId: 0,
        currentPhase: 'waiting-choice',
        turnIdRef: 1,
        turnCounter: 1
      })
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
        startStory: stateData.GameInitialStory?.start_story || ""
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
            const historyData = storyEntry.content as StoryHistoryData
            const checkpointId = storyEntry.checkpoint_id
            
            if (historyData.player) {
              const actionTurn: PlayerActionTurn = {
                id: historyData.player.id,
                type: 'action',
                playerAction: historyData.player.playerAction,
                selectedChoice: historyData.player.selectedChoice,
                isCustomInput: historyData.player.isCustomInput,
                diceResult: historyData.player.diceResult,
                directorNote: historyData.player.directorNote
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
              settingChanges: historyData.story.settingChanges,
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
          
          set({
            inkTurns: restoredTurns,
            turnIdRef: maxTurnId + 1,
            turnCounter: maxTurnId + 1,
            gameStarted: true
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
