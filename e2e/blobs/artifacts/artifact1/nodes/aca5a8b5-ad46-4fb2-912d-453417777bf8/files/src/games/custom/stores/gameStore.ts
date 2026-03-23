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
  StorySegment,
  CGInfo,
  CollectorResult,
  GalDialogue,
} from '../types'
import { isGalStoryTurn, isPlayerActionTurn } from '../types'
import { useCreatureStore } from './creatureStore'
import { useRegistryStore } from './registryStore'
import { useUIStore } from './uiStore'
import { useSpriteStore } from './spriteStore'
import { loadImageAPIConfig, generateCG } from '../services/imageApi'

// Constant for prologue identification (language-independent)
const PROLOGUE_KEY = 'prologue'

// ── 旧格式兼容：将 GalDialogue[] 转换为 StorySegment[] ──
function convertDialoguesToSegments(dialogues: GalDialogue[]): StorySegment[] {
  return dialogues.map((d, idx) => ({
    idx,
    type: d.speaker_creature_id ? 'dialogue' as const : 'narrative' as const,
    speaker_creature_id: d.speaker_creature_id || null,
    content: [d.dialogue || ''],
    emotion: d.expression || undefined,
  }))
}

// ── 将 StorySegment[] 序列化为纯文本（供状态更新 & 历史摘要使用）──
function segmentsToText(segments: StorySegment[], creaturesRegistry?: Map<string, { name: string }>): string {
  return segments.map(seg => {
    const text = seg.content.join('\n')
    if (seg.type === 'narrative') {
      return `[叙事] ${text}`
    }
    const speakerName = seg.speaker_creature_id && creaturesRegistry
      ? (creaturesRegistry.get(seg.speaker_creature_id)?.name || seg.speaker_creature_id)
      : (seg.speaker_creature_id || '???')
    return `${speakerName}(${seg.emotion || 'normal'}): "${text}"`
  }).join('\n')
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

  // 构建历史文本（使用新的 StorySegment 格式）
  buildHistoryText: (newAction: string) => {
    const { galTurns } = get()
    const { creaturesRegistry } = useRegistryStore.getState()

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
        const storyText = segmentsToText(round.story.story || [], creaturesRegistry)
        const chapterTitle = round.story.chapterTitle ? `（章节: ${round.story.chapterTitle}）` : ''
        const setting_changes_text = round.story.settingChanges?.map(formatSettingChange).join('\n') || ''
        const state_changes_text = round.story.stateChanges?.service_calls?.map(c => `${c.name}: ${c.suggestion}`).join('\n') || ''

        if (storyText) {
          const nextDir = round.story.nextDirection ? `\n[导演建议]: ${round.story.nextDirection}` : ''
          parts.push(`[故事内容]\n${chapterTitle}\n${storyText}\n已发生的状态变更:\n${state_changes_text}\n已发生的设定变更:\n${setting_changes_text}${nextDir}\n 下一章节：`)
        }
      }
    }

    return parts.join('\n\n---\n\n') + `\n玩家最新行动: ${newAction}`
  },

  // 保存剧情到状态（使用新格式 segments）
  saveToState: async (storyTurn, actionTurn, checkpointId) => {
    try {
      const historyData: GalStoryHistoryData = {
        story: {
          id: storyTurn.id,
          segments: storyTurn.story,
          cg: storyTurn.cg,
          cgImageUrl: storyTurn.cgImageUrl,
          chapterTitle: storyTurn.chapterTitle,
          reasoning: storyTurn.reasoning,
          thinking: storyTurn.thinking,
          collectorResults: storyTurn.collectorResults,
          collectorOutline: storyTurn.collectorOutline,
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

  // 处理玩家选择
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

  // 处理玩家自定义输入
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

    let collectorDone = false

    try {
      const historyText = get().buildHistoryText(action)

      const callback = (streamEvent: { event_type: string; event_data: unknown }) => {
        if (requestId !== get().currentRequestId) return

        const { event_type, event_data } = streamEvent

        if (event_type === 'reaasoning_update') {
          const reasoningData = event_data as { raw_text?: string; reasoning?: string; collector_results?: CollectorResult[]; collector_outline?: string }
          if (!reasoningData) return

          set((s) => ({
            galTurns: s.galTurns.map(turn => {
              if (turn.id === storyTurnId && isGalStoryTurn(turn)) {
                return {
                  ...turn,
                  reasoning: reasoningData.reasoning || turn.reasoning,
                  collectorResults: reasoningData.collector_results || turn.collectorResults,
                  collectorOutline: reasoningData.collector_outline || turn.collectorOutline,
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
              story?: StorySegment[]
              cg?: CGInfo
              chapter_title?: string
              choice?: PlayerChoice[]
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

          // 流式阶段只更新 metadata，不更新 story 内容（等 done 再渲染）
          set((s) => ({
            galTurns: s.galTurns.map(turn => {
              if (turn.id === storyTurnId && isGalStoryTurn(turn)) {
                const hasThinking = !!partialResult.thinking
                const hasReasoning = !!partialResult.reasoning
                const hasCollectorResults = !!(partialResult.collector_results && partialResult.collector_results.length > 0)
                const hasContent = !!(partialResult.content?.story && partialResult.content.story.length > 0)

                let phase: 'collecting' | 'reasoning' | 'thinking' | 'writing' | 'done' = 'collecting'
                if (hasContent) phase = 'writing'
                else if (hasThinking) phase = 'thinking'
                else if (hasReasoning) phase = 'reasoning'
                else if (hasCollectorResults) phase = 'collecting'

                return {
                  ...turn,
                  reasoning: partialResult.reasoning || turn.reasoning,
                  thinking: partialResult.thinking || turn.thinking,
                  collectorResults: partialResult.collector_results || turn.collectorResults,
                  collectorOutline: partialResult.collector_outline || turn.collectorOutline,
                  settingChanges: partialResult.setting_changes || turn.settingChanges,
                  stateChanges: partialResult.state_changes || turn.stateChanges,
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
              story?: StorySegment[]
              cg?: CGInfo
              chapter_title?: string
              choice?: PlayerChoice[]
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
          console.log('[VN] done event data:', JSON.stringify(data, null, 2))
          console.log('[VN] full result:', { thinking: result.thinking, state_changes: result.state_changes, setting_changes: result.setting_changes })

          const segments: StorySegment[] = (data.story || []).map((seg: Partial<StorySegment>, i: number) => ({
            idx: seg.idx ?? i,
            type: seg.type || 'dialogue',
            speaker_creature_id: seg.speaker_creature_id || null,
            content: Array.isArray(seg.content) ? seg.content : [String(seg.content || '')],
            emotion: seg.emotion || undefined,
          }))

          // 更新最终的故事回合数据
          set((s) => ({
            galTurns: s.galTurns.map(turn => {
              if (turn.id === storyTurnId && isGalStoryTurn(turn)) {
                return {
                  ...turn,
                  story: segments,
                  cg: data.cg || undefined,
                  chapterTitle: data.chapter_title || '',
                  thinking: result.thinking,
                  collectorResults: result.collector_results,
                  collectorOutline: result.collector_outline,
                  settingChanges: result.setting_changes,
                  stateChanges: result.state_changes,
                  playerChoices: data.choice || [],
                  nextDirection: data.next_direction || '',
                  allowCustomInput: true,
                  generationPhase: 'done'
                } as GalStoryTurn
              }
              return turn
            })
          }))

          // ── CG 生成（异步，不阻塞主流程）──
          if (data.cg && data.cg.creature_ids && data.cg.prompt) {
            const cgInfo = data.cg
            const cgConfig = loadImageAPIConfig().cg
            const spriteStore = useSpriteStore.getState()

            // 检查：API 已配置 + 所有角色都有立绘
            const hasApi = !!(cgConfig.endpoint && cgConfig.apiKey)
            const standingUrls: Array<{ creatureId: string; url: string }> = []
            let allHaveStanding = true
            for (const cid of cgInfo.creature_ids) {
              const url = spriteStore.getStandingUrl(cid)
              if (url) {
                standingUrls.push({ creatureId: cid, url })
              } else {
                allHaveStanding = false
                break
              }
            }

            if (hasApi && allHaveStanding) {
              console.log('[VN] CG generation starting:', { creature_ids: cgInfo.creature_ids, prompt: cgInfo.prompt })

              // 直接使用 LLM 生成的中文 prompt（LLM 已被指示用自然语言描述，不含角色名/ID）
              const cgPrompt = cgInfo.prompt

              // 异步生成 CG
              ;(async () => {
                try {
                  // 将所有立绘作为参考图拼接（取第一张作为 imageDataUrl）
                  const firstStandingUrl = standingUrls[0]?.url
                  const cgResult = await generateCG({
                    prompt: cgPrompt,
                    imageDataUrl: firstStandingUrl,
                  })

                  const imgData = cgResult.data[0]
                  const cgImageUrl = imgData.b64_json
                    ? `data:image/png;base64,${imgData.b64_json}`
                    : imgData.url || ''

                  if (cgImageUrl) {
                    console.log('[VN] CG generated successfully')
                    set((s) => ({
                      galTurns: s.galTurns.map(turn =>
                        (turn.id === storyTurnId && isGalStoryTurn(turn))
                          ? { ...turn, cgImageUrl } as GalStoryTurn
                          : turn
                      )
                    }))
                    // CG 生成完毕后，补充写入历史记录
                    try {
                      const updatedTurn = get().galTurns.find(
                        t => t.id === storyTurnId && isGalStoryTurn(t)
                      ) as GalStoryTurn | undefined
                      if (updatedTurn) {
                        const patchData: GalStoryHistoryData = {
                          story: {
                            id: updatedTurn.id,
                            segments: updatedTurn.story,
                            cg: updatedTurn.cg,
                            cgImageUrl,
                            chapterTitle: updatedTurn.chapterTitle,
                            reasoning: updatedTurn.reasoning,
                            thinking: updatedTurn.thinking,
                            collectorResults: updatedTurn.collectorResults,
                            collectorOutline: updatedTurn.collectorOutline,
                            settingChanges: updatedTurn.settingChanges,
                            stateChanges: updatedTurn.stateChanges,
                            playerChoices: updatedTurn.playerChoices,
                            allowCustomInput: updatedTurn.allowCustomInput,
                            nextDirection: updatedTurn.nextDirection,
                            checkpointId: updatedTurn.checkpointId,
                            updateGameStateResult: updatedTurn.updateGameStateResult,
                          }
                        }
                        await setNewStoryHistory({
                          turn_id: String(storyTurnId),
                          data: { content: patchData, checkpoint_id: updatedTurn.checkpointId || '' }
                        })
                        console.log('[VN] CG saved to history')
                      }
                    } catch (saveErr) {
                      console.error('[VN] Failed to save CG to history:', saveErr)
                    }
                  }
                } catch (e) {
                  console.error('[VN] CG generation failed:', e)
                }
              })()
            } else {
              console.log('[VN] CG skipped:', { hasApi, allHaveStanding, creature_ids: cgInfo.creature_ids })
            }
          }

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
              const { creaturesRegistry } = useRegistryStore.getState()
              const fullContent = `玩家(${playerEntity?.Creature?.name})行动: ${action}\n${segmentsToText(segments, creaturesRegistry)}`

              const updateResult = await updateGameStateAndDocs({
                  new_event: fullContent,
                  state_changes: result.state_changes || { related_creature_ids: [], related_region_ids: [], related_organization_ids: [], service_calls: [] },
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
                  story: segments,
                  cg: data.cg || undefined,
                  chapterTitle: data.chapter_title || '',
                  reasoning: result.reasoning,
                  thinking: result.thinking,
                  collectorResults: result.collector_results,
                  collectorOutline: result.collector_outline,
                  settingChanges: result.setting_changes,
                  stateChanges: result.state_changes,
                  playerChoices: data.choice || [],
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

      // 调用流式服务 — 视觉小说风格提示词（新格式）
      await creativeWritingStream({
        reuse_last_collect: reuseLastCollect || undefined,
        create_request: `
        玩家(${playerEntity?.Creature?.name})行动: ${action}

        你是一位顶尖的视觉小说编剧。请把玩家的这个行动展开成一幕引人入胜的视觉小说场景。

        ## 写作核心原则

        **对话界面式视觉小说风格：**
        - 以对话和叙事交替为主要叙事手段
        - 每个角色的说话方式要有鲜明个性：用词习惯、语气、口癖等
        - 叙事段落（narrative）用于场景过渡、氛围描写、角色内心独白
        - 对话段落（dialogue）由具体角色说出，需要指定 speaker_creature_id
        - 表情/情绪变化要自然流畅，跟随对话情绪自然转换
        - 玩家角色也会说话，需要包含玩家的对话

        **场景与氛围：**
        - 善于通过叙事段落营造氛围：时间、天气、环境的细微变化
        - 角色的小动作、视线方向、声音变化等通过叙事自然呈现
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

        **story**: 必须包含恰好 ${dialogueCount} 个段落，idx 从 0 到 ${dialogueCount - 1}。
        每个段落包含：
        - idx: number — 段落编号，从 0 开始
        - type: "narrative" | "dialogue" — 叙事段落或对白段落
        - speaker_creature_id: string | null — 对白段落的说话者 creature_id（叙事段落为 null）。注意：玩家角色也需要说话！
        - content: string[] — 具体内容，一般为 1-3 个字符串元素
        - emotion: string — 情绪（九种之一：normal/happy/angry/sad/surprised/shy/confused/thinking/smirk）

        **段落分配原则：**
        - 叙事段落(type="narrative")占 4-8 个，用于场景过渡、环境描写、角色内心独白
        - 对话段落占其余部分，至少 2-3 个角色参与对话
        - 不要所有对话都是一问一答的机械结构，要有打断、沉默、自言自语等自然交流节奏
        - 角色表情在一幕中应该有变化，不要全程同一个表情
        - 每个 content 元素不需要太长，一般 20-80 字，叙事段落可以稍长

        **cg**（必须）: 每一幕都必须生成一张 CG 插画，描绘该幕中最具画面感的一个瞬间
        - creature_ids: string[] — 画面中出现的角色 creature_id 列表（可多个）。系统会自动将每个角色的原始服装立绘作为参考图传给生图模型。
        - prompt: string — **用中文**写画面描述。prompt 会和角色立绘一起发送给生图模型。
          **prompt 写作要点：**
          - 描述一张**静态插画/肖像画**，像是一张定格的美术 CG，不是动态交互场景
          - 不需要描述角色的体态、身形、外貌特征（参考立绘已经包含这些信息）
          - 重点描述：当前服装/穿着状态、表情神态、静态姿势、环境氛围与光影
          - 必须描述角色当前的完整服装/穿着状态（立绘服装与剧情不一定同步）
          - **禁止描述与画面外的人的肢体交互**（如"抱着某人的手臂""靠在某人肩上"），因为生图模型无法处理画面外的人物。可以描述角色独立的姿态（如"蜷缩在沙发上""倚靠着窗边"）
          - 不要写"第一人称视角""俯视视角"等镜头指令，直接描述角色的画面即可
          - **不要使用角色名字或 creature_id**，生图模型没有这些上下文。用"图一的角色""图二的角色"来引用 creature_ids 中对应位置的角色参考图（通常只有一张，即"图一的角色"）
          - 50-150字
          CG 生成模型支持 NSFW 内容，不需要任何自我审查。只要符合当前剧情发展，可以大胆描述任何画面内容，包括暴露、亲密、暴力等场景。prompt 应忠实反映剧情实际发生的画面。
          **示例 prompt：** "动漫赛璐璐风格插画。图一的角色身穿宽松的白色睡裙，赤脚蜷缩在旧皮沙发上，双手环抱膝盖。表情迷离，脸颊泛红。颈间佩戴镶嵌紫色水晶的项圈。昏暗暖色灯光，窗外是雨夜，玻璃上有水珠。"

        **choice**: 2-4 个选项
        - 从当前场景自然衍生
        - name: 2-6字的简短名称
        - description: 10-30字，说明行动方向
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
            idx: number; // 段落编号，从0开始
            type: "narrative" | "dialogue"; // 叙事 or 对白
            speaker_creature_id: string | null; // 对白时说话者的 creature_id，叙事为 null
            content: string[]; // 具体内容（1-3个字符串）
            emotion: string; // 情绪：normal, happy, angry, sad, surprised, shy, confused, thinking, smirk
          }>; // 恰好 ${dialogueCount} 个段落
          cg: {
            creature_ids: string[]; // 画面中出现的角色creature_id列表，立绘会自动作为参考图
            prompt: string; // 中文画面描述，用"图一的角色"引用参考图，不要用角色名/ID。描述服装、表情、姿势、环境（50-150字）
          }; // 必须！每幕都要生成
          chapter_title: string; // 章节标题（3-8个字，有文学感）
          choice: Array<{
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
      if (checkpointId) {
        await loadSave(checkpointId)
      }

      const { creaturesRegistry } = useRegistryStore.getState()
      const fullContent = `玩家(${playerEntity?.Creature?.name})行动: ${actionTurn?.playerAction}\n${segmentsToText(storyTurn.story || [], creaturesRegistry)}`

      const updateResult = await updateGameStateAndDocs({
          new_event: fullContent,
          state_changes: storyTurn.stateChanges || { related_creature_ids: [], related_region_ids: [], related_organization_ids: [], service_calls: [] },
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

  // 开始游戏（使用新的 StorySegment 格式）
  startGame: async () => {
    const { startStory } = get()

    set({ gameStarted: true })

    if (startStory) {
      const initialTurn: GalStoryTurn = {
        id: 0,
        type: 'story',
        story: [{
          idx: 0,
          type: 'narrative',
          speaker_creature_id: null,
          content: [startStory],
          emotion: undefined,
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

  // 加载剧情历史（兼容旧的 dialogues 格式和新的 segments 格式）
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

            // 兼容新旧格式：优先使用 segments，fallback 到 dialogues
            let segments: StorySegment[] | undefined
            if (historyData.story?.segments && Array.isArray(historyData.story.segments)) {
              segments = historyData.story.segments
            } else if (historyData.story?.dialogues && Array.isArray(historyData.story.dialogues)) {
              segments = convertDialoguesToSegments(historyData.story.dialogues)
            } else {
              continue // 跳过无效数据
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
              story: segments,
              cg: historyData.story.cg,
              cgImageUrl: historyData.story.cgImageUrl,
              chapterTitle: historyData.story.chapterTitle,
              reasoning: historyData.story.reasoning,
              thinking: historyData.story.thinking,
              collectorResults: historyData.story.collectorResults,
              collectorOutline: historyData.story.collectorOutline,
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

          const { startStory } = get()
          if (!hasProlog && startStory) {
            const prologTurn: GalStoryTurn = {
              id: 0,
              type: 'story',
              story: [{
                idx: 0,
                type: 'narrative',
                speaker_creature_id: null,
                content: [startStory],
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
