import { useTranslation } from 'react-i18next'
import { CreatureEntity, TypeSchema, CreatureAttrField } from '../api/types'
import type { InfoDetailItem } from '../games/components/InfoModal'
import './CreaturePanel.css'

interface CreaturePanelProps {
  creature: CreatureEntity | null
  loading: boolean
  customComponentRegistry?: Map<string, { component_key: string, component_name: string, is_array: boolean, type_schema?: TypeSchema }>
  regionsRegistry: Map<string, { name: string }>
  locationsRegistry: Map<string, { name: string, description?: string }>
  organizationsRegistry: Map<string, { name: string }>
  creaturesRegistry: Map<string, { name: string }>
  attrFields?: CreatureAttrField[]
  onShowInfo: (info: { title: string, description?: string, details?: string[], structuredDetails?: InfoDetailItem[] }) => void
  onShowOrganization?: (organizationId: string) => void
  onShowLocation?: (regionId: string, locationId: string) => void
}

export default function CreaturePanel({
  creature,
  loading,
  customComponentRegistry,
  regionsRegistry,
  locationsRegistry,
  organizationsRegistry,
  creaturesRegistry,
  attrFields,
  onShowInfo,
  onShowOrganization,
  onShowLocation
}: CreaturePanelProps) {
  const { t } = useTranslation('game')

  if (!creature || !creature.Creature) {
    return (
      <div className="novel-player-panel">
        <h2>👤 {t('panel.characterInfo')}</h2>
        <div className="loading-text">
          {loading ? t('panel.loading') : t('panel.noCharacterSelected')}
        </div>
      </div>
    )
  }

  const attrs = creature.Creature
  const isPlayer = creature.is_player

  return (
    <div className="novel-player-panel">
      <h2>
        {isPlayer ? '👤' : '🎭'} {attrs?.name || t('panel.unknown')}
        {isPlayer && <span className="player-badge">{t('panel.playerBadge')}</span>}
      </h2>

      {attrs?.titles && attrs.titles.length > 0 && (
        <div className="player-title">{attrs.titles.join(' · ')}</div>
      )}

      {/* 基本信息 */}
      <div className="info-section">
        <h3>📋 {t('panel.basicInfo')}</h3>
        <div className="basic-info-list">
          {attrs.appearance && (
            <div className="info-item" style={{ borderLeftColor: '#8b5cf6' }}>
              <span className="label">👤 {t('panel.appearance')}</span>
              <div className="value" style={{ marginTop: '0.5rem' }}>{attrs.appearance.body}</div>
              <span className="label" style={{ marginTop: '0.75rem', display: 'block' }}>👔 {t('panel.clothing')}</span>
              <div className="value" style={{ marginTop: '0.5rem' }}>{attrs.appearance.clothing}</div>
            </div>
          )}
          {attrs.goal && (
            <div className="info-item" style={{ borderLeftColor: '#f97316' }}>
              <span className="label">🎯 {t('panel.goal')}</span>
              <div className="value" style={{ marginTop: '0.5rem' }}>{attrs.goal}</div>
            </div>
          )}
          {(attrs.gender || attrs.race) && (
            <div className="info-item" style={{ borderLeftColor: '#10b981' }}>
              {attrs.gender && <div><span className="label">{t('panel.gender')}</span> <strong>{attrs.gender}</strong></div>}
              {attrs.race && <div><span className="label">{t('panel.race')}</span> <strong>{attrs.race}</strong></div>}
            </div>
          )}
          {attrs.emotion && (
            <div className="info-item" style={{ borderLeftColor: '#ec4899' }}>
              <span className="label">💭 {t('panel.emotion')}</span>
              <div className="value" style={{ marginTop: '0.5rem' }}>{typeof attrs.emotion === 'string' ? attrs.emotion : JSON.stringify(attrs.emotion)}</div>
            </div>
          )}
          {attrs?.organization_id && (
            <div className="info-item" style={{ borderLeftColor: '#f59e0b' }}>
              <span className="label">🏛️ {t('panel.organization')}</span>
              <div
                className={onShowOrganization ? "value clickable" : "value"}
                onClick={() => onShowOrganization?.(attrs.organization_id!)}
                style={{ cursor: onShowOrganization ? 'pointer' : 'default', marginTop: '0.5rem' }}
              >
                {organizationsRegistry.get(attrs.organization_id)?.name || attrs.organization_id}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 已知信息 */}
      {attrs?.known_infos && attrs.known_infos.length > 0 && (
        <div className="info-section">
          <h3>💡 {t('panel.knownInfos')}</h3>
          <div className="known-infos-list">
            {attrs.known_infos.map((info, idx) => (
              <div key={idx} className="known-info-entry">
                {info}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 基础属性 */}
      {attrs?.attrs && Object.keys(attrs.attrs).length > 0 && (
        <div className="info-section">
          <h3>💪 {t('panel.attributes')}</h3>
          <div className="attributes-grid">
            {(attrFields && attrFields.length > 0
              ? attrFields.filter(f => attrs.attrs[f.field_name] !== undefined)
              : Object.keys(attrs.attrs).map(k => ({ field_name: k, hint: k, field_display_name: undefined as string | undefined }))
            ).map(f => (
              <div
                key={f.field_name}
                className="attr-item clickable"
                onClick={() => onShowInfo({
                  title: `💪 ${f.field_display_name || f.hint}`,
                  description: f.hint,
                  details: [
                    `${t('panel.currentValue')}: ${attrs.attrs[f.field_name]}`,
                    ...(f.field_display_name ? [`${t('panel.fieldName')}: ${f.field_name}`] : [])
                  ]
                })}
                style={{ cursor: 'pointer' }}
              >
                <span className="attr-label">{f.field_display_name || f.hint}</span>
                <span className="attr-value">{attrs.attrs[f.field_name]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 背包 */}
      {creature.Inventory?.items && creature.Inventory.items.length > 0 && (
        <div className="info-section">
          <h3>🎒 {t('panel.inventory')}</h3>
          <div className="inventory-list">
            {creature.Inventory.items.map((item, idx) => {
              const displayName = item.name || item.id
              const hasDetails = item.description || (item.details && item.details.length > 0)

              return (
                <div
                  key={idx}
                  className={hasDetails ? "inventory-item clickable" : "inventory-item"}
                  onClick={() => {
                    if (hasDetails) {
                      onShowInfo({
                        title: t('panel.itemTitle', { name: displayName }),
                        description: item.description,
                        details: item.details
                      })
                    }
                  }}
                  style={{ cursor: hasDetails ? 'pointer' : 'default' }}
                >
                  <span className="item-name">{item.equipped ? '🛡️' : '📦'} {displayName}</span>
                  <span className="item-count">×{item.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 状态效果 */}
      {creature.StatusEffects?.status_effects && creature.StatusEffects.status_effects.length > 0 && (
        <div className="info-section">
          <h3>✨ {t('panel.statusEffects')}</h3>
          <div className="statuses-list">
            {creature.StatusEffects.status_effects.map((effect, idx) => {
              // 格式化 data 显示
              const displayData = effect.data !== undefined
                ? (typeof effect.data === 'object'
                    ? JSON.stringify(effect.data, null, 2)
                    : String(effect.data))
                : undefined

              return (
                <div
                  key={idx}
                  className="status-item clickable"
                  onClick={() => {
                    onShowInfo({
                      title: t('panel.statusEffectTitle', { name: effect.display_name || effect.instance_id }),
                      description: effect.remark,
                      details: [
                        ...(effect.add_at ? [t('panel.addedAt', { time: effect.add_at })] : []),
                        ...(effect.last_update_at ? [t('panel.lastUpdatedAt', { time: effect.last_update_at })] : []),
                        ...(displayData ? [t('panel.statusData', { data: displayData })] : [])
                      ]
                    })
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="status-name">{effect.display_name || effect.instance_id}</span>
                  {effect.data !== undefined && (
                    <span className="status-value">
                      {typeof effect.data === 'object' ? '📋' : effect.data}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 自定义组件 */}
      {creature.CustomComponents?.custom_components && creature.CustomComponents.custom_components.length > 0 && (
        <div className="info-section">
          <h3>🧩 {t('panel.customComponents')}</h3>
          <div className="custom-components-list">
            {creature.CustomComponents.custom_components.map((comp, idx) => {
              const regInfo = customComponentRegistry?.get(comp.component_key)
              const displayName = regInfo?.component_name || comp.component_key
              const schema = regInfo?.type_schema
              const isArray = regInfo?.is_array ?? false

              // 生成简短预览（面板内显示）
              const getPreview = (data: any): string => {
                if (data === null || data === undefined) return t('panel.noData')
                if (Array.isArray(data)) return t('panel.itemCount', { count: data.length })
                if (typeof data === 'object') {
                  const keys = Object.keys(data)
                  if (keys.length <= 2) return keys.map(k => `${k}: ${typeof data[k] === 'object' ? '...' : data[k]}`).join(', ')
                  return t('panel.fieldCount', { count: keys.length })
                }
                return String(data)
              }

              // 递归展平嵌套值为结构化详情行
              const flattenValue = (key: string, value: any, description?: string, depth = 0): InfoDetailItem[] => {
                if (value === null || value === undefined) {
                  return [{ fieldKey: key, label: description || key, value: '—' }]
                }
                if (Array.isArray(value)) {
                  if (value.length === 0) return [{ fieldKey: key, label: description || key, value: '—' }]
                  // 简单类型数组：合并为一行逗号分隔
                  if (value.every(v => typeof v !== 'object' || v === null)) {
                    return [{ fieldKey: key, label: description || key, value: value.map(v => String(v ?? '—')).join('、') }]
                  }
                  // 复杂数组：每个元素展开
                  const header: InfoDetailItem = { label: description || key, value: '', separator: true }
                  const items = value.flatMap((item, i) => {
                    const sep: InfoDetailItem = { label: `#${i + 1}`, value: '', separator: true }
                    if (typeof item === 'object' && item !== null) {
                      const rows = Object.entries(item).flatMap(([k, v]) => flattenValue(k, v, undefined, depth + 1))
                      return [sep, ...rows]
                    }
                    return [{ label: `#${i + 1}`, value: String(item) }]
                  })
                  return [header, ...items]
                }
                if (typeof value === 'object') {
                  if (depth > 0) {
                    const header: InfoDetailItem = { label: description || key, value: '', separator: true }
                    const rows = Object.entries(value).flatMap(([k, v]) => flattenValue(k, v, undefined, depth + 1))
                    return [header, ...rows]
                  }
                  return Object.entries(value).flatMap(([k, v]) => flattenValue(k, v, undefined, depth + 1))
                }
                return [{ fieldKey: key, label: description || key, value: String(value) }]
              }

              // 用 schema 生成结构化详情行（模态框内显示）
              const getStructuredDetails = (): InfoDetailItem[] => {
                const data = comp.data
                if (data === null || data === undefined) return [{ label: t('panel.noData'), value: '—' }]

                if (isArray && Array.isArray(data)) {
                  const itemSchema = schema?.items
                  return data.flatMap((item, i) => {
                    const separator: InfoDetailItem = { label: `#${i + 1}`, value: '', separator: true }
                    if (typeof item === 'object' && item !== null) {
                      const rows: InfoDetailItem[] = Object.entries(item).flatMap(([k, v]) => {
                        const desc = itemSchema?.properties?.[k]?.description
                        return flattenValue(k, v, desc || k)
                      })
                      return [separator, ...rows]
                    }
                    return [separator, { label: t('panel.value'), value: String(item) }]
                  })
                }

                if (typeof data === 'object' && !Array.isArray(data)) {
                  return Object.entries(data).flatMap(([k, v]) => {
                    const desc = schema?.properties?.[k]?.description
                    return flattenValue(k, v, desc || k)
                  })
                }

                return [{ label: t('panel.value'), value: String(data) }]
              }

              return (
                <div
                  key={idx}
                  className="custom-component-item"
                  onClick={() => {
                    onShowInfo({
                      title: `🧩 ${displayName}`,
                      description: isArray ? t('panel.listComponent', { count: Array.isArray(comp.data) ? comp.data.length : 0 }) : schema?.description,
                      structuredDetails: getStructuredDetails()
                    })
                  }}
                >
                  <span className="component-name">{displayName}</span>
                  <span className="component-preview">{getPreview(comp.data)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 关系 */}
      {creature.Relationship?.relationships && creature.Relationship.relationships.length > 0 && (
        <div className="info-section">
          <h3>💕 {t('panel.relationships')}</h3>
          <div className="relationships-list">
            {creature.Relationship.relationships.map((rel, idx) => {
              const targetName = creaturesRegistry.get(rel.target_creature_id)?.name || rel.target_creature_id
              return (
                <div key={idx} className="rel-item">
                  <span className="rel-target">{targetName}</span>
                  <span className="rel-name-value">{rel.name}( {rel.value})</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 位置 */}
      {creature.LocationRef && (
        <div className="info-section">
          <h3>📍 {t('panel.location')}</h3>
          <div className="location-info">
            <div
              className="location-combined clickable"
              onClick={() => {
                if (onShowLocation) {
                  onShowLocation(creature.LocationRef!.region_id, creature.LocationRef!.location_id)
                }
              }}
              style={{ cursor: onShowLocation ? 'pointer' : 'default' }}
            >
              <span className="location-label">{t('panel.regionLabel')}</span>
              <span className="location-value">
                {regionsRegistry.get(creature.LocationRef.region_id)?.name || creature.LocationRef.region_id}
              </span>
              <span className="location-separator">·</span>
              <span className="location-label">{t('panel.locationLabel')}</span>
              <span className="location-value">
                {locationsRegistry.get(creature.LocationRef.location_id)?.name || creature.LocationRef.location_id}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 日志 */}
      {creature.Log?.entries && creature.Log.entries.length > 0 && (
        <div className="info-section">
          <h3>📜 {t('panel.log')}</h3>
          <div className="creature-log">
            {creature.Log.entries.slice(-10).map((entry, idx) => (
              <div key={idx} className="log-entry">
                <div className="log-time">{entry.add_at}</div>
                <div className="log-content">{entry.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 设定文档 */}
      {creature.BindSetting?.documents && creature.BindSetting.documents.length > 0 && (
        <div className="info-section">
          <h3>📚 {t('panel.settingDocs')}</h3>
          <div className="setting-docs-list">
            {creature.BindSetting.documents.map((doc, idx) => (
              <div
                key={idx}
                className={`setting-doc-item${doc.disable ? ' disabled' : ''}`}
                onClick={() => !doc.disable && onShowInfo({ title: `📄 ${doc.name}`, description: doc.content })}
              >
                <span className="setting-doc-name">{doc.name}</span>
                {doc.disable && <span className="setting-doc-badge disabled">{t('panel.disabled')}</span>}
                {doc.static_priority !== undefined && !doc.disable && (
                  <span className="setting-doc-badge priority">P{doc.static_priority}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

}
