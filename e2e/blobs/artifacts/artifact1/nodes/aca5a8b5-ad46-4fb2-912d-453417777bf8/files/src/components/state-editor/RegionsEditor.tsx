import React, { useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { RegionSnapshot, Location, Path, StatusEffect, LogEntry, SettingDocument } from '../../api/types'
import { showConfirm, showAlert } from '../AlertDialog'
import { luaList, generateUniqueId } from './types'
import { BentoEditModal } from './BentoEditModal'
import { SingleLogEntryEditor, SingleStatusEffectEditor, SingleDocumentEditor } from './BentoSingleEditors'
import { useEditorUIStore } from '../../stores/editorUIStore'
import { EntityCardGrid, type SortOrder } from './EntityCardGrid'

// ============================================================================
// 编辑目标类型
// ============================================================================

type RegionEditTarget = null
  | { type: 'location'; index: number }
  | { type: 'path'; index: number }
  | { type: 'status_effect'; index: number }
  | { type: 'log_entry'; index: number }
  | { type: 'document'; index: number }

// ============================================================================
// 单个地点编辑器
// ============================================================================

const SingleLocationEditor: React.FC<{
  location: Location
  onChange: (patch: Partial<Location>) => void
  onDelete: () => void
}> = ({ location, onChange, onDelete }) => {
  const { t } = useTranslation('editor')
  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('regions.locationId')}</label>
          <input type="text" value={location.id} onChange={e => onChange({ id: e.target.value })} />
        </div>
        <div className="form-group">
          <label>{t('regions.locationName')}</label>
          <input type="text" value={location.name} onChange={e => onChange({ name: e.target.value })} />
        </div>
      </div>
      <div className="form-group" style={{ marginTop: '16px' }}>
        <label>{t('regions.locationDescription')}</label>
        <textarea value={location.description || ''} onChange={e => onChange({ description: e.target.value })} rows={3} placeholder={t('regions.locationDescPlaceholder')} />
      </div>
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// ============================================================================
// 单个路径编辑器
// ============================================================================

const SinglePathEditor: React.FC<{
  path: Path
  allRegions: RegionSnapshot[]
  onChange: (patch: Partial<Path>) => void
  onDelete: () => void
}> = ({ path, allRegions, onChange, onDelete }) => {
  const { t } = useTranslation('editor')

  const srcRegionLocations = useMemo(() => {
    return allRegions.find(r => r.Region?.region_id === path.src_region)?.Region?.locations || []
  }, [allRegions, path.src_region])

  const destRegionLocations = useMemo(() => {
    return allRegions.find(r => r.Region?.region_id === path.to_region)?.Region?.locations || []
  }, [allRegions, path.to_region])

  return (
    <div>
      {/* Source */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 600, color: 'var(--paper-text-secondary)', marginBottom: '8px', fontSize: '0.85rem' }}>{t('regions.pathSource')}</div>
        <div className="form-grid">
          <div className="form-group">
            <label>{t('regions.sourceRegion')}</label>
            <select
              value={path.src_region || ''}
              onChange={e => onChange({ src_region: e.target.value, src_location: '' })}
            >
              <option value="">{t('regions.selectRegion')}</option>
              {allRegions.map(r => (
                <option key={r.Region?.region_id} value={r.Region?.region_id}>
                  {r.Metadata?.name || r.Region?.region_id}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('regions.sourceLocation')}</label>
            <select
              value={path.src_location || ''}
              onChange={e => onChange({ src_location: e.target.value })}
              disabled={!path.src_region}
            >
              <option value="">{t('regions.selectLocation')}</option>
              {srcRegionLocations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', color: 'var(--paper-text-tertiary)', fontSize: '1.2rem', margin: '4px 0' }}>↓</div>

      {/* Destination */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 600, color: 'var(--paper-text-secondary)', marginBottom: '8px', fontSize: '0.85rem' }}>{t('regions.pathDestination')}</div>
        <div className="form-grid">
          <div className="form-group">
            <label>{t('regions.destRegion')}</label>
            <select
              value={path.to_region || ''}
              onChange={e => onChange({ to_region: e.target.value, to_location: '' })}
            >
              <option value="">{t('regions.selectRegion')}</option>
              {allRegions.map(r => (
                <option key={r.Region?.region_id} value={r.Region?.region_id}>
                  {r.Metadata?.name || r.Region?.region_id}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('regions.destLocation')}</label>
            <select
              value={path.to_location || ''}
              onChange={e => onChange({ to_location: e.target.value })}
              disabled={!path.to_region}
            >
              <option value="">{t('regions.selectLocation')}</option>
              {destRegionLocations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="form-group" style={{ marginTop: '12px' }}>
        <label>{t('regions.pathDescription')}</label>
        <textarea
          value={path.description || ''}
          onChange={e => onChange({ description: e.target.value })}
          rows={2}
          placeholder={t('regions.pathDescPlaceholder')}
        />
      </div>

      {/* Discovered toggle */}
      <div className="form-group" style={{ marginTop: '12px' }}>
        <div className="toggle-group">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={path.discovered || false}
              onChange={e => onChange({ discovered: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
          <span style={{ color: path.discovered ? 'var(--paper-lime-green)' : 'var(--paper-text-tertiary)' }}>
            {path.discovered ? t('regions.discovered') : t('regions.notDiscovered')}
          </span>
        </div>
      </div>

      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button className="btn-delete" onClick={onDelete}>{t('common:delete')}</button>
      </div>
    </div>
  )
}

// ============================================================================
// 地域编辑器 - Bento Grid Layout (Dopamine Style)
// ============================================================================

export const RegionsEditor: React.FC<{
  regions: RegionSnapshot[]
  onChange: (regions: RegionSnapshot[]) => void
}> = ({ regions, onChange }) => {
  const { t } = useTranslation('editor')

  const { regions: regionsUIState, setRegionsSelected } = useEditorUIStore()
  const selectedIndex = regionsUIState.selectedIndex
  const setSelectedIndex = setRegionsSelected

  const [sortOrder, setSortOrder] = useState<SortOrder>('original')
  const [editing, setEditing] = useState<RegionEditTarget>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const closeModal = useCallback(() => setEditing(null), [])

  // Search filter + sort
  const filteredRegions = useMemo(() => {
    let result = regions.map((r, i) => ({ region: r, originalIndex: i }))
    if (sortOrder === 'az') {
      result = [...result].sort((a, b) => (a.region.Metadata?.name || '').localeCompare(b.region.Metadata?.name || ''))
    } else if (sortOrder === 'za') {
      result = [...result].sort((a, b) => (b.region.Metadata?.name || '').localeCompare(a.region.Metadata?.name || ''))
    }
    return result
  }, [regions, sortOrder])

  const selectedRegionData = selectedIndex !== null ? regions[selectedIndex] : null

  // Derived data for the selected region
  const locations = useMemo(() => selectedRegionData ? luaList<Location>(selectedRegionData.Region?.locations) : [], [selectedRegionData])
  const paths = useMemo(() => selectedRegionData?.Region?.paths || [], [selectedRegionData])
  const statusEffects = useMemo(() => selectedRegionData?.StatusEffects?.status_effects || [], [selectedRegionData])
  const logEntries = useMemo(() => selectedRegionData?.Log?.entries || [], [selectedRegionData])
  const documents = useMemo(() => selectedRegionData?.BindSetting?.documents || [], [selectedRegionData])

  // Current editing targets
  const editingLocation = editing?.type === 'location' ? locations[editing.index] : null
  const editingLocationIndex = editing?.type === 'location' ? editing.index : -1
  const editingPath = editing?.type === 'path' ? paths[editing.index] : null
  const editingPathIndex = editing?.type === 'path' ? editing.index : -1
  const editingStatusEffect = editing?.type === 'status_effect' ? statusEffects[editing.index] : null
  const editingStatusIndex = editing?.type === 'status_effect' ? editing.index : -1
  const editingLogEntry = editing?.type === 'log_entry' ? logEntries[editing.index] : null
  const editingLogIndex = editing?.type === 'log_entry' ? editing.index : -1
  const editingDocument = editing?.type === 'document' ? documents[editing.index] : null
  const editingDocIndex = editing?.type === 'document' ? editing.index : -1

  // CRUD operations
  const addRegion = () => {
    const newId = Math.max(0, ...regions.map(r => r.entity_id)) + 1
    const newRegion: RegionSnapshot = {
      entity_id: newId,
      Metadata: { name: t('regions.newRegion'), desc: '' },
      Region: {
        region_id: `region_${Date.now()}`,
        region_name: t('regions.newRegion'),
        description: '',
        locations: [],
        paths: []
      },
      StatusEffects: { status_effects: [] },
      Log: { entries: [] }
    }
    const newRegions = [...regions, newRegion]
    onChange(newRegions)
    setSelectedIndex(newRegions.length - 1)
  }

  const updateRegion = (index: number, updates: Partial<RegionSnapshot>) => {
    const newRegions = [...regions]
    newRegions[index] = { ...newRegions[index], ...updates }
    onChange(newRegions)
  }

  const removeRegion = (index: number) => {
    const newRegions = regions.filter((_, i) => i !== index)
    onChange(newRegions)
    if (selectedIndex === index) setSelectedIndex(null)
    else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1)
  }

  const duplicateRegion = (index: number) => {
    const original = regions[index]
    const newId = Math.max(0, ...regions.map(r => r.entity_id)) + 1
    const copy: RegionSnapshot = {
      ...JSON.parse(JSON.stringify(original)),
      entity_id: newId,
      Metadata: {
        ...JSON.parse(JSON.stringify(original.Metadata)),
        name: t('common:copyOf', { name: original.Metadata?.name || t('regions.region') })
      },
      Region: {
        ...JSON.parse(JSON.stringify(original.Region)),
        region_id: `${original.Region?.region_id}_copy_${Date.now()}`,
        region_name: t('common:copyOf', { name: original.Region?.region_name || t('regions.region') })
      }
    }
    const newRegions = [...regions, copy]
    onChange(newRegions)
    setSelectedIndex(newRegions.length - 1)
    showAlert(t('regions.copied', { name: original.Metadata?.name }))
  }

  // --- Location CRUD ---
  const addLocation = () => {
    if (selectedIndex === null || !selectedRegionData) return
    const newLocation: Location = { id: `loc_${Date.now()}`, name: t('regions.newLocation'), description: '' }
    const newLocs = [...locations, newLocation]
    updateRegion(selectedIndex, {
      Region: { ...selectedRegionData.Region!, locations: newLocs }
    })
    setEditing({ type: 'location', index: newLocs.length - 1 })
  }

  const updateLocation = (index: number, patch: Partial<Location>) => {
    if (selectedIndex === null || !selectedRegionData) return
    const newLocs = [...locations]
    newLocs[index] = { ...newLocs[index], ...patch }
    updateRegion(selectedIndex, {
      Region: { ...selectedRegionData.Region!, locations: newLocs }
    })
  }

  const removeLocation = (index: number) => {
    if (selectedIndex === null || !selectedRegionData) return
    updateRegion(selectedIndex, {
      Region: { ...selectedRegionData.Region!, locations: locations.filter((_, i) => i !== index) }
    })
    closeModal()
  }

  // --- Path CRUD ---
  const addPath = () => {
    if (selectedIndex === null || !selectedRegionData) return
    const newPath: Path = {
      src_location: selectedRegionData.Region?.locations?.[0]?.id || '',
      src_region: selectedRegionData.Region?.region_id || '',
      discovered: false,
      to_region: '',
      to_location: '',
      description: ''
    }
    const newPaths = [...paths, newPath]
    updateRegion(selectedIndex, {
      Region: { ...selectedRegionData.Region!, paths: newPaths }
    })
    setEditing({ type: 'path', index: newPaths.length - 1 })
  }

  const updatePath = (index: number, patch: Partial<Path>) => {
    if (selectedIndex === null || !selectedRegionData) return
    const newPaths = [...paths]
    newPaths[index] = { ...newPaths[index], ...patch }
    updateRegion(selectedIndex, {
      Region: { ...selectedRegionData.Region!, paths: newPaths }
    })
  }

  const removePath = (index: number) => {
    if (selectedIndex === null || !selectedRegionData) return
    updateRegion(selectedIndex, {
      Region: { ...selectedRegionData.Region!, paths: paths.filter((_, i) => i !== index) }
    })
    closeModal()
  }

  // --- Status Effect CRUD ---
  const addStatusEffect = () => {
    if (selectedIndex === null || !selectedRegionData) return
    const newEffect: StatusEffect = {
      instance_id: generateUniqueId('status_inst'),
      display_name: '',
      data: undefined
    }
    const newEffects = [...statusEffects, newEffect]
    updateRegion(selectedIndex, {
      StatusEffects: { status_effects: newEffects }
    })
    setEditing({ type: 'status_effect', index: newEffects.length - 1 })
  }

  const updateStatusEffect = (index: number, patch: Partial<StatusEffect>) => {
    if (selectedIndex === null) return
    const newEffects = [...statusEffects]
    newEffects[index] = { ...newEffects[index], ...patch }
    updateRegion(selectedIndex, {
      StatusEffects: { status_effects: newEffects }
    })
  }

  const removeStatusEffect = (index: number) => {
    if (selectedIndex === null) return
    updateRegion(selectedIndex, {
      StatusEffects: { status_effects: statusEffects.filter((_, i) => i !== index) }
    })
    closeModal()
  }

  // --- Log Entry CRUD ---
  const addLogEntry = () => {
    if (selectedIndex === null) return
    const now = new Date()
    const add_at = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const newEntries = [...logEntries, { content: '', add_at }]
    updateRegion(selectedIndex, { Log: { entries: newEntries } })
    setEditing({ type: 'log_entry', index: newEntries.length - 1 })
  }

  const updateLogEntry = (index: number, patch: Partial<LogEntry>) => {
    if (selectedIndex === null) return
    const newEntries = [...logEntries]
    newEntries[index] = { ...newEntries[index], ...patch }
    updateRegion(selectedIndex, { Log: { entries: newEntries } })
  }

  const removeLogEntry = (index: number) => {
    if (selectedIndex === null) return
    updateRegion(selectedIndex, { Log: { entries: logEntries.filter((_, i) => i !== index) } })
    closeModal()
  }

  // --- Document CRUD ---
  const addDocument = () => {
    if (selectedIndex === null || !selectedRegionData) return
    const newDocs = [...documents, { name: t('world.newDocName'), content: '' }]
    updateRegion(selectedIndex, { BindSetting: { documents: newDocs } })
    setEditing({ type: 'document', index: newDocs.length - 1 })
  }

  const updateDocument = (index: number, patch: Partial<SettingDocument>) => {
    if (selectedIndex === null) return
    const newDocs = [...documents]
    newDocs[index] = { ...newDocs[index], ...patch }
    updateRegion(selectedIndex, { BindSetting: { documents: newDocs } })
  }

  const removeDocument = (index: number) => {
    if (selectedIndex === null) return
    updateRegion(selectedIndex, { BindSetting: { documents: documents.filter((_, i) => i !== index) } })
    closeModal()
  }

  // Helper: get region name by region_id
  const getRegionName = (regionId: string): string => {
    const r = regions.find(r => r.Region?.region_id === regionId)
    return r?.Metadata?.name || regionId || '?'
  }

  // Helper: get location name by region_id + location_id
  const getLocationName = (regionId: string, locationId: string): string => {
    if (!locationId) return '?'
    const r = regions.find(r => r.Region?.region_id === regionId)
    const loc = r?.Region?.locations?.find((l: any) => l.id === locationId)
    return loc?.name || locationId
  }

  return (
    <div className="paper-vertical-editor">
      {/* Top: Entity Card Grid */}
      <EntityCardGrid
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
        emptyLabel={t('regions.noMatch', { defaultValue: t('common:noResults') })}
        hasItems={filteredRegions.length > 0}
        actions={
          <button className="paper-btn-add" onClick={addRegion}>➕ {t('regions.addRegion')}</button>
        }
      >
        {filteredRegions.map(({ region, originalIndex }) => {
          const isSelected = selectedIndex === originalIndex
          return (
            <div
              key={region.entity_id}
              className={`paper-entity-card ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedIndex(originalIndex)}
            >
              <div className="paper-card-actions">
                <button onClick={(e) => { e.stopPropagation(); duplicateRegion(originalIndex) }} title={t('common:copy')}>📋</button>
                <button className="danger" onClick={async (e) => {
                  e.stopPropagation()
                  if (await showConfirm(t('regions.confirmDelete', { name: region.Metadata?.name }))) removeRegion(originalIndex)
                }} title={t('common:delete')}>✕</button>
              </div>
              <span className="paper-entity-badge region">🗺️ REGION</span>
              <span className="paper-entity-name">{region.Metadata?.name || t('common:unnamed')}</span>
              <span className="paper-entity-subtitle">{region.Region?.region_id}</span>
            </div>
          )
        })}
      </EntityCardGrid>

      {/* Bottom: Bento Grid Detail Editor */}
      <div className="paper-entity-detail-section" ref={contentRef}>
        {selectedRegionData && selectedIndex !== null ? (
            <div className="paper-region-grid">

              {/* ===== Basic Info ===== */}
              <div className="paper-bento-card paper-region-basic">
                <h3 className="section-title">{t('regions.basicInfo')}</h3>
                <div className="form-grid">
                  <div className="form-group">
                    <label>{t('regions.regionId')}</label>
                    <input
                      type="text"
                      value={selectedRegionData.Region?.region_id || ''}
                      onChange={e => updateRegion(selectedIndex, {
                        Region: { ...selectedRegionData.Region!, region_id: e.target.value }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('regions.regionName')}</label>
                    <input
                      type="text"
                      value={selectedRegionData.Region?.region_name || ''}
                      onChange={e => updateRegion(selectedIndex, {
                        Metadata: { ...selectedRegionData.Metadata!, name: e.target.value },
                        Region: { ...selectedRegionData.Region!, region_name: e.target.value }
                      })}
                    />
                  </div>
                  <div className="form-group full-width">
                    <label>{t('common:description')}</label>
                    <textarea
                      value={selectedRegionData.Region?.description || ''}
                      onChange={e => updateRegion(selectedIndex, {
                        Region: { ...selectedRegionData.Region!, description: e.target.value }
                      })}
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* ===== Locations — mini cards ===== */}
              <div className="paper-bento-card paper-region-locations">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">📍 {t('regions.locationsList', { count: locations.length })}</h3>
                  <button className="paper-bento-edit-btn" onClick={addLocation}>+ {t('regions.addLocation')}</button>
                </div>
                {locations.length > 0 ? (
                  <div className="paper-bento-item-grid">
                    {locations.map((loc, i) => (
                      <div key={`loc-${i}`} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'location', index: i })}>
                        <div className="paper-mini-card-title">{loc.name || t('regions.unnamedLocation')}</div>
                        <div className="paper-mini-card-desc">{loc.id}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('regions.noLocations', { defaultValue: t('common:noResults') })}</div>
                )}
              </div>

              {/* ===== Log — horizontal mini cards ===== */}
              <div className="paper-bento-card paper-region-log">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">📝 {t('regions.log')}</h3>
                  <button className="paper-bento-edit-btn" onClick={addLogEntry}>+ {t('world.addLogEntry')}</button>
                </div>
                {logEntries.length > 0 ? (
                  <div className="paper-bento-item-list">
                    {logEntries.map((entry, i) => (
                      <div key={`log-${i}`} className="paper-bento-mini-card paper-mini-card-horizontal" onClick={() => setEditing({ type: 'log_entry', index: i })}>
                        <div className="paper-mini-card-badge">{entry.add_at || '?'}</div>
                        <div className="paper-mini-card-title">{entry.content ? (entry.content.length > 60 ? entry.content.slice(0, 60) + '…' : entry.content) : t('world.emptyLogEntry')}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('world.noLogEntries')}</div>
                )}
              </div>

              {/* ===== Docs — mini cards ===== */}
              <div className="paper-bento-card paper-region-docs">
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

              {/* ===== Paths — mini cards ===== */}
              <div className="paper-bento-card paper-region-paths">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">🛤️ {t('regions.pathsList', { count: paths.length })}</h3>
                  <button className="paper-bento-edit-btn" onClick={addPath}>+ {t('regions.addPath')}</button>
                </div>
                {paths.length > 0 ? (
                  <div className="paper-bento-item-grid">
                    {paths.map((path, i) => {
                      const isCrossRegion = path.src_region !== path.to_region
                      const srcLocName = getLocationName(path.src_region, path.src_location)
                      const toLocName = getLocationName(path.to_region, path.to_location)
                      return (
                        <div key={`path-${i}`} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'path', index: i })}>
                          <div className="paper-mini-card-title" style={{ fontSize: '0.78rem' }}>
                            {srcLocName} → {toLocName}
                          </div>
                          {isCrossRegion && (
                            <div className="paper-mini-card-desc" style={{ fontSize: '0.68rem', color: 'var(--paper-accent, #8b2b1a)' }}>
                              ↗ {getRegionName(path.to_region)}
                            </div>
                          )}
                          {path.description && (
                            <div className="paper-mini-card-desc" style={{ fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                              {path.description}
                            </div>
                          )}
                          <div className="paper-bento-chips" style={{ marginTop: '4px' }}>
                            <span className={`paper-bento-chip ${path.discovered ? 'chip-active' : 'chip-inactive'}`} style={{ fontSize: '0.65rem' }}>
                              {path.discovered ? t('regions.discovered') : t('regions.notDiscovered')}
                            </span>
                            {isCrossRegion && (
                              <span className="paper-bento-chip chip-pink" style={{ fontSize: '0.65rem' }}>
                                {t('regions.crossRegion')}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('regions.noPaths', { defaultValue: t('common:noResults') })}</div>
                )}
              </div>

              {/* ===== Status Effects — mini cards ===== */}
              <div className="paper-bento-card paper-region-statuses">
                <div className="paper-bento-summary-header">
                  <h3 className="section-title">✨ {t('creatures.statusList', { count: statusEffects.length })}</h3>
                  <button className="paper-bento-edit-btn" onClick={addStatusEffect}>+ {t('creatures.addStatus')}</button>
                </div>
                {statusEffects.length > 0 ? (
                  <div className="paper-bento-item-grid">
                    {statusEffects.map((effect, i) => (
                      <div key={`se-${i}`} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'status_effect', index: i })}>
                        <div className="paper-mini-card-title">{effect.display_name || effect.instance_id}</div>
                        {effect.remark && <div className="paper-mini-card-desc">{effect.remark}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="paper-bento-empty">{t('creatures.noStatus', { defaultValue: t('common:noResults') })}</div>
                )}
              </div>

            </div>
        ) : (
          <div className="paper-grid-empty" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🗺️</div>
            <div>{t('regions.selectToEdit')}</div>
          </div>
        )}

        {/* =============== Edit Modals =============== */}

        {/* Single Location */}
        {editingLocation && (
          <BentoEditModal open onClose={closeModal} title={`📍 ${editingLocation.name || t('regions.unnamedLocation')}`}>
            <SingleLocationEditor
              location={editingLocation}
              onChange={patch => updateLocation(editingLocationIndex, patch)}
              onDelete={() => removeLocation(editingLocationIndex)}
            />
          </BentoEditModal>
        )}

        {/* Single Path */}
        {editingPath && (
          <BentoEditModal open onClose={closeModal} title={`🛤️ ${t('regions.pathNumber', { number: editingPathIndex + 1 })}`}>
            <SinglePathEditor
              path={editingPath}
              allRegions={regions}
              onChange={patch => updatePath(editingPathIndex, patch)}
              onDelete={() => removePath(editingPathIndex)}
            />
          </BentoEditModal>
        )}

        {/* Single Status Effect */}
        {editingStatusEffect && (
          <BentoEditModal open onClose={closeModal} title={`✨ ${editingStatusEffect.display_name || editingStatusEffect.instance_id}`}>
            <SingleStatusEffectEditor
              effect={editingStatusEffect}
              onChange={patch => updateStatusEffect(editingStatusIndex, patch)}
              onDelete={() => removeStatusEffect(editingStatusIndex)}
            />
          </BentoEditModal>
        )}

        {/* Single Log Entry */}
        {editingLogEntry && (
          <BentoEditModal open onClose={closeModal} title={`📝 ${editingLogEntry.add_at}`}>
            <SingleLogEntryEditor
              entry={editingLogEntry}
              onChange={patch => updateLogEntry(editingLogIndex, patch)}
              onDelete={() => removeLogEntry(editingLogIndex)}
            />
          </BentoEditModal>
        )}

        {/* Single Document */}
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
