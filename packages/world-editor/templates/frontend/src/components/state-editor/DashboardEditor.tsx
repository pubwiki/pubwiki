import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { StateData } from '../../api/types'
import type { TabType, ValidationError } from './types'
import { luaList } from './types'
import './DashboardEditor.css'

interface DashboardEditorProps {
  data: StateData
  validationErrors: ValidationError[]
  onNavigate: (tab: TabType) => void
}

export const DashboardEditor: React.FC<DashboardEditorProps> = ({
  data,
  validationErrors,
  onNavigate
}) => {
  const { t } = useTranslation('editor')

  // 提取数据
  const stats = useMemo(() => {
    const creatures = luaList(data.Creatures)
    const regions = luaList(data.Regions)
    const organizations = luaList(data.Organizations)
    const allDocs: Array<{name: string; content: string}> = []
    ;(data.World?.BindSetting?.documents || []).forEach(d => allDocs.push(d))
    ;(luaList(data.Creatures)).forEach(c => (c.BindSetting?.documents || []).forEach((d: any) => allDocs.push(d)))
    ;(luaList(data.Regions)).forEach(r => (r.BindSetting?.documents || []).forEach((d: any) => allDocs.push(d)))
    ;(luaList(data.Organizations)).forEach(o => (o.BindSetting?.documents || []).forEach((d: any) => allDocs.push(d)))
    const storyHistory = luaList(data.StoryHistory)

    const templates = luaList(data.World?.CustomComponentRegistry?.custom_components)
    const directorNotesCount = (data.World?.DirectorNotes?.notes?.length || 0) + Object.keys(data.World?.DirectorNotes?.flags || {}).length

    const playerCreature = creatures.find(c => c.IsPlayer)
    const gameTime = data.World?.GameTime 
      ? `${data.World.GameTime.year}${t('dashboard.year')}${data.World.GameTime.month}${t('dashboard.month')}${data.World.GameTime.day}${t('dashboard.day')}`
      : '-'

    return {
      creatures,
      regions,
      organizations,
      documents: allDocs,
      storyHistory,
      templates,
      directorNotesCount,
      gameTime,
      playerName: playerCreature?.Creature?.name || '-'
    }
  }, [data, t])

  const errorCount = validationErrors.filter(e => e.severity === 'error').length
  const warningCount = validationErrors.filter(e => e.severity === 'warning').length

  // 渲染可点击的项目列表
  const renderItemList = (
    items: { id: string; name: string }[], 
    maxShow: number,
    onItemClick: () => void
  ) => {
    const shown = items.slice(0, maxShow)
    const remaining = items.length - maxShow
    
    return (
      <div className="item-list">
        {shown.map((item, i) => (
          <span key={item.id || i} className="item-tag" onClick={onItemClick}>
            {item.name}
          </span>
        ))}
        {remaining > 0 && (
          <span className="item-more" onClick={onItemClick}>
            +{remaining}...
          </span>
        )}
        {items.length === 0 && (
          <span className="item-empty">{t('dashboard.empty')}</span>
        )}
      </div>
    )
  }

  return (
    <div className="dashboard-editor">
      <div className="dashboard-header">
        <h2>{t('dashboard.title')}</h2>
        <p className="dashboard-subtitle">{t('dashboard.subtitle')}</p>
      </div>

      {/* 验证状态横幅 */}
      {(errorCount > 0 || warningCount > 0) && (
        <div className={`validation-banner ${errorCount > 0 ? 'has-errors' : 'has-warnings'}`}>
          {errorCount > 0 && (
            <span className="error-badge">{t('dashboard.errors', { count: errorCount })}</span>
          )}
          {warningCount > 0 && (
            <span className="warning-badge">{t('dashboard.warnings', { count: warningCount })}</span>
          )}
        </div>
      )}

      {/* 世界注册表 - 最重要的放前面 */}
      <section className="dashboard-section">
        <div className="section-header" onClick={() => onNavigate('world')}>
          <h3>{t('dashboard.worldCard')}</h3>
          <span className="section-link">{t('dashboard.editAll')} →</span>
        </div>
        <div className="section-meta">
          <span className="meta-item">{stats.gameTime}</span>
          <span className="meta-item">{t('dashboard.directorNotes')}: {stats.directorNotesCount}</span>
        </div>
        
        <div className="registry-grid">
          {/* 状态模板 */}
          <div className="registry-card" onClick={() => onNavigate('world')}>
            <div className="registry-card-header">
              <span className="registry-icon"></span>
              <span className="registry-title">{t('dashboard.templates')}</span>
              <span className="registry-count">{stats.templates.length}</span>
            </div>
            {renderItemList(
              stats.templates.map((t: any) => ({ id: t.component_key, name: t.component_key })),
              5,
              () => onNavigate('world')
            )}
          </div>
        </div>
      </section>

      {/* 角色列表 */}
      <section className="dashboard-section">
        <div className="section-header" onClick={() => onNavigate('creatures')}>
          <h3>{t('dashboard.creaturesCard')}</h3>
          <span className="section-link">{t('dashboard.editAll')} →</span>
        </div>
        <div className="section-meta">
          <span className="meta-item">{t('dashboard.player')}: <strong>{stats.playerName}</strong></span>
          <span className="meta-item">{t('dashboard.total')}: {stats.creatures.length}</span>
        </div>
        <div className="entity-list">
          {stats.creatures.slice(0, 8).map((c, i) => (
            <div 
              key={c.Creature?.creature_id || i} 
              className={`entity-card ${c.IsPlayer ? 'is-player' : ''}`}
              onClick={() => onNavigate('creatures')}
            >
              <span className="entity-icon">{c.IsPlayer ? '' : ''}</span>
              <span className="entity-name">{c.Creature?.name || '???'}</span>
              {c.Creature?.organization_id && (
                <span className="entity-org"></span>
              )}
            </div>
          ))}
          {stats.creatures.length > 8 && (
            <div className="entity-card more" onClick={() => onNavigate('creatures')}>
              +{stats.creatures.length - 8} {t('dashboard.more')}
            </div>
          )}
          {stats.creatures.length === 0 && (
            <div className="entity-empty">{t('dashboard.noCharacters')}</div>
          )}
        </div>
      </section>

      {/* 地域列表 */}
      <section className="dashboard-section">
        <div className="section-header" onClick={() => onNavigate('regions')}>
          <h3>{t('dashboard.regionsCard')}</h3>
          <span className="section-link">{t('dashboard.editAll')} →</span>
        </div>
        <div className="entity-list">
          {stats.regions.slice(0, 6).map((r, i) => {
            const locCount = r.Region?.locations?.length || 0
            return (
              <div 
                key={r.Region?.region_id || i} 
                className="entity-card region-card"
                onClick={() => onNavigate('regions')}
              >
                <span className="entity-name">{r.Metadata?.name || r.Region?.region_name || '???'}</span>
                <span className="entity-meta">{locCount} {t('dashboard.locations')}</span>
              </div>
            )
          })}
          {stats.regions.length > 6 && (
            <div className="entity-card more" onClick={() => onNavigate('regions')}>
              +{stats.regions.length - 6} {t('dashboard.more')}
            </div>
          )}
          {stats.regions.length === 0 && (
            <div className="entity-empty">{t('dashboard.noRegions')}</div>
          )}
        </div>
      </section>

      {/* 组织列表 */}
      <section className="dashboard-section">
        <div className="section-header" onClick={() => onNavigate('organizations')}>
          <h3>{t('dashboard.organizationsCard')}</h3>
          <span className="section-link">{t('dashboard.editAll')} →</span>
        </div>
        <div className="entity-list">
          {stats.organizations.slice(0, 6).map((o, i) => (
            <div 
              key={o.Organization?.organization_id || i} 
              className="entity-card org-card"
              onClick={() => onNavigate('organizations')}
            >
              <span className="entity-name">{o.Organization?.name || '???'}</span>
            </div>
          ))}
          {stats.organizations.length > 6 && (
            <div className="entity-card more" onClick={() => onNavigate('organizations')}>
              +{stats.organizations.length - 6} {t('dashboard.more')}
            </div>
          )}
          {stats.organizations.length === 0 && (
            <div className="entity-empty">{t('dashboard.noOrganizations')}</div>
          )}
        </div>
      </section>

      {/* 设定文档和剧情历史 - 合并成一行 */}
      <div className="dashboard-row">
        <section className="dashboard-section half">
          <div className="section-header" onClick={() => onNavigate('world')}>
            <h3>{t('dashboard.settingsCard')}</h3>
            <span className="section-link">{t('dashboard.editAll')} →</span>
          </div>
          <div className="compact-list">
            {stats.documents.slice(0, 4).map((d: any, i: number) => (
              <div key={d.name || i} className="compact-item" onClick={() => onNavigate('world')}>
                {d.name || '???'}
              </div>
            ))}
            {stats.documents.length > 4 && (
              <div className="compact-item more" onClick={() => onNavigate('world')}>
                +{stats.documents.length - 4} {t('dashboard.more')}
              </div>
            )}
            {stats.documents.length === 0 && (
              <div className="entity-empty">{t('dashboard.noDocuments')}</div>
            )}
          </div>
        </section>

        <section className="dashboard-section half">
          <div className="section-header" onClick={() => onNavigate('story-history')}>
            <h3>{t('dashboard.storyCard')}</h3>
            <span className="section-link">{t('dashboard.editAll')} →</span>
          </div>
          <div className="story-summary">
            <div className="story-stat">
              <span className="story-number">{stats.storyHistory.length}</span>
              <span className="story-label">{t('dashboard.turns')}</span>
            </div>
          </div>
        </section>
      </div>

      {/* 快捷键提示 */}
      <div className="dashboard-tips">
        <p>{t('dashboard.tip')}</p>
      </div>
    </div>
  )
}

export default DashboardEditor
