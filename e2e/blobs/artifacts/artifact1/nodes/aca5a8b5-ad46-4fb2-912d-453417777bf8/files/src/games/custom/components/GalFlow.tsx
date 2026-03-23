/**
 * VNPresenter — 视觉小说对话界面（一幕一页模式）
 *
 * - 每次只显示一幕内容，用户选择选项后生成新一幕
 * - 新一幕生成完毕后显示"查看下一幕"按钮
 * - 立绘根据 viewport 中心的说话者动态切换
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameStore } from '../stores/gameStore'
import { useCreatureStore } from '../stores/creatureStore'
import { useUIStore } from '../stores/uiStore'
import { useSpriteStore } from '../stores/spriteStore'
import { useRegistryStore } from '../stores/registryStore'
import { useHighlightEntities } from '../hooks'
import type { GalStoryTurn, PlayerChoice, StorySegment } from '../types'
import { isGalStoryTurn, isErrorTurn } from '../types'
import { TransparentImg } from './TransparentImg'

const PROLOGUE_KEY = 'prologue'

// ─── 单条消息组件（无打字机效果）────────────────────────────

interface SegmentMessageProps {
  segment: StorySegment
  isPlayer: boolean
  speakerName: string
  avatarUrl: string | null
  showAvatar: boolean
  showEmotion: boolean
  onAvatarClick?: (creatureId: string) => void
  highlightText: (text: string, key: string) => React.ReactNode
  keyPrefix: string
}

function SegmentMessage({
  segment,
  isPlayer,
  speakerName,
  avatarUrl,
  showAvatar,
  showEmotion,
  onAvatarClick,
  highlightText,
  keyPrefix,
}: SegmentMessageProps) {
  const { t } = useTranslation('game')

  // 将 content[] 展平为段落（按 \n 拆分）
  const paragraphs = useMemo(() => {
    const result: string[] = []
    for (const item of segment.content) {
      for (const line of item.split('\n')) {
        const trimmed = line.trim()
        if (trimmed) result.push(trimmed)
      }
    }
    return result
  }, [segment.content])

  // ── 叙事消息 ──
  if (segment.type === 'narrative') {
    return (
      <div className="vn-msg narrative" key={keyPrefix}>
        <div className="vn-narrative-box">
          {paragraphs.map((para, pi) => (
            <p key={`${keyPrefix}-p${pi}`} className="vn-narrative-para">
              {highlightText(para, `${keyPrefix}-p${pi}`)}
            </p>
          ))}
        </div>
      </div>
    )
  }

  // ── 对话消息 ──
  const side = isPlayer ? 'right' : 'left'

  return (
    <div
      className={`vn-msg message ${side} ${!showAvatar ? 'continuation' : ''}`}
      key={keyPrefix}
      data-speaker={segment.speaker_creature_id || undefined}
    >
      {/* 头像：仅首条显示 */}
      {showAvatar ? (
        <div
          className="vn-avatar-container"
          onClick={() => segment.speaker_creature_id && onAvatarClick?.(segment.speaker_creature_id)}
        >
          {avatarUrl ? (
            <TransparentImg className="vn-avatar-img" src={avatarUrl} alt={speakerName} draggable={false} />
          ) : (
            <div className="vn-avatar-fallback">
              {speakerName.charAt(0)}
            </div>
          )}
        </div>
      ) : (
        <div className="vn-avatar-spacer" />
      )}

      {/* 气泡 */}
      <div className="vn-bubble-wrapper">
        {showAvatar && <div className="vn-name-tag">{speakerName}</div>}
        <div className="vn-bubble">
          <span className="vn-bubble-text">
            {paragraphs.map((para, pi) => (
              <p key={`${keyPrefix}-p${pi}`} className="vn-bubble-para">
                {highlightText(para, `${keyPrefix}-p${pi}`)}
              </p>
            ))}
          </span>
        </div>
        {showEmotion && segment.emotion && segment.emotion !== 'normal' && (
          <span className={`vn-emotion-badge emotion-${segment.emotion}`}>
            {t(`galgame.expressions.${segment.emotion}`, segment.emotion)}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── 一幕的展示（无播放，直接全部显示）─────────────────────

interface ActPlayerProps {
  turn: GalStoryTurn
  playerCreatureId: string
  onAvatarClick: (creatureId: string) => void
  highlightText: (text: string, key: string) => React.ReactNode
}

// ── 将 segments 展平为气泡：每个 content 元素 = 一个气泡 ──
interface FlatBubble {
  key: string
  segment: StorySegment
  text: string
  isFirstOfGroup: boolean
  isLastOfGroup: boolean
}

function flattenSegments(segments: StorySegment[]): FlatBubble[] {
  const result: FlatBubble[] = []
  for (const seg of segments) {
    if (seg.type === 'narrative') {
      const lines: string[] = []
      for (const item of seg.content) {
        for (const line of item.split('\n')) {
          const trimmed = line.trim()
          if (trimmed) lines.push(trimmed)
        }
      }
      const text = lines.join('\n')
      if (text) {
        result.push({ key: `seg${seg.idx}`, segment: seg, text, isFirstOfGroup: true, isLastOfGroup: true })
      }
    } else {
      const items: string[] = []
      for (const item of seg.content) {
        for (const line of item.split('\n')) {
          const trimmed = line.trim()
          if (trimmed) items.push(trimmed)
        }
      }
      items.forEach((text, ci) => {
        const prev = result.length > 0 ? result[result.length - 1] : null
        const sameAsPrev = prev
          && prev.segment.type === 'dialogue'
          && prev.segment.speaker_creature_id === seg.speaker_creature_id
        result.push({
          key: `seg${seg.idx}-c${ci}`,
          segment: seg,
          text,
          isFirstOfGroup: ci === 0 && !sameAsPrev,
          isLastOfGroup: true,
        })
      })
    }
  }
  // 回填 isLastOfGroup
  for (let i = 0; i < result.length; i++) {
    if (result[i].segment.type !== 'dialogue') continue
    const next = i + 1 < result.length ? result[i + 1] : null
    const nextIsSame = next
      && next.segment.type === 'dialogue'
      && next.segment.speaker_creature_id === result[i].segment.speaker_creature_id
    result[i].isLastOfGroup = !nextIsSame
  }
  return result
}

function ActPlayer({
  turn,
  playerCreatureId,
  onAvatarClick,
  highlightText,
}: ActPlayerProps) {
  const { t } = useTranslation('game')
  const segments = turn.story || []
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const getAvatarUrl = useSpriteStore(s => s.getAvatarUrl)

  const bubbles = useMemo(() => flattenSegments(segments), [segments])

  return (
    <div className="vn-act">
      {/* 章节标题 */}
      {turn.chapterTitle && (
        <div className="vn-chapter-divider">
          <span className="vn-chapter-line" />
          <span className="vn-chapter-label">
            {turn.chapterTitle === PROLOGUE_KEY ? t('galgame.startGame.prologue') : turn.chapterTitle}
          </span>
          <span className="vn-chapter-line" />
        </div>
      )}

      {/* 消息列表 */}
      <div className="vn-messages">
        {bubbles.map((bubble) => {
          const seg = bubble.segment
          const isPlayer = seg.speaker_creature_id === playerCreatureId
          const speakerName = seg.speaker_creature_id
            ? (creaturesRegistry.get(seg.speaker_creature_id)?.name || seg.speaker_creature_id)
            : ''
          const avatarUrl = seg.speaker_creature_id
            ? getAvatarUrl(seg.speaker_creature_id, seg.emotion)
            : null

          const singleContentSeg: StorySegment = {
            ...seg,
            content: [bubble.text],
          }

          return (
            <SegmentMessage
              key={`${turn.id}-${bubble.key}`}
              segment={singleContentSeg}
              isPlayer={isPlayer}
              speakerName={speakerName}
              avatarUrl={avatarUrl}
              showAvatar={bubble.isFirstOfGroup}
              showEmotion={bubble.isLastOfGroup}
              onAvatarClick={onAvatarClick}
              highlightText={highlightText}
              keyPrefix={`${turn.id}-${bubble.key}`}
            />
          )
        })}

        {/* CG 图片 */}
        {turn.cg && (
          <div className="vn-msg narrative vn-cg-message">
            {turn.cgImageUrl ? (
              <img className="vn-cg-image" src={turn.cgImageUrl} alt="CG" draggable={false} />
            ) : (
              <div className="vn-cg-placeholder">
                <span className="vn-cg-icon">🖼</span>
                <span className="vn-cg-label">{t('galgame.cg.placeholder')}</span>
                <div className="vn-dots"><span /><span /><span /></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 选项面板 ────────────────────────────────────────────

function ChoicesPanel({
  choices,
  disabled,
  showCustomInput,
  playerInput,
  onChoiceSelect,
  onCustomSubmit,
  setShowCustomInput,
  setPlayerInput,
}: {
  choices: PlayerChoice[]
  disabled: boolean
  showCustomInput: boolean
  playerInput: string
  onChoiceSelect: (choice: PlayerChoice) => void
  onCustomSubmit: () => void
  setShowCustomInput: (show: boolean) => void
  setPlayerInput: (input: string) => void
}) {
  const { t } = useTranslation('game')

  return (
    <div className="vn-choices-panel">
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

// ─── 设置面板 ────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('game')
  const dialogueCount = useUIStore(s => s.dialogueCount)
  const setDialogueCount = useUIStore(s => s.setDialogueCount)
  const clearStoryHistory = useGameStore(s => s.clearStoryHistory)

  return (
    <div className="vn-settings-overlay" onClick={onClose}>
      <div className="vn-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="vn-settings-header">
          <span>{t('galgame.settings.title')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="vn-settings-body">
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
    </div>
  )
}

// ─── VN 主界面（一幕一页）────────────────────────────────

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
  const showSettings = useUIStore(s => s.showSettings)
  const setShowSettings = useUIStore(s => s.setShowSettings)
  const toggleSettings = useUIStore(s => s.toggleSettings)

  const { highlightEntitiesInText } = useHighlightEntities()

  // lazy ref for modalStore
  const openCreatureModalRef = useRef<(id: string) => void>(() => {})
  useEffect(() => {
    import('../stores/modalStore').then(mod => {
      openCreatureModalRef.current = mod.useModalStore.getState().openCreatureModal
    })
  }, [])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const getStandingUrl = useSpriteStore(s => s.getStandingUrl)

  const playerCreatureId = playerEntity?.Creature?.creature_id || ''

  // ── 提取故事回合 ──
  const storyTurns = useMemo(
    () => galTurns.filter(isGalStoryTurn),
    [galTurns]
  )

  // ── 一幕一页：当前查看的幕索引 ──
  const [viewingActIndex, setViewingActIndex] = useState(Math.max(0, storyTurns.length - 1))

  // 新一幕到来（生成完成）或历史恢复时，自动跳到最新幕
  const prevTurnCountRef = useRef(storyTurns.length)
  useEffect(() => {
    const prevCount = prevTurnCountRef.current
    prevTurnCountRef.current = storyTurns.length

    if (storyTurns.length > prevCount || (prevCount === 0 && storyTurns.length > 0)) {
      setViewingActIndex(storyTurns.length - 1)
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0
      }
    }
  }, [storyTurns.length])

  const currentTurn = storyTurns[viewingActIndex] as GalStoryTurn | undefined
  const isViewingLatest = viewingActIndex === storyTurns.length - 1
  const hasNewerAct = storyTurns.length > 0 && viewingActIndex < storyTurns.length - 1
  const newerActTitle = hasNewerAct ? storyTurns[viewingActIndex + 1]?.chapterTitle : undefined
  const hasPrevAct = viewingActIndex > 0
  const prevActTitle = hasPrevAct ? storyTurns[viewingActIndex - 1]?.chapterTitle : undefined

  // 最新一幕的状态
  const lastStoryTurn = storyTurns.length > 0 ? storyTurns[storyTurns.length - 1] : undefined

  // 是否展示选项（仅在查看最新幕时）
  const showChoices = isViewingLatest &&
    lastStoryTurn?.generationPhase === 'done' &&
    lastStoryTurn?.playerChoices && lastStoryTurn.playerChoices.length > 0 &&
    pendingChoiceTurnId === lastStoryTurn?.id

  // 是否正在生成
  const isGenerating = currentPhase === 'generating-story'
  const isUpdating = currentPhase === 'updating-state'

  // 错误
  const lastTurn = galTurns.length > 0 ? galTurns[galTurns.length - 1] : null
  const hasError = lastTurn && isErrorTurn(lastTurn)

  // ── Viewport 立绘 ──
  const [viewportSpeakerId, setViewportSpeakerId] = useState<string | null>(null)
  const visibleSpeakersRef = useRef<Map<Element, string>>(new Map())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // 切换幕时清空追踪
    visibleSpeakersRef.current.clear()
    setViewportSpeakerId(null)

    const computeCenterSpeaker = () => {
      const containerRect = container.getBoundingClientRect()
      const centerY = containerRect.top + containerRect.height / 2
      let closest: string | null = null
      let minDist = Infinity
      for (const [el, sid] of visibleSpeakersRef.current) {
        const rect = el.getBoundingClientRect()
        const elCenterY = rect.top + rect.height / 2
        const dist = Math.abs(elCenterY - centerY)
        if (dist < minDist) {
          minDist = dist
          closest = sid
        }
      }
      setViewportSpeakerId(closest)
    }

    const debouncedUpdate = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(computeCenterSpeaker, 600)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const speaker = (entry.target as HTMLElement).dataset.speaker
          if (!speaker) continue
          if (entry.isIntersecting) {
            visibleSpeakersRef.current.set(entry.target, speaker)
          } else {
            visibleSpeakersRef.current.delete(entry.target)
          }
        }
        debouncedUpdate()
      },
      { root: container, threshold: 0.3 }
    )

    const observeAll = () => {
      container.querySelectorAll('[data-speaker]').forEach(el => observer.observe(el))
    }
    observeAll()

    const mutObs = new MutationObserver(() => observeAll())
    mutObs.observe(container, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutObs.disconnect()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [viewingActIndex])

  const viewportStandingUrl = viewportSpeakerId ? getStandingUrl(viewportSpeakerId) : null
  const viewportStandingSide = viewportSpeakerId === playerCreatureId ? 'right' : 'left'

  // 滚到顶部（切换幕时）
  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [])

  // 选项处理
  const noopScroll = useCallback((_force: boolean) => {}, [])

  const onChoiceSelect = useCallback((choice: PlayerChoice) => {
    if (!lastStoryTurn) return
    handleChoiceSelect(choice, lastStoryTurn.id, noopScroll)
  }, [lastStoryTurn, handleChoiceSelect, noopScroll])

  const onCustomSubmit = useCallback(() => {
    if (!lastStoryTurn || !playerInput.trim()) return
    handleCustomInput(playerInput, lastStoryTurn.id, noopScroll)
  }, [lastStoryTurn, playerInput, handleCustomInput, noopScroll])

  const onAvatarClick = useCallback((creatureId: string) => {
    openCreatureModalRef.current(creatureId)
  }, [])

  // 翻页
  const goToNextAct = useCallback(() => {
    setViewingActIndex(prev => Math.min(prev + 1, storyTurns.length - 1))
    scrollToTop()
  }, [storyTurns.length, scrollToTop])

  const goToPrevAct = useCallback(() => {
    setViewingActIndex(prev => Math.max(prev - 1, 0))
    scrollToTop()
  }, [scrollToTop])

  return (
    <div className="vn-chat-container">
      {/* Viewport 立绘 */}
      {viewportStandingUrl && (
        <div className={`vn-standing-area standing-${viewportStandingSide}`} key={`vp-standing-${viewportSpeakerId}`}>
          <TransparentImg className="vn-standing-sprite" src={viewportStandingUrl} draggable={false} />
        </div>
      )}

      {/* 消息滚动区 — 只显示当前幕 */}
      <div className="vn-chat-scroll" ref={scrollContainerRef}>
        {/* 上一幕按钮 */}
        {hasPrevAct && (
          <button className="vn-act-nav-btn vn-act-nav-prev" onClick={goToPrevAct}>
            ← {t('galgame.actNav.prev')}{prevActTitle ? `：${prevActTitle}` : ''}
          </button>
        )}

        {/* 当前幕内容 */}
        {currentTurn && (
          <ActPlayer
            key={currentTurn.id}
            turn={currentTurn}
            playerCreatureId={playerCreatureId}
            onAvatarClick={onAvatarClick}
            highlightText={highlightEntitiesInText}
          />
        )}

        {/* 正在生成（仅在查看最新幕时） */}
        {isViewingLatest && (isGenerating || isUpdating) && (
          <div className="vn-msg narrative vn-generating">
            <div className="vn-narrative-box">
              <div className="vn-dots"><span /><span /><span /></div>
              <span className="vn-gen-text">
                {isUpdating ? t('galgame.status.updatingState') : t('galgame.status.generating')}
              </span>
            </div>
          </div>
        )}

        {/* 错误（仅在查看最新幕时） */}
        {isViewingLatest && hasError && (
          <div className="vn-msg narrative vn-error-msg">
            <div className="vn-narrative-box vn-error-box">
              <span>{(lastTurn as any).errorMessage}</span>
              {(lastTurn as any).retryAction && (
                <button className="vn-error-retry" onClick={(lastTurn as any).retryAction}>
                  {t('galgame.error.retry')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 下一幕按钮 */}
        {hasNewerAct && (
          <button className="vn-act-nav-btn vn-act-nav-next" onClick={goToNextAct}>
            {t('galgame.actNav.next')}{newerActTitle ? `：${newerActTitle}` : ''} →
          </button>
        )}
      </div>

      {/* 底部控制区 */}
      <div className="vn-bottom-bar">
        {/* 在查看最新幕且有选项时显示 */}
        {showChoices ? (
          <ChoicesPanel
            choices={lastStoryTurn!.playerChoices!}
            disabled={currentPhase !== 'waiting-choice'}
            showCustomInput={showCustomInput}
            playerInput={playerInput}
            onChoiceSelect={onChoiceSelect}
            onCustomSubmit={onCustomSubmit}
            setShowCustomInput={setShowCustomInput}
            setPlayerInput={setPlayerInput}
          />
        ) : (
          <div className="vn-bottom-status">
            {isViewingLatest && isGenerating && (
              <span className="vn-status-text">{t('galgame.status.generating')}</span>
            )}
            {isViewingLatest && isUpdating && (
              <span className="vn-status-text">{t('galgame.status.updatingState')}</span>
            )}
            {/* 不在最新幕：提示有新内容 */}
            {!isViewingLatest && !hasNewerAct && (
              <span className="vn-status-text vn-status-dim">
                {t('galgame.actNav.viewingHistory', { current: viewingActIndex + 1, total: storyTurns.length })}
              </span>
            )}
          </div>
        )}

        {/* 设置按钮 */}
        <button className="vn-settings-btn" onClick={toggleSettings} title={t('galgame.controls.settings')}>
          ⚙
        </button>
      </div>

      {/* 设置面板 */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}

export const GalStoryBlock = VNPresenter
