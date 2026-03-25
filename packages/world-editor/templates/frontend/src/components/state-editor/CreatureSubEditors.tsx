import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  StatusEffect,
  Item,
  Relationship,
  SettingDocument,
  BindSetting,
  CustomComponentDef
} from '../../api/types'
import { showConfirm } from '../AlertDialog'
import { SchemaValueEditor, KeyValuePairEditor } from './CommonEditors'
import { getDefaultValueForSchema, generateUniqueId } from './types'

// ============================================================================
// 技艺编辑子组件
// ============================================================================

export const SkillsSubEditor: React.FC<{
  skills: Record<string, number>
  availableSkills: Array<{ id: string; name: string }>
  onChange: (skills: Record<string, number>) => void
}> = ({ skills, availableSkills, onChange }) => {
  const { t } = useTranslation('editor')
  const addSkill = () => {
    const unusedSkill = availableSkills.find(s => !(s.id in skills))
    if (unusedSkill) {
      onChange({ ...skills, [unusedSkill.id]: 0 })
    } else {
      onChange({ ...skills, [`skill_${Date.now()}`]: 0 })
    }
  }
  
  return (
    <div className="subsection">
      <h4>{t('creatures.skillsExp', { count: Object.keys(skills).length })}</h4>
      <button className="btn-add-small" onClick={addSkill}>{t('creatures.addSkill')}</button>
      <div className="skill-list">
        {Object.entries(skills).map(([skillId, exp]) => (
          <div key={skillId} className="skill-item nested-item">
            <select
              value={skillId}
              onChange={e => {
                const newSkills = { ...skills }
                delete newSkills[skillId]
                newSkills[e.target.value] = exp
                onChange(newSkills)
              }}
            >
              <option value={skillId}>{availableSkills.find(s => s.id === skillId)?.name || skillId}</option>
              {availableSkills.filter(s => !(s.id in skills) || s.id === skillId).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <input
              type="number"
              value={exp}
              onChange={e => onChange({ ...skills, [skillId]: parseInt(e.target.value) || 0 })}
              placeholder={t('creatures.expValue')}
              style={{ width: '80px' }}
            />
            <button
              className="btn-remove-small"
              onClick={() => {
                const newSkills = { ...skills }
                delete newSkills[skillId]
                onChange(newSkills)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// 物品编辑子组件
// ============================================================================

export const InventorySubEditor: React.FC<{
  items: Item[]
  onChange: (items: Item[]) => void
}> = ({ items, onChange }) => {
  const { t } = useTranslation('editor')
  const addItem = () => {
    onChange([...items, { id: '', count: 1, name: '', description: '', details: [] }])
  }

  return (
    <div className="subsection">
      <h4>{t('creatures.inventoryItems', { count: items.length })}</h4>
      <button className="btn-add-small" onClick={addItem}>{t('creatures.addItem')}</button>
      <div className="inventory-list">
        {items.map((item, index) => (
          <div key={`inv-${item.id}-${index}`} className="inventory-item nested-item">
            <input
              type="text"
              value={item.id}
              placeholder="item_id"
              onChange={e => {
                const newItems = [...items]
                newItems[index] = { ...item, id: e.target.value }
                onChange(newItems)
              }}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={item.count}
              onChange={e => {
                const newItems = [...items]
                newItems[index] = { ...item, count: parseInt(e.target.value) || 1 }
                onChange(newItems)
              }}
              min={1}
              style={{ width: 60 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={item.equipped || false}
                onChange={e => {
                  const newItems = [...items]
                  newItems[index] = { ...item, equipped: e.target.checked || undefined }
                  onChange(newItems)
                }}
              />
              {t('creatures.equipped', 'Equipped')}
            </label>
            <button
              className="btn-remove-small"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ✕
            </button>
            <div style={{ width: '100%', marginTop: 4, display: 'flex', gap: '4px' }}>
              <input
                type="text"
                value={item.name || ''}
                placeholder={t('creatures.itemName', 'Name')}
                onChange={e => {
                  const newItems = [...items]
                  newItems[index] = { ...item, name: e.target.value }
                  onChange(newItems)
                }}
                style={{ flex: 1 }}
              />
              <input
                type="text"
                value={item.description}
                placeholder={t('creatures.itemDescription', 'Description')}
                onChange={e => {
                  const newItems = [...items]
                  newItems[index] = { ...item, description: e.target.value }
                  onChange(newItems)
                }}
                style={{ flex: 2 }}
              />
            </div>
            <div style={{ width: '100%', marginTop: 4 }}>
              <textarea
                value={item.details?.join('\n') || ''}
                placeholder={t('creatures.itemDetails', 'Details (one per line)')}
                onChange={e => {
                  const newItems = [...items]
                  newItems[index] = { ...item, details: e.target.value ? e.target.value.split('\n') : [] }
                  onChange(newItems)
                }}
                style={{ width: '100%' }}
                rows={2}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// 状态编辑子组件
// ============================================================================

export const StatusEffectsSubEditor: React.FC<{
  effects: StatusEffect[]
  onChange: (effects: StatusEffect[]) => void
}> = ({ effects, onChange }) => {
  const { t } = useTranslation('editor')
  const addEffect = () => {
    const newEffect: StatusEffect = {
      instance_id: generateUniqueId('status_inst'),
      display_name: '',
      data: undefined
    }
    onChange([...effects, newEffect])
  }
  
  // 生成随机实例ID
  const generateRandomId = (index: number) => {
    const newEffects = [...effects]
    newEffects[index] = { 
      ...effects[index], 
      instance_id: generateUniqueId('status_inst') 
    }
    onChange(newEffects)
  }
  
  return (
    <div className="subsection">
      <h4>{t('creatures.statusList', { count: effects.length })}</h4>
      <button className="btn-add-small" onClick={addEffect}>{t('creatures.addStatus')}</button>
      <div className="relationships-list">
        {effects.map((effect, index) => (
          <div key={`effect-${index}`} className="relationship-item nested-item" style={{ borderLeftColor: '#8b5cf6' }}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('creatures.instanceId')}</label>
                <div className="instance-id-input-group">
                  <input
                    type="text"
                    value={effect.instance_id}
                    onChange={e => {
                      const newEffects = [...effects]
                      newEffects[index] = { ...effect, instance_id: e.target.value }
                      onChange(newEffects)
                    }}
                    placeholder={t('creatures.instanceIdPlaceholder')}
                  />
                  <button
                    className="btn-dice"
                    onClick={() => generateRandomId(index)}
                    title={t('creatures.generateRandomId')}
                  >
                    🎲
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>{t('creatures.displayName')}</label>
                <input
                  type="text"
                  value={effect.display_name || ''}
                  onChange={e => {
                    const newEffects = [...effects]
                    newEffects[index] = { ...effect, display_name: e.target.value || undefined }
                    onChange(newEffects)
                  }}
                  placeholder={t('creatures.displayNamePlaceholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('creatures.remark')}</label>
                <input
                  type="text"
                  value={effect.remark || ''}
                  onChange={e => {
                    const newEffects = [...effects]
                    newEffects[index] = { ...effect, remark: e.target.value || undefined }
                    onChange(newEffects)
                  }}
                  placeholder={t('creatures.remarkPlaceholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('creatures.addAt')}</label>
                <input
                  type="text"
                  value={effect.add_at || ''}
                  onChange={e => {
                    const newEffects = [...effects]
                    newEffects[index] = { ...effect, add_at: e.target.value || undefined }
                    onChange(newEffects)
                  }}
                  placeholder={t('creatures.addAtPlaceholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('creatures.lastUpdateAt')}</label>
                <input
                  type="text"
                  value={effect.last_update_at || ''}
                  onChange={e => {
                    const newEffects = [...effects]
                    newEffects[index] = { ...effect, last_update_at: e.target.value || undefined }
                    onChange(newEffects)
                  }}
                  placeholder={t('creatures.lastUpdateAtPlaceholder')}
                />
              </div>
            </div>
            {/* 数据编辑区域 */}
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label>{t('creatures.value')}</label>
              <KeyValuePairEditor
                value={effect.data}
                onChange={data => {
                  const newEffects = [...effects]
                  newEffects[index] = { ...effect, data }
                  onChange(newEffects)
                }}
              />
            </div>
            <button
              className="btn-remove-small"
              onClick={() => onChange(effects.filter((_, i) => i !== index))}
            >
              ❌
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
// ============================================================================
// 自定义组件编辑子组件
// ============================================================================

export const CustomComponentsSubEditor: React.FC<{
  components: Array<{ component_key: string; data: any }>
  onChange: (components: Array<{ component_key: string; data: any }>) => void
  registryKeys?: string[]
  componentDefs?: CustomComponentDef[]
}> = ({ components, onChange, registryKeys, componentDefs }) => {
  const { t } = useTranslation('editor')
  
  const addComponent = () => {
    onChange([...components, { component_key: '', data: undefined }])
  }
  
  return (
    <div className="subsection">
      <h4>{t('creatures.customComponentList', { count: components.length })}</h4>
      <button className="btn-add-small" onClick={addComponent}>{t('creatures.addCustomComponent')}</button>
      <div className="relationships-list">
        {components.map((comp, index) => (
          <div key={`comp-${index}`} className="relationship-item nested-item" style={{ borderLeftColor: 'var(--paper-lime-green)' }}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('creatures.componentKey')}</label>
                {registryKeys && registryKeys.length > 0 ? (
                  <select
                    value={comp.component_key}
                    onChange={e => {
                      const newComps = [...components]
                      newComps[index] = { ...comp, component_key: e.target.value }
                      onChange(newComps)
                    }}
                  >
                    <option value="">{t('creatures.selectComponentKey')}</option>
                    {registryKeys.map(key => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={comp.component_key}
                    onChange={e => {
                      const newComps = [...components]
                      newComps[index] = { ...comp, component_key: e.target.value }
                      onChange(newComps)
                    }}
                    placeholder={t('creatures.componentKeyPlaceholder')}
                  />
                )}
              </div>
            </div>
            
            {/* 数据编辑区域 */}
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label>{t('creatures.value')}</label>
              {(() => {
                // 查找匹配的 schema
                const matchedDef = componentDefs?.find(d => d.component_key === comp.component_key)
                const itemSchema = matchedDef
                  ? (matchedDef.is_array ? matchedDef.type_schema?.items : matchedDef.type_schema)
                  : undefined
                if (!itemSchema) {
                  return (
                    <div style={{ padding: '8px 12px', color: 'var(--paper-text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      {t('creatures.selectComponentFirst')}
                    </div>
                  )
                }
                return (
                  <SchemaValueEditor
                    schema={itemSchema}
                    value={comp.data}
                    onChange={data => {
                      const newComps = [...components]
                      newComps[index] = { ...comp, data }
                      onChange(newComps)
                    }}
                  />
                )
              })()}
            </div>
            <button
              className="btn-remove-small"
              onClick={() => onChange(components.filter((_, i) => i !== index))}
            >
              ❌
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// 关系编辑子组件
// ============================================================================

export const RelationshipsSubEditor: React.FC<{
  relationships: Relationship[]
  allCreatures: Array<{ creature_id: string; name: string }>
  onChange: (relationships: Relationship[]) => void
}> = ({ relationships, allCreatures, onChange }) => {
  const { t } = useTranslation('editor')
  const addRelationship = () => {
    const newRel: Relationship = {
      target_creature_id: allCreatures[0]?.creature_id || '',
      name: t('creatures.relationFriend'),
      value: 50
    }
    onChange([...relationships, newRel])
  }
  
  return (
    <div className="subsection">
      <h4>{t('creatures.relationList', { count: relationships.length })}</h4>
      <button className="btn-add-small" onClick={addRelationship}>{t('creatures.addRelation')}</button>
      <div className="relationships-list">
        {relationships.map((rel, index) => (
          <div key={`rel-${index}`} className="relationship-item nested-item">
            <div className="form-grid">
              <div className="form-group">
                <label>{t('creatures.targetCreature')}</label>
                <select
                  value={rel.target_creature_id}
                  onChange={e => {
                    const newRels = [...relationships]
                    newRels[index] = { ...rel, target_creature_id: e.target.value }
                    onChange(newRels)
                  }}
                >
                  <option value="">{t('creatures.selectCreature')}</option>
                  {allCreatures.map(c => (
                    <option key={c.creature_id} value={c.creature_id}>{c.name} ({c.creature_id})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t('creatures.relationName')}</label>
                <input
                  type="text"
                  value={rel.name}
                  onChange={e => {
                    const newRels = [...relationships]
                    newRels[index] = { ...rel, name: e.target.value }
                    onChange(newRels)
                  }}
                  placeholder={t('creatures.relationPlaceholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('creatures.relationValue', { value: rel.value })}</label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={rel.value}
                  onChange={e => {
                    const newRels = [...relationships]
                    newRels[index] = { ...rel, value: parseInt(e.target.value) }
                    onChange(newRels)
                  }}
                />
              </div>
            </div>
            <button
              className="btn-remove-small"
              onClick={() => onChange(relationships.filter((_, i) => i !== index))}
            >
              ❌
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// BindSetting 编辑子组件
// ============================================================================

export const BindSettingSubEditor: React.FC<{
  bindSetting?: BindSetting
  onChange: (bindSetting: BindSetting | undefined) => void
  title?: string
}> = ({ bindSetting, onChange, title }) => {
  const { t } = useTranslation('editor')
  const displayTitle = title ?? t('creatures.settingDocBinding')
  const hasSetting = bindSetting !== undefined
  const docCount = bindSetting?.documents?.length || 0

  return (
    <div className="subsection">
      <h4>📚 {displayTitle}</h4>
      {hasSetting ? (
        <div className="nested-item">
          <div className="form-group">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              background: 'rgba(99, 102, 241, 0.1)',
              borderRadius: '6px',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              fontSize: '0.85rem',
              color: 'var(--paper-text-secondary)'
            }}>
              <span style={{ fontSize: '1.1rem' }}>📄</span>
              <span>{docCount} {t('creatures.documentsCount', { count: docCount })}</span>
              <span style={{ color: 'var(--paper-text-tertiary)', fontSize: '0.8rem', marginLeft: 'auto' }}>
                {t('creatures.editInSettingPanel')}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <button
          className="btn-add-small"
          onClick={() => onChange({ documents: [] })}
        >
          {t('creatures.addSettingBinding')}
        </button>
      )}
    </div>
  )
}
