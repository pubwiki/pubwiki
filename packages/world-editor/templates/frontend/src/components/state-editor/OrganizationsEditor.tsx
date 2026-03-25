import React, { useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrganizationSnapshot, RegionSnapshot, WorldSnapshot, StatusEffect, LogEntry, SettingDocument } from '../../api/types'
import { showConfirm, showAlert } from '../AlertDialog'
import { BentoEditModal } from './BentoEditModal'
import { SingleLogEntryEditor, SingleStatusEffectEditor, SingleDocumentEditor } from './BentoSingleEditors'
import { generateUniqueId } from './types'
import { useEditorUIStore } from '../../stores/editorUIStore'
import { EntityCardGrid, type SortOrder } from './EntityCardGrid'

// ============================================================================
// 编辑目标类型
// ============================================================================

type OrgEditTarget = null
  | { type: 'territory'; index: number }
  | { type: 'status_effect'; index: number }
  | { type: 'log_entry'; index: number }
  | { type: 'document'; index: number }

// ============================================================================
// 单个领地编辑器
// ============================================================================

const SingleTerritoryEditor: React.FC<{
  territory: { region_id: string; location_id: string }
  allRegions: RegionSnapshot[]
  onChange: (patch: Partial<{ region_id: string; location_id: string }>) => void
  onDelete: () => void
}> = ({ territory, allRegions, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  const currentRegion = allRegions.find(r => r.Region?.region_id === territory.region_id)
  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('organizations.selectRegion')}</label>
          <select value={territory.region_id} onChange={e => onChange({ region_id: e.target.value, location_id: '' })}>
            <option value="">{t('organizations.regionPlaceholder')}</option>
            {allRegions.map(r => (
              <option key={r.Region?.region_id} value={r.Region?.region_id}>{r.Metadata?.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>{t('organizations.selectLocation')}</label>
          <select value={territory.location_id} onChange={e => onChange({ location_id: e.target.value })} disabled={!territory.region_id}>
            <option value="">{t('organizations.locationPlaceholder')}</option>
            {(currentRegion?.Region?.locations || []).map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name || loc.id}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// ============================================================================
// 组织编辑器 - Bento Grid Layout (Dopamine Style)
// ============================================================================

export const OrganizationsEditor: React.FC<{
  organizations: OrganizationSnapshot[]
  onChange: (organizations: OrganizationSnapshot[]) => void
  regions: RegionSnapshot[]
  world: WorldSnapshot
}> = ({ organizations, onChange, regions, world }) => {
  const { t } = useTranslation('editor')

  const { organizations: orgsUIState, setOrganizationsSelected } = useEditorUIStore()
  const selectedIndex = orgsUIState.selectedIndex
  const setSelectedIndex = setOrganizationsSelected

  const [sortOrder, setSortOrder] = useState<SortOrder>('original')
  const [editing, setEditing] = useState<OrgEditTarget>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const closeModal = useCallback(() => setEditing(null), [])

  // 搜索过滤 + 排序
  const filteredOrganizations = useMemo(() => {
    let result = organizations.map((o, i) => ({ org: o, originalIndex: i }))
    if (sortOrder === 'az') {
      result = [...result].sort((a, b) => (a.org.Organization?.name || '').localeCompare(b.org.Organization?.name || ''))
    } else if (sortOrder === 'za') {
      result = [...result].sort((a, b) => (b.org.Organization?.name || '').localeCompare(a.org.Organization?.name || ''))
    }
    return result
  }, [organizations, sortOrder])

  const selectedOrgData = selectedIndex !== null ? organizations[selectedIndex] : null

  // ============================================================================
  // CRUD
  // ============================================================================

  const addOrganization = () => {
    const newId = Math.max(0, ...organizations.map(o => o.entity_id)) + 1
    const newOrg: OrganizationSnapshot = {
      entity_id: newId,
      Organization: {
        organization_id: `org_${Date.now()}`,
        name: t('organizations.newOrg'),
        description: '',
        territories: []
      },
      StatusEffects: { status_effects: [] },
      Log: { entries: [] }
    }
    const newOrgs = [...organizations, newOrg]
    onChange(newOrgs)
    setSelectedIndex(newOrgs.length - 1)
  }

  const updateOrganization = (index: number, updates: Partial<OrganizationSnapshot>) => {
    const newOrgs = [...organizations]
    newOrgs[index] = { ...newOrgs[index], ...updates }
    onChange(newOrgs)
  }

  const removeOrganization = (index: number) => {
    const newOrgs = organizations.filter((_, i) => i !== index)
    onChange(newOrgs)
    if (selectedIndex === index) setSelectedIndex(null)
    else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1)
  }

  const duplicateOrganization = (index: number) => {
    const original = organizations[index]
    const newId = Math.max(0, ...organizations.map(o => o.entity_id)) + 1
    const copy: OrganizationSnapshot = {
      ...JSON.parse(JSON.stringify(original)),
      entity_id: newId,
      Organization: {
        ...JSON.parse(JSON.stringify(original.Organization)),
        organization_id: `${original.Organization?.organization_id}_copy_${Date.now()}`,
        name: t('organizations.copiedName', { name: original.Organization?.name || t('organizations.org') })
      }
    }
    const newOrgs = [...organizations, copy]
    onChange(newOrgs)
    setSelectedIndex(newOrgs.length - 1)
    showAlert(t('organizations.copySuccess', { name: original.Organization?.name }))
  }

  // ============================================================================
  // Territory CRUD
  // ============================================================================

  const addTerritory = () => {
    if (selectedIndex === null || !selectedOrgData) return
    const firstRegion = regions[0]
    const newTerritories = [...(selectedOrgData.Organization?.territories || []), {
      region_id: firstRegion?.Region?.region_id || '',
      location_id: ''
    }]
    updateOrganization(selectedIndex, {
      Organization: { ...selectedOrgData.Organization!, territories: newTerritories }
    })
    setEditing({ type: 'territory', index: newTerritories.length - 1 })
  }

  const updateTerritory = (index: number, patch: Partial<{ region_id: string; location_id: string }>) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newTerrs = [...(selectedOrgData.Organization?.territories || [])]
    newTerrs[index] = { ...newTerrs[index], ...patch }
    updateOrganization(selectedIndex, {
      Organization: { ...selectedOrgData.Organization!, territories: newTerrs }
    })
  }

  const removeTerritory = (index: number) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newTerrs = (selectedOrgData.Organization?.territories || []).filter((_, i) => i !== index)
    updateOrganization(selectedIndex, {
      Organization: { ...selectedOrgData.Organization!, territories: newTerrs }
    })
    closeModal()
  }

  // ============================================================================
  // StatusEffect CRUD
  // ============================================================================

  const addStatusEffect = () => {
    if (selectedIndex === null || !selectedOrgData) return
    const newEffect: StatusEffect = {
      instance_id: generateUniqueId('status_inst'),
      display_name: '',
      data: {}
    }
    const newEffects = [...(selectedOrgData.StatusEffects?.status_effects || []), newEffect]
    updateOrganization(selectedIndex, { StatusEffects: { status_effects: newEffects } })
    setEditing({ type: 'status_effect', index: newEffects.length - 1 })
  }

  const updateStatusEffect = (index: number, patch: Partial<StatusEffect>) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newEffects = [...(selectedOrgData.StatusEffects?.status_effects || [])]
    newEffects[index] = { ...newEffects[index], ...patch }
    updateOrganization(selectedIndex, { StatusEffects: { status_effects: newEffects } })
  }

  const removeStatusEffect = (index: number) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newEffects = (selectedOrgData.StatusEffects?.status_effects || []).filter((_, i) => i !== index)
    updateOrganization(selectedIndex, { StatusEffects: { status_effects: newEffects } })
    closeModal()
  }

  // ============================================================================
  // Log CRUD
  // ============================================================================

  const addLogEntry = () => {
    if (selectedIndex === null || !selectedOrgData) return
    const gt = world.GameTime
    const add_at = gt ? `${gt.year}年${gt.month}月${gt.day}日 ${String(gt.hour).padStart(2, '0')}:${String(gt.minute).padStart(2, '0')}` : ''
    const newEntries = [...(selectedOrgData.Log?.entries || []), { content: '', add_at }]
    updateOrganization(selectedIndex, { Log: { entries: newEntries } })
    setEditing({ type: 'log_entry', index: newEntries.length - 1 })
  }

  const updateLogEntry = (index: number, patch: Partial<LogEntry>) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newEntries = [...(selectedOrgData.Log?.entries || [])]
    newEntries[index] = { ...newEntries[index], ...patch }
    updateOrganization(selectedIndex, { Log: { entries: newEntries } })
  }

  const removeLogEntry = (index: number) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newEntries = (selectedOrgData.Log?.entries || []).filter((_, i) => i !== index)
    updateOrganization(selectedIndex, { Log: { entries: newEntries } })
    closeModal()
  }

  // ============================================================================
  // Document CRUD
  // ============================================================================

  const addDocument = () => {
    if (selectedIndex === null || !selectedOrgData) return
    const newDocs = [...(selectedOrgData.BindSetting?.documents || []), { name: t('world.newDocName'), content: '' }]
    updateOrganization(selectedIndex, { BindSetting: { documents: newDocs } })
    setEditing({ type: 'document', index: newDocs.length - 1 })
  }

  const updateDocument = (index: number, patch: Partial<SettingDocument>) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newDocs = [...(selectedOrgData.BindSetting?.documents || [])]
    newDocs[index] = { ...newDocs[index], ...patch }
    updateOrganization(selectedIndex, { BindSetting: { documents: newDocs } })
  }

  const removeDocument = (index: number) => {
    if (selectedIndex === null || !selectedOrgData) return
    const newDocs = (selectedOrgData.BindSetting?.documents || []).filter((_, i) => i !== index)
    updateOrganization(selectedIndex, { BindSetting: { documents: newDocs } })
    closeModal()
  }

  // ============================================================================
  // 编辑中的数据
  // ============================================================================

  const territories = selectedOrgData?.Organization?.territories || []
  const statusEffects = selectedOrgData?.StatusEffects?.status_effects || []
  const logEntries = selectedOrgData?.Log?.entries || []
  const documents = selectedOrgData?.BindSetting?.documents || []

  const editingTerritory = editing?.type === 'territory' ? territories[editing.index] : null
  const editingTerritoryIndex = editing?.type === 'territory' ? editing.index : -1

  const editingEffect = editing?.type === 'status_effect' ? statusEffects[editing.index] : null
  const editingEffectIndex = editing?.type === 'status_effect' ? editing.index : -1

  const editingLogEntry = editing?.type === 'log_entry' ? logEntries[editing.index] : null
  const editingLogIndex = editing?.type === 'log_entry' ? editing.index : -1
  const editingDocument = editing?.type === 'document' ? documents[editing.index] : null
  const editingDocIndex = editing?.type === 'document' ? editing.index : -1

  return (
    <div className="paper-vertical-editor">
      {/* Top: Entity Card Grid */}
      <EntityCardGrid
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
        emptyLabel={t('organizations.noMatch', { defaultValue: t('common:noResults') })}
        hasItems={filteredOrganizations.length > 0}
        actions={
          <button className="paper-btn-add" onClick={addOrganization}>➕ {t('organizations.newOrg')}</button>
        }
      >
        {filteredOrganizations.map(({ org, originalIndex }) => {
          const isSelected = selectedIndex === originalIndex
          return (
            <div
              key={org.entity_id}
              className={`paper-entity-card ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedIndex(originalIndex)}
            >
              <div className="paper-card-actions">
                <button onClick={(e) => { e.stopPropagation(); duplicateOrganization(originalIndex) }} title={t('common:copy')}>📋</button>
                <button className="danger" onClick={async (e) => {
                  e.stopPropagation()
                  if (await showConfirm(t('organizations.confirmDelete', { name: org.Organization?.name }))) removeOrganization(originalIndex)
                }} title={t('common:delete')}>✕</button>
              </div>
              <span className="paper-entity-badge organization">🏛️ ORG</span>
              <span className="paper-entity-name">{org.Organization?.name || t('common:unnamed')}</span>
              <span className="paper-entity-subtitle">{org.Organization?.organization_id}</span>
            </div>
          )
        })}
      </EntityCardGrid>

      {/* Bottom: Detail Editor — Bento Grid */}
      <div className="paper-entity-detail-section" ref={contentRef}>
        {selectedOrgData && selectedIndex !== null ? (
            <div className="paper-org-grid">

              {/* ===== 基础信息 ===== */}
              <div className="paper-bento-card paper-org-basic">
                <h3 className="section-title">{t('organizations.basicInfoSection')}</h3>
                <div className="form-grid">
                  <div className="form-group">
                    <label>{t('organizations.orgId')}</label>
                    <input
                      type="text"
                      value={selectedOrgData.Organization?.organization_id || ''}
                      onChange={e => updateOrganization(selectedIndex, {
                        Organization: { ...selectedOrgData.Organization!, organization_id: e.target.value }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('organizations.orgName')}</label>
                    <input
                      type="text"
                      value={selectedOrgData.Organization?.name || ''}
                      onChange={e => updateOrganization(selectedIndex, {
                        Organization: { ...selectedOrgData.Organization!, name: e.target.value }
                      })}
                    />
                  </div>
                  <div className="form-group full-width">
                    <label>{t('organizations.orgDesc')}</label>
                    <textarea
                      value={selectedOrgData.Organization?.description || ''}
                      onChange={e => updateOrganization(selectedIndex, {
                        Organization: { ...selectedOrgData.Organization!, description: e.target.value }
                      })}
                      rows={3}
                      placeholder={t('organizations.orgDescPlaceholder')}
                    />
                  </div>
                </div>
              </div>

              {/* ===== 领地 — mini cards ===== */}
              <div className="paper-bento-card paper-org-territories">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">🏰 {t('organizations.territoriesHeader', { count: territories.length })}</h3>
                  <button className="paper-bento-edit-btn" onClick={addTerritory}>+ {t('organizations.addTerritory')}</button>
                </div>
                {territories.length > 0 ? (
                  <div className="paper-bento-item-grid">
                    {territories.map((terr, i) => {
                      const regionSnap = regions.find(r => r.Region?.region_id === terr.region_id)
                      const regionName = regionSnap?.Metadata?.name || terr.region_id
                      const locName = regionSnap?.Region?.locations?.find(l => l.id === terr.location_id)?.name
                      return (
                        <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'territory', index: i })}>
                          <div className="paper-mini-card-title">{regionName}</div>
                          <div className="paper-mini-card-desc">{locName || t('organizations.entireRegion')}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('organizations.noTerritories')}</div>
                )}
              </div>

              {/* ===== 状态效果 — mini cards ===== */}
              <div className="paper-bento-card paper-org-statuses">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">✨ {t('creatures.statusList', { count: statusEffects.length })}</h3>
                  <button className="paper-bento-edit-btn" onClick={addStatusEffect}>+ {t('creatures.addStatus')}</button>
                </div>
                {statusEffects.length > 0 ? (
                  <div className="paper-bento-item-grid">
                    {statusEffects.map((effect, i) => (
                      <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'status_effect', index: i })}>
                        <div className="paper-mini-card-title">{effect.display_name || effect.instance_id}</div>
                        {effect.remark && <div className="paper-mini-card-desc">{effect.remark}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('creatures.noStatuses')}</div>
                )}
              </div>

              {/* ===== 设定文档 — mini cards ===== */}
              <div className="paper-bento-card paper-org-docs">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">📚 {t('world.sections.documents')} ({documents.length})</h3>
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

              {/* ===== 日志 — horizontal mini cards ===== */}
              <div className="paper-bento-card paper-org-log">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">📝 {t('common:log')}</h3>
                  <button className="paper-bento-edit-btn" onClick={addLogEntry}>+ {t('world.addLogEntry')}</button>
                </div>
                {logEntries.length > 0 ? (
                  <div className="paper-bento-item-list">
                    {logEntries.map((entry, i) => (
                      <div key={i} className="paper-bento-mini-card paper-mini-card-horizontal" onClick={() => setEditing({ type: 'log_entry', index: i })}>
                        <div className="paper-mini-card-badge">{entry.add_at || '?'}</div>
                        <div className="paper-mini-card-title">{entry.content ? (entry.content.length > 60 ? entry.content.slice(0, 60) + '...' : entry.content) : t('world.emptyLogEntry')}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('world.noLogEntries')}</div>
                )}
              </div>

            </div>
        ) : (
          <div className="paper-grid-empty" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🏛️</div>
            <div>{t('organizations.selectToEdit')}</div>
          </div>
        )}

        {/* =============== 编辑模态框 =============== */}

        {/* 单个领地 */}
        {editingTerritory && (
          <BentoEditModal open onClose={closeModal} title={`🏰 ${t('organizations.editTerritory')}`}>
            <SingleTerritoryEditor
              territory={editingTerritory}
              allRegions={regions}
              onChange={patch => updateTerritory(editingTerritoryIndex, patch)}
              onDelete={() => removeTerritory(editingTerritoryIndex)}
            />
          </BentoEditModal>
        )}

        {/* 单个状态效果 */}
        {editingEffect && (
          <BentoEditModal open onClose={closeModal} title={`✨ ${editingEffect.display_name || editingEffect.instance_id}`}>
            <SingleStatusEffectEditor
              effect={editingEffect}
              onChange={patch => updateStatusEffect(editingEffectIndex, patch)}
              onDelete={() => removeStatusEffect(editingEffectIndex)}
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
      </div>
    </div>
  )
}
