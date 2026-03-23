import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { showConfirm } from '../../../components/AlertDialog'
import { useGameStore } from '../stores/gameStore'
import { useUIStore } from '../stores/uiStore'
import { refreshAllGameData } from '../stores/refreshCoordinator'
import { useModalStore } from '../stores/modalStore'
import { useHighlightEntities } from '../hooks'
import { useTypewriter } from '../hooks/useTypewriter'
import type { StoryTurn, PlayerChoice, InkTurn, PlayerActionTurn } from '../types'
import { isStoryTurn, isPlayerActionTurn, isErrorTurn } from '../types'
import {
  CollapsibleSection,
  CollectorResultsSection,
  ReasoningSection,
  ThinkingSection,
  ChangeSuggestionsSection,
  UpdateGameStateSection
} from './CollapsibleSections'
import { FormUI } from './FormUI'
import { parseFormUI, formatFormUIResult } from '../utils/formUIDSL'
import type { FormUIResult } from '../utils/formUIDSL'

interface InkFlowProps {
  scrollToBottom: (force: boolean) => void
}

// Strip paragraph markers like 【A1】【A2】【B1】【B2】 from LLM output
const stripParagraphMarkers = (text: string): string =>
  text.replace(/【[A-Z]\d+】/g, '')

// ─── Story Block with Typewriter ───────────────────────────────────────

export function StoryBlock({ turn, scrollToBottom }: { turn: StoryTurn; scrollToBottom: (force: boolean) => void }) {
  const { t } = useTranslation('game')
  const currentPhase = useGameStore(s => s.currentPhase)
  const pendingChoiceTurnId = useGameStore(s => s.pendingChoiceTurnId)
  const playerInput = useGameStore(s => s.playerInput)
  const showCustomInput = useGameStore(s => s.showCustomInput)
  const setPlayerInput = useGameStore(s => s.setPlayerInput)
  const setShowCustomInput = useGameStore(s => s.setShowCustomInput)
  const handleChoiceSelect = useGameStore(s => s.handleChoiceSelect)
  const handleCustomInput = useGameStore(s => s.handleCustomInput)
  const rewindToTurn = useGameStore(s => s.rewindToTurn)
  const regenerateStory = useGameStore(s => s.regenerateStory)
  const oocInstructions = useGameStore(s => s.oocInstructions)
  const addOOCInstruction = useGameStore(s => s.addOOCInstruction)
  const updateOOCInstruction = useGameStore(s => s.updateOOCInstruction)
  const removeOOCInstruction = useGameStore(s => s.removeOOCInstruction)

  const diceState = useGameStore(s => s.diceState)
  const rollDice = useGameStore(s => s.rollDice)
  const retryDice = useGameStore(s => s.retryDice)
  const confirmDiceResult = useGameStore(s => s.confirmDiceResult)
  const cancelDice = useGameStore(s => s.cancelDice)

  const { highlightCreatureNames } = useHighlightEntities()
  const typewriterSpeed = useUIStore(s => s.typewriterSpeed)

  // OOC Instruction form state
  const [oocFormOpen, setOocFormOpen] = useState(false)
  const [oocEditId, setOocEditId] = useState<string | null>(null) // null = adding new
  const [oocContent, setOocContent] = useState('')
  const [oocDurationType, setOocDurationType] = useState<'permanent' | 'turns'>('permanent')
  const [oocDurationTurns, setOocDurationTurns] = useState(3)

  const openOocForm = useCallback((editId?: string) => {
    if (editId) {
      const inst = oocInstructions.find(i => i.id === editId)
      if (inst) {
        setOocEditId(editId)
        setOocContent(inst.content)
        setOocDurationType(inst.duration === null ? 'permanent' : 'turns')
        setOocDurationTurns(inst.duration ?? 3)
      }
    } else {
      setOocEditId(null)
      setOocContent('')
      setOocDurationType('permanent')
      setOocDurationTurns(3)
    }
    setOocFormOpen(true)
  }, [oocInstructions])

  const submitOocForm = useCallback(() => {
    if (!oocContent.trim()) return
    const dur = oocDurationType === 'permanent' ? null : oocDurationTurns
    if (oocEditId) {
      updateOOCInstruction(oocEditId, oocContent.trim(), dur)
    } else {
      addOOCInstruction(oocContent.trim(), dur)
    }
    setOocFormOpen(false)
    setOocContent('')
    setOocEditId(null)
  }, [oocContent, oocDurationType, oocDurationTurns, oocEditId, addOOCInstruction, updateOOCInstruction])

  // Typewriter
  const isTypewriterActive = turn.typewriterEnabled === true

  const tw1 = useTypewriter(turn.content?.toString() || '', isTypewriterActive, typewriterSpeed)

  // One-way latch: once tw1 has real content and completes, tw2 starts and never stops
  const tw1EverCompleteRef = useRef(false)
  if (tw1.isComplete && (turn.content || '').length > 0) {
    tw1EverCompleteRef.current = true
  }
  const tw2 = useTypewriter(turn.contentPart2?.toString() || '', isTypewriterActive && tw1EverCompleteRef.current, typewriterSpeed)
  const typewriterComplete = tw1.isComplete && tw2.isComplete

  // Auto-scroll during typewriter animation
  const prevVisibleLenRef = useRef(0)
  const currentVisibleLen = tw1.visibleText.length + tw2.visibleText.length
  useEffect(() => {
    if (isTypewriterActive && currentVisibleLen > prevVisibleLenRef.current) {
      scrollToBottom(false)
    }
    prevVisibleLenRef.current = currentVisibleLen
  }, [currentVisibleLen, isTypewriterActive, scrollToBottom])

  // Rewind handler
  const handleRewind = useCallback(async () => {
    if (!turn.checkpointId) return
    if (!await showConfirm(t('ink.rewind.confirmTitle'))) return

    try {
      await window.LoadGameSave(turn.checkpointId)
      rewindToTurn(turn.id)
      await refreshAllGameData()
    } catch (e) {
      console.error('Failed to load checkpoint:', e)
      alert(t('ink.rewind.loadFailed') + (e as Error).message)
    }
  }, [turn, rewindToTurn, t])

  // Regenerate: check if the previous story turn has a checkpointId
  const canRegenerate = useGameStore(s => {
    if (!turn.relatedActionId) return false
    const idx = s.inkTurns.findIndex(t => t.id === turn.id)
    if (idx < 0) return false
    const prevTurns = s.inkTurns.slice(0, idx)
    return prevTurns.some(t => isStoryTurn(t) && !!(t as StoryTurn).checkpointId)
  })

  const handleRegenerate = useCallback(async () => {
    if (!canRegenerate) return
    if (!await showConfirm(t('ink.regenerate.confirmTitle'))) return
    await regenerateStory(turn.id, scrollToBottom)
  }, [canRegenerate, turn.id, regenerateStory, scrollToBottom, t])

  // Publish checkpoint handler
  const openPublishCheckpointModal = useModalStore(s => s.openPublishCheckpointModal)
  const handlePublishCheckpoint = useCallback(() => {
    if (!turn.checkpointId) return
    openPublishCheckpointModal(turn.checkpointId)
  }, [turn.checkpointId, openPublishCheckpointModal])

  // Rewrite history handler
  const openRewriteModal = useModalStore(s => s.openRewriteModal)
  const hasLaterStoryTurns = useGameStore(s =>
    s.inkTurns.some(t => t.id > turn.id && isStoryTurn(t) && (t as StoryTurn).generationPhase === 'done')
  )

  // Should we show the interaction area (choices + custom input)?
  const showInteraction = turn.generationPhase === 'done'
    && typewriterComplete
    && pendingChoiceTurnId === turn.id

  // Are there actual choices to render?
  const hasChoices = !!(turn.playerChoices && turn.playerChoices.length > 0)

  // Parse FormUI DSL (if present)
  const parsedFormUI = useMemo(
    () => turn.formUI ? parseFormUI(turn.formUI) : null,
    [turn.formUI]
  )

  const [formUISubmitted, setFormUISubmitted] = useState(false)

  const handleFormUISubmit = useCallback((result: FormUIResult) => {
    if (!parsedFormUI) return
    setFormUISubmitted(true)
    const actionText = formatFormUIResult(parsedFormUI, result)
    handleCustomInput(actionText, turn.id, scrollToBottom)
  }, [parsedFormUI, handleCustomInput, turn.id, scrollToBottom])

  return (
    <div className={`story-block ${turn.generationPhase === 'done' ? 'complete' : 'generating'}`}>
      {/* 章节标题 */}
      {(turn.chapterHint || turn.generationPhase !== 'done') && (
        <div className="chapter-header">
          <div className="chapter-hint">
            {turn.chapterHint || t('ink.generating')}
          </div>
        </div>
      )}

      {/* RAG 收集器结果 */}
      <CollectorResultsSection turn={turn} />

      {/* 模型推理过程 */}
      <ReasoningSection turn={turn} />

      {/* 思考过程 */}
      <ThinkingSection turn={turn} />

      {/* 小说内容 - 第一节 */}
      {tw1.visibleText && (
        <div
          className={`novel-content${isTypewriterActive && !tw1.isComplete ? ' typewriter-active' : ''}`}
        >
          {tw1.visibleText.split('\n').map((para, idx) => (
            <p key={`${turn.id}-${idx}`}>{highlightCreatureNames(stripParagraphMarkers(para))}</p>
          ))}
        </div>
      )}

      {/* 小说内容 - 第二节 */}
      {tw1.isComplete && tw2.visibleText && (
        <>
          <div className="story-divider">• • •</div>
          <div
            className={`novel-content story-content-part2${isTypewriterActive && !tw2.isComplete ? ' typewriter-active' : ''}`}
          >
            {tw2.visibleText.split('\n').map((para, idx) => (
              <p key={`${turn.id}-part2-${idx}`}>{highlightCreatureNames(stripParagraphMarkers(para))}</p>
            ))}
          </div>
        </>
      )}

      {/* 状态与设定变更建议 */}
      {turn.generationPhase === 'done' && typewriterComplete && <ChangeSuggestionsSection turn={turn} />}

      {/* 游戏状态更新结果 */}
      {turn.generationPhase === 'done' && typewriterComplete && <UpdateGameStateSection turn={turn} />}

      {/* 导演笔记 */}
      {turn.generationPhase === 'done' && typewriterComplete && turn.directorNotes && (turn.directorNotes.notes?.length > 0 || turn.directorNotes.flags?.length > 0 || turn.directorNotes.stage_goal) && (
        <CollapsibleSection
          sectionId={`director-${turn.id}`}
          title={t('ink.sections.directorNotes')}
          autoCollapsed={true}
          icon="🎬"
          className="director-section"
        >
          <div className="next-direction-text">
            {turn.directorNotes.stage_goal && (
              <div style={{ fontWeight: 600, marginBottom: turn.directorNotes.notes?.length ? 4 : 0 }}>
                {turn.directorNotes.stage_goal}
              </div>
            )}
            {turn.directorNotes.notes && turn.directorNotes.notes.length > 0 && (
              <div className="director-notes-notes">
                {turn.directorNotes.notes.map((note, i) => (
                  <div key={i}>{note}</div>
                ))}
              </div>
            )}
            {turn.directorNotes.flags && turn.directorNotes.flags.length > 0 && (
              <div className="director-notes-flags">
                {turn.directorNotes.flags.map((flag, i) => (
                  <div key={`flag-${i}`} style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                    {flag.value ? '' : ''} <code>{flag.id}</code>{flag.remark ? ` — ${flag.remark}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* 掷骰判定面板 */}
      {currentPhase === 'dice-rolling' && diceState && diceState.storyTurnId === turn.id && (
        <div className="dice-roll-container">
          <div className="dice-header">
            <span className="dice-icon"></span>
            <span className="dice-title">{t('ink.dice.title')}</span>
          </div>

          {/* 选项信息 */}
          <div className="dice-choice-info">
            <div className="dice-choice-name">{diceState.choice.name}: {diceState.choice.description}</div>
            {diceState.choice.difficulty_reason && (
              <div className="dice-reason">{diceState.choice.difficulty_reason}</div>
            )}
          </div>

          {/* 难度条 */}
          <div className="dice-difficulty-section">
            <div className="dice-difficulty-label">
              <span>{t('ink.dice.difficulty')}</span>
              <span className="dice-difficulty-value">{diceState.choice.difficulty_level}/100</span>
            </div>
            <div className="dice-difficulty-bar">
              <div
                className="dice-difficulty-fill"
                style={{ width: `${diceState.choice.difficulty_level}%` }}
              />
              {diceState.roll !== null && (
                <div
                  className={`dice-roll-marker ${diceState.roll >= diceState.choice.difficulty_level! ? 'success' : 'fail'}`}
                  style={{ left: `${diceState.roll}%` }}
                />
              )}
              {diceState.retryRoll !== null && (
                <div
                  className={`dice-roll-marker retry ${diceState.retryRoll >= diceState.choice.difficulty_level! ? 'success' : 'fail'}`}
                  style={{ left: `${diceState.retryRoll}%` }}
                />
              )}
            </div>
          </div>

          {/* 掷骰区域 */}
          <div className="dice-action-area">
            {diceState.phase === 'ready' && (
              <button className="dice-roll-btn" onClick={rollDice}>
                {t('ink.dice.roll')}
              </button>
            )}

            {(diceState.phase === 'rolling' || diceState.phase === 'retrying') && (
              <div className="dice-rolling-animation">
                <span className="dice-spinning"></span>
                <span>{t('ink.dice.rolling')}</span>
              </div>
            )}

            {(diceState.phase === 'result' || diceState.phase === 'retry-result') && (() => {
              const currentRoll = diceState.retryRoll ?? diceState.roll!
              const difficulty = diceState.choice.difficulty_level!
              const isSuccess = currentRoll >= difficulty
              return (
                <div className="dice-result-area">
                  {/* 首次结果 */}
                  {diceState.roll !== null && (
                    <div className={`dice-result-display ${diceState.retryRoll !== null ? 'superseded' : (diceState.roll >= difficulty ? 'success' : 'fail')}`}>
                      <span className="dice-result-number">{diceState.roll}</span>
                      {diceState.retryRoll === null && (
                        <span className="dice-result-label">{diceState.roll >= difficulty ? t('ink.dice.success') : t('ink.dice.fail')}</span>
                      )}
                      {diceState.retryRoll !== null && (
                        <span className="dice-result-label superseded-label">{t('ink.dice.first')}</span>
                      )}
                    </div>
                  )}
                  {/* 重试结果 */}
                  {diceState.retryRoll !== null && (
                    <div className={`dice-result-display ${diceState.retryRoll >= difficulty ? 'success' : 'fail'}`}>
                      <span className="dice-result-number">{diceState.retryRoll}</span>
                      <span className="dice-result-label">{diceState.retryRoll >= difficulty ? t('ink.dice.success') : t('ink.dice.fail')}</span>
                    </div>
                  )}

                  <div className="dice-result-actions">
                    {/* 重试按钮：仅首次失败且未重试过时显示 */}
                    {diceState.phase === 'result' && !isSuccess && diceState.retryRoll === null && (
                      <button className="dice-retry-btn" onClick={retryDice}>
                        {t('ink.dice.retry')}
                      </button>
                    )}
                    <button className="dice-confirm-btn" onClick={confirmDiceResult}>
                      {isSuccess ? t('ink.dice.continueAdventure') : t('ink.dice.acceptFate')}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>

          <button className="dice-cancel-btn" onClick={cancelDice}>
            {t('ink.dice.backToChoices')}
          </button>
        </div>
      )}

      {/* 存档点分割线、时光倒流和重新生成按钮 */}
      {turn.generationPhase === 'done' && (turn.checkpointId || canRegenerate) && (
        <div className="checkpoint-divider">
          <div className="divider-line"></div>
          {turn.checkpointId && (
            <button
              className="rewind-button"
              onClick={handleRewind}
              title={t('ink.rewind.buttonTitle')}
            >
              {t('ink.rewind.buttonText')}
            </button>
          )}
          {turn.checkpointId && hasLaterStoryTurns && (
            <button
              className="rewrite-history-button"
              onClick={() => openRewriteModal(turn.id)}
              title={t('ink.rewrite.buttonTitle')}
            >
              {t('ink.rewrite.buttonText')}
            </button>
          )}
          {turn.checkpointId && (
            <button
              className="publish-checkpoint-button"
              onClick={handlePublishCheckpoint}
              title={t('ink.publishCheckpoint.buttonTitle')}
            >
              {t('ink.publishCheckpoint.buttonText')}
            </button>
          )}
          {canRegenerate && (
            <button
              className="regenerate-button"
              onClick={handleRegenerate}
              title={t('ink.regenerate.buttonTitle')}
              disabled={currentPhase === 'generating-story' || currentPhase === 'updating-state'}
            >
              {t('ink.regenerate.buttonText')}
            </button>
          )}
        </div>
      )}


      {/* 玩家交互区域（FormUI + 选项 + 自定义输入） */}
      {showInteraction && currentPhase !== 'dice-rolling' && (
        <div className="player-choices-container">
          {/* FormUI 表单（商店/技能消耗等，由 LLM 生成的 DSL） */}
          {parsedFormUI && !formUISubmitted && (
            <FormUI
              parsed={parsedFormUI}
              disabled={currentPhase !== 'waiting-choice'}
              onSubmit={handleFormUISubmit}
            />
          )}

          {/* 选项列表（仅当 AI 返回了选项时显示；与 FormUI 互斥） */}
          {hasChoices && !parsedFormUI && (
            <>
              <div className="choices-header">
                <span className="choices-icon"></span>
                <span className="choices-title">{t('ink.choices.title')}</span>
              </div>
              <div className="choices-list">
                {turn.playerChoices!.map((choice, idx) => (
                  <button
                    key={idx}
                    className={`choice-button ${choice.is_special ? 'special' : ''} ${choice.difficulty_level ? 'has-dice' : ''}`}
                    onClick={() => handleChoiceSelect(choice, turn.id, scrollToBottom)}
                    disabled={currentPhase !== 'waiting-choice'}
                  >
                    <div className="choice-name">
                      {choice.is_special && <span className="special-badge"></span>}
                      {choice.difficulty_level != null && choice.difficulty_level > 0 && <span className="dice-badge"></span>}
                      {choice.name}
                    </div>
                    <div className="choice-description">{choice.description}</div>
                    {choice.difficulty_level != null && choice.difficulty_level > 0 && (
                      <div className="choice-difficulty-hint">
                        <span className="difficulty-tag">{t('ink.dice.difficultyTag', { level: choice.difficulty_level })}</span>
                        {choice.difficulty_reason && <span className="difficulty-reason">{choice.difficulty_reason}</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 无选项时的提示（FormUI 存在时不显示） */}
          {!hasChoices && !parsedFormUI && (
            <div className="no-choices-hint">
              <span>{t('ink.choices.noChoicesHint')}</span>
            </div>
          )}

          {/* OOC 指令区域 */}
          <div className="ooc-instructions-section">
            {oocInstructions.length > 0 && (
              <div className="ooc-instructions-list">
                <div className="ooc-instructions-header">
                  <span className="ooc-instructions-title">🎬 {t('ink.ooc.title')}</span>
                </div>
                {oocInstructions.map(inst => (
                  <div key={inst.id} className="ooc-instruction-card">
                    <div className="ooc-instruction-content">{inst.content}</div>
                    <div className="ooc-instruction-meta">
                      <span className="ooc-instruction-duration">
                        {inst.duration === null ? t('ink.ooc.permanent') : t('ink.ooc.turnsLeft', { count: inst.duration })}
                      </span>
                      <button className="ooc-instruction-edit-btn" onClick={() => openOocForm(inst.id)} disabled={currentPhase !== 'waiting-choice'}>✏️</button>
                      <button className="ooc-instruction-delete-btn" onClick={() => removeOOCInstruction(inst.id)} disabled={currentPhase !== 'waiting-choice'}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {oocFormOpen ? (
              <div className="ooc-form">
                <textarea
                  value={oocContent}
                  onChange={(e) => setOocContent(e.target.value)}
                  placeholder={t('ink.ooc.placeholder')}
                  disabled={currentPhase !== 'waiting-choice'}
                  rows={2}
                  autoFocus
                />
                <div className="ooc-form-options">
                  <label className="ooc-duration-option">
                    <input type="radio" checked={oocDurationType === 'permanent'} onChange={() => setOocDurationType('permanent')} />
                    {t('ink.ooc.permanent')}
                  </label>
                  <label className="ooc-duration-option">
                    <input type="radio" checked={oocDurationType === 'turns'} onChange={() => setOocDurationType('turns')} />
                    {t('ink.ooc.forTurns')}
                    {oocDurationType === 'turns' && (
                      <input
                        type="number"
                        className="ooc-duration-input"
                        value={oocDurationTurns}
                        onChange={(e) => setOocDurationTurns(Math.max(1, parseInt(e.target.value) || 1))}
                        min={1}
                        max={99}
                      />
                    )}
                  </label>
                </div>
                <div className="ooc-form-actions">
                  <button className="ooc-cancel-btn" onClick={() => { setOocFormOpen(false); setOocEditId(null) }}>
                    {t('ink.ooc.cancel')}
                  </button>
                  <button className="ooc-confirm-btn" onClick={submitOocForm} disabled={!oocContent.trim()}>
                    {oocEditId ? t('ink.ooc.save') : t('ink.ooc.add')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="ooc-add-btn"
                onClick={() => openOocForm()}
                disabled={currentPhase !== 'waiting-choice'}
              >
                + {t('ink.ooc.addButton')}
              </button>
            )}
          </div>

          {/* 自定义输入区域 */}
          <div className="custom-input-section">
            {!showCustomInput ? (
              <button
                className="show-custom-input-btn"
                onClick={() => setShowCustomInput(true)}
                disabled={currentPhase !== 'waiting-choice'}
              >
                {t('ink.choices.customAction')}
              </button>
            ) : (
              <div className="custom-input-area">
                <textarea
                  value={playerInput}
                  onChange={(e) => setPlayerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && currentPhase === 'waiting-choice') {
                      e.preventDefault()
                      handleCustomInput(playerInput, turn.id, scrollToBottom)
                    }
                  }}
                  placeholder={t('ink.choices.inputPlaceholder')}
                  disabled={currentPhase !== 'waiting-choice'}
                  rows={2}
                  autoFocus
                />
                <div className="custom-input-actions">
                  <button
                    className="cancel-btn"
                    onClick={() => {
                      setShowCustomInput(false)
                      setPlayerInput('')
                    }}
                  >
                    {t('ink.choices.cancel')}
                  </button>
                  <button
                    className="confirm-btn"
                    onClick={() => handleCustomInput(playerInput, turn.id, scrollToBottom)}
                    disabled={!playerInput.trim() || currentPhase !== 'waiting-choice'}
                  >
                    {t('ink.choices.confirm')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* 无内容时显示加载指示 */}
      {!turn.content && turn.generationPhase !== 'done' && !turn.thinking && !turn.collectorResults && (
        <div className="generating-placeholder">
          <div className="loading-spinner-small"></div>
          <span>{t('ink.preparing')}</span>
        </div>
      )}
    </div>
  )
}

// ─── Main InkFlow Component ────────────────────────────────────────────

const TURNS_PER_PAGE = 10;

export function InkFlow({ scrollToBottom }: InkFlowProps) {
  const { t } = useTranslation('game')
  const inkFlowRef = useRef<HTMLDivElement>(null)

  const inkTurns = useGameStore(s => s.inkTurns)
  const errorInfo = useGameStore(s => s.errorInfo)
  const setErrorInfo = useGameStore(s => s.setErrorInfo)

  const [visibleTurnsCount, setVisibleTurnsCount] = useState(TURNS_PER_PAGE)

  // 保证当产生新 turn 时始终可视最新的一批
  useEffect(() => {
    if (inkTurns.length > visibleTurnsCount) {
       // If there are more turns than visible minus 1 (meaning a new one was just added),
       // we auto-expand the visible count slightly or at least don't clip the new one
       setVisibleTurnsCount(Math.max(visibleTurnsCount, inkTurns.length - visibleTurnsCount + TURNS_PER_PAGE))
    }
  }, [inkTurns.length])

  const loadMoreTurns = useCallback(() => {
    setVisibleTurnsCount((prev: number) => prev + TURNS_PER_PAGE)
  }, [])

  const visibleTurns = inkTurns.slice(Math.max(0, inkTurns.length - visibleTurnsCount))
  const hasMoreTurns = inkTurns.length > visibleTurnsCount

  return (
    <div className="ink-flow" ref={inkFlowRef}>
      {hasMoreTurns && (
        <div className="load-more-turns">
          <button className="load-more-btn" onClick={loadMoreTurns}>
            ↑ {t('ink.loadEarlierStory', '加载更早的故事')} ({inkTurns.length - visibleTurnsCount})
          </button>
        </div>
      )}

      {visibleTurns.map((turn) => (
        <div key={turn.id} className={`ink-turn turn-${turn.type}`}>
          {turn.type === 'story' && (
            <StoryBlock turn={turn as StoryTurn} scrollToBottom={scrollToBottom} />
          )}

          {turn.type === 'action' && (() => {
            const actionTurn = turn as PlayerActionTurn
            return (
              <div className="action-block">
                <div className="action-label">
                  {t('ink.action.yourAction')}
                  {actionTurn.selectedChoice?.is_special && <span className="special-action-badge">{t('ink.action.special')}</span>}
                  {actionTurn.isCustomInput && <span className="custom-action-badge">{t('ink.action.custom')}</span>}
                  {actionTurn.diceResult && (
                    <span className={`dice-result-badge ${actionTurn.diceResult.success ? 'success' : 'fail'}`}>
                      {actionTurn.diceResult.roll}/{actionTurn.diceResult.difficulty} {actionTurn.diceResult.success ? t('ink.dice.success') : t('ink.dice.fail')}
                      {actionTurn.diceResult.retried && ` (${t('ink.dice.retried')})`}
                    </span>
                  )}
                </div>
                <div className="action-content">{actionTurn.playerAction}</div>
                {actionTurn.directorNote && (
                  <div className="action-ooc-note">
                    <span className="action-ooc-note-icon">🎬</span>
                    <span className="action-ooc-note-text">{actionTurn.directorNote}</span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* 错误块 */}
          {turn.type === 'error' && (
            <div className="error-turn-block">
              <div className="error-icon"></div>
              <div className="error-message">{(turn as any).errorMessage}</div>
              <div className="error-actions">
                {(turn as any).retryAction && (
                  <button className="retry-btn" onClick={(turn as any).retryAction}>
                    {t('ink.error.retry')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* 旧的错误提示（兼容） */}
      {errorInfo && (
        <div className="error-block">
          <div className="error-icon"></div>
          <div className="error-message">{errorInfo.message}</div>
          <div className="error-actions">
            <button className="retry-btn" onClick={errorInfo.retryAction}>
              {t('ink.error.retry')}
            </button>
            <button className="dismiss-btn" onClick={() => setErrorInfo(null)}>
              {t('ink.error.dismiss')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default InkFlow
