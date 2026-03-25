import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameStore } from '../stores/gameStore'
import { useCreatureStore } from '../stores/creatureStore'
import { useUIStore } from '../stores/uiStore'
import { useSpriteStore } from '../stores/spriteStore'
import { useHighlightEntities } from '../hooks'
import type { GalDialogue, PlayerChoice } from '../types'
import { isGalStoryTurn, isPlayerActionTurn, isErrorTurn } from '../types'

// ─── Prologue key constant (must match gameStore.ts) ────────────────────
const PROLOGUE_KEY = 'prologue'

// ─── Expression label keys ──────────────────────────────────────────────

const EXPRESSION_KEYS: Record<string, string> = {
  normal: 'galgame.expressions.normal',
  happy: 'galgame.expressions.happy',
  angry: 'galgame.expressions.angry',
  sad: 'galgame.expressions.sad',
  surprised: 'galgame.expressions.surprised',
  shy: 'galgame.expressions.shy',
  disgusted: 'galgame.expressions.disgusted',
  dazed: 'galgame.expressions.dazed',
}

// ─── VN 选项覆盖层 ─────────────────────────────────────────

function VNChoices({
  choices,
  currentPhase,
  showCustomInput,
  playerInput,
  onChoiceSelect,
  onCustomSubmit,
  setShowCustomInput,
  setPlayerInput,
}: {
  choices: PlayerChoice[]
  currentPhase: string
  showCustomInput: boolean
  playerInput: string
  onChoiceSelect: (choice: PlayerChoice) => void
  onCustomSubmit: () => void
  setShowCustomInput: (show: boolean) => void
  setPlayerInput: (input: string) => void
}) {
  const { t } = useTranslation('game')
  const disabled = currentPhase !== 'waiting-choice'

  return (
    <div className="vn-choices" onClick={(e) => e.stopPropagation()}>
      <div className="vn-choices-list">
        {choices.map((choice, idx) => (
          <button
            key={idx}
            className={`vn-choice-btn ${choice.is_special ? 'special' : ''}`}
            onClick={() => onChoiceSelect(choice)}
            disabled={disabled}
          >
            <div className="vn-choice-name">
              {choice.is_special && <span className="vn-special-badge">✦</span>}
              {choice.name}
            </div>
            <div className="vn-choice-desc">{choice.description}</div>
          </button>
        ))}
      </div>

      <div className="vn-custom-section">
        {!showCustomInput ? (
          <button
            className="vn-custom-toggle"
            onClick={() => setShowCustomInput(true)}
            disabled={disabled}
          >
            {t('galgame.choices.customAction')}
          </button>
        ) : (
          <div className="vn-custom-input">
            <textarea
              value={playerInput}
              onChange={(e) => setPlayerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !disabled) {
                  e.preventDefault()
                  onCustomSubmit()
                }
              }}
              placeholder={t('galgame.choices.inputPlaceholder')}
              rows={2}
              autoFocus
            />
            <div className="vn-custom-actions">
              <button onClick={() => setShowCustomInput(false)}>{t('galgame.choices.cancel')}</button>
              <button
                className="vn-custom-submit"
                onClick={onCustomSubmit}
                disabled={!playerInput.trim() || disabled}
              >
                {t('galgame.choices.confirm')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── VN 历史记录抽屉 ───────────────────────────────────────

function VNLogDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('game')
  const galTurns = useGameStore(s => s.galTurns)
  const { highlightEntitiesInText } = useHighlightEntities()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  return (
    <div className="vn-log-drawer" onClick={(e) => e.stopPropagation()}>
      <div className="vn-log-header">
        <span className="vn-log-title">{t('galgame.log.title')}</span>
        <button className="vn-log-close" onClick={onClose}>×</button>
      </div>
      <div className="vn-log-content" ref={scrollRef}>
        {galTurns.map((turn) => {
          if (isGalStoryTurn(turn)) {
            return (
              <div key={turn.id} className="vn-log-turn">
                {turn.chapterTitle && (
                  <div className="vn-log-chapter">{turn.chapterTitle === PROLOGUE_KEY ? t('galgame.startGame.prologue') : turn.chapterTitle}</div>
                )}
                {(turn.story || []).map((d, idx) => (
                  <div
                    key={`${turn.id}-${idx}`}
                    className={`vn-log-line ${!d.speaker_creature_id ? 'is-narration' : ''}`}
                  >
                    {d.speaker_creature_id ? (
                      <>
                        <span className="vn-log-speaker">
                          {d.speaker_display_name}
                          {d.expression && d.expression !== 'normal' && (
                            <span className="vn-log-expression">
                              ({EXPRESSION_KEYS[d.expression] ? t(EXPRESSION_KEYS[d.expression]) : d.expression})
                            </span>
                          )}
                        </span>
                        <span className="vn-log-dialogue">
                          {highlightEntitiesInText(d.dialogue || '', `log-${turn.id}-${idx}`)}
                        </span>
                      </>
                    ) : (
                      <span className="vn-log-narration">
                        {highlightEntitiesInText(d.dialogue || '', `log-${turn.id}-${idx}`)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          }

          if (isPlayerActionTurn(turn)) {
            return (
              <div key={turn.id} className="vn-log-action">
                <span className="vn-log-action-label">{t('galgame.log.yourAction')}</span>
                <span className="vn-log-action-text">{turn.playerAction}</span>
              </div>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}

// ─── VN 设置面板 ────────────────────────────────────────────

function VNSettingsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('game')
  const dialogueCount = useUIStore(s => s.dialogueCount)
  const setDialogueCount = useUIStore(s => s.setDialogueCount)
  const typewriterSpeed = useUIStore(s => s.typewriterSpeed)
  const setTypewriterSpeed = useUIStore(s => s.setTypewriterSpeed)
  const autoPlayDelay = useUIStore(s => s.autoPlayDelay)
  const setAutoPlayDelay = useUIStore(s => s.setAutoPlayDelay)
  const clearStoryHistory = useGameStore(s => s.clearStoryHistory)

  return (
    <div className="vn-settings-panel" onClick={(e) => e.stopPropagation()}>
      <div className="vn-settings-header">
        <span>{t('galgame.settings.title')}</span>
        <button onClick={onClose}>×</button>
      </div>
      <div className="vn-settings-body">
        <div className="vn-setting-row">
          <label>{t('galgame.settings.typewriterSpeed')}</label>
          <div className="vn-setting-control">
            <input
              type="range"
              min={20}
              max={120}
              step={10}
              value={typewriterSpeed}
              onChange={(e) => setTypewriterSpeed(Number(e.target.value))}
            />
            <span className="vn-setting-value">{t('galgame.settings.typewriterSpeedUnit', { speed: typewriterSpeed })}</span>
          </div>
        </div>
        <div className="vn-setting-row">
          <label>{t('galgame.settings.autoPlayDelay')}</label>
          <div className="vn-setting-control">
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={autoPlayDelay}
              onChange={(e) => setAutoPlayDelay(Number(e.target.value))}
            />
            <span className="vn-setting-value">{t('galgame.settings.autoPlayDelayUnit', { delay: autoPlayDelay })}</span>
          </div>
        </div>
        <div className="vn-setting-row">
          <label>{t('galgame.settings.dialogueLines')}</label>
          <div className="vn-setting-control">
            <input
              type="range"
              min={20}
              max={40}
              value={dialogueCount}
              onChange={(e) => setDialogueCount(Number(e.target.value))}
            />
            <span className="vn-setting-value">{t('galgame.settings.dialogueLinesUnit', { count: dialogueCount })}</span>
          </div>
        </div>
        <div className="vn-setting-divider" />
        <button className="vn-setting-danger" onClick={clearStoryHistory}>
          {t('galgame.settings.clearHistory')}
        </button>
      </div>
    </div>
  )
}

// ─── VN 主展示器 ────────────────────────────────────────────

export function VNPresenter() {
  const { t } = useTranslation('game')
  const galTurns = useGameStore(s => s.galTurns)
  const currentPhase = useGameStore(s => s.currentPhase)
  const pendingChoiceTurnId = useGameStore(s => s.pendingChoiceTurnId)
  const handleChoiceSelect = useGameStore(s => s.handleChoiceSelect)
  const handleCustomInput = useGameStore(s => s.handleCustomInput)
  const playerInput = useGameStore(s => s.playerInput)
  const setPlayerInput = useGameStore(s => s.setPlayerInput)
  const showCustomInput = useGameStore(s => s.showCustomInput)
  const setShowCustomInput = useGameStore(s => s.setShowCustomInput)

  const playerEntity = useCreatureStore(s => s.playerEntity)
  const gameTime = useCreatureStore(s => s.gameTime)

  const typewriterSpeed = useUIStore(s => s.typewriterSpeed)
  const autoPlay = useUIStore(s => s.autoPlay)
  const toggleAutoPlay = useUIStore(s => s.toggleAutoPlay)
  const autoPlayDelay = useUIStore(s => s.autoPlayDelay)
  const showLog = useUIStore(s => s.showLog)
  const toggleLog = useUIStore(s => s.toggleLog)
  const setShowLog = useUIStore(s => s.setShowLog)
  const showSettings = useUIStore(s => s.showSettings)
  const toggleSettings = useUIStore(s => s.toggleSettings)
  const setShowSettings = useUIStore(s => s.setShowSettings)

  const { highlightEntitiesInText } = useHighlightEntities()

  // ─── Extract story turns ────────────────────
  const storyTurns = useMemo(
    () => galTurns.filter(isGalStoryTurn),
    [galTurns]
  )

  // ─── Current presenting turn = last story turn ──
  const currentTurn = storyTurns.length > 0
    ? storyTurns[storyTurns.length - 1]
    : undefined
  const dialogues = currentTurn?.story || []

  // ─── Dialogue index within current turn ─────
  const [dialogueIdx, setDialogueIdx] = useState(0)
  const [typedPos, setTypedPos] = useState(0)
  const [isSkipped, setIsSkipped] = useState(false)

  // Track the "dialogue key" to reset typewriter synchronously during render
  // This prevents the 1-frame flicker caused by async useEffect resets
  const [prevDialogueKey, setPrevDialogueKey] = useState('')
  const dialogueKey = `${currentTurn?.id ?? 'none'}-${dialogueIdx}`

  const initializedRef = useRef(false)
  const prevTurnIdRef = useRef<number | null>(null)

  // ─── Initialize: jump to end of loaded history ──
  useEffect(() => {
    if (initializedRef.current || !currentTurn) return
    initializedRef.current = true
    prevTurnIdRef.current = currentTurn.id

    if (currentTurn.generationPhase === 'done') {
      const lastIdx = Math.max(0, dialogues.length - 1)
      setDialogueIdx(lastIdx)
      setIsSkipped(true)
      setTypedPos((dialogues[lastIdx]?.dialogue || '').length)
      setPrevDialogueKey(`${currentTurn.id}-${lastIdx}`)
    }
  }, [currentTurn, dialogues, storyTurns.length])

  // ─── Detect new story turn ──────────────────
  useEffect(() => {
    if (!initializedRef.current || !currentTurn) return

    if (currentTurn.id !== prevTurnIdRef.current) {
      prevTurnIdRef.current = currentTurn.id
      setDialogueIdx(0)
      setTypedPos(0)
      setIsSkipped(false)
      setPrevDialogueKey(`${currentTurn.id}-0`)
    }
  }, [currentTurn?.id])

  // ─── Current dialogue ───────────────────────
  const currentDialogue = dialogues[dialogueIdx] as GalDialogue | undefined
  const dialogueText = currentDialogue?.dialogue || ''

  // ─── Synchronous typewriter reset on dialogue change ──
  // React 18: calling setState during render triggers an immediate re-render
  // before committing, so no intermediate frame is painted.
  if (dialogueKey !== prevDialogueKey && initializedRef.current) {
    setPrevDialogueKey(dialogueKey)
    setTypedPos(0)
    setIsSkipped(false)
  }

  // ─── Typewriter ─────────────────────────────
  const isTyping = !isSkipped && dialogueText.length > 0 && typedPos < dialogueText.length
  const isComplete = isSkipped || typedPos >= dialogueText.length
  const displayText = isSkipped ? dialogueText : dialogueText.slice(0, typedPos)

  useEffect(() => {
    if (isSkipped || !dialogueText || typedPos >= dialogueText.length) return
    const charsPerUpdate = Math.max(1, Math.round(typewriterSpeed * 50 / 1000))
    const interval = setInterval(() => {
      setTypedPos(p => Math.min(p + charsPerUpdate, dialogueText.length))
    }, 50)
    return () => clearInterval(interval)
  }, [isSkipped, dialogueText, typedPos, typewriterSpeed])

  // ─── Derived state ──────────────────────────
  const isGenerating = currentPhase === 'generating-story'
  const isUpdating = currentPhase === 'updating-state'
  const turnDone = currentTurn?.generationPhase === 'done'
  const atLastDialogue = dialogueIdx >= dialogues.length - 1

  const showChoices = turnDone && atLastDialogue && isComplete &&
    currentTurn?.playerChoices && currentTurn.playerChoices.length > 0 &&
    pendingChoiceTurnId === currentTurn?.id

  const playerCreatureId = playerEntity?.Creature?.creature_id || ''
  const isPlayerSpeaking = !!currentDialogue?.speaker_creature_id &&
    currentDialogue.speaker_creature_id === playerCreatureId
  const isNarration = !currentDialogue?.speaker_creature_id
  const depiction = currentDialogue?.depiction
  const chapterTitle = currentTurn?.chapterTitle

  // ─── Character sprite ─────────────────────
  const getSpriteUrl = useSpriteStore(s => s.getSpriteUrl)
  const spriteUrl = currentDialogue?.speaker_creature_id
    ? getSpriteUrl(currentDialogue.speaker_creature_id, currentDialogue.expression)
    : null

  // Fade transition when sprite changes
  const prevSpriteRef = useRef<string | null>(null)
  const [displaySpriteUrl, setDisplaySpriteUrl] = useState<string | null>(null)
  const [spriteVisible, setSpriteVisible] = useState(false)

  useEffect(() => {
    if (spriteUrl === prevSpriteRef.current) return
    setSpriteVisible(false)
    const timer = setTimeout(() => {
      setDisplaySpriteUrl(spriteUrl)
      prevSpriteRef.current = spriteUrl
      if (spriteUrl) {
        requestAnimationFrame(() => setSpriteVisible(true))
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [spriteUrl])

  // Waiting for first dialogue during generation
  const waitingForContent = isGenerating && dialogues.length === 0

  // Waiting for next dialogue (caught up to streaming)
  const waitingForMore = isGenerating && !turnDone &&
    dialogueIdx >= dialogues.length - 1 && isComplete && dialogues.length > 0

  // ─── Auto-play ──────────────────────────────
  useEffect(() => {
    if (!autoPlay || !isComplete || showChoices || waitingForContent) return

    const hasNext = dialogueIdx < dialogues.length - 1
    if (!hasNext) return

    const timer = setTimeout(() => {
      setDialogueIdx(d => d + 1)
    }, autoPlayDelay * 1000)
    return () => clearTimeout(timer)
  }, [autoPlay, isComplete, showChoices, waitingForContent, dialogueIdx, dialogues.length, autoPlayDelay])

  // ─── Skip mode ──────────────────────────────
  const [skipMode, setSkipMode] = useState(false)

  useEffect(() => {
    if (!skipMode) return

    // In skip mode, rapidly advance through dialogues
    if (isTyping) {
      setIsSkipped(true)
      setTypedPos(dialogueText.length)
      return
    }

    if (dialogueIdx < dialogues.length - 1) {
      const timer = setTimeout(() => {
        setDialogueIdx(d => d + 1)
      }, 50)
      return () => clearTimeout(timer)
    }

    // Reached end, stop skip
    if (turnDone || showChoices) {
      setSkipMode(false)
    }
  }, [skipMode, isTyping, dialogueIdx, dialogues.length, turnDone, showChoices, dialogueText.length])

  // ─── Click handler ──────────────────────────
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't advance if clicking entity highlights
    const target = e.target as HTMLElement
    if (target.closest('.creature-name-highlight, .organization-name-highlight, .location-name-highlight, .entry-name-highlight, .entry-button')) {
      return
    }

    if (showChoices) return

    if (isTyping) {
      setIsSkipped(true)
      setTypedPos(dialogueText.length)
      return
    }

    if (dialogueIdx < dialogues.length - 1) {
      setDialogueIdx(d => d + 1)
      return
    }
  }, [isTyping, dialogueIdx, dialogues.length, showChoices, dialogueText.length])

  // ─── Choice handlers ────────────────────────
  const noop = useCallback(() => {}, [])

  const onChoiceSelect = useCallback((choice: PlayerChoice) => {
    if (!currentTurn) return
    handleChoiceSelect(choice, currentTurn.id, noop)
  }, [currentTurn, handleChoiceSelect, noop])

  const onCustomSubmit = useCallback(() => {
    if (!currentTurn || !playerInput.trim()) return
    handleCustomInput(playerInput, currentTurn.id, noop)
  }, [currentTurn, playerInput, handleCustomInput, noop])

  // ─── Last error turn ────────────────────────
  const lastTurn = galTurns.length > 0 ? galTurns[galTurns.length - 1] : null
  const hasError = lastTurn && isErrorTurn(lastTurn)

  // ─── Render ─────────────────────────────────
  return (
    <>
      {/* Chapter title - pinned to top */}
      {chapterTitle && (
        <div className="vn-chapter" key={`ch-${currentTurn?.id}`}>
          <span className="vn-chapter-deco" />
          <span className="vn-chapter-text">{chapterTitle === PROLOGUE_KEY ? t('galgame.startGame.prologue') : chapterTitle}</span>
          <span className="vn-chapter-deco" />
        </div>
      )}

      {/* Scene Area */}
      <div className="vn-scene" onClick={handleClick}>
        <div className="vn-bg" />

        {/* Character Sprite */}
        {displaySpriteUrl && (
          <div className={`vn-sprite ${spriteVisible ? 'visible' : ''}`}>
            <img
              src={displaySpriteUrl}
              alt={currentDialogue?.speaker_display_name || ''}
              className="vn-sprite-img"
              draggable={false}
            />
          </div>
        )}

        {/* Depiction text */}
        {depiction && isComplete && (
          <div className="vn-depiction" key={`dep-${currentTurn?.id}-${dialogueIdx}`}>
            {highlightEntitiesInText(depiction, `dep-${currentTurn?.id}-${dialogueIdx}`)}
          </div>
        )}

        {/* Game time */}
        {gameTime && (
          <div className="vn-game-time">
            {t('galgame.time.format', { year: gameTime.year, month: gameTime.month, day: gameTime.day, hour: gameTime.hour, minute: gameTime.minute.toString().padStart(2, '0') })}
          </div>
        )}

        {/* Choices overlay */}
        {showChoices && (
          <VNChoices
            choices={currentTurn!.playerChoices!}
            currentPhase={currentPhase}
            showCustomInput={showCustomInput}
            playerInput={playerInput}
            onChoiceSelect={onChoiceSelect}
            onCustomSubmit={onCustomSubmit}
            setShowCustomInput={setShowCustomInput}
            setPlayerInput={setPlayerInput}
          />
        )}

        {/* Error overlay */}
        {hasError && (
          <div className="vn-error-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="vn-error-msg">{(lastTurn as any).errorMessage}</div>
            {(lastTurn as any).retryAction && (
              <button className="vn-error-retry" onClick={(lastTurn as any).retryAction}>
                {t('galgame.error.retry')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Text Box */}
      <div className="vn-textbox" onClick={handleClick}>
        {/* Dialogue progress */}
        {dialogues.length > 0 && (
          <div className="vn-progress">
            {dialogueIdx + 1} / {dialogues.length}
            {storyTurns.length > 1 && (
              <span className="vn-progress-turn">{t('galgame.status.turnCount', { count: storyTurns.length })}</span>
            )}
          </div>
        )}

        {waitingForContent ? (
          <div className="vn-waiting">
            <div className="vn-dots"><span /><span /><span /></div>
          </div>
        ) : currentDialogue ? (
          <>
            {/* Speaker line */}
            {!isNarration && (
              <div className={`vn-speaker ${isPlayerSpeaking ? 'is-player' : ''}`}>
                <span className="vn-speaker-name">
                  {isComplete
                    ? highlightEntitiesInText(currentDialogue.speaker_display_name, `sp-${currentTurn?.id}-${dialogueIdx}`)
                    : currentDialogue.speaker_display_name
                  }
                </span>
                {currentDialogue.expression && currentDialogue.expression !== 'normal' && (
                  <span className={`vn-expression expression-${currentDialogue.expression}`}>
                    {EXPRESSION_KEYS[currentDialogue.expression] ? t(EXPRESSION_KEYS[currentDialogue.expression]) : currentDialogue.expression}
                  </span>
                )}
              </div>
            )}

            {/* Dialogue text */}
            <div className={`vn-text ${isNarration ? 'is-narration' : ''} ${isPlayerSpeaking ? 'is-player' : ''}`}>
              {isComplete
                ? highlightEntitiesInText(dialogueText, `dl-${currentTurn?.id}-${dialogueIdx}`)
                : displayText
              }
            </div>

            {/* Click indicator */}
            {isComplete && !showChoices && !waitingForMore && (
              <div className="vn-indicator">▼</div>
            )}

            {/* Waiting for more streaming content */}
            {waitingForMore && (
              <div className="vn-indicator waiting">
                <div className="vn-dots"><span /><span /><span /></div>
              </div>
            )}
          </>
        ) : (
          <div className="vn-empty" />
        )}

        {/* Status bar */}
        {isUpdating && (
          <div className="vn-status">{t('galgame.status.updatingState')}</div>
        )}
      </div>

      {/* Controls */}
      <div className="vn-controls" onClick={(e) => e.stopPropagation()}>
        <button
          className={`vn-ctrl-btn ${autoPlay ? 'active' : ''}`}
          onClick={toggleAutoPlay}
          title={t('galgame.controls.autoPlay')}
        >
          Auto
        </button>
        <button
          className={`vn-ctrl-btn ${skipMode ? 'active' : ''}`}
          onClick={() => setSkipMode(!skipMode)}
          title={t('galgame.controls.skip')}
        >
          Skip
        </button>
        <button
          className={`vn-ctrl-btn ${showLog ? 'active' : ''}`}
          onClick={toggleLog}
          title={t('galgame.controls.log')}
        >
          Log
        </button>
        <button
          className="vn-ctrl-btn"
          onClick={toggleSettings}
          title={t('galgame.controls.settings')}
        >
          ⚙
        </button>
      </div>

      {/* Log Drawer */}
      {showLog && <VNLogDrawer onClose={() => setShowLog(false)} />}

      {/* Settings Panel */}
      {showSettings && <VNSettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  )
}

// Keep old export name for compatibility but redirect
export const GalStoryBlock = VNPresenter
