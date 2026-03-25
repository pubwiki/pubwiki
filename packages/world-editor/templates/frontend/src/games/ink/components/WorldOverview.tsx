/**
 * WorldOverview - 世界概览组件
 * 
 * 显示当前游戏世界中的人物、地域、组织信息
 * 点击列表项会打开对应的详情 Modal
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CreatureEntity, OrganizationEntity, RegionEntity, DirectorNotes } from '../../../api/types'

type TabType = 'creatures' | 'regions' | 'organizations' | 'director'

interface WorldOverviewProps {
  open: boolean
  onClose: () => void
  // 数据来源
  creaturesMap: Map<string, CreatureEntity>
  regionsMap: Map<string, RegionEntity>
  organizationsMap: Map<string, OrganizationEntity>
  directorNotes?: DirectorNotes | null
  // Modal 触发器
  onShowCreature: (creatureId: string) => void
  onShowLocation: (regionId: string, locationId: string) => void
  onShowOrganization: (organizationId: string) => void
}

export function WorldOverview({
  open,
  onClose,
  creaturesMap,
  regionsMap,
  organizationsMap,
  directorNotes,
  onShowCreature,
  onShowLocation,
  onShowOrganization
}: WorldOverviewProps) {
  const { t } = useTranslation('game')
  const [activeTab, setActiveTab] = useState<TabType>('creatures')
  
  if (!open) return null
  
  // 将 Map 转换为数组用于渲染
  const creatures = Array.from(creaturesMap.entries())
  const regions = Array.from(regionsMap.entries())
  const organizations = Array.from(organizationsMap.entries())
  
  return createPortal(
    <div className="world-overview-overlay" onClick={onClose}>
      <div className="world-overview-panel" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="world-overview-header">
          <h3>{t('world.title')}</h3>
          <button className="world-overview-close" onClick={onClose}>✕</button>
        </div>
        
        {/* 标签页导航 */}
        <div className="world-overview-tabs">
          <button 
            className={`world-overview-tab ${activeTab === 'creatures' ? 'active' : ''}`}
            onClick={() => setActiveTab('creatures')}
          >
            {t('world.creatures')} ({creatures.length})
          </button>
          <button 
            className={`world-overview-tab ${activeTab === 'regions' ? 'active' : ''}`}
            onClick={() => setActiveTab('regions')}
          >
            {t('world.regions')} ({regions.length})
          </button>
          <button
            className={`world-overview-tab ${activeTab === 'organizations' ? 'active' : ''}`}
            onClick={() => setActiveTab('organizations')}
          >
            {t('world.organizations')} ({organizations.length})
          </button>
          {directorNotes && (
            <button
              className={`world-overview-tab ${activeTab === 'director' ? 'active' : ''}`}
              onClick={() => setActiveTab('director')}
            >
              {t('world.director')}
            </button>
          )}
        </div>
        
        {/* 内容区 */}
        <div className="world-overview-content">
          {/* 人物列表 */}
          {activeTab === 'creatures' && (
            <div className="world-overview-list">
              {creatures.length === 0 ? (
                <div className="world-overview-empty">{t('world.noCreatures')}</div>
              ) : (
                creatures.map(([id, creature]) => (
                  <div 
                    key={id}
                    className="world-overview-item"
                    onClick={() => onShowCreature(id)}
                  >
                    <span className="item-icon">
                      {creature.is_player ? '👤' : '🎭'}
                    </span>
                    <div className="item-info">
                      <span className="item-name">
                        {creature.Creature?.name || id}
                      </span>
                      {creature.Creature?.appearance?.body && (
                        <span className="item-desc">
                          {creature.Creature?.appearance?.body.substring(0, 50)}
                          {creature.Creature?.appearance?.body.length > 50 ? '...' : ''}
                        </span>
                      )}
                    </div>
                    <span className="item-arrow">›</span>
                  </div>
                ))
              )}
            </div>
          )}
          
          {/* 地域列表 */}
          {activeTab === 'regions' && (
            <div className="world-overview-list">
              {regions.length === 0 ? (
                <div className="world-overview-empty">{t('world.noRegions')}</div>
              ) : (
                regions.map(([regionId, region]) => {
                  const locations = region.Region?.locations ?? []
                  return (
                    <div key={regionId} className="world-overview-region">
                      <div className="region-header">
                        <span className="region-icon">🗺️</span>
                        <span className="region-name">
                          {region.Region?.region_name || regionId}
                        </span>
                        <span className="region-count">
                          {t('world.locationCount', { count: locations.length })}
                        </span>
                      </div>
                      <div className="region-locations">
                        {locations.map((location: any) => (
                          <div 
                            key={location.id}
                            className="world-overview-item location-item"
                            onClick={() => onShowLocation(regionId, location.id)}
                          >
                            <span className="item-icon">📍</span>
                            <div className="item-info">
                              <span className="item-name">{location.name || location.id}</span>
                              {location.description && (
                                <span className="item-desc">
                                  {location.description.substring(0, 40)}
                                  {location.description.length > 40 ? '...' : ''}
                                </span>
                              )}
                            </div>
                            <span className="item-arrow">›</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
          
          {/* 组织列表 */}
          {activeTab === 'organizations' && (
            <div className="world-overview-list">
              {organizations.length === 0 ? (
                <div className="world-overview-empty">{t('world.noOrganizations')}</div>
              ) : (
                organizations.map(([id, org]) => (
                  <div
                    key={id}
                    className="world-overview-item"
                    onClick={() => onShowOrganization(id)}
                  >
                    <span className="item-icon">🏛️</span>
                    <div className="item-info">
                      <span className="item-name">
                        {org.Organization?.name || id}
                      </span>
                      {org.Organization?.description && (
                        <span className="item-desc">
                          {org.Organization.description.substring(0, 50)}
                          {org.Organization.description.length > 50 ? '...' : ''}
                        </span>
                      )}
                    </div>
                    <span className="item-arrow">›</span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 导演笔记 */}
          {activeTab === 'director' && directorNotes && (
            <div className="world-overview-list">
              {/* Stage Goal */}
              {directorNotes.stage_goal && (
                <div className="director-section">
                  <div className="director-section-title">{t('world.stageGoal')}</div>
                  <div className="world-overview-item director-note-item">
                    <span className="item-icon">🎯</span>
                    <div className="item-info">
                      <span className="item-name">{directorNotes.stage_goal}</span>
                    </div>
                  </div>
                </div>
              )}
              {/* Notes */}
              {directorNotes.notes?.length > 0 && (
                <div className="director-section">
                  <div className="director-section-title">{t('world.directorNotes')}</div>
                  {directorNotes.notes.map((note, i) => (
                    <div key={i} className="world-overview-item director-note-item">
                      <span className="item-icon">📝</span>
                      <div className="item-info">
                        <span className="item-name">{note}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Flags */}
              {directorNotes.flags && Object.keys(directorNotes.flags).length > 0 && (
                <div className="director-section">
                  <div className="director-section-title">{t('world.directorFlags')}</div>
                  {Object.values(directorNotes.flags).map((flag) => (
                    <div key={flag.id} className="world-overview-item director-flag-item">
                      <span className="item-icon">{flag.value ? '✅' : '❌'}</span>
                      <div className="item-info">
                        <span className="item-name">
                          <code>{flag.id}</code>
                        </span>
                        {flag.remark && (
                          <span className="item-desc">{flag.remark}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(!directorNotes.stage_goal && !directorNotes.notes?.length && (!directorNotes.flags || Object.keys(directorNotes.flags).length === 0)) && (
                <div className="world-overview-empty">{t('world.noDirectorNotes')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
