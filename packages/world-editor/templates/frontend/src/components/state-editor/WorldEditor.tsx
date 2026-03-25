import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorldSnapshot, CustomComponentDef, CreatureAttrField, TypeSchema, LogEntry, SettingDocument } from '../../api/types'
import { TypeSchemaEditor, SchemaValueEditor } from './CommonEditors'
import { showPrompt } from '../AlertDialog'
import { DEFAULT_GAME_TIME, generateUniqueId, getDefaultValueForSchema } from './types'
import { BentoEditModal } from './BentoEditModal'
import { SingleLogEntryEditor, SingleDocumentEditor } from './BentoSingleEditors'

// ============================================================================
// 世界编辑器 (Bento Grid - 重展示，轻编辑)
// 每个条目以小卡片展示，点击编辑打开单条目模态框
// ============================================================================

type EditingTarget = null
  | { type: 'time' }
  | { type: 'attr_field'; index: number }
  | { type: 'component'; index: number }
  | { type: 'registry'; compIndex: number }
  | { type: 'log_entry'; index: number }
  | { type: 'document'; index: number }
  | { type: 'note'; index: number }
  | { type: 'flag'; key: string }
  | { type: 'stage_goal' };

export const WorldEditor: React.FC<{
  world: WorldSnapshot
  onChange: (world: WorldSnapshot) => void
  simpleMode?: boolean
}> = ({ world, onChange, simpleMode }) => {
  const { t } = useTranslation('editor')
  const gameTime = world.GameTime || DEFAULT_GAME_TIME
  const registry = world.Registry || {}
  const customComponentRegistry = world.CustomComponentRegistry || { custom_components: [] }
  const [editing, setEditing] = useState<EditingTarget>(null)

  const closeModal = useCallback(() => setEditing(null), [])

  const notes = world.DirectorNotes?.notes || []
  const flags = world.DirectorNotes?.flags || {}
  const flagEntries = Object.entries(flags)
  const documents = world.BindSetting?.documents || []
  const attrFields = registry.creature_attr_fields || []
  const components = customComponentRegistry.custom_components || []
  const logEntries = world.Log?.entries || []

  // 拥有注册表的组件列表
  const registryComponents = useMemo(() => {
    return components
      .map((def, index) => ({ def, index }))
      .filter(({ def }) => Array.isArray(def.data_registry))
  }, [components])

  // --- 属性字段 CRUD ---
  const addAttrField = () => {
    const newFields = [...attrFields, { field_name: '', hint: '' }]
    onChange({ ...world, Registry: { ...registry, creature_attr_fields: newFields } })
    setEditing({ type: 'attr_field', index: newFields.length - 1 })
  }
  const updateAttrField = (index: number, updates: Partial<CreatureAttrField>) => {
    const newFields = [...attrFields]
    newFields[index] = { ...newFields[index], ...updates }
    onChange({ ...world, Registry: { ...registry, creature_attr_fields: newFields } })
  }
  const removeAttrField = (index: number) => {
    onChange({ ...world, Registry: { ...registry, creature_attr_fields: attrFields.filter((_, i) => i !== index) } })
    closeModal()
  }

  // --- 日志 CRUD ---
  const addLogEntry = () => {
    const now = new Date()
    const add_at = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const newEntries = [...logEntries, { content: '', add_at }]
    onChange({ ...world, Log: { entries: newEntries } })
    setEditing({ type: 'log_entry', index: newEntries.length - 1 })
  }
  const updateLogEntry = (index: number, patch: Partial<LogEntry>) => {
    const newEntries = [...logEntries]
    newEntries[index] = { ...newEntries[index], ...patch }
    onChange({ ...world, Log: { entries: newEntries } })
  }
  const removeLogEntry = (index: number) => {
    onChange({ ...world, Log: { entries: logEntries.filter((_, i) => i !== index) } })
    closeModal()
  }

  // --- 设定文档 CRUD ---
  const addDocument = () => {
    const newDocs = [...documents, { name: t('world.newDocName'), content: '' }]
    onChange({ ...world, BindSetting: { documents: newDocs } })
    setEditing({ type: 'document', index: newDocs.length - 1 })
  }
  const updateDocument = (index: number, patch: Partial<SettingDocument>) => {
    const newDocs = [...documents]
    newDocs[index] = { ...newDocs[index], ...patch }
    onChange({ ...world, BindSetting: { documents: newDocs } })
  }
  const removeDocument = (index: number) => {
    onChange({ ...world, BindSetting: { documents: documents.filter((_, i) => i !== index) } })
    closeModal()
  }

  // --- 笔记 CRUD ---
  const addNote = () => {
    const newNotes = [...notes, '']
    onChange({ ...world, DirectorNotes: { notes: newNotes, flags } })
    setEditing({ type: 'note', index: newNotes.length - 1 })
  }
  const updateNote = (index: number, value: string) => {
    const newNotes = [...notes]
    newNotes[index] = value
    onChange({ ...world, DirectorNotes: { notes: newNotes, flags } })
  }
  const removeNote = (index: number) => {
    onChange({ ...world, DirectorNotes: { notes: notes.filter((_, i) => i !== index), flags } })
    closeModal()
  }

  // --- 标志 CRUD ---
  const addFlag = (id: string) => {
    if (!id.trim() || id.trim() in flags) return
    onChange({ ...world, DirectorNotes: { notes, flags: { ...flags, [id.trim()]: { id: id.trim(), value: false } } } })
    setEditing({ type: 'flag', key: id.trim() })
  }
  const updateFlag = (key: string, patch: Partial<{ id: string; value: boolean; remark?: string }>) => {
    onChange({ ...world, DirectorNotes: { notes, flags: { ...flags, [key]: { ...flags[key], ...patch } } } })
  }
  const removeFlag = (key: string) => {
    const newFlags = { ...flags }
    delete newFlags[key]
    onChange({ ...world, DirectorNotes: { notes, flags: newFlags } })
    closeModal()
  }
  const renameFlag = (oldKey: string, newId: string) => {
    if (!newId.trim() || newId.trim() === oldKey || newId.trim() in flags) return
    const newFlags = { ...flags }
    const oldFlag = newFlags[oldKey]
    delete newFlags[oldKey]
    newFlags[newId.trim()] = { ...oldFlag, id: newId.trim() }
    onChange({ ...world, DirectorNotes: { notes, flags: newFlags } })
    setEditing({ type: 'flag', key: newId.trim() })
  }

  // --- 阶段目标 CRUD ---
  const updateStageGoal = (val: string) => {
    onChange({ ...world, DirectorNotes: { notes, flags, stage_goal: val || null } })
  }

  // --- 自定义组件 CRUD ---
  const addComponent = () => {
    const newDef: CustomComponentDef = {
      component_key: generateUniqueId('comp'),
      component_name: '',
      is_array: false,
      type_schema: { type: 'object', properties: {} }
    }
    onChange({ ...world, CustomComponentRegistry: { custom_components: [...components, newDef] } })
    setEditing({ type: 'component', index: components.length })
  }
  const updateComponent = (index: number, patch: Partial<CustomComponentDef>) => {
    const newDefs = [...components]
    newDefs[index] = { ...newDefs[index], ...patch }
    onChange({ ...world, CustomComponentRegistry: { custom_components: newDefs } })
  }
  const removeComponent = (index: number) => {
    onChange({ ...world, CustomComponentRegistry: { custom_components: components.filter((_, i) => i !== index) } })
    closeModal()
  }

  // 当前编辑的属性字段
  const editingAttrField = editing?.type === 'attr_field' ? attrFields[editing.index] : null
  const editingAttrIndex = editing?.type === 'attr_field' ? editing.index : -1
  // 当前编辑的组件
  const editingComponent = editing?.type === 'component' ? components[editing.index] : null
  const editingCompIndex = editing?.type === 'component' ? editing.index : -1
  // 当前编辑的注册表
  const editingRegistryCompIndex = editing?.type === 'registry' ? editing.compIndex : -1
  const editingRegistryDef = editingRegistryCompIndex >= 0 ? components[editingRegistryCompIndex] : undefined
  // 当前编辑的日志条目
  const editingLogEntry = editing?.type === 'log_entry' ? logEntries[editing.index] : null
  const editingLogIndex = editing?.type === 'log_entry' ? editing.index : -1
  // 当前编辑的文档
  const editingDocument = editing?.type === 'document' ? documents[editing.index] : null
  const editingDocIndex = editing?.type === 'document' ? editing.index : -1
  // 当前编辑的笔记
  const editingNoteIndex = editing?.type === 'note' ? editing.index : -1
  const editingNote = editingNoteIndex >= 0 ? notes[editingNoteIndex] : null
  // 当前编辑的标志
  const editingFlagKey = editing?.type === 'flag' ? editing.key : null
  const editingFlag = editingFlagKey ? flags[editingFlagKey] : null

  return (
    <div className="paper-bento-scroll">
      <div className="paper-bento-grid">

        {/* ===== 时间 ===== */}
        <div className="paper-bento-card paper-bento-time">
          <div className="paper-bento-summary-header">
            <h3 className="section-title">⏰ {t('world.sections.time')}</h3>
            <button className="paper-bento-edit-btn" onClick={() => setEditing({ type: 'time' })}>✏️ {t('common:edit')}</button>
          </div>
          <div className="paper-bento-time-display">
            {gameTime.year}{t('dashboard.year')}{gameTime.month}{t('dashboard.month')}{gameTime.day}{t('dashboard.day')}
          </div>
          <div className="paper-bento-time-detail">
            {String(gameTime.hour).padStart(2, '0')}:{String(gameTime.minute).padStart(2, '0')}
          </div>
        </div>

        {/* ===== 属性字段 - 每个字段一张小卡片 ===== */}
        {!simpleMode && (
          <div className="paper-bento-card paper-bento-attr">
            <div className="paper-bento-summary-header">
              <h3 className="section-title">🎯 {t('world.sections.attr_fields')}</h3>
              <button className="paper-bento-edit-btn" onClick={addAttrField}>+ {t('world.addAttrField')}</button>
            </div>
            {attrFields.length > 0 ? (
              <div className="paper-bento-item-grid">
                {attrFields.map((f, i) => (
                  <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'attr_field', index: i })}>
                    <div className="paper-mini-card-title">{f.field_display_name || f.field_name || t('world.unnamedField')}</div>
                    <div className="paper-mini-card-desc" style={{ fontFamily: 'monospace', color: 'var(--paper-electric-blue)' }}>{f.field_name}</div>
                    <div className="paper-mini-card-meta">{f.hint || '-'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="paper-bento-empty">{t('world.noAttrFields')}</div>
            )}
          </div>
        )}

        {/* ===== 日志 - 每条日志一张小卡片 ===== */}
        <div className="paper-bento-card paper-bento-log">
          <div className="paper-bento-summary-header">
            <h3 className="section-title">📝 {t('world.sections.log')}</h3>
            <button className="paper-bento-edit-btn" onClick={addLogEntry}>+ {t('world.addLogEntry')}</button>
          </div>
          {logEntries.length > 0 ? (
            <div className="paper-bento-item-list">
              {logEntries.map((entry, i) => (
                <div key={i} className="paper-bento-mini-card paper-mini-card-horizontal" onClick={() => setEditing({ type: 'log_entry', index: i })}>
                  <div className="paper-mini-card-badge">{entry.add_at || '?'}</div>
                  <div className="paper-mini-card-title">{entry.content ? (entry.content.length > 60 ? entry.content.slice(0, 60) + '…' : entry.content) : t('world.emptyLogEntry')}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="paper-bento-empty">{t('world.noLogEntries')}</div>
          )}
        </div>

        {/* ===== 设定文档 - 每篇文档一张小卡片 ===== */}
        <div className="paper-bento-card paper-bento-docs">
          <div className="paper-bento-summary-header">
            <h3 className="section-title">📚 {t('world.sections.documents')}</h3>
            <button className="paper-bento-edit-btn" onClick={addDocument}>+ {t('world.addDocument')}</button>
          </div>
          {documents.length > 0 ? (
            <div className="paper-bento-item-grid">
              {documents.map((d, i) => (
                <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'document', index: i })}>
                  <div className="paper-mini-card-title">📄 {d.name || '?'}</div>
                  <div className="paper-mini-card-desc">{d.content ? `${d.content.split('\n').length} ${t('world.lines')}` : t('world.emptyDocument')}</div>
                  <div className="paper-bento-chips" style={{ marginTop: '4px' }}>
                    {d.static_priority !== undefined && <span className="paper-bento-chip chip-blue" style={{ fontSize: '0.65rem' }}>P{d.static_priority}</span>}
                    {d.condition && <span className="paper-bento-chip chip-pink" style={{ fontSize: '0.65rem' }}>🔀</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="paper-bento-empty">{t('world.noDocuments')}</div>
          )}
        </div>

        {/* ===== 导演笔记 - 每条笔记/标志一张小卡片 ===== */}
        <div className="paper-bento-card paper-bento-director">
          <div className="paper-bento-summary-header">
            <h3 className="section-title">🎬 {t('world.sections.director_notes')}</h3>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="paper-bento-edit-btn" onClick={() => setEditing({ type: 'stage_goal' })}>{t('world.editStageGoal')}</button>
              <button className="paper-bento-edit-btn" onClick={addNote}>{t('world.addNote')}</button>
              <button className="paper-bento-edit-btn" onClick={async () => {
                const id = await showPrompt(t('world.flagIdPlaceholder'))
                if (id) addFlag(id)
              }}>{t('world.addFlag')}</button>
            </div>
          </div>

          {/* 阶段目标卡片 */}
          {world.DirectorNotes?.stage_goal && (
            <div className="paper-bento-mini-card paper-mini-card-horizontal" onClick={() => setEditing({ type: 'stage_goal' })} style={{ borderLeftColor: 'var(--paper-vivid-orange)', marginBottom: '8px' }}>
              <span className="paper-mini-card-badge" style={{ backgroundColor: 'var(--paper-vivid-orange)' }}>🎯 Goal</span>
              <div className="paper-mini-card-title">{world.DirectorNotes.stage_goal}</div>
            </div>
          )}

          {/* 笔记卡片 */}
          {notes.length > 0 && (
            <div className="paper-bento-item-list" style={{ marginBottom: flagEntries.length > 0 ? '12px' : '0' }}>
              {notes.map((note, i) => (
                <div key={`note-${i}`} className="paper-bento-mini-card paper-mini-card-horizontal" onClick={() => setEditing({ type: 'note', index: i })}>
                  <span className="paper-mini-card-badge">#{i + 1}</span>
                  <div className="paper-mini-card-title">{note ? (note.length > 60 ? note.slice(0, 60) + '…' : note) : t('world.emptyNote')}</div>
                </div>
              ))}
            </div>
          )}
          {/* 标志卡片 */}
          {flagEntries.length > 0 && (
            <div className="paper-bento-item-grid">
              {flagEntries.map(([key, flag]) => (
                <div key={key} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'flag', key })}>
                  <div className="paper-mini-card-title">{flag.value ? '✅' : '❌'} {key}</div>
                  {flag.remark && <div className="paper-mini-card-desc">{flag.remark}</div>}
                </div>
              ))}
            </div>
          )}
          {notes.length === 0 && flagEntries.length === 0 && (
            <div className="paper-bento-empty">{t('world.noNotes')}</div>
          )}
        </div>

        {/* ===== 自定义组件 - 每个组件一张小卡片 ===== */}
        {!simpleMode && (
          <div className="paper-bento-card paper-bento-components">
            <div className="paper-bento-summary-header">
              <h3 className="section-title">🧩 {t('world.sections.custom_components')}</h3>
              <button className="paper-bento-edit-btn" onClick={addComponent}>{t('world.addCustomComponent')}</button>
            </div>
            {components.length > 0 ? (
              <div className="paper-bento-item-grid">
                {components.map((c, i) => (
                  <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'component', index: i })}>
                    <div className="paper-mini-card-title">🧩 {c.component_name || c.component_key}</div>
                    <div className="paper-mini-card-desc" style={{ fontFamily: 'monospace' }}>{c.component_key}</div>
                    <div className="paper-bento-chips" style={{ marginTop: '4px' }}>
                      <span className="paper-bento-chip" style={{ fontSize: '0.65rem' }}>{c.is_array ? 'Array' : 'Object'}</span>
                      {Array.isArray(c.data_registry) && (
                        <span className="paper-bento-chip chip-active" style={{ fontSize: '0.65rem' }}>📋 {c.data_registry.length}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="paper-bento-empty">{t('world.noCustomComponents')}</div>
            )}
          </div>
        )}

        {/* ===== 动态注册表 - 每个一张卡片 ===== */}
        {!simpleMode && registryComponents.map(({ def, index }) => (
          <div key={`registry_${index}`} className="paper-bento-card paper-bento-registry">
            <div className="paper-bento-summary-header">
              <h3 className="section-title">📋 {def.component_name || def.component_key}</h3>
              <button className="paper-bento-edit-btn" onClick={() => setEditing({ type: 'registry', compIndex: index })}>✏️ {t('common:edit')}</button>
            </div>
            <div className="paper-bento-stat">
              <span className="paper-bento-stat-number">{def.data_registry?.length || 0}</span> {t('world.registeredItems')}
            </div>
            {(def.data_registry?.length || 0) > 0 && (
              <div className="paper-bento-chips">
                {def.data_registry!.slice(0, 10).map((item, i) => (
                  <span key={i} className="paper-bento-chip">{item.item_id || `#${i + 1}`}</span>
                ))}
                {def.data_registry!.length > 10 && (
                  <span className="paper-bento-chip" style={{ fontStyle: 'italic' }}>+{def.data_registry!.length - 10}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* =============== 编辑模态框 =============== */}

      {/* 时间 */}
      <BentoEditModal open={editing?.type === 'time'} onClose={closeModal} title={t('world.sections.time')} icon="⏰">
        <GameTimeEditor gameTime={gameTime} onChange={newTime => onChange({ ...world, GameTime: newTime })} />
      </BentoEditModal>

      {/* 单个属性字段 */}
      {editingAttrField && (
        <BentoEditModal open onClose={closeModal} title={`🎯 ${editingAttrField.field_name || t('world.unnamedField')}`}>
          <SingleAttrFieldEditor
            field={editingAttrField}
            onChange={updates => updateAttrField(editingAttrIndex, updates)}
            onDelete={() => removeAttrField(editingAttrIndex)}
          />
        </BentoEditModal>
      )}

      {/* 单条日志 */}
      {editingLogEntry && (
        <BentoEditModal open onClose={closeModal} title={`📝 ${editingLogEntry.add_at}`}>
          <SingleLogEntryEditor
            entry={editingLogEntry}
            onChange={patch => updateLogEntry(editingLogIndex, patch)}
            onDelete={() => removeLogEntry(editingLogIndex)}
          />
        </BentoEditModal>
      )}

      {/* 单篇文档 */}
      {editingDocument && (
        <BentoEditModal open onClose={closeModal} title={`📄 ${editingDocument.name}`} size="wide">
          <SingleDocumentEditor
            doc={editingDocument}
            onChange={patch => updateDocument(editingDocIndex, patch)}
            onDelete={() => removeDocument(editingDocIndex)}
          />
        </BentoEditModal>
      )}

      {/* 阶段目标 */}
      {editing?.type === 'stage_goal' && (
        <BentoEditModal open onClose={closeModal} title={`🎯 ${t('world.stageGoalTitle')}`}>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label>{t('world.stageGoalContent')}</label>
            <textarea
              value={world.DirectorNotes?.stage_goal || ''}
              onChange={e => updateStageGoal(e.target.value)}
              placeholder={t('world.stageGoalPlaceholder')}
              rows={4}
            />
          </div>
        </BentoEditModal>
      )}

      {/* 单条笔记 */}
      {editingNote !== null && editingNoteIndex >= 0 && (
        <BentoEditModal open onClose={closeModal} title={`📝 ${t('world.noteTitle', { index: editingNoteIndex + 1 })}`}>
          <SingleNoteEditor
            note={editingNote}
            onChange={value => updateNote(editingNoteIndex, value)}
            onDelete={() => removeNote(editingNoteIndex)}
          />
        </BentoEditModal>
      )}

      {/* 单个标志 */}
      {editingFlag && editingFlagKey && (
        <BentoEditModal open onClose={closeModal} title={`🚩 ${editingFlagKey}`}>
          <SingleFlagEditor
            flagKey={editingFlagKey}
            flag={editingFlag}
            onUpdate={patch => updateFlag(editingFlagKey, patch)}
            onRename={newId => renameFlag(editingFlagKey, newId)}
            onDelete={() => removeFlag(editingFlagKey)}
          />
        </BentoEditModal>
      )}

      {/* 单个自定义组件 */}
      {editingComponent && (
        <BentoEditModal open onClose={closeModal} title={`🧩 ${editingComponent.component_name || editingComponent.component_key}`} size="wide">
          <SingleComponentEditor
            def={editingComponent}
            onChange={patch => updateComponent(editingCompIndex, patch)}
            onDelete={() => removeComponent(editingCompIndex)}
          />
        </BentoEditModal>
      )}

      {/* 注册表 */}
      {editingRegistryDef && (
        <BentoEditModal open onClose={closeModal} title={`📋 ${editingRegistryDef.component_name || editingRegistryDef.component_key}`} size="full">
          <DataRegistryEditor
            def={editingRegistryDef}
            defIndex={editingRegistryCompIndex}
            customComponentRegistry={customComponentRegistry}
            onChange={newRegistry => onChange({ ...world, CustomComponentRegistry: newRegistry })}
          />
        </BentoEditModal>
      )}
    </div>
  )
}

// =============================================================================
// 单个属性字段编辑器 (在模态框中编辑一个字段)
// =============================================================================

const SingleAttrFieldEditor: React.FC<{
  field: CreatureAttrField
  onChange: (updates: Partial<CreatureAttrField>) => void
  onDelete: () => void
}> = ({ field, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('world.fieldName')}</label>
          <input
            type="text"
            value={field.field_name}
            onChange={e => onChange({ field_name: e.target.value })}
            placeholder={t('world.fieldNamePlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('world.fieldHint')}</label>
          <input
            type="text"
            value={field.hint}
            onChange={e => onChange({ hint: e.target.value })}
            placeholder={t('world.fieldHintPlaceholder')}
          />
        </div>
        <div className="form-group">
          <label>{t('world.fieldDisplayName')}</label>
          <input
            type="text"
            value={field.field_display_name || ''}
            onChange={e => onChange({ field_display_name: e.target.value || undefined })}
            placeholder={t('world.fieldDisplayNamePlaceholder')}
          />
        </div>
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单个自定义组件编辑器 (在模态框中编辑一个组件)
// =============================================================================

const SingleComponentEditor: React.FC<{
  def: CustomComponentDef
  onChange: (patch: Partial<CustomComponentDef>) => void
  onDelete: () => void
}> = ({ def, onChange, onDelete }) => {
  const { t } = useTranslation('editor')

  const getEffectivePropertiesSchema = (): TypeSchema | undefined => {
    return def.is_array ? (def.type_schema?.items || undefined) : (def.type_schema || undefined)
  }

  const setEffectivePropertiesSchema = (itemSchema: TypeSchema | undefined) => {
    if (def.is_array) {
      onChange({
        type_schema: {
          type: 'array',
          items: itemSchema ? { ...itemSchema, type: 'object' } : { type: 'object', properties: {} }
        }
      })
    } else {
      onChange({
        type_schema: itemSchema ? { ...itemSchema, type: 'object' } : { type: 'object', properties: {} }
      })
    }
  }

  const handleIsArrayChange = (isArray: boolean) => {
    const currentProps = getEffectivePropertiesSchema()
    const objectSchema: TypeSchema = currentProps
      ? { ...currentProps, type: 'object' }
      : { type: 'object', properties: {} }
    if (isArray) {
      onChange({ is_array: true, type_schema: { type: 'array', items: objectSchema } })
    } else {
      onChange({ is_array: false, type_schema: objectSchema })
    }
  }

  const propsSchema = getEffectivePropertiesSchema()

  return (
    <div>
      {/* Name & Key */}
      <div className="form-grid" style={{ marginBottom: '16px' }}>
        <div className="form-group">
          <label>{t('world.componentName')}</label>
          <input type="text" value={def.component_name || ''} onChange={e => onChange({ component_name: e.target.value })} placeholder={t('world.componentNamePlaceholder')} />
        </div>
        <div className="form-group">
          <label>{t('world.componentKey')}</label>
          <input type="text" value={def.component_key} onChange={e => onChange({ component_key: e.target.value })} placeholder={t('world.componentKeyPlaceholder')} style={{ fontFamily: 'monospace' }} />
        </div>
      </div>

      {/* Toggles */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '16px' }}>
        <div className="form-group" style={{ flex: 'none' }}>
          <label>{t('world.isArray')}</label>
          <label className="toggle-switch">
            <input type="checkbox" checked={def.is_array || false} onChange={e => handleIsArrayChange(e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
          <span style={{ fontSize: '0.7rem', color: 'var(--paper-text-secondary)', marginLeft: '8px' }}>{t('world.isArrayHint')}</span>
        </div>
        <div className="form-group" style={{ flex: 'none' }}>
          <label>{t('world.hasDataRegistry')}</label>
          <label className="toggle-switch">
            <input type="checkbox" checked={Array.isArray(def.data_registry)} onChange={e => onChange({ data_registry: e.target.checked ? [] : undefined })} />
            <span className="toggle-slider"></span>
          </label>
          <span style={{ fontSize: '0.7rem', color: 'var(--paper-text-secondary)', marginLeft: '8px' }}>{t('world.hasDataRegistryHint')}</span>
        </div>
      </div>

      {/* Schema */}
      <div style={{ marginBottom: '16px' }}>
        <div className="schema-section-title">{t('world.schemaProperties')}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--paper-text-secondary)', marginBottom: '8px' }}>
          {t('world.schemaPropertiesHint')} — <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>{def.is_array ? 'Array<Object>' : 'Object'}</span>
        </div>
        <TypeSchemaEditor schema={propsSchema || undefined} onChange={schema => setEffectivePropertiesSchema(schema)} />
      </div>

      {/* Registry info */}
      {Array.isArray(def.data_registry) && (
        <div style={{ padding: '8px 12px', background: 'var(--paper-bg-primary)', borderRadius: '12px', border: '1.5px solid var(--paper-lime-green)', marginBottom: '16px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--paper-text-secondary)' }}>
            📋 {t('world.dataRegistry')} — {def.data_registry.length} {t('world.registeredItems')}
          </span>
        </div>
      )}

      <div style={{ textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// Sub-Editors
// =============================================================================

const GameTimeEditor: React.FC<{
  gameTime: NonNullable<WorldSnapshot['GameTime']>
  onChange: (gameTime: NonNullable<WorldSnapshot['GameTime']>) => void
}> = ({ gameTime, onChange }) => {
  const { t } = useTranslation('editor')
  return (
    <div className="form-card" data-outline-id="world-time">
      <h3 className="section-title">{t('world.gameTime')}</h3>
      <p className="field-hint">{t('world.gameTimeHint')}</p>
      <div className="form-grid" style={{ marginTop: '16px' }}>
        <div className="form-group">
          <label>{t('world.year')}</label>
          <input type="number" value={gameTime.year} onChange={e => onChange({ ...gameTime, year: parseInt(e.target.value) || 1 })} />
        </div>
        <div className="form-group">
          <label>{t('world.month')}</label>
          <input type="number" min={1} max={12} value={gameTime.month} onChange={e => onChange({ ...gameTime, month: parseInt(e.target.value) || 1 })} />
        </div>
        <div className="form-group">
          <label>{t('world.day')}</label>
          <input type="number" min={1} max={31} value={gameTime.day} onChange={e => onChange({ ...gameTime, day: parseInt(e.target.value) || 1 })} />
        </div>
        <div className="form-group">
          <label>{t('world.hour')}</label>
          <input type="number" min={0} max={23} value={gameTime.hour} onChange={e => onChange({ ...gameTime, hour: parseInt(e.target.value) || 0 })} />
        </div>
        <div className="form-group">
          <label>{t('world.minute')}</label>
          <input type="number" min={0} max={59} value={gameTime.minute} onChange={e => onChange({ ...gameTime, minute: parseInt(e.target.value) || 0 })} />
        </div>
      </div>
    </div>
  )
}


// =============================================================================
// 注册表数据编辑器
// =============================================================================

const DataRegistryEditor: React.FC<{
  def: CustomComponentDef
  defIndex: number
  customComponentRegistry: NonNullable<WorldSnapshot['CustomComponentRegistry']>
  onChange: (registry: NonNullable<WorldSnapshot['CustomComponentRegistry']>) => void
}> = ({ def, defIndex, customComponentRegistry, onChange }) => {
  const { t } = useTranslation('editor')

  const updateDef = (patch: Partial<CustomComponentDef>) => {
    const newDefs = [...(customComponentRegistry.custom_components || [])]
    newDefs[defIndex] = { ...newDefs[defIndex], ...patch }
    onChange({ custom_components: newDefs })
  }

  // 获取用于渲染单个注册项的 schema
  // 如果 is_array, items schema 就是单个项的结构
  // 如果不是 array, 顶层 schema 本身就是单项结构
  const getItemSchema = (): TypeSchema | undefined => {
    if (def.is_array) {
      return def.type_schema?.items || undefined
    }
    return def.type_schema || undefined
  }

  const itemSchema = getItemSchema()
  const registryItems = def.data_registry || []

  const addItem = () => {
    const defaultData = itemSchema ? getDefaultValueForSchema(itemSchema) : {}
    const newItem = { item_id: generateUniqueId('item'), data: defaultData }
    updateDef({ data_registry: [...registryItems, newItem] })
  }

  const deleteItem = (itemIndex: number) => {
    updateDef({ data_registry: registryItems.filter((_, i) => i !== itemIndex) })
  }

  const updateItem = (itemIndex: number, patch: Partial<{ item_id: string; data: any }>) => {
    const newItems = [...registryItems]
    newItems[itemIndex] = { ...newItems[itemIndex], ...patch }
    updateDef({ data_registry: newItems })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 className="section-title">
          📋 {def.component_name || def.component_key} {t('world.registrySuffix')}
          <span style={{ fontSize: '0.85rem', color: 'var(--paper-text-secondary)', marginLeft: '8px' }}>
            ({registryItems.length} {t('world.registeredItems')})
          </span>
        </h3>
        <button className="btn-add" onClick={addItem}>
          {t('world.addRegistryItem')}
        </button>
      </div>

      {/* Schema 提示 */}
      {itemSchema && Object.keys(itemSchema.properties || {}).length > 0 && (
        <div style={{ marginBottom: '16px', padding: '8px 12px', background: 'var(--paper-bg-primary)', borderRadius: '12px', border: '1.5px solid var(--paper-electric-blue)', fontSize: '0.8rem', color: 'var(--paper-text-secondary)' }}>
          🔧 {t('world.schemaFieldsHint')}: {Object.keys(itemSchema.properties || {}).join(', ')}
        </div>
      )}

      {registryItems.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--paper-text-secondary)', fontSize: '0.9rem' }}>
          {t('world.noRegistryItems')}
        </div>
      )}

      <div className="list-items">
        {registryItems.map((item, itemIndex) => (
          <div key={itemIndex} className="registry-card status-template-card" data-outline-id={`registry-item-${itemIndex}`}>
            {/* Header: item_id + delete */}
            <div className="registry-card-header" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--paper-text-secondary)', marginBottom: '4px', display: 'block' }}>
                  {t('world.registryItemId')}
                </label>
                <input
                  type="text"
                  value={item.item_id}
                  onChange={e => updateItem(itemIndex, { item_id: e.target.value })}
                  placeholder={t('world.registryItemIdPlaceholder')}
                  className="name-input"
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>
              <button
                className="btn-delete"
                style={{ alignSelf: 'flex-end' }}
                onClick={() => deleteItem(itemIndex)}
              >
                {t('world.deleteRegistryItem')}
              </button>
            </div>

            {/* Data: SchemaValueEditor */}
            <div style={{ marginTop: '12px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--paper-text-secondary)', marginBottom: '4px', display: 'block' }}>
                {t('world.registryItemData')}
              </label>
              <SchemaValueEditor
                schema={itemSchema}
                value={item.data}
                onChange={(data: any) => updateItem(itemIndex, { data })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// =============================================================================
// 单篇文档编辑器
// =============================================================================

// =============================================================================
// 单条笔记编辑器
// =============================================================================

const SingleNoteEditor: React.FC<{
  note: string
  onChange: (value: string) => void
  onDelete: () => void
}> = ({ note, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-group" style={{ marginBottom: '20px' }}>
        <label>{t('world.noteContent')}</label>
        <textarea
          value={note}
          onChange={e => onChange(e.target.value)}
          placeholder={t('world.notePlaceholder')}
          rows={4}
        />
      </div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// =============================================================================
// 单个标志编辑器
// =============================================================================

const SingleFlagEditor: React.FC<{
  flagKey: string
  flag: { id: string; value: boolean; remark?: string }
  onUpdate: (patch: Partial<{ id: string; value: boolean; remark?: string }>) => void
  onRename: (newId: string) => void
  onDelete: () => void
}> = ({ flagKey, flag, onUpdate, onRename, onDelete }) => {
  const { t } = useTranslation('editor')
  const [editingId, setEditingId] = useState(flagKey)
  return (
    <div>
      <div className="form-grid" style={{ marginBottom: '16px' }}>
        <div className="form-group">
          <label>{t('world.flagId')}</label>
          <input
            type="text"
            value={editingId}
            onChange={e => setEditingId(e.target.value)}
            onBlur={() => { if (editingId !== flagKey) onRename(editingId) }}
            placeholder={t('world.flagIdPlaceholder')}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <div className="form-group">
          <label>{t('world.flagValue')}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '4px' }}>
            <label className="toggle-switch">
              <input type="checkbox" checked={flag.value} onChange={e => onUpdate({ value: e.target.checked })} />
              <span className="toggle-slider"></span>
            </label>
            <span style={{ fontWeight: 700, color: flag.value ? 'var(--paper-lime-green)' : 'var(--paper-text-tertiary)' }}>
              {flag.value ? 'true' : 'false'}
            </span>
          </div>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: '20px' }}>
        <label>{t('world.flagRemark')}</label>
        <input
          type="text"
          value={flag.remark || ''}
          onChange={e => onUpdate({ remark: e.target.value || undefined })}
          placeholder={t('world.flagRemarkPlaceholder')}
        />
      </div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}
