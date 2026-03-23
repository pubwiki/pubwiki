/**
 * ResourceManager — 资源管理器
 *
 * 批量为角色生成立绘和表情头像。
 * 显示每个角色的进度，支持选择性生成。
 */

import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreatureStore } from '../stores/creatureStore'
import { useSpriteStore } from '../stores/spriteStore'
import { runImageGenPipeline, type PipelineState, type PipelinePhase } from '../services/imageGenPipeline'
import type { GalExpression } from '../types'
import type { Creature } from '../../../api/types'

const ALL_EXPRESSIONS: GalExpression[] = [
  'normal', 'happy', 'angry', 'sad', 'surprised', 'shy', 'confused', 'thinking', 'smirk',
]

interface ResourceManagerProps {
  open: boolean
  onClose: () => void
}

export function ResourceManager({ open, onClose }: ResourceManagerProps) {
  const { t } = useTranslation('game')

  const creaturesMap = useCreatureStore(s => s.creaturesMap)
  const playerEntity = useCreatureStore(s => s.playerEntity)

  const hasStanding = useSpriteStore(s => s.hasStanding)
  const getCreatureExpressions = useSpriteStore(s => s.getCreatureExpressions)
  const setSprite = useSpriteStore(s => s.setSprite)
  const removeCreatureSprites = useSpriteStore(s => s.removeCreatureSprites)
  const sprites = useSpriteStore(s => s.sprites) // subscribe to re-render on changes

  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Build creature list
  const creatureList = useMemo(() => {
    const list: Array<{ id: string; name: string; creature: Creature; isPlayer: boolean }> = []
    const playerId = playerEntity?.Creature?.creature_id
    if (playerId && playerEntity?.Creature) {
      list.push({ id: playerId, name: playerEntity.Creature.name || playerId, creature: playerEntity.Creature, isPlayer: true })
    }
    for (const [id, entity] of creaturesMap) {
      if (id !== playerId && entity.Creature) {
        list.push({ id, name: entity.Creature.name || id, creature: entity.Creature, isPlayer: false })
      }
    }
    return list
  }, [creaturesMap, playerEntity, sprites]) // sprites dependency to refresh missing counts

  // Compute missing resources per creature
  const creatureStatus = useMemo(() => {
    return creatureList.map(c => {
      const hasStandingSprite = hasStanding(c.id)
      const existingAvatars = getCreatureExpressions(c.id, 'avatar')
      const missingAvatars = ALL_EXPRESSIONS.filter(e => !existingAvatars.includes(e))
      return {
        ...c,
        hasStanding: hasStandingSprite,
        missingAvatars,
        totalMissing: (hasStandingSprite ? 0 : 1) + missingAvatars.length,
      }
    })
  }, [creatureList, hasStanding, getCreatureExpressions])

  const isRunning = pipelineState?.phase === 'generating-standings' || pipelineState?.phase === 'generating-avatars'

  // Toggle selection
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Regenerate all resources for a single creature
  const handleRegenerate = useCallback(async (creatureId: string) => {
    const target = creatureStatus.find(c => c.id === creatureId)
    if (!target || isRunning) return

    // 清除该角色的所有图像
    removeCreatureSprites(creatureId)

    // 以全套资源运行 pipeline
    await runImageGenPipeline({
      creatures: [{
        creature: target.creature,
        needStanding: true,
        needAvatars: ALL_EXPRESSIONS,
      }],
      onSpriteReady: (cid, imageType, expression, dataUrl, mimeType) => {
        setSprite(cid, imageType, expression, dataUrl, mimeType)
      },
      onProgress: (state) => {
        setPipelineState({ ...state })
      },
    })
  }, [creatureStatus, isRunning, removeCreatureSprites, setSprite])

  // Select all with missing resources
  const selectAllMissing = useCallback(() => {
    const ids = creatureStatus.filter(c => c.totalMissing > 0).map(c => c.id)
    setSelectedIds(new Set(ids))
  }, [creatureStatus])

  // Run pipeline
  const handleGenerate = useCallback(async () => {
    const targets = creatureStatus.filter(c => selectedIds.has(c.id) && c.totalMissing > 0)
    if (targets.length === 0) return

    await runImageGenPipeline({
      creatures: targets.map(c => ({
        creature: c.creature,
        needStanding: !c.hasStanding,
        needAvatars: c.missingAvatars,
      })),
      onSpriteReady: (creatureId, imageType, expression, dataUrl, mimeType) => {
        setSprite(creatureId, imageType, expression, dataUrl, mimeType)
      },
      onProgress: (state) => {
        setPipelineState({ ...state })
      },
    })
  }, [creatureStatus, selectedIds, setSprite])

  // Get progress for a creature
  const getCreatureProgress = useCallback((creatureId: string) => {
    return pipelineState?.creatures.find(c => c.creatureId === creatureId)
  }, [pipelineState])

  if (!open) return null

  const totalSelected = selectedIds.size
  const totalAPICalls = creatureStatus
    .filter(c => selectedIds.has(c.id))
    .reduce((sum, c) => sum + c.totalMissing, 0)

  return (
    <div className="sprite-manager-overlay" onClick={onClose}>
      <div className="resource-manager-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sprite-manager-header">
          <h3>{t('galgame.resourceManager.title')}</h3>
          <button className="sprite-manager-close" onClick={onClose}>×</button>
        </div>

        {/* Toolbar */}
        <div className="resource-toolbar">
          <button
            className="resource-select-all"
            onClick={selectAllMissing}
            disabled={isRunning}
          >
            {t('galgame.resourceManager.selectAll')}
          </button>
          <div className="resource-toolbar-info">
            {totalSelected > 0 && (
              <span>
                {t('galgame.resourceManager.selectedInfo', { count: totalSelected, calls: totalAPICalls })}
              </span>
            )}
          </div>
          <button
            className="resource-generate-btn"
            onClick={handleGenerate}
            disabled={isRunning || totalSelected === 0}
          >
            {isRunning
              ? t('galgame.resourceManager.generating')
              : t('galgame.resourceManager.generate')
            }
          </button>
        </div>

        {/* Creature list */}
        <div className="resource-list">
          {creatureStatus.length === 0 && (
            <div className="sprite-empty-hint">{t('galgame.resourceManager.noCharacters')}</div>
          )}
          {creatureStatus.map(c => {
            const progress = getCreatureProgress(c.id)
            const isSelected = selectedIds.has(c.id)

            return (
              <div key={c.id} className={`resource-item ${isSelected ? 'selected' : ''}`}>
                {/* Checkbox + name */}
                <label className="resource-item-header">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(c.id)}
                    disabled={isRunning || c.totalMissing === 0}
                  />
                  <span className="resource-item-name">
                    {c.name}
                    {c.isPlayer && <span className="sprite-creature-badge">P</span>}
                  </span>
                  {c.totalMissing === 0 ? (
                    <span className="resource-complete">✓</span>
                  ) : (
                    <span className="resource-missing">
                      {t('galgame.resourceManager.missing', { count: c.totalMissing })}
                    </span>
                  )}
                  {c.totalMissing < 10 && (
                    <button
                      className="resource-regen-btn"
                      onClick={(e) => { e.preventDefault(); handleRegenerate(c.id) }}
                      disabled={isRunning}
                      title={t('galgame.resourceManager.regenerate')}
                    >
                      ↻
                    </button>
                  )}
                </label>

                {/* Status details */}
                <div className="resource-item-detail">
                  <span className={c.hasStanding ? 'has' : 'miss'}>
                    {t('galgame.resourceManager.standing')}: {c.hasStanding ? '✓' : '✗'}
                  </span>
                  <span className={c.missingAvatars.length === 0 ? 'has' : 'miss'}>
                    {t('galgame.resourceManager.avatars')}: {ALL_EXPRESSIONS.length - c.missingAvatars.length}/{ALL_EXPRESSIONS.length}
                  </span>
                </div>

                {/* Progress bar (when running) */}
                {progress && (
                  <div className="resource-progress">
                    <div className="resource-progress-bar">
                      <div
                        className="resource-progress-fill"
                        style={{
                          width: `${((progress.standingDone ? 1 : 0) + progress.avatarsDone) / (1 + progress.avatarsTotal) * 100}%`
                        }}
                      />
                    </div>
                    <span className="resource-progress-text">
                      {!progress.standingDone
                        ? t('galgame.resourceManager.generatingStanding')
                        : progress.avatarsDone < progress.avatarsTotal
                          ? t('galgame.resourceManager.generatingAvatars', { done: progress.avatarsDone, total: progress.avatarsTotal })
                          : '✓'
                      }
                    </span>
                    {progress.standingError && (
                      <div className="resource-error">{progress.standingError}</div>
                    )}
                    {progress.avatarErrors.length > 0 && (
                      <div className="resource-error">{progress.avatarErrors.join('; ')}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pipeline global status */}
        {pipelineState?.phase === 'done' && (
          <div className="resource-done-banner">
            {t('galgame.resourceManager.done')}
          </div>
        )}
      </div>
    </div>
  )
}
