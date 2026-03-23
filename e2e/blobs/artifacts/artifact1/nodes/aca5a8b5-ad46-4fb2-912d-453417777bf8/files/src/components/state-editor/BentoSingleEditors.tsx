/**
 * BentoSingleEditors - 共享的单条目编辑器组件
 * 用于在 BentoEditModal 中编辑单个列表条目
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { LogEntry, StatusEffect, Item, Relationship, CustomComponentDef, SettingDocument } from '../../api/types'
import { KeyValuePairEditor, SchemaValueEditor } from './CommonEditors'
import { generateUniqueId } from './types'

// =============================================================================
// 单条日志编辑器
// =============================================================================

export const SingleLogEntryEditor: React.FC<{
  entry: LogEntry
  onChange: (patch: Partial<LogEntry>) => void
  onDelete: () => void
}> = ({ entry, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-group" style={{ marginBottom: '16px' }}>
        <label>{t('world.logTime')}</label>
        <input
          type="text"
          value={entry.add_at}
          onChange={e => onChange({ add_at: e.target.value })}
          placeholder={t('commonEditors.logTimePlaceholder')}
        />
      </div>
      <div className="form-group" style={{ marginBottom: '20px' }}>
        <label>{t('world.logContent')}</label>
        <textarea
          value={entry.content}
          onChange={e => onChange({ content: e.target.value })}
          placeholder={t('world.logContentPlaceholder')}
          rows={5}
        />
      </div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单个状态效果编辑器
// =============================================================================

export const SingleStatusEffectEditor: React.FC<{
  effect: StatusEffect
  onChange: (patch: Partial<StatusEffect>) => void
  onDelete: () => void
}> = ({ effect, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('creatures.instanceId')}</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={effect.instance_id}
              onChange={e => onChange({ instance_id: e.target.value })}
              placeholder={t('creatures.instanceIdPlaceholder')}
              style={{ flex: 1 }}
            />
            <button
              className="paper-bento-edit-btn"
              onClick={() => onChange({ instance_id: generateUniqueId('status_inst') })}
              title={t('creatures.generateRandomId')}
              style={{ flexShrink: 0 }}
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
            onChange={e => onChange({ display_name: e.target.value || undefined })}
            placeholder={t('creatures.displayNamePlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('creatures.remark')}</label>
          <input
            type="text"
            value={effect.remark || ''}
            onChange={e => onChange({ remark: e.target.value || undefined })}
            placeholder={t('creatures.remarkPlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('creatures.addAt')}</label>
          <input
            type="text"
            value={effect.add_at || ''}
            onChange={e => onChange({ add_at: e.target.value || undefined })}
            placeholder={t('creatures.addAtPlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('creatures.lastUpdateAt')}</label>
          <input
            type="text"
            value={effect.last_update_at || ''}
            onChange={e => onChange({ last_update_at: e.target.value || undefined })}
            placeholder={t('creatures.lastUpdateAtPlaceholder')}
          />
        </div>
      </div>
      <div className="form-group" style={{ marginTop: '16px' }}>
        <label>{t('creatures.value')}</label>
        <KeyValuePairEditor
          value={effect.data}
          onChange={data => onChange({ data })}
        />
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单个物品编辑器
// =============================================================================

export const SingleInventoryItemEditor: React.FC<{
  item: Item
  onChange: (patch: Partial<Item>) => void
  onDelete: () => void
}> = ({ item, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>ID</label>
          <input
            type="text"
            value={item.id}
            onChange={e => onChange({ id: e.target.value })}
            placeholder="item_id"
          />
        </div>
        <div className="form-group">
          <label>{t('creatures.itemName')}</label>
          <input
            type="text"
            value={item.name || ''}
            onChange={e => onChange({ name: e.target.value })}
            placeholder={t('creatures.itemNamePlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('creatures.itemCount')}</label>
          <input
            type="number"
            value={item.count}
            onChange={e => onChange({ count: parseInt(e.target.value) || 1 })}
            min={1}
          />
        </div>
      </div>
      <div className="form-group" style={{ marginTop: '16px' }}>
        <label>{t('creatures.itemDescription')}</label>
        <textarea
          value={item.description}
          onChange={e => onChange({ description: e.target.value })}
          rows={3}
        />
      </div>
      <div className="form-group" style={{ marginTop: '16px' }}>
        <label>{t('creatures.itemDetails')}</label>
        <textarea
          value={item.details?.join('\n') || ''}
          onChange={e => onChange({ details: e.target.value ? e.target.value.split('\n') : [] })}
          rows={3}
          placeholder={t('creatures.itemDetailsPlaceholder')}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={item.equipped || false}
            onChange={e => onChange({ equipped: e.target.checked || undefined })}
          />
          {t('creatures.equipped', { defaultValue: 'Equipped' })}
        </label>
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单个关系编辑器
// =============================================================================

export const SingleRelationshipEditor: React.FC<{
  relationship: Relationship
  allCreatures: Array<{ creature_id: string; name: string }>
  onChange: (patch: Partial<Relationship>) => void
  onDelete: () => void
}> = ({ relationship, allCreatures, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('creatures.targetCreature')}</label>
          <select
            value={relationship.target_creature_id}
            onChange={e => onChange({ target_creature_id: e.target.value })}
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
            value={relationship.name}
            onChange={e => onChange({ name: e.target.value })}
            placeholder={t('creatures.relationPlaceholder')}
          />
        </div>
      </div>
      <div className="form-group" style={{ marginTop: '16px' }}>
        <label>{t('creatures.relationValue', { value: relationship.value })}</label>
        <input
          type="range"
          min={-100}
          max={100}
          value={relationship.value}
          onChange={e => onChange({ value: parseInt(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--paper-text-tertiary)' }}>
          <span>-100</span>
          <span style={{ fontWeight: 700, color: relationship.value >= 0 ? 'var(--paper-lime-green)' : 'var(--paper-coral)' }}>
            {relationship.value}
          </span>
          <span>100</span>
        </div>
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单个自定义组件编辑器
// =============================================================================

export const SingleCustomComponentEditor: React.FC<{
  comp: { component_key: string; data: any }
  registryKeys?: string[]
  componentDefs?: CustomComponentDef[]
  onChange: (patch: Partial<{ component_key: string; data: any }>) => void
  onDelete: () => void
}> = ({ comp, registryKeys, componentDefs, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  const matchedDef = componentDefs?.find(d => d.component_key === comp.component_key)
  const itemSchema = matchedDef
    ? (matchedDef.is_array ? matchedDef.type_schema?.items : matchedDef.type_schema)
    : undefined

  return (
    <div>
      <div className="form-group" style={{ marginBottom: '16px' }}>
        <label>{t('creatures.componentKey')}</label>
        {registryKeys && registryKeys.length > 0 ? (
          <select
            value={comp.component_key}
            onChange={e => onChange({ component_key: e.target.value })}
          >
            <option value="">{t('creatures.selectComponentKey')}</option>
            {registryKeys.map(key => {
              const def = componentDefs?.find(d => d.component_key === key)
              const displayName = def?.component_name ? `${def.component_name} (${key})` : key
              return (
                <option key={key} value={key}>{displayName}</option>
              )
            })}
          </select>
        ) : (
          <input
            type="text"
            value={comp.component_key}
            onChange={e => onChange({ component_key: e.target.value })}
            placeholder={t('creatures.componentKeyPlaceholder')}
          />
        )}
      </div>
      <div className="form-group">
        <label>{t('creatures.value')}</label>
        {itemSchema ? (
          <SchemaValueEditor
            schema={itemSchema}
            value={comp.data}
            onChange={data => onChange({ data })}
          />
        ) : (
          <div style={{ padding: '8px 12px', color: 'var(--paper-text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
            {t('creatures.selectComponentFirst')}
          </div>
        )}
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单篇设定文档编辑器
// =============================================================================

export const SingleDocumentEditor: React.FC<{
  doc: SettingDocument
  onChange: (patch: Partial<SettingDocument>) => void
  onDelete: () => void
}> = ({ doc, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-grid" style={{ marginBottom: '16px' }}>
        <div className="form-group">
          <label>{t('world.docName')}</label>
          <input
            type="text"
            value={doc.name}
            onChange={e => onChange({ name: e.target.value })}
            placeholder={t('world.docNamePlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('world.docCondition')}</label>
          <input
            type="text"
            value={doc.condition || ''}
            onChange={e => onChange({ condition: e.target.value || undefined })}
            placeholder={t('world.docConditionPlaceholder')}
          />
        </div>
      </div>
      <div className="form-grid" style={{ marginBottom: '16px' }}>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {t('world.docDisable')}
            <label className="toggle-switch" style={{ marginLeft: '4px' }}>
              <input
                type="checkbox"
                checked={!!doc.disable}
                onChange={e => onChange({ disable: e.target.checked || undefined })}
              />
              <span className="toggle-slider"></span>
            </label>
          </label>
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {t('world.docPriority')}
            <label className="toggle-switch" style={{ marginLeft: '4px' }}>
              <input
                type="checkbox"
                checked={doc.static_priority !== undefined}
                onChange={e => onChange({ static_priority: e.target.checked ? 10 : undefined })}
              />
              <span className="toggle-slider"></span>
            </label>
            {doc.static_priority !== undefined && (
              <input
                type="number"
                value={doc.static_priority}
                onChange={e => onChange({ static_priority: parseInt(e.target.value) || 0 })}
                min={0}
                style={{ width: '80px' }}
              />
            )}
          </label>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: '20px' }}>
        <label>{t('world.docContent')}</label>
        <textarea
          value={doc.content}
          onChange={e => onChange({ content: e.target.value })}
          placeholder={t('world.docContentPlaceholder')}
          rows={12}
          style={{ fontFamily: 'var(--paper-font-mono)', lineHeight: '1.6' }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--paper-font-size-xs)', color: 'var(--paper-text-tertiary)' }}>
          {doc.content.split('\n').length} {t('world.lines')} · {doc.content.length} {t('world.chars')}
        </span>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}
