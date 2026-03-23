/**
 * ActGallery — 幕回顾界面
 *
 * 类似 Galgame 存档界面的卡片列表，每一幕显示为一张卡片：
 * - 有 CG → 以 CG 作为封面（后续接入图片生成后替换）
 * - 无 CG → 用章节标题渲染为封面
 * - 点击卡片 → 进入该幕的回放模式
 */

import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameStore } from '../stores/gameStore'
import { useCreatureStore } from '../stores/creatureStore'
import { useRegistryStore } from '../stores/registryStore'
import { useSpriteStore } from '../stores/spriteStore'
import { useUIStore } from '../stores/uiStore'
import { useHighlightEntities } from '../hooks'
import type { GalStoryTurn, StorySegment } from '../types'
import { isGalStoryTurn } from '../types'
import { TransparentImg } from './TransparentImg'

const PROLOGUE_KEY = 'prologue'

interface ActGalleryProps {
  open: boolean
  onClose: () => void
}

// ─── 单幕回放组件 ────────────────────────────────────────

function ActReplay({
  turn,
  onBack,
}: {
  turn: GalStoryTurn
  onBack: () => void
}) {
  const { t } = useTranslation('game')
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const playerEntity = useCreatureStore(s => s.playerEntity)
  const getAvatarUrl = useSpriteStore(s => s.getAvatarUrl)
  const typewriterSpeed = useUIStore(s => s.typewriterSpeed)
  const { highlightEntitiesInText } = useHighlightEntities()
  const playerCreatureId = playerEntity?.Creature?.creature_id || ''

  const segments = turn.story || []

  return (
    <div className="act-replay">
      <div className="act-replay-header">
        <button className="act-replay-back" onClick={onBack}>← {t('galgame.startGame.back')}</button>
        <span className="act-replay-title">
          {turn.chapterTitle === PROLOGUE_KEY ? t('galgame.startGame.prologue') : (turn.chapterTitle || t('galgame.unnamedChapter'))}
        </span>
      </div>
      <div className="act-replay-scroll">
        {segments.map((seg) => {
          if (seg.type === 'narrative') {
            return (
              <div key={seg.idx} className="act-replay-narrative">
                {highlightEntitiesInText(seg.content.join('\n'), `replay-${turn.id}-${seg.idx}`)}
              </div>
            )
          }
          const isPlayer = seg.speaker_creature_id === playerCreatureId
          const speakerName = seg.speaker_creature_id
            ? (creaturesRegistry.get(seg.speaker_creature_id)?.name || seg.speaker_creature_id)
            : ''
          const avatarUrl = seg.speaker_creature_id
            ? getAvatarUrl(seg.speaker_creature_id, seg.emotion)
            : null
          const side = isPlayer ? 'right' : 'left'

          return (
            <div key={seg.idx} className={`act-replay-dialogue ${side}`}>
              <div className="act-replay-avatar">
                {avatarUrl ? (
                  <TransparentImg src={avatarUrl} alt={speakerName} draggable={false} />
                ) : (
                  <span>{speakerName.charAt(0)}</span>
                )}
              </div>
              <div className="act-replay-bubble-area">
                <div className="act-replay-speaker">{speakerName}</div>
                <div className="act-replay-bubble">
                  {highlightEntitiesInText(seg.content.join('\n'), `replay-${turn.id}-${seg.idx}`)}
                </div>
                {seg.emotion && seg.emotion !== 'normal' && (
                  <span className={`vn-emotion-badge emotion-${seg.emotion}`}>
                    {t(`galgame.expressions.${seg.emotion}`, seg.emotion)}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {/* CG */}
        {turn.cg && (
          <div className="act-replay-narrative act-replay-cg">
            <span className="vn-cg-icon">🖼</span>
            <span>{t('galgame.cg.placeholder')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 主画廊 ────────────────────────────────────────────

export function ActGallery({ open, onClose }: ActGalleryProps) {
  const { t } = useTranslation('game')
  const galTurns = useGameStore(s => s.galTurns)
  const [replayTurnId, setReplayTurnId] = useState<number | null>(null)

  const storyTurns = useMemo(
    () => galTurns.filter(isGalStoryTurn).filter(t => t.generationPhase === 'done'),
    [galTurns]
  )

  const replayTurn = replayTurnId !== null
    ? storyTurns.find(t => t.id === replayTurnId)
    : null

  if (!open) return null

  // 回放模式
  if (replayTurn) {
    return (
      <div className="act-gallery-overlay" onClick={onClose}>
        <div className="act-gallery-modal act-gallery-replay" onClick={e => e.stopPropagation()}>
          <ActReplay turn={replayTurn} onBack={() => setReplayTurnId(null)} />
        </div>
      </div>
    )
  }

  // 画廊模式
  return (
    <div className="act-gallery-overlay" onClick={onClose}>
      <div className="act-gallery-modal" onClick={e => e.stopPropagation()}>
        <div className="act-gallery-header">
          <h3>{t('galgame.actGallery.title')}</h3>
          <button className="act-gallery-close" onClick={onClose}>×</button>
        </div>

        {storyTurns.length === 0 ? (
          <div className="act-gallery-empty">{t('galgame.actGallery.empty')}</div>
        ) : (
          <div className="act-gallery-grid">
            {storyTurns.map((turn, idx) => {
              const title = turn.chapterTitle === PROLOGUE_KEY
                ? t('galgame.startGame.prologue')
                : (turn.chapterTitle || t('galgame.unnamedChapter'))
              const hasCG = !!turn.cg
              const segCount = (turn.story || []).length
              const dialogueCount = (turn.story || []).filter(s => s.type === 'dialogue').length

              return (
                <button
                  key={turn.id}
                  className="act-gallery-card"
                  onClick={() => setReplayTurnId(turn.id)}
                >
                  {/* 封面区 */}
                  <div className={`act-card-cover ${hasCG ? 'has-cg' : ''}`}>
                    {hasCG ? (
                      <div className="act-card-cg-badge">CG</div>
                    ) : (
                      <div className="act-card-title-cover">
                        <span>{title}</span>
                      </div>
                    )}
                    <div className="act-card-number">#{idx + 1}</div>
                  </div>

                  {/* 信息区 */}
                  <div className="act-card-info">
                    <div className="act-card-title">{title}</div>
                    <div className="act-card-meta">
                      {t('galgame.actGallery.segments', { count: segCount })} · {t('galgame.actGallery.dialogues', { count: dialogueCount })}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
