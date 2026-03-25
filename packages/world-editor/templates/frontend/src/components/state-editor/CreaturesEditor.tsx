
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CreatureSnapshot,
  WorldSnapshot,
  OrganizationSnapshot,
  RegionSnapshot,
  StatusEffect,
  Item,
  Relationship,
  LogEntry,
  SettingDocument
} from '../../api/types'
import { showConfirm, showAlert } from '../AlertDialog'
import { AttributesEditor } from './CommonEditors'
import { generateUniqueId } from './types'
import { useEditorUIStore } from '../../stores/editorUIStore'
import { EntityCardGrid, type SortOrder } from './EntityCardGrid'
import { BentoEditModal } from './BentoEditModal'
import {
  SingleLogEntryEditor,
  SingleStatusEffectEditor,
  SingleInventoryItemEditor,
  SingleRelationshipEditor,
  SingleCustomComponentEditor,
  SingleDocumentEditor
} from './BentoSingleEditors'

// ============================================================================
// Editing Target Type
// ============================================================================

type CreatureEditTarget = null
  | { type: 'inventory_item'; index: number }
  | { type: 'status_effect'; index: number }
  | { type: 'relationship'; index: number }
  | { type: 'custom_component'; index: number }
  | { type: 'log_entry'; index: number }
  | { type: 'document'; index: number }

// ============================================================================
// 角色编辑器 - Bento Grid Layout (Dopamine Style)
// ============================================================================

export const CreaturesEditor: React.FC<{
  creatures: CreatureSnapshot[]
  world: WorldSnapshot
  onChange: (creatures: CreatureSnapshot[]) => void
  organizations: OrganizationSnapshot[]
  regions: RegionSnapshot[]
  onCreateOrganization?: (name: string) => string | undefined
  onCreateRegion?: (name: string) => string | undefined
  simpleMode?: boolean
}> = ({ creatures, world, onChange, organizations, regions, onCreateOrganization, onCreateRegion, simpleMode }) => {
  const { t } = useTranslation('editor')

  const { creatures: creaturesUIState, setCreaturesSelected } = useEditorUIStore()
  const selectedIndex = creaturesUIState.selectedIndex
  const setSelectedIndex = setCreaturesSelected

  const [sortOrder, setSortOrder] = useState<SortOrder>('original')
  const [nameError, setNameError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CreatureEditTarget>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const closeModal = () => setEditing(null)

  useEffect(() => { setNameError(null) }, [selectedIndex])

  useEffect(() => {
    if (selectedIndex === null && creatures.length > 0) {
      setSelectedIndex(0)
    } else if (selectedIndex !== null && selectedIndex >= creatures.length) {
      setSelectedIndex(Math.max(0, creatures.length - 1))
    }
  }, [creatures.length, selectedIndex])

  const filteredCreatures = useMemo(() => {
    let result = creatures.map((c, i) => ({ creature: c, originalIndex: i }))
    if (sortOrder === 'az') {
      result = [...result].sort((a, b) => (a.creature.Creature?.name || '').localeCompare(b.creature.Creature?.name || ''))
    } else if (sortOrder === 'za') {
      result = [...result].sort((a, b) => (b.creature.Creature?.name || '').localeCompare(a.creature.Creature?.name || ''))
    }
    return result
  }, [creatures, sortOrder])

  const selectedCreatureWrapper = selectedIndex !== null && creatures[selectedIndex]
    ? { creature: creatures[selectedIndex], index: selectedIndex }
    : null

  // CRUD Operations
  const addCreature = (isPlayer: boolean) => {
    const newId = Math.max(0, ...creatures.map(c => c.entity_id)) + 1
    const newCreature: CreatureSnapshot = {
      entity_id: newId,
      Creature: {
        creature_id: `${isPlayer ? 'player' : 'npc'}_${Date.now()}`,
        name: isPlayer ? t('creatures.newPlayer') : t('creatures.newNPC'),
        organization_id: '',
        titles: [],
        attrs: {},
        known_infos: []
      },
      LocationRef: { region_id: '', location_id: '' },
      Inventory: { items: [] },
      StatusEffects: { status_effects: [] },
      CustomComponents: { custom_components: [] },
      Relationship: { relationships: [] },
      Log: { entries: [] }
    }
    if (isPlayer) newCreature.IsPlayer = {}
    const newCreatures = [...creatures, newCreature]
    onChange(newCreatures)
    setSelectedIndex(newCreatures.length - 1)
  }

  const updateCreature = (index: number, updates: Partial<CreatureSnapshot>) => {
    const newCreatures = [...creatures]
    newCreatures[index] = { ...newCreatures[index], ...updates }
    onChange(newCreatures)
  }

  const removeCreature = (index: number) => {
    const newCreatures = creatures.filter((_, i) => i !== index)
    onChange(newCreatures)
    if (selectedIndex === index) setSelectedIndex(null)
  }

  const duplicateCreature = (index: number) => {
    const original = creatures[index]
    const newId = Math.max(0, ...creatures.map(c => c.entity_id)) + 1
    const copy: CreatureSnapshot = {
      ...JSON.parse(JSON.stringify(original)),
      entity_id: newId,
      Creature: {
        ...JSON.parse(JSON.stringify(original.Creature)),
        creature_id: `${original.Creature?.creature_id}_copy_${Date.now()}`,
        name: t('creatures.copyOf', { name: original.Creature?.name || t('common:unnamed') })
      }
    }
    const newCreatures = [...creatures, copy]
    onChange(newCreatures)
    setSelectedIndex(newCreatures.length - 1)
    showAlert(t('creatures.copied', { name: original.Creature?.name }))
  }

  const togglePlayerStatus = (index: number) => {
    const newCreatures = [...creatures]
    const target = newCreatures[index]
    const currentlyPlayer = target.IsPlayer !== undefined
    
    if (currentlyPlayer) {
      newCreatures[index] = { ...target }
      delete newCreatures[index].IsPlayer
    } else {
      // Set to player: remove IsPlayer from others first
      for (let i = 0; i < newCreatures.length; i++) {
        if (newCreatures[i].IsPlayer !== undefined) {
          newCreatures[i] = { ...newCreatures[i] }
          delete newCreatures[i].IsPlayer
        }
      }
      newCreatures[index] = { ...newCreatures[index], IsPlayer: {} }
    }
    onChange(newCreatures)
  }

  const allCreatures = creatures.map(c => ({
    creature_id: c.Creature?.creature_id || '',
    name: c.Creature?.name || ''
  }))

  // ========================================================================
  // List item CRUD helpers
  // ========================================================================

  // --- Inventory ---
  const getItems = (creature: CreatureSnapshot): Item[] => creature.Inventory?.items || []
  const addItem = (creatureIndex: number) => {
    const creature = creatures[creatureIndex]
    const items = [...getItems(creature), { id: '', count: 1, name: '', description: '', details: [] }]
    updateCreature(creatureIndex, { Inventory: { items } })
  }
  const updateItem = (creatureIndex: number, itemIndex: number, patch: Partial<Item>) => {
    const creature = creatures[creatureIndex]
    const items = [...getItems(creature)]
    items[itemIndex] = { ...items[itemIndex], ...patch }
    updateCreature(creatureIndex, { Inventory: { items } })
  }
  const removeItem = (creatureIndex: number, itemIndex: number) => {
    const creature = creatures[creatureIndex]
    const items = getItems(creature).filter((_, i) => i !== itemIndex)
    updateCreature(creatureIndex, { Inventory: { items } })
    closeModal()
  }

  // --- StatusEffects ---
  const getEffects = (creature: CreatureSnapshot): StatusEffect[] => creature.StatusEffects?.status_effects || []
  const addEffect = (creatureIndex: number) => {
    const creature = creatures[creatureIndex]
    const effects = [...getEffects(creature), {
      instance_id: generateUniqueId('status_inst'),
      display_name: '',
      data: undefined
    }]
    updateCreature(creatureIndex, { StatusEffects: { status_effects: effects } })
  }
  const updateEffect = (creatureIndex: number, effectIndex: number, patch: Partial<StatusEffect>) => {
    const creature = creatures[creatureIndex]
    const effects = [...getEffects(creature)]
    effects[effectIndex] = { ...effects[effectIndex], ...patch }
    updateCreature(creatureIndex, { StatusEffects: { status_effects: effects } })
  }
  const removeEffect = (creatureIndex: number, effectIndex: number) => {
    const creature = creatures[creatureIndex]
    const effects = getEffects(creature).filter((_, i) => i !== effectIndex)
    updateCreature(creatureIndex, { StatusEffects: { status_effects: effects } })
    closeModal()
  }

  // --- Relationships ---
  const getRels = (creature: CreatureSnapshot): Relationship[] => creature.Relationship?.relationships || []
  const addRelationship = (creatureIndex: number) => {
    const creature = creatures[creatureIndex]
    const rels = [...getRels(creature), {
      target_creature_id: allCreatures[0]?.creature_id || '',
      name: t('creatures.relationFriend'),
      value: 50
    }]
    updateCreature(creatureIndex, { Relationship: { relationships: rels } })
  }
  const updateRelationship = (creatureIndex: number, relIndex: number, patch: Partial<Relationship>) => {
    const creature = creatures[creatureIndex]
    const rels = [...getRels(creature)]
    rels[relIndex] = { ...rels[relIndex], ...patch }
    updateCreature(creatureIndex, { Relationship: { relationships: rels } })
  }
  const removeRelationship = (creatureIndex: number, relIndex: number) => {
    const creature = creatures[creatureIndex]
    const rels = getRels(creature).filter((_, i) => i !== relIndex)
    updateCreature(creatureIndex, { Relationship: { relationships: rels } })
    closeModal()
  }

  // --- CustomComponents ---
  const getComponents = (creature: CreatureSnapshot): Array<{ component_key: string; data: any }> =>
    creature.CustomComponents?.custom_components || []
  const addComponent = (creatureIndex: number) => {
    const creature = creatures[creatureIndex]
    const comps = [...getComponents(creature), { component_key: '', data: undefined }]
    updateCreature(creatureIndex, { CustomComponents: { custom_components: comps } })
  }
  const updateComponent = (creatureIndex: number, compIndex: number, patch: Partial<{ component_key: string; data: any }>) => {
    const creature = creatures[creatureIndex]
    const comps = [...getComponents(creature)]
    comps[compIndex] = { ...comps[compIndex], ...patch }
    updateCreature(creatureIndex, { CustomComponents: { custom_components: comps } })
  }
  const removeComponent = (creatureIndex: number, compIndex: number) => {
    const creature = creatures[creatureIndex]
    const comps = getComponents(creature).filter((_, i) => i !== compIndex)
    updateCreature(creatureIndex, { CustomComponents: { custom_components: comps } })
    closeModal()
  }

  // --- Documents ---
  const getDocs = (creature: CreatureSnapshot): SettingDocument[] => creature.BindSetting?.documents || []
  const addDoc = (creatureIndex: number) => {
    const creature = creatures[creatureIndex]
    const docs = [...getDocs(creature), { name: t('world.newDocName'), content: '' }]
    updateCreature(creatureIndex, { BindSetting: { documents: docs } })
    setEditing({ type: 'document', index: docs.length - 1 })
  }
  const updateDoc = (creatureIndex: number, docIndex: number, patch: Partial<SettingDocument>) => {
    const creature = creatures[creatureIndex]
    const docs = [...getDocs(creature)]
    docs[docIndex] = { ...docs[docIndex], ...patch }
    updateCreature(creatureIndex, { BindSetting: { documents: docs } })
  }
  const removeDoc = (creatureIndex: number, docIndex: number) => {
    const creature = creatures[creatureIndex]
    const docs = getDocs(creature).filter((_, i) => i !== docIndex)
    updateCreature(creatureIndex, { BindSetting: { documents: docs } })
    closeModal()
  }

  // --- LogEntries ---
  const getEntries = (creature: CreatureSnapshot): LogEntry[] => creature.Log?.entries || []
  const addLogEntry = (creatureIndex: number) => {
    const creature = creatures[creatureIndex]
    const entries = [...getEntries(creature), { content: '', add_at: '' }]
    updateCreature(creatureIndex, { Log: { entries } })
  }
  const updateLogEntry = (creatureIndex: number, entryIndex: number, patch: Partial<LogEntry>) => {
    const creature = creatures[creatureIndex]
    const entries = [...getEntries(creature)]
    entries[entryIndex] = { ...entries[entryIndex], ...patch }
    updateCreature(creatureIndex, { Log: { entries } })
  }
  const removeLogEntry = (creatureIndex: number, entryIndex: number) => {
    const creature = creatures[creatureIndex]
    const entries = getEntries(creature).filter((_, i) => i !== entryIndex)
    updateCreature(creatureIndex, { Log: { entries } })
    closeModal()
  }

  return (
    <div className="paper-vertical-editor">
      {/* Top: Entity Card Grid */}
      <EntityCardGrid
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
        emptyLabel={t('creatures.noMatch')}
        hasItems={filteredCreatures.length > 0}
        actions={
          <div className="paper-btn-group">
            <button className="paper-btn-add" onClick={() => addCreature(true)}>➕ {t('creatures.addPlayer')}</button>
            <button className="paper-btn-add" onClick={() => addCreature(false)}>➕ {t('creatures.addNPC')}</button>
          </div>
        }
      >
        {filteredCreatures.map(({ creature, originalIndex }) => {
          const isSelected = selectedIndex === originalIndex
          const isPlayer = creature.IsPlayer !== undefined
          return (
            <div
              key={creature.entity_id}
              className={`paper-entity-card ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedIndex(originalIndex)}
            >
              <div className="paper-card-actions">
                <button onClick={(e) => { e.stopPropagation(); duplicateCreature(originalIndex) }} title={t('common:copy')}>📋</button>
                <button className="danger" onClick={async (e) => {
                  e.stopPropagation()
                  if (await showConfirm(t('creatures.confirmDelete'))) removeCreature(originalIndex)
                }} title={t('common:delete')}>✕</button>
              </div>
              <span 
                className={`paper-entity-badge ${isPlayer ? 'player' : 'npc'}`}
                style={{ cursor: 'pointer' }}
                title={isPlayer ? t('creatures.clickToSetNPC') : t('creatures.clickToSetPlayer')}
              >
                {isPlayer ? '🎮 PLAYER' : '🤖 NPC'}
              </span>
              <span className="paper-entity-name">{creature.Creature?.name || t('common:unnamed')}</span>
              <span className="paper-entity-subtitle">{creature.Creature?.creature_id}</span>
            </div>
          )
        })}
      </EntityCardGrid>

      {/* Bottom: Detail Editor — Bento Grid */}
      <div className="paper-entity-detail-section" ref={contentRef}>
        {selectedCreatureWrapper ? (
            (() => {
              const { creature, index } = selectedCreatureWrapper
              const attrs = creature.Creature!
              const items = getItems(creature)
              const effects = getEffects(creature)
              const rels = getRels(creature)
              const comps = getComponents(creature)
              const entries = getEntries(creature)

              return (
                <div className="paper-creature-grid">
                  {/* ===== basic ===== */}
                  <div className="paper-bento-card paper-creature-basic">
                    <h3 className="section-title">{t('creatures.basicInfo')}</h3>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>{t('creatures.name')}</label>
                        <input
                          type="text"
                          value={attrs.name || ''}
                          onChange={e => {
                            if (nameError && e.target.value.trim()) setNameError(null)
                            updateCreature(index, { Creature: { ...attrs, name: e.target.value } })
                          }}
                          onBlur={e => {
                            if (!e.target.value.trim()) setNameError(t('validation.nameRequired'))
                            else setNameError(null)
                          }}
                          className={nameError ? 'form-input-error' : undefined}
                          placeholder={t('creatures.namePlaceholder')}
                        />
                        {nameError && <div className="form-field-error">{nameError}</div>}
                      </div>
                      <div className="form-group">
                        <label>Definition ID</label>
                        <input
                          type="text"
                          value={attrs.creature_id}
                          onChange={e => updateCreature(index, { Creature: { ...attrs, creature_id: e.target.value } })}
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('creatures.organization')}</label>
                        <select
                          value={attrs.organization_id || ''}
                          onChange={e => updateCreature(index, { Creature: { ...attrs, organization_id: e.target.value || undefined } })}
                        >
                          <option value="">{t('creatures.noOrganization')}</option>
                          {organizations.map(org => (
                            <option key={org.Organization?.organization_id} value={org.Organization?.organization_id}>
                              {org.Organization?.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <button 
                          className="paper-btn paper-btn-secondary"
                          onClick={() => togglePlayerStatus(index)}
                          style={{ width: '100%', marginTop: '4px', borderColor: creature.IsPlayer !== undefined ? 'var(--paper-electric-blue)' : 'var(--paper-border-color)' }}
                        >
                          {creature.IsPlayer !== undefined 
                            ? t('creatures.setToNPC') 
                            : t('creatures.setToPlayer')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ===== appearance ===== */}
                  <div className="paper-bento-card paper-creature-appearance">
                    <h3 className="section-title">{t('creatures.appearance')}</h3>
                    <div className="form-group">
                      <label>{t('creatures.bodyFeatures')}</label>
                      <textarea
                        value={attrs.appearance?.body || ''}
                        onChange={e => updateCreature(index, {
                          Creature: {
                            ...attrs,
                            appearance: { body: e.target.value, clothing: attrs.appearance?.clothing || '' }
                          }
                        })}
                        rows={3}
                        placeholder={t('creatures.bodyFeaturesPlaceholder')}
                      />
                    </div>
                    <br/>
                    <div className="form-group">
                      <label>{t('creatures.clothing')}</label>
                      <textarea
                        value={attrs.appearance?.clothing || ''}
                        onChange={e => updateCreature(index, {
                          Creature: {
                            ...attrs,
                            appearance: { body: attrs.appearance?.body || '', clothing: e.target.value }
                          }
                        })}
                        rows={3}
                        placeholder={t('creatures.clothingPlaceholder')}
                      />
                    </div>
                  </div>

                  {/* ===== profile ===== */}
                  <div className="paper-bento-card paper-creature-profile">
                    <h3 className="section-title">{t('creatures.profile')}</h3>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>{t('creatures.gender')}</label>
                        <input type="text" value={attrs.gender || ''} onChange={e => updateCreature(index, { Creature: { ...attrs, gender: e.target.value || undefined } })} placeholder={t('creatures.genderPlaceholder')} />
                      </div>
                      <div className="form-group">
                        <label>{t('creatures.race')}</label>
                        <input type="text" value={attrs.race || ''} onChange={e => updateCreature(index, { Creature: { ...attrs, race: e.target.value || undefined } })} placeholder={t('creatures.racePlaceholder')} />
                      </div>
                      <div className="form-group">
                        <label>{t('creatures.emotion')}</label>
                        <input type="text" value={attrs.emotion || ''} onChange={e => updateCreature(index, { Creature: { ...attrs, emotion: e.target.value || undefined } })} placeholder={t('creatures.emotionPlaceholder')} />
                      </div>
                    </div>

                  </div>

                  {/* ===== location & titles ===== */}
                  {creature.LocationRef && (
                    <div className="paper-bento-card paper-creature-location">
                      <h3 className="section-title">{t('creatures.location')}</h3>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>{t('creatures.region')}</label>
                          <select value={creature.LocationRef.region_id} onChange={e => updateCreature(index, { LocationRef: { region_id: e.target.value, location_id: '' } })}>
                            <option value="">{t('creatures.selectRegion')}</option>
                            {regions.map(r => <option key={r.Region?.region_id} value={r.Region?.region_id}>{r.Metadata?.name}</option>)}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>{t('creatures.place')}</label>
                          <select
                            value={creature.LocationRef.location_id}
                            onChange={e => updateCreature(index, { LocationRef: { ...creature.LocationRef!, location_id: e.target.value } })}
                            disabled={!creature.LocationRef.region_id}
                          >
                            <option value="">{t('creatures.selectPlace')}</option>
                            {regions.find(r => r.Region?.region_id === creature.LocationRef?.region_id)?.Region?.locations?.map(l => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <hr style={{ border: 'none', borderTop: '1px solid var(--paper-border)', margin: '12px 0' }} />

                      <h3 className="section-title">{t('creatures.titles')}</h3>
                      {attrs.titles.length > 0 && (
                        <div className="paper-bento-chips" style={{ flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                          {attrs.titles.map((title, ti) => (
                            <span
                              key={ti}
                              className="paper-bento-chip chip-blue"
                              style={{ cursor: 'pointer' }}
                              onClick={() => {
                                const newTitles = attrs.titles.filter((_, i) => i !== ti)
                                updateCreature(index, { Creature: { ...attrs, titles: newTitles } })
                              }}
                              title={t('common:delete')}
                            >
                              {title} ✕
                            </span>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder={t('creatures.titlePlaceholder')}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                            const newTitles = [...(attrs.titles || []), e.currentTarget.value.trim()]
                            updateCreature(index, { Creature: { ...attrs, titles: newTitles } })
                            e.currentTarget.value = ''
                            e.preventDefault()
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* ===== goal & known_infos ===== */}
                  <div className="paper-bento-card paper-creature-info">
                    <div className="paper-creature-goal-section">
                      <h3 className="section-title">🎯 {t('creatures.goal')}</h3>
                      <input
                        type="text"
                        value={attrs.goal || ''}
                        onChange={e => updateCreature(index, { Creature: { ...attrs, goal: e.target.value || undefined } })}
                        placeholder={t('creatures.goalPlaceholder')}
                      />
                    </div>

                    <hr style={{ border: 'none', borderTop: '1px solid var(--paper-border)', margin: '12px 0' }} />

                    <div className="paper-bento-summary-header">
                      <h3 className="section-title">💡 {t('creatures.knownInfos')} ({(attrs.known_infos || []).length})</h3>
                    </div>
                    <div className="paper-creature-known-infos-list">
                      {(attrs.known_infos || []).length > 0 ? (
                        <div className="paper-bento-item-list">
                          {(attrs.known_infos || []).map((info, ki) => (
                            <div
                              key={ki}
                              className="paper-bento-mini-card paper-mini-card-horizontal"
                              style={{ cursor: 'pointer' }}
                              onClick={() => {
                                const newInfos = (attrs.known_infos || []).filter((_, i) => i !== ki)
                                updateCreature(index, { Creature: { ...attrs, known_infos: newInfos } })
                              }}
                              title={t('common:delete')}
                            >
                              <div className="paper-mini-card-badge">{ki + 1}</div>
                              <div className="paper-mini-card-title">{info}</div>
                              <span className="paper-mini-card-delete">✕</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="paper-bento-empty">{t('creatures.knownInfoPlaceholder')}</div>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder={t('creatures.knownInfoPlaceholder')}
                      style={{ marginTop: '8px' }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newInfos = [...(attrs.known_infos || []), e.currentTarget.value.trim()]
                          updateCreature(index, { Creature: { ...attrs, known_infos: newInfos } })
                          e.currentTarget.value = ''
                          e.preventDefault()
                        }
                      }}
                    />
                  </div>

                  {/* ===== attrs ===== */}
                  {!simpleMode && (
                    <div className="paper-bento-card paper-creature-attrs">
                      <h3 className="section-title">{t('creatures.attributes')}</h3>
                      <AttributesEditor
                        attrs={attrs.attrs}
                        attrFields={world.Registry?.creature_attr_fields}
                        onChange={newAttrs => updateCreature(index, { Creature: { ...attrs, attrs: newAttrs } })}
                      />
                    </div>
                  )}

                  {/* ===== docs ===== */}
                  <div className="paper-bento-card paper-creature-docs">
                    <div className="paper-bento-summary-header">
                      <h3 className="section-title">{t('world.sections.documents')} ({getDocs(creature).length})</h3>
                      <button className="paper-bento-edit-btn" onClick={() => addDoc(index)}>+ {t('world.addDocument')}</button>
                    </div>
                    {getDocs(creature).length > 0 ? (
                      <div className="paper-bento-item-grid">
                        {getDocs(creature).map((d, i) => (
                          <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'document', index: i })}>
                            <div className="paper-mini-card-title">{d.name || '?'}</div>
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

                  {/* ===== inventory ===== */}
                  {!simpleMode && (
                    <div className="paper-bento-card paper-creature-inventory">
                      <div className="paper-bento-summary-header">
                        <h3 className="section-title">{t('creatures.inventory')} ({items.length})</h3>
                        <button className="paper-bento-edit-btn" onClick={() => addItem(index)}>+ {t('creatures.addItem')}</button>
                      </div>
                      {items.length > 0 ? (
                        <div className="paper-bento-item-grid">
                          {items.map((item, i) => (
                            <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'inventory_item', index: i })}>
                              <div className="paper-mini-card-title">{item.name || item.id || 'unnamed'}</div>
                              <div className="paper-mini-card-desc">&times;{item.count}{item.equipped ? ' ' : ''}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="paper-bento-empty">{t('creatures.noItems')}</div>
                      )}
                    </div>
                  )}

                  {/* ===== statuses ===== */}
                  <div className="paper-bento-card paper-creature-statuses">
                    <div className="paper-bento-summary-header">
                      <h3 className="section-title">✨ {t('creatures.statuses')} ({effects.length})</h3>
                      <button className="paper-bento-edit-btn" onClick={() => addEffect(index)}>+ {t('creatures.addStatus')}</button>
                    </div>
                    {effects.length > 0 ? (
                      <div className="paper-bento-item-grid">
                        {effects.map((eff, i) => (
                          <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'status_effect', index: i })}>
                            <div className="paper-mini-card-title">{eff.display_name || eff.instance_id}</div>
                            <div className="paper-mini-card-desc">{eff.remark || '-'}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="paper-bento-empty">{t('creatures.noStatuses')}</div>
                    )}
                  </div>

                  {/* ===== relationships ===== */}
                  {!simpleMode && (
                    <div className="paper-bento-card paper-creature-relationships">
                      <div className="paper-bento-summary-header">
                        <h3 className="section-title">💫 {t('creatures.relationships')} ({rels.length})</h3>
                        <button className="paper-bento-edit-btn" onClick={() => addRelationship(index)}>+ {t('creatures.addRelation')}</button>
                      </div>
                      {rels.length > 0 ? (
                        <div className="paper-bento-item-grid">
                          {rels.map((rel, i) => {
                            const targetName = allCreatures.find(c => c.creature_id === rel.target_creature_id)?.name || rel.target_creature_id
                            return (
                              <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'relationship', index: i })}>
                                <div className="paper-mini-card-title">{targetName}</div>
                                <div className="paper-mini-card-desc">{rel.name} ({rel.value})</div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="paper-bento-empty">{t('creatures.noRelationships')}</div>
                      )}
                    </div>
                  )}

                  {/* ===== components ===== */}
                  {!simpleMode && (
                    <div className="paper-bento-card paper-creature-components">
                      <div className="paper-bento-summary-header">
                        <h3 className="section-title"> {t('creatures.customComponents')} ({comps.length})</h3>
                        <button className="paper-bento-edit-btn" onClick={() => addComponent(index)}>+ {t('creatures.addCustomComponent')}</button>
                      </div>
                      {comps.length > 0 ? (
                        <div className="paper-bento-item-grid">
                          {comps.map((comp, i) => (
                            <div key={i} className="paper-bento-mini-card" onClick={() => setEditing({ type: 'custom_component', index: i })}>
                              <div className="paper-mini-card-title">{world.CustomComponentRegistry?.custom_components?.find(c => c.component_key === comp.component_key)?.component_name || comp.component_key || 'unnamed'}</div>
                              <div className="paper-mini-card-desc">{comp.data !== undefined ? JSON.stringify(comp.data).slice(0, 40) : '-'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="paper-bento-empty">{t('creatures.noCustomComponents')}</div>
                      )}
                    </div>
                  )}

                  {/* ===== log ===== */}
                  <div className="paper-bento-card paper-creature-log">
                    <div className="paper-bento-summary-header">
                      <h3 className="section-title">📝 {t('common:log')} ({entries.length})</h3>
                      <button className="paper-bento-edit-btn" onClick={() => addLogEntry(index)}>+ {t('world.addLogEntry')}</button>
                    </div>
                    {entries.length > 0 ? (
                      <div className="paper-bento-item-list">
                        {entries.map((entry, i) => (
                          <div key={i} className="paper-bento-mini-card paper-mini-card-horizontal" onClick={() => setEditing({ type: 'log_entry', index: i })}>
                            <div className="paper-mini-card-badge">{entry.add_at || '?'}</div>
                            <div className="paper-mini-card-title">{entry.content?.slice(0, 60) || t('world.emptyLogEntry')}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="paper-bento-empty">{t('world.emptyLogEntry')}</div>
                    )}
                  </div>
                </div>
              )
            })()
        ) : (
          <div className="empty-state">
            <span style={{ fontSize: '4rem', opacity: 0.3 }}>👥</span>
            <p style={{ color: 'var(--paper-text-tertiary)' }}>{t('creatures.selectToEdit') || '请从上方选择一个角色'}</p>
          </div>
        )}

        {/* ================================================================ */}
        {/* BentoEditModal instances                                         */}
        {/* ================================================================ */}

        {/* Inventory Item Modal */}
        {editing?.type === 'inventory_item' && selectedCreatureWrapper && (() => {
          const item = getItems(selectedCreatureWrapper.creature)[editing.index]
          if (!item) return null
          return (
            <BentoEditModal open onClose={closeModal} title={`🎒 ${item.name || item.id || 'Item'}`}>
              <SingleInventoryItemEditor
                item={item}
                onChange={patch => updateItem(selectedCreatureWrapper.index, editing.index, patch)}
                onDelete={() => removeItem(selectedCreatureWrapper.index, editing.index)}
              />
            </BentoEditModal>
          )
        })()}

        {/* Status Effect Modal */}
        {editing?.type === 'status_effect' && selectedCreatureWrapper && (() => {
          const eff = getEffects(selectedCreatureWrapper.creature)[editing.index]
          if (!eff) return null
          return (
            <BentoEditModal open onClose={closeModal} title={`✨ ${eff.display_name || eff.instance_id}`}>
              <SingleStatusEffectEditor
                effect={eff}
                onChange={patch => updateEffect(selectedCreatureWrapper.index, editing.index, patch)}
                onDelete={() => removeEffect(selectedCreatureWrapper.index, editing.index)}
              />
            </BentoEditModal>
          )
        })()}

        {/* Relationship Modal */}
        {editing?.type === 'relationship' && selectedCreatureWrapper && (() => {
          const rel = getRels(selectedCreatureWrapper.creature)[editing.index]
          if (!rel) return null
          const targetName = allCreatures.find(c => c.creature_id === rel.target_creature_id)?.name || rel.target_creature_id
          return (
            <BentoEditModal open onClose={closeModal} title={`💫 ${targetName}`}>
              <SingleRelationshipEditor
                relationship={rel}
                allCreatures={allCreatures.filter(c => c.creature_id !== selectedCreatureWrapper.creature.Creature?.creature_id)}
                onChange={patch => updateRelationship(selectedCreatureWrapper.index, editing.index, patch)}
                onDelete={() => removeRelationship(selectedCreatureWrapper.index, editing.index)}
              />
            </BentoEditModal>
          )
        })()}

        {/* Custom Component Modal */}
        {editing?.type === 'custom_component' && selectedCreatureWrapper && (() => {
          const comp = getComponents(selectedCreatureWrapper.creature)[editing.index]
          if (!comp) return null
          const matchedDef = world?.CustomComponentRegistry?.custom_components?.find(c => c.component_key === comp.component_key)
          return (
            <BentoEditModal open onClose={closeModal} title={`🧩 ${matchedDef?.component_name || comp.component_key || 'Component'}`}>
              <SingleCustomComponentEditor
                comp={comp}
                registryKeys={world?.CustomComponentRegistry?.custom_components?.map(c => c.component_key)}
                componentDefs={world?.CustomComponentRegistry?.custom_components}
                onChange={patch => updateComponent(selectedCreatureWrapper.index, editing.index, patch)}
                onDelete={() => removeComponent(selectedCreatureWrapper.index, editing.index)}
              />
            </BentoEditModal>
          )
        })()}

        {/* Log Entry Modal */}
        {editing?.type === 'log_entry' && selectedCreatureWrapper && (() => {
          const entry = getEntries(selectedCreatureWrapper.creature)[editing.index]
          if (!entry) return null
          return (
            <BentoEditModal open onClose={closeModal} title={`📝 ${entry.add_at || t('common:log')}`}>
              <SingleLogEntryEditor
                entry={entry}
                onChange={patch => updateLogEntry(selectedCreatureWrapper.index, editing.index, patch)}
                onDelete={() => removeLogEntry(selectedCreatureWrapper.index, editing.index)}
              />
            </BentoEditModal>
          )
        })()}

        {/* Document Modal */}
        {editing?.type === 'document' && selectedCreatureWrapper && (() => {
          const doc = getDocs(selectedCreatureWrapper.creature)[editing.index]
          if (!doc) return null
          return (
            <BentoEditModal open onClose={closeModal} title={`📄 ${doc.name}`} size="wide">
              <SingleDocumentEditor
                doc={doc}
                onChange={patch => updateDoc(selectedCreatureWrapper.index, editing.index, patch)}
                onDelete={() => removeDoc(selectedCreatureWrapper.index, editing.index)}
              />
            </BentoEditModal>
          )
        })()}
      </div>
    </div>
  )
}
