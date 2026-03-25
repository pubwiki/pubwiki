import { create } from 'zustand'
import i18next from 'i18next'
import type {
  UpdateGameStateAndDocsOutput,
  CreativeWritingOutput,
} from '../../../api/types'
import {
  getGameState,
  createSave,
  loadSave,
  setNewStoryHistory,
  getStoryHistory,
  clearStoryHistory as clearStoryHistoryService,
  updateGameStateAndDocs,
  creativeWritingStream,
} from '../../utils'
import { showConfirm } from '../../../components/AlertDialog'
import type {
  GalTurn,
  GalStoryTurn,
  PlayerActionTurn,
  PlayerChoice,
  GalStoryHistoryData,
  GalDialogue,
  CollectorResult,
} from '../types'
import { isGalStoryTurn, isPlayerActionTurn } from '../types'
import { useCreatureStore } from './creatureStore'
import { useRegistryStore } from './registryStore'
import { useUIStore } from './uiStore'

// Constant for prologue identification (language-independent)
const PROLOGUE_KEY = 'prologue'

// 去除 AI 输出中的【Dn】编号前缀
const DIALOGUE_ID_RE = /^【D\d+】\s*/
function stripDialogueIds(dialogues: GalDialogue[]): GalDialogue[] {
  return dialogues.map(d => ({
    ...d,
    dialogue: (d.dialogue || '').replace(DIALOGUE_ID_RE, ''),
  }))
}

interface GameState {
  // 核心游戏状态
  gameStarted: boolean
  backgroundStory: string
  startStory: string
  galTurns: GalTurn[]
  turnCounter: number
  currentPhase: 'idle' | 'generating-story' | 'updating-state' | 'waiting-choice'
  playerInput: string
  showCustomInput: boolean
  pendingChoiceTurnId: number | null
  errorInfo: { message: string; retryAction: () => void } | null

  // 内部引用
  turnIdRef: number
  currentRequestId: number

  // Actions
  setGameStarted: (started: boolean) => void
  setBackgroundStory: (story: string) => void
  setStartStory: (story: string) => void
  setGalTurns: (turns: GalTurn[] | ((prev: GalTurn[]) => GalTurn[])) => void
  setTurnCounter: (counter: number) => void
  setCurrentPhase: (phase: GameState['currentPhase']) => void
  setPlayerInput: (input: string) => void
  setShowCustomInput: (show: boolean) => void
  setPendingChoiceTurnId: (id: number | null) => void
  setErrorInfo: (info: { message: string; retryAction: () => void } | null) => void

  // 业务逻辑
  buildHistoryText: (new_action: string) => string
  saveToState: (storyTurn: GalStoryTurn, actionTurn: PlayerActionTurn | undefined, checkpointId?: string) => Promise<void>
  handleChoiceSelect: (choice: PlayerChoice, storyTurnId: number, scrollToBottom: (force: boolean) => void) => void
  handleCustomInput: (input: string, storyTurnId: number, scrollToBottom: (force: boolean) => void) => void
  generateStory: (action: string, actionTurnId: number, scrollToBottom: (force: boolean) => void, reuseLastCollect?: boolean) => Promise<void>
  retryUpdateGameState: (storyTurnId: number, checkpointId?: string) => Promise<void>
  startGame: () => Promise<void>
  clearStoryHistory: () => Promise<void>
  loadInitialData: () => Promise<void>
  loadStoryHistory: () => Promise<void>
  reset: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  gameStarted: false,
  backgroundStory: '',
  startStory: '',
  galTurns: [],
  turnCounter: 0,
  currentPhase: 'idle',
  playerInput: '',
  showCustomInput: false,
  pendingChoiceTurnId: null,
  errorInfo: null,
  turnIdRef: 0,
  currentRequestId: 0,

  reset: () => set({
    gameStarted: false,
    backgroundStory: '',
    startStory: '',
    galTurns: [],
    turnCounter: 0,
    currentPhase: 'idle',
    playerInput: '',
    showCustomInput: false,
    pendingChoiceTurnId: null,
    errorInfo: null,
    turnIdRef: 0,
    currentRequestId: 0
  }),

  setGameStarted: (started) => set({ gameStarted: started }),
  setBackgroundStory: (story) => set({ backgroundStory: story }),
  setStartStory: (story) => set({ startStory: story }),
  setGalTurns: (turns) => set((state) => ({
    galTurns: typeof turns === 'function' ? turns(state.galTurns) : turns
  })),
  setTurnCounter: (counter) => set({ turnCounter: counter }),
  setCurrentPhase: (phase) => set({ currentPhase: phase }),
  setPlayerInput: (input) => set({ playerInput: input }),
  setShowCustomInput: (show) => set({ showCustomInput: show }),
  setPendingChoiceTurnId: (id) => set({ pendingChoiceTurnId: id }),
  setErrorInfo: (info) => set({ errorInfo: info }),

  // 构建历史文本
  buildHistoryText: (newAction: string) => {
    const { galTurns } = get()
    const { playerEntity } = useCreatureStore.getState()

    const parts: string[] = []
    let recentRounds: { action?: PlayerActionTurn; story?: GalStoryTurn }[] = []
    let currentRound: { action?: PlayerActionTurn; story?: GalStoryTurn } = {}

    for (const turn of galTurns) {
      if (isPlayerActionTurn(turn)) {
        if (currentRound.action || currentRound.story) {
          recentRounds.push(currentRound)
          currentRound = {}
        }
        currentRound.action = turn
      } else if (isGalStoryTurn(turn)) {
        currentRound.story = turn
      }
    }

    if (currentRound.action || currentRound.story) {
      recentRounds.push(currentRound)
    }

    const lastTwoRounds = recentRounds.slice(-2)

    for (const round of lastTwoRounds) {
      if (round.story) {
        // 将对话数组序列化为文本
        const dialogueText = (round.story.story || []).map(d => {
          if (d.speaker_creature_id) {
            return `${d.speaker_display_name}(${d.expression || 'normal'}): "${d.dialogue}"${d.depiction ? `\n  [描写] ${d.depiction}` : ''}`
          } else {
            return `[旁白] ${d.dialogue}${d.depiction ? `\n  [描写] ${d.depiction}` : ''}`
          }
        }).join('\n')

        const chapterTitle = round.story.chapterTitle ? `（章节: ${round.story.chapterTitle}）` : ''
        const setting_changes_text = round.story.settingChanges?.join('\n') || ''
        const state_changes_text = round.story.stateChanges?.join('\n') || ''

        if (dialogueText) {
          const nextDir = round.story.nextDirection ? `\n[导演建议]: ${round.story.nextDirection}` : ''
          parts.push(`[对话内容]\n${chapterTitle}\n${dialogueText}\n已发生的状态变更:\n${state_changes_text}\n已发生的设定变更:\n${setting_changes_text}${nextDir}\n 下一章节：`)
        }
      }
    }

    return parts.join('\n\n---\n\n') + `\n玩家最新行动: ${newAction}`
  },

  // 保存剧情到状态
  saveToState: async (storyTurn, actionTurn, checkpointId) => {
    try {
      const historyData: GalStoryHistoryData = {
        story: {
          id: storyTurn.id,
          dialogues: storyTurn.story,
          chapterTitle: storyTurn.chapterTitle,
          reasoning: storyTurn.reasoning,
          thinking: storyTurn.thinking,
          collectorResults: storyTurn.collectorResults,
          settingChanges: storyTurn.settingChanges,
          stateChanges: storyTurn.stateChanges,
          playerChoices: storyTurn.playerChoices,
          allowCustomInput: storyTurn.allowCustomInput,
          nextDirection: storyTurn.nextDirection,
          checkpointId: checkpointId,
          updateGameStateResult: storyTurn.updateGameStateResult,
        }
      }

      if (actionTurn) {
        historyData.player = {
          id: actionTurn.id,
          playerAction: actionTurn.playerAction,
          selectedChoice: actionTurn.selectedChoice,
          isCustomInput: actionTurn.isCustomInput,
        }
      }

      await setNewStoryHistory({
        turn_id: String(storyTurn.id),
        data: {
          content: historyData,
          checkpoint_id: checkpointId || ''
        }
      })
    } catch (e) {
      console.error('Failed to save story history:', e)
    }
  },

  // 处理玩家选择（无骰子系统）
  handleChoiceSelect: (choice, storyTurnId, scrollToBottom) => {
    const state = get()
    const actionTurnId = state.turnIdRef

    const actionTurn: GalTurn = {
      id: actionTurnId,
      type: 'action',
      playerAction: `${choice.name}: ${choice.description}`,
      selectedChoice: choice,
      isCustomInput: false
    }

    set((s) => ({
      galTurns: [...s.galTurns, actionTurn],
      pendingChoiceTurnId: null,
      currentPhase: 'idle'
    }))

    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(`${choice.name}: ${choice.description}`, actionTurnId, scrollToBottom)
    }, 100)
  },

  // 处理玩家自定义输入（无骰子系统）
  handleCustomInput: (input, storyTurnId, scrollToBottom) => {
    if (!input.trim()) return

    const state = get()
    const actionTurnId = state.turnIdRef

    const actionTurn: GalTurn = {
      id: actionTurnId,
      type: 'action',
      playerAction: input,
      isCustomInput: true
    }

    set((s) => ({
      galTurns: [...s.galTurns, actionTurn],
      playerInput: '',
      showCustomInput: false,
      pendingChoiceTurnId: null,
      currentPhase: 'idle'
    }))

    setTimeout(() => {
      scrollToBottom(true)
      get().generateStory(input, actionTurnId, scrollToBottom)
    }, 100)
  },

  // 生成故事
  generateStory: async (action, actionTurnId, scrollToBottom, reuseLastCollect) => {
    if (!action.trim()) return

    const state = get()
    const { playerEntity } = useCreatureStore.getState()
    const { loadRegistries } = useRegistryStore.getState()
    const { refreshCreatures, loadEntityMaps } = useCreatureStore.getState()
    const { dialogueCount } = useUIStore.getState()

    // 递增请求 ID
    const requestId = state.currentRequestId + 1
    set({ currentRequestId: requestId })

    // 清除错误信息
    set((s) => ({
      errorInfo: null,
      playerInput: '',
      currentPhase: 'generating-story',
      galTurns: s.galTurns.filter(turn =>
        !(turn.type === 'error' && turn.relatedActionId === actionTurnId) &&
        !(turn.type === 'story' && turn.relatedActionId === actionTurnId)
      )
    }))

    const storyTurnId = actionTurnId + 1

    // 创建空的故事回合
    set((s) => ({
      galTurns: [...s.galTurns, {
        id: storyTurnId,
        type: 'story',
        story: [],
        chapterTitle: '',
        generationPhase: 'collecting',
        typewriterEnabled: true,
        relatedActionId: actionTurnId
      } as GalStoryTurn]
    }))

    let collectorDone = false // 跟踪 RAG 收集是否已完成，用于 retry 时跳过收集

    try {
      const historyText = get().buildHistoryText(action)

      const callback = (streamEvent: { event_type: string; event_data: unknown }) => {
        if (requestId !== get().currentRequestId) return

        const { event_type, event_data } = streamEvent

        if (event_type === 'reaasoning_update') {
          const reasoningData = event_data as { raw_text?: string; reasoning?: string; collector_results?: CollectorResult[] }
          if (!reasoningData) return

          set((s) => ({
            galTurns: s.galTurns.map(turn => {
              if (turn.id === storyTurnId && isGalStoryTurn(turn)) {
                return {
                  ...turn,
                  reasoning: reasoningData.reasoning || turn.reasoning,
                  collectorResults: reasoningData.collector_results || turn.collectorResults,
                  generationPhase: 'reasoning'
                } as GalStoryTurn
              }
              return turn
            })
          }))
          setTimeout(() => scrollToBottom(false), 50)

        } else if (event_type === 'result_update' || event_type === 'collector_result_update') {
          const partialResult = event_data as Partial<CreativeWritingOutput> & {
            content?: {
              story?: GalDialogue[]
              chapter_title?: string
              player_choices?: PlayerChoice[]
              next_direction?: string
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
                galTurns: [
                  ...s.galTurns.filter(t => t.id !== storyTurnId),
                  {
                    id: -(actionTurnId + 1),
                    type: 'error' as const,
                    errorMessage: i18next.t('game:galgame.error.ragEmpty'),
                    relatedActionId: actionTurnId,
                    retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom)
                  }
                ]
              }))
              return
            }
            collectorDone = true
          }

          set((s) => ({
            galTurns: s.galTurns.map(turn => {
              if (turn.id === storyTurnId && isGalStoryTurn(turn)) {
                const data = partialResult.content || {}
                const hasContent = !!(data.story && data.story.length > 0)
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
                  story: data.story ? stripDialogueIds(data.story) : turn.story || [],
                  chapterTitle: data.chapter_title || turn.chapterTitle || '',
                  reasoning: partialResult.reasoning || turn.reasoning,
                  thinking: partialResult.thinking || turn.thinking,
                  collectorResults: partialResult.collector_results || turn.collectorResults,
                  settingChanges: partialResult.setting_changes || turn.settingChanges,
                  stateChanges: partialResult.state_changes || turn.stateChanges,
                  playerChoices: data.player_choices || turn.playerChoices,
                  nextDirection: data.next_direction || turn.nextDirection,
                  allowCustomInput: true,
                  generationPhase: phase
                } as GalStoryTurn
              }
              return turn
            })
          }))
          setTimeout(() => scrollToBottom(false), 50)

        } else if (event_type === 'done') {
          const result = event_data as Partial<CreativeWritingOutput> & {
            content?: {
              story?: GalDialogue[]
              chapter_title?: string
              player_choices?: PlayerChoice[]
              next_direction?: string
            }
          }

          if (!result.content) {
            set((s) => ({
              currentPhase: 'idle',
              galTurns: [
                ...s.galTurns.filter(t => t.id !== storyTurnId),
                {
                  id: -(actionTurnId + 1),
                  type: 'error' as const,
                  errorMessage: result.error || i18next.t('game:galgame.error.noContent'),
                  relatedActionId: actionTurnId,
                  retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, collectorDone)
                }
              ]
            }))
            return
          }

          const data = result.content

          // 更新最终的故事回合数据
          set((s) => ({
            galTurns: s.galTurns.map(turn => {
              if (turn.id === storyTurnId && isGalStoryTurn(turn)) {
                return {
                  ...turn,
                  story: data.story ? stripDialogueIds(data.story) : [],
                  chapterTitle: data.chapter_title || '',
                  thinking: result.thinking,
                  collectorResults: result.collector_results,
                  settingChanges: result.setting_changes,
                  stateChanges: result.state_changes,
                  playerChoices: data.player_choices || [],
                  nextDirection: data.next_direction || '',
                  allowCustomInput: true,
                  generationPhase: 'done'
                } as GalStoryTurn
              }
              return turn
            })
          }))

          // 更新游戏状态
          set({ currentPhase: 'updating-state' })

          const updateGameStateAsync = async () => {
            let tempCheckpointId: string | undefined
            try {
              const saveResult = await createSave({
                title: `[turn-${storyTurnId}]临时存档-更新前`,
                description: '临时存档点 - 用于状态更新失败时回滚 - 回合ID ' + storyTurnId,
              })

              if (saveResult.success && saveResult.checkpointId) {
                tempCheckpointId = saveResult.checkpointId
                set((s) => ({
                  galTurns: s.galTurns.map(turn =>
                    (turn.id === storyTurnId && isGalStoryTurn(turn))
                      ? { ...turn, checkpointId: tempCheckpointId } as GalStoryTurn
                      : turn
                  )
                }))
              }
            } catch (e) {
              console.error('Failed to create temp checkpoint:', e)
            }

            try {
              // 将对话转为纯文本供状态更新使用
              const dialogueText = (data.story || []).map((d: any) => {
                if (d.speaker_creature_id) {
                  return `${d.speaker_display_name}: "${d.dialogue}"`
                }
                return d.dialogue
              }).join('\n')

              const fullContent = `玩家(${playerEntity?.Creature?.name})行动: ${action}\n${dialogueText}`

              const updateResult = await updateGameStateAndDocs({
                  new_event: fullContent,
                  state_changes: result.state_changes || [],
                  setting_changes: result.setting_changes || []
                })

              set((s) => ({
                galTurns: s.galTurns.map(turn =>
                  (turn.id === storyTurnId && isGalStoryTurn(turn))
                    ? { ...turn, updateGameStateResult: updateResult } as GalStoryTurn
                    : turn
                )
              }))

              if (!updateResult.success && tempCheckpointId) {
                try {
                  await loadSave(tempCheckpointId)
                  await loadRegistries()
                  await loadEntityMaps()
                  await refreshCreatures()
                } catch (rollbackError) {
                  console.error('Failed to rollback:', rollbackError)
                }
              }

              await loadRegistries()
              await loadEntityMaps()
              await refreshCreatures()

              if (updateResult.success) {
                let checkpointId: string | undefined

                try {
                  const saveResult = await createSave({
                    title: `[turn-${storyTurnId}] ${data.chapter_title || i18next.t('game:galgame.unnamedChapter')}`,
                    description: '游戏进度存档点 - 自动创建 - 回合ID ' + storyTurnId,
                  })

                  if (saveResult.success && saveResult.checkpointId) {
                    checkpointId = saveResult.checkpointId

                    set((s) => ({
                      galTurns: s.galTurns.map(turn =>
                        (turn.id === storyTurnId && isGalStoryTurn(turn))
                          ? { ...turn, checkpointId } as GalStoryTurn
                          : turn
                      )
                    }))
                  }
                } catch (e) {
                  console.error('Failed to create checkpoint:', e)
                  checkpointId = tempCheckpointId
                }

                // 保存剧情历史
                const storyTurnToSave: GalStoryTurn = {
                  id: storyTurnId,
                  type: 'story',
                  story: data.story ? stripDialogueIds(data.story) : [],
                  chapterTitle: data.chapter_title || '',
                  reasoning: result.reasoning,
                  thinking: result.thinking,
                  collectorResults: result.collector_results,
                  settingChanges: result.setting_changes,
                  stateChanges: result.state_changes,
                  playerChoices: data.player_choices || [],
                  nextDirection: data.next_direction || '',
                  allowCustomInput: true,
                  generationPhase: 'done',
                  relatedActionId: actionTurnId,
                  updateGameStateResult: updateResult
                }

                const actualActionTurn = get().galTurns.find(
                  t => t.id === actionTurnId && isPlayerActionTurn(t)
                ) as PlayerActionTurn | undefined

                const actionTurnToSave: PlayerActionTurn = actualActionTurn || {
                  id: actionTurnId,
                  type: 'action',
                  playerAction: action,
                  isCustomInput: true
                }

                await get().saveToState(storyTurnToSave, actionTurnToSave, checkpointId)
              }

            } catch (e) {
              console.error('Failed to update game state:', e)
              set((s) => ({
                galTurns: s.galTurns.map(turn =>
                  (turn.id === storyTurnId && isGalStoryTurn(turn))
                    ? { ...turn, updateGameStateResult: { success: false, error: (e as Error).message } } as GalStoryTurn
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

          set({ turnIdRef: actionTurnId + 2, turnCounter: actionTurnId + 2 })
          setTimeout(() => scrollToBottom(true), 100)

        } else if (event_type === 'error') {
          const error = event_data as { message?: string } | Error
          const errorMessage = 'message' in error ? error.message : i18next.t('game:galgame.error.unknownError')

          set((s) => ({
            currentPhase: 'idle',
            galTurns: [
              ...s.galTurns.filter(t => t.id !== storyTurnId),
              {
                id: -(actionTurnId + 1),
                type: 'error' as const,
                errorMessage: i18next.t('game:galgame.error.generateFailed', { error: errorMessage }),
                relatedActionId: actionTurnId,
                retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, collectorDone)
              }
            ]
          }))
        }
      }

      // 调用流式服务 - Galgame 风格提示词
      await creativeWritingStream({
        reuse_last_collect: reuseLastCollect || undefined,
        create_request: `
        玩家(${playerEntity?.Creature?.name})行动: ${action}

        你是一位顶尖的 Galgame/视觉小说编剧。请把玩家的这个行动展开成一段引人入胜的 Galgame 对话场景。

        ## 写作核心原则

        **Galgame 对话风格：**
        - 以对话为主要叙事手段，角色之间的交流推动剧情发展
        - 每个角色的说话方式要有鲜明个性：用词习惯、语气、口癖等
        - 旁白用于场景过渡、氛围描写、角色内心独白
        - depiction 用于重要的视觉场景描写（CG 级别的画面感），不是每句话都需要
        - 表情变化要自然流畅，跟随对话情绪自然转换

        **场景与氛围：**
        - 善于通过旁白营造氛围：时间、天气、环境的细微变化
        - 角色的小动作、视线方向、声音变化等通过旁白或 depiction 自然呈现
        - 用"展示"代替"告诉"——不要说"她很紧张"，而是描写她的手指不自觉地攥紧裙角

        **数值和剧情同时驱动：**
        - 叙事中自然融入当前游戏状态（体力、技能、关系等），不直接告诉玩家
        - 角色的态度和行为要反映与玩家的关系亲密度
        - NPC 是活的：有自己的目的、情绪、反应

        **防全知准则——玩家不是上帝：**
        - 玩家角色的认知严格受限于其实际经历
        - 禁止莫名其妙了解 NPC 的秘密或内心想法
        - 需要通过合理叙事途径获知信息

        **叙事节奏控制：**
        - 不要在一次生成中把整个事件写完
        - 一次生成只推进一个小的叙事阶段
        - 禁止时间跳跃式叙事
        - 参考上一次的"导演建议"来把握节奏

        ## 输出结构

        **story**: 必须包含恰好 ${dialogueCount} 条对话/旁白，编号从【D1】到【D${dialogueCount}】，按时间顺序排列。
        每条的 dialogue 字段以对应编号开头，如【D1】、【D2】...【D${dialogueCount}】。
        每条包含：
        - speaker_creature_id: 说话者的 ECS 实体 ID（旁白留空字符串 ""）
        - speaker_display_name: 说话者显示名（旁白留空字符串 ""）
        - dialogue: 以【Dn】编号开头的对话文本（旁白时为场景描写/内心独白文本）
        - depiction: 可选，第一人称视角的具体情景描写（只在画面感强的关键时刻使用）
        - expression: 可选，说话者表情（normal/happy/angry/sad/surprised/shy/disgusted/dazed）

        **对话分配原则：**
        - 旁白(speaker_creature_id="")占 4-8 条，用于场景过渡、环境描写、角色内心独白
        - 角色对话占其余部分，至少 2-3 个角色参与对话
        - 不要所有对话都是一问一答的机械结构，要有打断、沉默、自言自语等自然交流节奏
        - 角色表情在一段对话中应该有变化，不要全程同一个表情
        - 每条对话不需要太长，一般 20-80 字，旁白可以稍长

        **player_choices**: 2-4 个选项
        - 从当前对话场景中自然衍生
        - name: 2-6字的简短名称
        - description: 10-30字，说明行动方向
        - is_special: 需要特定条件才能选择设为 true
    `,
        thinking_instruction: `
        你需要深度思考后再创作。按以下步骤思考：
        1. **角色一致性检查**
           - 查看 ECS 数据：相关角色的性格特征、当前状态、与玩家的关系
           - 每个角色的说话方式是否有辨识度？
           - 角色的行为是否符合其设定
           - ECS 状态一致性：属性、技能、状态效果、关系等

        2. **玩家认知边界审查**
           - 逐条梳理玩家角色将展现的所有知识和判断
           - 检查 log 记录：与哪些 NPC 交互？去过哪些地方？

        3. **世界规则遵守**
           - 状态变更是否合理？
           - 有没有违反已建立的世界设定？

        4. **遵守设定文档**
           - 思考并遵守设定文档中的写作指导
           `,
        previous_content_overview: historyText,
        callback: callback,
        output_content_schema: `
        {
          story: Array<{
            speaker_creature_id: string; // 说话者 ECS 实体 ID。旁白/内心独白/场景描写时使用空字符串 ""
            speaker_display_name: string; // 说话者显示名称。旁白时使用空字符串 ""
            dialogue: string; // 对话文本。旁白时为场景描写或内心独白文本
            depiction?: string; // 可选。第一人称视角的具体情景描写，画面感强的关键时刻使用
            expression?: string; // 可选。说话者表情：normal, happy, angry, sad, surprised, shy, disgusted, dazed
          }>; // 恰好 ${dialogueCount} 条，编号【D1】~【D${dialogueCount}】，dialogue字段以编号开头
          chapter_title: string; // 章节标题（3-8个字，有文学感）
          player_choices: Array<{
            name: string; // 选项名称（2-6个字）
            description: string; // 选项描述（10-30字）
            is_special: boolean; // 是否为特殊选项
          }>; // 2-4个选项
          next_direction: string; // 给下一次生成的导演建议（30-80字）
        }`
      })

    } catch (e) {
      console.error('Generation failed:', e)
      set((s) => {
        const storyToRemove = s.galTurns.find(t => t.type === 'story' && t.relatedActionId === actionTurnId && isGalStoryTurn(t) && (!t.story || t.story.length === 0))
        const filtered = storyToRemove ? s.galTurns.filter(t => t.id !== storyToRemove.id) : s.galTurns
        return {
          currentPhase: 'idle',
          galTurns: [...filtered, {
            id: -(actionTurnId + 1),
            type: 'error' as const,
            errorMessage: i18next.t('game:galgame.error.generateFailed', { error: (e as Error).message }),
            relatedActionId: actionTurnId,
            retryAction: () => get().generateStory(action, actionTurnId, scrollToBottom, collectorDone)
          }]
        }
      })
    }
  },

  // 重试更新游戏状态
  retryUpdateGameState: async (storyTurnId, checkpointId) => {
    const { galTurns } = get()
    const { loadRegistries } = useRegistryStore.getState()
    const { refreshCreatures, loadEntityMaps } = useCreatureStore.getState()

    const storyTurn = galTurns.find(t => t.id === storyTurnId && isGalStoryTurn(t)) as GalStoryTurn | undefined
    if (!storyTurn) return
    const { playerEntity } = useCreatureStore.getState()

    const actionTurn = storyTurn.relatedActionId !== undefined
      ? galTurns.find(t => t.id === storyTurn.relatedActionId && isPlayerActionTurn(t)) as PlayerActionTurn | undefined
      : undefined

    set({ currentPhase: 'updating-state' })

    set((s) => ({
      galTurns: s.galTurns.map(turn =>
        (turn.id === storyTurnId && isGalStoryTurn(turn))
          ? { ...turn, updateGameStateResult: undefined } as GalStoryTurn
          : turn
      )
    }))

    try {
      // 回滚到临时存档
      if (checkpointId) {
        await loadSave(checkpointId)
      }

      const dialogueText = (storyTurn.story || []).map(d => {
        if (d.speaker_creature_id) return `${d.speaker_display_name}: "${d.dialogue}"`
        return d.dialogue
      }).join('\n')

      const fullContent = `玩家(${playerEntity?.Creature?.name})行动: ${actionTurn?.playerAction}\n${dialogueText}`

      const updateResult = await updateGameStateAndDocs({
          new_event: fullContent,
          state_changes: storyTurn.stateChanges || [],
          setting_changes: storyTurn.settingChanges || []
        })

      set((s) => ({
        galTurns: s.galTurns.map(turn =>
          (turn.id === storyTurnId && isGalStoryTurn(turn))
            ? { ...turn, updateGameStateResult: updateResult } as GalStoryTurn
            : turn
        )
      }))

      if (!updateResult.success && checkpointId) {
        try {
          await loadSave(checkpointId)
          await loadRegistries()
          await loadEntityMaps()
          await refreshCreatures()
        } catch (e) {
          console.error('Failed to rollback:', e)
        }
      }

      await loadRegistries()
      await loadEntityMaps()
      await refreshCreatures()

      if (updateResult.success) {
        let newCheckpointId: string | undefined

        try {
          const saveResult = await createSave({
            title: `[turn-${storyTurnId}] ${storyTurn.chapterTitle || i18next.t('game:galgame.unnamedChapter')}`,
            description: '游戏进度存档点 - 重试后自动创建 - 回合ID ' + storyTurnId,
          })

          if (saveResult.success && saveResult.checkpointId) {
            newCheckpointId = saveResult.checkpointId
            set((s) => ({
              galTurns: s.galTurns.map(turn =>
                (turn.id === storyTurnId && isGalStoryTurn(turn))
                  ? { ...turn, checkpointId: newCheckpointId } as GalStoryTurn
                  : turn
              )
            }))
          }
        } catch (e) {
          console.error('Failed to create checkpoint after retry:', e)
        }

        const storyTurnToSave: GalStoryTurn = {
          ...storyTurn,
          checkpointId: newCheckpointId,
          updateGameStateResult: updateResult
        }

        await get().saveToState(storyTurnToSave, actionTurn, newCheckpointId)
      }

    } catch (e) {
      console.error('Retry update game state failed:', e)
      set((s) => ({
        galTurns: s.galTurns.map(turn =>
          (turn.id === storyTurnId && isGalStoryTurn(turn))
            ? { ...turn, updateGameStateResult: { success: false, error: (e as Error).message } } as GalStoryTurn
            : turn
        )
      }))
    } finally {
      set({ pendingChoiceTurnId: storyTurnId, currentPhase: 'waiting-choice' })
    }
  },

  // 开始游戏
  startGame: async () => {
    const { startStory } = get()

    set({ gameStarted: true })

    if (startStory) {
      const initialTurn: GalStoryTurn = {
        id: 0,
        type: 'story',
        story: [{
          speaker_creature_id: '',
          speaker_display_name: '',
          dialogue: startStory,
        }],
        chapterTitle: PROLOGUE_KEY,
        playerChoices: [
          { name: i18next.t('game:galgame.startGame.continueStory'), description: i18next.t('game:galgame.startGame.continueStoryDesc'), is_special: false }
        ],
        allowCustomInput: true,
        generationPhase: 'done',
        updateGameStateResult: { success: true, isHistorical: true } as UpdateGameStateAndDocsOutput
      }

      set({
        galTurns: [initialTurn],
        pendingChoiceTurnId: 0,
        currentPhase: 'waiting-choice',
        turnIdRef: 1,
        turnCounter: 1
      })
    }
  },

  // 清空剧情历史
  clearStoryHistory: async () => {
    if (!await showConfirm(i18next.t('game:galgame.confirm.clearHistory'))) {
      return
    }

    try {
      const result = await clearStoryHistoryService()
      if (result.success) {
        set({
          galTurns: [],
          turnIdRef: 0,
          turnCounter: 0,
          gameStarted: false,
          pendingChoiceTurnId: null,
          showCustomInput: false
        })
      } else {
        alert(i18next.t('game:galgame.error.clearFailed', { error: result.error }))
      }
    } catch (e) {
      console.error('Failed to clear story history:', e)
      alert(i18next.t('game:galgame.error.clearFailed', { error: (e as Error).message }))
    }
  },

  // 加载初始数据
  loadInitialData: async () => {
    const { loadRegistries } = useRegistryStore.getState()
    const { refreshCreatures, loadEntityMaps } = useCreatureStore.getState()

    await loadRegistries()
    await loadEntityMaps()
    await refreshCreatures()

    try {
      const gameState = await getGameState()
      if (gameState.success && gameState.data) {
        set({
          backgroundStory: gameState.data.GameInitialStory?.background || i18next.t('game:galgame.noBackgroundStory'),
          startStory: gameState.data.GameInitialStory?.start_story || ""
        })
      }
    } catch (e) {
      console.error('Failed to load game stories:', e)
    }
  },

  // 加载剧情历史
  loadStoryHistory: async () => {
    try {
      const historyResponse = await getStoryHistory()
      if (historyResponse.success && historyResponse.data?.turn_ids && historyResponse.data.turn_ids.length && historyResponse.data.story) {
        const { turn_ids, story } = historyResponse.data

        const restoredTurns: GalTurn[] = []
        let maxTurnId = 0
        let lastStoryTurnId: number | null = null

        for (const turnId of turn_ids) {
          const storyEntry = story[turnId]
          if (storyEntry) {
            const historyData = storyEntry.content as GalStoryHistoryData
            const checkpointId = storyEntry.checkpoint_id

            // 验证是否为 galgame 格式（必须有 dialogues 数组），跳过 ink 格式的数据
            if (!historyData.story?.dialogues || !Array.isArray(historyData.story.dialogues)) {
              continue
            }

            if (historyData.player) {
              const actionTurn: PlayerActionTurn = {
                id: historyData.player.id,
                type: 'action',
                playerAction: historyData.player.playerAction,
                selectedChoice: historyData.player.selectedChoice,
                isCustomInput: historyData.player.isCustomInput,
              }
              restoredTurns.push(actionTurn)
              if (actionTurn.id > maxTurnId) maxTurnId = actionTurn.id
            }

            const storyTurn: GalStoryTurn = {
              id: historyData.story.id,
              type: 'story',
              story: historyData.story.dialogues || [],
              chapterTitle: historyData.story.chapterTitle,
              reasoning: historyData.story.reasoning,
              thinking: historyData.story.thinking,
              collectorResults: historyData.story.collectorResults,
              settingChanges: historyData.story.settingChanges,
              stateChanges: historyData.story.stateChanges,
              playerChoices: historyData.story.playerChoices,
              allowCustomInput: historyData.story.allowCustomInput,
              nextDirection: historyData.story.nextDirection,
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
          restoredTurns.sort((a, b) => a.id - b.id)

          const firstStoryTurn = restoredTurns.find(t => isGalStoryTurn(t)) as GalStoryTurn | undefined
          const hasProlog = firstStoryTurn?.id === 0 && firstStoryTurn?.chapterTitle === PROLOGUE_KEY

          // 如果没有序幕且有开场故事，添加序幕
          const { startStory } = get()
          if (!hasProlog && startStory) {
            const prologTurn: GalStoryTurn = {
              id: 0,
              type: 'story',
              story: [{
                speaker_creature_id: '',
                speaker_display_name: '',
                dialogue: startStory,
              }],
              chapterTitle: PROLOGUE_KEY,
              generationPhase: 'done',
              updateGameStateResult: { success: true, isHistorical: true } as UpdateGameStateAndDocsOutput
            }
            restoredTurns.unshift(prologTurn)
          }

          set({
            galTurns: restoredTurns,
            gameStarted: true,
            turnIdRef: maxTurnId + 1,
            turnCounter: maxTurnId + 1,
            pendingChoiceTurnId: lastStoryTurnId,
            currentPhase: 'waiting-choice'
          })
        }
      }
    } catch (e) {
      console.error('Failed to load story history:', e)
    }
  },
}))
