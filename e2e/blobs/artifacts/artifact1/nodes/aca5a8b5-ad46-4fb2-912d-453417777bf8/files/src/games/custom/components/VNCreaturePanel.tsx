/**
 * VNCreaturePanel — 全新的角色信息面板
 *
 * P5/侘寂风格，左侧显示立绘，右侧显示角色详情。
 * 替代点击文本高亮时弹出的旧版 CreatureModal。
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CreatureEntity } from '../../../api/types'
import { useSpriteStore } from '../stores/spriteStore'
import { useRegistryStore } from '../stores/registryStore'
import { useCreatureStore } from '../stores/creatureStore'
import type { GalExpression } from '../types'
import { TransparentImg } from './TransparentImg'

interface VNCreaturePanelProps {
  open: boolean
  creature: CreatureEntity | null
  onClose: () => void
}

export function VNCreaturePanel({ open, creature, onClose }: VNCreaturePanelProps) {
  const { t } = useTranslation('game')
  const getStandingUrl = useSpriteStore(s => s.getStandingUrl)
  const getAvatarUrl = useSpriteStore(s => s.getAvatarUrl)
  const getCreatureExpressions = useSpriteStore(s => s.getCreatureExpressions)
  const organizationsRegistry = useRegistryStore(s => s.organizationsRegistry)
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const locationsRegistry = useRegistryStore(s => s.locationsRegistry)
  const regionsMap = useCreatureStore(s => s.regionsMap)

  if (!open || !creature?.Creature) return null

  const c = creature.Creature
  const creatureId = c.creature_id
  const standingUrl = getStandingUrl(creatureId)
  const avatarExpressions = getCreatureExpressions(creatureId, 'avatar')

  // 所在地点
  const locationInfo = (() => {
    if (!creature.LocationRef?.location_id) return null
    const locName = locationsRegistry.get(creature.LocationRef.location_id)?.name
    return locName || creature.LocationRef.location_id
  })()

  // 所属组织
  const orgName = c.organization_id
    ? organizationsRegistry.get(c.organization_id)?.name || c.organization_id
    : null

  // 关系
  const relationships = creature.Relationship?.relationships || []

  // 属性
  const attrs = c.attrs || {}
  const attrEntries = Object.entries(attrs).filter(([k]) =>
    !['name', 'creature_id'].includes(k)
  )

  // 物品栏
  const items = creature.Inventory?.items || []

  // 状态效果
  const statusEffects = creature.StatusEffects?.status_effects || []

  return (
    <div className="vncp-overlay" onClick={onClose}>
      <div className="vncp-panel" onClick={e => e.stopPropagation()}>
        {/* 关闭按钮 */}
        <button className="vncp-close" onClick={onClose}>×</button>

        {/* 左侧：立绘 */}
        <div className="vncp-standing-area">
          {standingUrl ? (
            <TransparentImg
              className="vncp-standing-img"
              src={standingUrl}
              alt={c.name}
              draggable={false}
            />
          ) : (
            <div className="vncp-standing-placeholder">
              <span className="vncp-standing-initial">{c.name.charAt(0)}</span>
            </div>
          )}

          {/* 表情头像缩略图 */}
          {avatarExpressions.length > 0 && (
            <div className="vncp-expr-row">
              {avatarExpressions.slice(0, 5).map(expr => {
                const url = getAvatarUrl(creatureId, expr)
                if (!url) return null
                return (
                  <div key={expr} className="vncp-expr-thumb" title={t(`galgame.expressions.${expr}`, expr)}>
                    <TransparentImg src={url} alt={expr} draggable={false} />
                  </div>
                )
              })}
              {avatarExpressions.length > 5 && (
                <div className="vncp-expr-more">+{avatarExpressions.length - 5}</div>
              )}
            </div>
          )}
        </div>

        {/* 右侧：信息 */}
        <div className="vncp-info-area">
          {/* 名字 + 标签 */}
          <div className="vncp-name-block">
            <h2 className="vncp-name">{c.name}</h2>
            <div className="vncp-tags">
              {creature.is_player && <span className="vncp-tag vncp-tag-player">{t('galgame.player')}</span>}
              {c.gender && <span className="vncp-tag">{c.gender}</span>}
              {c.race && <span className="vncp-tag">{c.race}</span>}
            </div>
            {c.titles && c.titles.length > 0 && (
              <div className="vncp-titles">
                {c.titles.map((title, i) => (
                  <span key={i} className="vncp-title-chip">{title}</span>
                ))}
              </div>
            )}
          </div>

          {/* 情绪 + 目标 */}
          {(c.emotion || c.goal) && (
            <div className="vncp-mood-section">
              {c.emotion && (
                <div className="vncp-mood-item">
                  <span className="vncp-mood-label">{t('panel.emotion')}</span>
                  <span className="vncp-mood-value">{c.emotion}</span>
                </div>
              )}
              {c.goal && (
                <div className="vncp-mood-item">
                  <span className="vncp-mood-label">{t('panel.goal')}</span>
                  <span className="vncp-mood-value">{c.goal}</span>
                </div>
              )}
            </div>
          )}

          {/* 外观 */}
          {c.appearance && (
            <div className="vncp-section">
              <h4 className="vncp-section-title">{t('panel.appearance')}</h4>
              {c.appearance.body && <p className="vncp-desc">{c.appearance.body}</p>}
              {c.appearance.clothing && <p className="vncp-desc vncp-clothing">{c.appearance.clothing}</p>}
            </div>
          )}

          {/* 组织 & 位置 */}
          {(orgName || locationInfo) && (
            <div className="vncp-meta-row">
              {orgName && (
                <div className="vncp-meta-item">
                  <span className="vncp-meta-label">{t('panel.organization')}</span>
                  <span className="vncp-meta-value">{orgName}</span>
                </div>
              )}
              {locationInfo && (
                <div className="vncp-meta-item">
                  <span className="vncp-meta-label">{t('panel.location')}</span>
                  <span className="vncp-meta-value">{locationInfo}</span>
                </div>
              )}
            </div>
          )}

          {/* 属性 */}
          {attrEntries.length > 0 && (
            <div className="vncp-section">
              <h4 className="vncp-section-title">{t('panel.attributes')}</h4>
              <div className="vncp-attr-grid">
                {attrEntries.map(([key, val]) => (
                  <div key={key} className="vncp-attr-item">
                    <span className="vncp-attr-key">{key}</span>
                    <span className="vncp-attr-val">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关系 */}
          {relationships.length > 0 && (
            <div className="vncp-section">
              <h4 className="vncp-section-title">{t('panel.relationships')}</h4>
              <div className="vncp-rel-list">
                {relationships.map((rel, i) => {
                  const targetName = creaturesRegistry.get(rel.target_creature_id)?.name || rel.target_creature_id
                  return (
                    <div key={i} className="vncp-rel-item">
                      <span className="vncp-rel-name">{targetName}</span>
                      <span className="vncp-rel-type">{rel.name}</span>
                      {rel.value !== undefined && (
                        <div className="vncp-rel-bar">
                          <div className="vncp-rel-fill" style={{ width: `${Math.min(100, Math.max(0, rel.value))}%` }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 物品 */}
          {items.length > 0 && (
            <div className="vncp-section">
              <h4 className="vncp-section-title">{t('panel.inventory')}</h4>
              <div className="vncp-item-list">
                {items.map((item, i) => (
                  <div key={i} className="vncp-item">
                    <span className="vncp-item-name">{item.name}</span>
                    {item.count > 1 && <span className="vncp-item-count">×{item.count}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 状态效果 */}
          {statusEffects.length > 0 && (
            <div className="vncp-section">
              <h4 className="vncp-section-title">{t('panel.statusEffects')}</h4>
              <div className="vncp-status-list">
                {statusEffects.map((se, i) => (
                  <span key={i} className="vncp-status-chip">{se.display_name || se.instance_id}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
