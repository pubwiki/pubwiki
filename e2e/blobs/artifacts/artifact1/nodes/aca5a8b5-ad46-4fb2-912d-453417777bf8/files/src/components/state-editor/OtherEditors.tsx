import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { 
  SettingDocument,
  StateData,
  BindSetting,
  GameWikiEntry,
  StoryHistoryEntry,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot
} from '../../api/types'
import type { GameInitialStory } from '../../api/types'
import { showAlert, showConfirm, showPrompt } from '../AlertDialog'
import { StringArrayEditor } from './CommonEditors'
import { useEditorUIStore } from '../../stores/editorUIStore'

// ============================================================================
// Setting Documents Editor (Entity-Grouped)
// ============================================================================

import { 
  FileText, 
  FilePlus, 
  Trash2, 
  Bold,
  Italic,
  Heading,
  List,
  Link as LinkIcon,
  ChevronRight,
  ChevronDown,
  Pencil,
  Folder,
  FolderOpen,
  Download,
  Upload
} from 'lucide-react'

type EntityType = 'world' | 'creature' | 'region' | 'organization'
interface DocSelection {
  entityType: EntityType
  entityIndex: number
  docIndex: number
}

function getEntityLabel(entityType: EntityType, entityIndex: number, data: StateData): string {
  switch (entityType) {
    case 'world': return '🌍 World'
    case 'creature': {
      const c = (data.Creatures as CreatureSnapshot[] | undefined)?.[entityIndex]
      return `👤 ${c?.Creature?.name || 'Unnamed'}`
    }
    case 'region': {
      const r = (data.Regions as RegionSnapshot[] | undefined)?.[entityIndex]
      return `🗺️ ${r?.Metadata?.name || r?.Region?.region_name || 'Unnamed'}`
    }
    case 'organization': {
      const o = (data.Organizations as OrganizationSnapshot[] | undefined)?.[entityIndex]
      return `🏛️ ${o?.Organization?.name || 'Unnamed'}`
    }
  }
}

function getEntityDocs(entityType: EntityType, entityIndex: number, data: StateData): SettingDocument[] {
  switch (entityType) {
    case 'world': return data.World?.BindSetting?.documents || []
    case 'creature': {
      const c = (data.Creatures as CreatureSnapshot[] | undefined)?.[entityIndex]
      return c?.BindSetting?.documents || []
    }
    case 'region': {
      const r = (data.Regions as RegionSnapshot[] | undefined)?.[entityIndex]
      return r?.BindSetting?.documents || []
    }
    case 'organization': {
      const o = (data.Organizations as OrganizationSnapshot[] | undefined)?.[entityIndex]
      return o?.BindSetting?.documents || []
    }
  }
}

function updateEntityDocs(entityType: EntityType, entityIndex: number, data: StateData, newDocs: SettingDocument[]): StateData {
  const newBindSetting: BindSetting = { documents: newDocs }
  switch (entityType) {
    case 'world':
      return { ...data, World: { ...data.World, BindSetting: newBindSetting } }
    case 'creature': {
      const creatures = [...(data.Creatures as CreatureSnapshot[] || [])]
      creatures[entityIndex] = { ...creatures[entityIndex], BindSetting: newBindSetting }
      return { ...data, Creatures: creatures }
    }
    case 'region': {
      const regions = [...(data.Regions as RegionSnapshot[] || [])]
      regions[entityIndex] = { ...regions[entityIndex], BindSetting: newBindSetting }
      return { ...data, Regions: regions }
    }
    case 'organization': {
      const orgs = [...(data.Organizations as OrganizationSnapshot[] || [])]
      orgs[entityIndex] = { ...orgs[entityIndex], BindSetting: newBindSetting }
      return { ...data, Organizations: orgs }
    }
  }
}

type DocNode = {
  name: string;
  path: string;
  docIndex?: number;
  doc?: SettingDocument;
  children?: { [key: string]: DocNode };
};

// Patch types for import/export
interface PatchEntry {
  entityType: EntityType
  entityId: number
  entityName: string
  documents: SettingDocument[]
}

interface SettingDocPatch {
  version: 1
  exportedAt: string
  entries: PatchEntry[]
}

function getEntityId(entityType: EntityType, entityIndex: number, data: StateData): number {
  switch (entityType) {
    case 'world': return data.World.entity_id
    case 'creature': return (data.Creatures as CreatureSnapshot[] | undefined)?.[entityIndex]?.entity_id ?? -1
    case 'region': return (data.Regions as RegionSnapshot[] | undefined)?.[entityIndex]?.entity_id ?? -1
    case 'organization': return (data.Organizations as OrganizationSnapshot[] | undefined)?.[entityIndex]?.entity_id ?? -1
  }
}

function buildDocTree(docs: SettingDocument[]): DocNode {
  const root: DocNode = { name: '', path: '', children: {} };

  docs.forEach((doc, docIdx) => {
    const parts = doc.name.split('/');
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!current.children) current.children = {};
      if (!current.children[part]) {
        current.children[part] = { name: part, path: currentPath, children: {} };
      }
      current = current.children[part];
    }

    const fileName = parts[parts.length - 1];
    if (!current.children) current.children = {};
    if (current.children[fileName]) {
       current.children[fileName].docIndex = docIdx;
       current.children[fileName].doc = doc;
    } else {
       current.children[fileName] = { name: fileName, path: doc.name, docIndex: docIdx, doc };
    }
  });

  return root;
}

export const SettingDocumentsEditor: React.FC<{
  data: StateData
  onChange: (data: StateData) => void
}> = ({ data, onChange }) => {
  const { t } = useTranslation('editor')
  const { settingDocs, setSettingDocsExpanded } = useEditorUIStore()
  const expandedGroups = useMemo(() => new Set(settingDocs.expandedPaths), [settingDocs.expandedPaths])
  const setExpandedGroups = useCallback((groups: Set<string>) => {
    setSettingDocsExpanded(Array.from(groups))
  }, [setSettingDocsExpanded])

  const [selection, setSelection] = useState<DocSelection | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportSelections, setExportSelections] = useState<Set<string>>(new Set())
  const [showImportResolveModal, setShowImportResolveModal] = useState(false)
  const [unmatchedEntries, setUnmatchedEntries] = useState<PatchEntry[]>([])
  const [unmatchedAssignments, setUnmatchedAssignments] = useState<Record<number, string>>({})

  const toggleGroup = (groupKey: string) => {
    const newGroups = new Set(expandedGroups)
    if (newGroups.has(groupKey)) newGroups.delete(groupKey)
    else newGroups.add(groupKey)
    setExpandedGroups(newGroups)
  }

  const selectedDoc = useMemo(() => {
    if (!selection) return null
    const docs = getEntityDocs(selection.entityType, selection.entityIndex, data)
    return docs[selection.docIndex] || null
  }, [selection, data])

  const addDoc = async (entityType: EntityType, entityIndex: number) => {
    const newName = await showPrompt(t('others.enterName', { type: t('others.file') }))
    if (!newName?.trim()) return
    const docs = getEntityDocs(entityType, entityIndex, data)
    if (docs.some(d => d.name === newName.trim())) {
      showAlert(t('others.nameExists'))
      return
    }
    const newDoc: SettingDocument = { name: newName.trim(), content: '' }
    const newDocs = [...docs, newDoc]
    onChange(updateEntityDocs(entityType, entityIndex, data, newDocs))
    setSelection({ entityType, entityIndex, docIndex: newDocs.length - 1 })
  }

  const removeDoc = async (entityType: EntityType, entityIndex: number, docIndex: number) => {
    const docs = getEntityDocs(entityType, entityIndex, data)
    const doc = docs[docIndex]
    if (!doc) return
    if (!(await showConfirm(t('others.confirmDeleteNode', { name: doc.name })))) return
    const newDocs = docs.filter((_, i) => i !== docIndex)
    onChange(updateEntityDocs(entityType, entityIndex, data, newDocs))
    if (selection?.entityType === entityType && selection?.entityIndex === entityIndex && selection?.docIndex === docIndex) {
      setSelection(null)
    }
  }

  const renameDoc = async (entityType: EntityType, entityIndex: number, docIndex: number) => {
    const docs = getEntityDocs(entityType, entityIndex, data)
    const doc = docs[docIndex]
    if (!doc) return
    const newName = await showPrompt(t('others.rename'), { defaultValue: doc.name })
    if (!newName?.trim() || newName === doc.name) return
    if (docs.some((d, i) => i !== docIndex && d.name === newName.trim())) {
      showAlert(t('others.nameExists'))
      return
    }
    const newDocs = docs.map((d, i) => i === docIndex ? { ...d, name: newName.trim() } : d)
    onChange(updateEntityDocs(entityType, entityIndex, data, newDocs))
  }

  const updateDocContent = (content: string) => {
    if (!selection) return
    const docs = getEntityDocs(selection.entityType, selection.entityIndex, data)
    const newDocs = docs.map((d, i) => i === selection.docIndex ? { ...d, content } : d)
    onChange(updateEntityDocs(selection.entityType, selection.entityIndex, data, newDocs))
  }

  const updateDocPriority = (priority: number | undefined) => {
    if (!selection) return
    const docs = getEntityDocs(selection.entityType, selection.entityIndex, data)
    const newDocs = docs.map((d, i) => {
      if (i !== selection.docIndex) return d
      if (priority === undefined) {
        const { static_priority, ...rest } = d
        return rest
      }
      return { ...d, static_priority: priority }
    })
    onChange(updateEntityDocs(selection.entityType, selection.entityIndex, data, newDocs))
  }

  const updateDocCondition = (condition: string | undefined) => {
    if (!selection) return
    const docs = getEntityDocs(selection.entityType, selection.entityIndex, data)
    const newDocs = docs.map((d, i) => {
      if (i !== selection.docIndex) return d
      if (condition === undefined || condition === '') {
        const { condition: _, ...rest } = d
        return rest
      }
      return { ...d, condition }
    })
    onChange(updateEntityDocs(selection.entityType, selection.entityIndex, data, newDocs))
  }

  const wrapSelection = (prefix: string, suffix: string = '', placeholder: string = '') => {
    if (!selectedDoc) return
    const textarea = document.querySelector('.setting-editor-textarea') as HTMLTextAreaElement
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const selected = text.substring(start, end)
    let newText: string, newCursorStart: number, newCursorEnd: number
    if (selected) {
      newText = text.substring(0, start) + prefix + selected + suffix + text.substring(end)
      newCursorStart = start + prefix.length
      newCursorEnd = newCursorStart + selected.length
    } else {
      const insert = placeholder || 'text'
      newText = text.substring(0, start) + prefix + insert + suffix + text.substring(end)
      newCursorStart = start + prefix.length
      newCursorEnd = newCursorStart + insert.length
    }
    updateDocContent(newText)
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(newCursorStart, newCursorEnd) })
  }

  const insertAtLineStart = (prefix: string) => {
    if (!selectedDoc) return
    const textarea = document.querySelector('.setting-editor-textarea') as HTMLTextAreaElement
    if (!textarea) return
    const start = textarea.selectionStart
    const text = textarea.value
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const newText = text.substring(0, lineStart) + prefix + text.substring(lineStart)
    updateDocContent(newText)
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, start + prefix.length) })
  }

  // === Patch Export/Import handlers ===
  const openExportModal = () => {
    const selections = new Set<string>()
    entityGroups.forEach(group => {
      group.entities.forEach(entity => {
        const docs = getEntityDocs(group.entityType, entity.index, data)
        docs.forEach((_, di) => {
          selections.add(`${group.entityType}|${entity.index}|${di}`)
        })
      })
    })
    setExportSelections(selections)
    setShowExportModal(true)
  }

  const toggleExportSelection = (key: string) => {
    const newSelections = new Set(exportSelections)
    if (newSelections.has(key)) newSelections.delete(key)
    else newSelections.add(key)
    setExportSelections(newSelections)
  }

  const toggleAllEntityDocs = (entityType: EntityType, entityIndex: number, docs: SettingDocument[]) => {
    const newSelections = new Set(exportSelections)
    const keys = docs.map((_, di) => `${entityType}|${entityIndex}|${di}`)
    const allSelected = keys.every(k => newSelections.has(k))
    if (allSelected) {
      keys.forEach(k => newSelections.delete(k))
    } else {
      keys.forEach(k => newSelections.add(k))
    }
    setExportSelections(newSelections)
  }

  const handleExport = () => {
    const entriesMap = new Map<string, PatchEntry>()
    exportSelections.forEach(key => {
      const parts = key.split('|')
      const entityType = parts[0] as EntityType
      const entityIndex = parseInt(parts[1])
      const docIndex = parseInt(parts[2])
      const docs = getEntityDocs(entityType, entityIndex, data)
      const doc = docs[docIndex]
      if (!doc) return
      const entityKey = `${entityType}|${entityIndex}`
      if (!entriesMap.has(entityKey)) {
        entriesMap.set(entityKey, {
          entityType,
          entityId: getEntityId(entityType, entityIndex, data),
          entityName: getEntityLabel(entityType, entityIndex, data),
          documents: []
        })
      }
      entriesMap.get(entityKey)!.documents.push(doc)
    })

    const patch: SettingDocPatch = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: Array.from(entriesMap.values())
    }

    const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `setting-docs-patch-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportModal(false)
  }

  const handleImportFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const patch = JSON.parse(text) as SettingDocPatch
        if (!patch.version || !patch.entries) {
          showAlert(t('others.invalidPatchFile'))
          return
        }
        processPatch(patch)
      } catch (err) {
        showAlert(t('others.patchParseError', { message: (err as Error).message }))
      }
    }
    input.click()
  }

  const mergeDocs = (existing: SettingDocument[], incoming: SettingDocument[]): SettingDocument[] => {
    const result = [...existing]
    for (const doc of incoming) {
      const idx = result.findIndex(d => d.name === doc.name)
      if (idx >= 0) result[idx] = doc
      else result.push(doc)
    }
    return result
  }

  const processPatch = (patch: SettingDocPatch) => {
    let newData = { ...data }
    const unmatched: PatchEntry[] = []

    for (const entry of patch.entries) {
      if (entry.entityType === 'world') {
        const worldDocs = newData.World?.BindSetting?.documents || []
        const merged = mergeDocs(worldDocs, entry.documents)
        newData = { ...newData, World: { ...newData.World, BindSetting: { documents: merged } } }
      } else {
        const entitiesArray = entry.entityType === 'creature'
          ? (newData.Creatures || []) as CreatureSnapshot[]
          : entry.entityType === 'region'
          ? (newData.Regions || []) as RegionSnapshot[]
          : (newData.Organizations || []) as OrganizationSnapshot[]

        const matchIndex = entitiesArray.findIndex(e => e.entity_id === entry.entityId)
        if (matchIndex >= 0) {
          const currentDocs = getEntityDocs(entry.entityType, matchIndex, newData)
          const merged = mergeDocs(currentDocs, entry.documents)
          newData = updateEntityDocs(entry.entityType, matchIndex, newData, merged)
        } else {
          unmatched.push(entry)
        }
      }
    }

    onChange(newData)

    if (unmatched.length > 0) {
      setUnmatchedEntries(unmatched)
      const assignments: Record<number, string> = {}
      unmatched.forEach((_, i) => { assignments[i] = 'discard' })
      setUnmatchedAssignments(assignments)
      setShowImportResolveModal(true)
    } else {
      showAlert(t('others.importSuccess'))
    }
  }

  const handleResolveUnmatched = () => {
    let newData = { ...data }
    unmatchedEntries.forEach((entry, i) => {
      const assignment = unmatchedAssignments[i]
      if (!assignment || assignment === 'discard') return
      const [targetType, targetIndexStr] = assignment.split('|') as [EntityType, string]
      const targetIndex = parseInt(targetIndexStr)
      const currentDocs = getEntityDocs(targetType, targetIndex, newData)
      const merged = mergeDocs(currentDocs, entry.documents)
      newData = updateEntityDocs(targetType, targetIndex, newData, merged)
    })
    onChange(newData)
    setShowImportResolveModal(false)
    setUnmatchedEntries([])
    showAlert(t('others.importSuccess'))
  }

  const creatures = (data.Creatures || []) as CreatureSnapshot[]
  const regions = (data.Regions || []) as RegionSnapshot[]
  const organizations = (data.Organizations || []) as OrganizationSnapshot[]

  interface EntityGroup {
    key: string; icon: string; label: string; entityType: EntityType
    entities: { index: number; name: string; docCount: number }[]
  }

  const entityGroups: EntityGroup[] = useMemo(() => [
    {
      key: 'world', icon: '🌍', label: t('others.worldDocs'), entityType: 'world' as EntityType,
      entities: [{ index: -1, name: t('tabs.world'), docCount: (data.World?.BindSetting?.documents || []).length }]
    },
    {
      key: 'creatures', icon: '👥', label: t('tabs.creatures'), entityType: 'creature' as EntityType,
      entities: creatures.map((c, i) => ({
        index: i, name: c.Creature?.name || t('common:unnamed'),
        docCount: (c.BindSetting?.documents || []).length
      }))
    },
    {
      key: 'regions', icon: '🗺️', label: t('tabs.regions'), entityType: 'region' as EntityType,
      entities: regions.map((r, i) => ({
        index: i, name: r.Metadata?.name || r.Region?.region_name || t('common:unnamed'),
        docCount: (r.BindSetting?.documents || []).length
      }))
    },
    {
      key: 'organizations', icon: '🏛️', label: t('tabs.organizations'), entityType: 'organization' as EntityType,
      entities: organizations.map((o, i) => ({
        index: i, name: o.Organization?.name || t('common:unnamed'),
        docCount: (o.BindSetting?.documents || []).length
      }))
    }
  ], [data, creatures, regions, organizations, t])

  const renderDocTree = (
    nodes: { [key: string]: DocNode },
    groupKey: string,
    entityIndex: number,
    groupEntityType: EntityType,
    depth: number,
    parentExpandedKey: string
  ): React.ReactNode[] => {
    return Object.values(nodes).sort((a, b) => {
      const aIsFolder = !!a.children;
      const bIsFolder = !!b.children;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).map((node) => {
      const folderKey = `${parentExpandedKey}-folder-${node.path}`;
      const isExpanded = expandedGroups.has(folderKey);
      const isFile = node.docIndex !== undefined;
      const isFolder = !!node.children;
      const docIdx = node.docIndex;
      const isSelected = isFile && selection?.entityType === groupEntityType && selection?.entityIndex === entityIndex && selection?.docIndex === docIdx;
      
      return (
        <div key={folderKey}>
          <div 
            className={`tree-node-item ${isSelected ? 'selected' : ''}`} 
            style={{ paddingLeft: `${44 + depth * 16}px`, gap: '6px' }} 
            onClick={(e) => {
              if (isFile) {
                setSelection({ entityType: groupEntityType, entityIndex: entityIndex, docIndex: docIdx! });
              } else if (isFolder) {
                 toggleGroup(folderKey);
              }
            }}
          >
            {isFolder && (
              <span onClick={(e) => { e.stopPropagation(); toggleGroup(folderKey); }} style={{ display: 'flex', alignItems: 'center' }}>
                {isExpanded ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} style={{ flexShrink: 0 }} />}
              </span>
            )}
            {!isFolder && <span style={{ width: '14px' }} />}
            
            {isFolder ? (
              isExpanded ? <FolderOpen size={14} style={{ flexShrink: 0, color: 'var(--paper-text-secondary)' }} /> : <Folder size={14} style={{ flexShrink: 0, color: 'var(--paper-text-secondary)' }} />
            ) : (
              <FileText size={14} style={{ flexShrink: 0, color: 'var(--paper-text-secondary)' }} />
            )}
            
            <span className="tree-label" style={{ fontSize: '0.9rem', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
            <div className="tree-item-actions">
              {isFile && <button className="tree-more-btn" onClick={e => { e.stopPropagation(); renameDoc(groupEntityType, entityIndex, docIdx!) }} title={t('others.rename')}><Pencil size={12} /></button>}
              {isFile && <button className="tree-more-btn danger" onClick={e => { e.stopPropagation(); removeDoc(groupEntityType, entityIndex, docIdx!) }} title={t('common:delete')}><Trash2 size={12} /></button>}
            </div>
          </div>
          {isFolder && isExpanded && renderDocTree(node.children!, groupKey, entityIndex, groupEntityType, depth + 1, parentExpandedKey)}
        </div>
      );
    });
  };

  const totalDocs = entityGroups.reduce((sum, g) => sum + g.entities.reduce((s, e) => s + e.docCount, 0), 0)

  return (
    <div className="editor-maximize-container">
      <div className="editor-left-sidebar">
        <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            📚 {t('others.settingDocuments')} ({totalDocs})
          </span>
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
            <button onClick={handleImportFile} title={t('others.importPatch')} style={{ background: 'transparent', border: 'none', color: 'var(--paper-text-secondary)', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Upload size={14} />
            </button>
            <button onClick={openExportModal} title={t('others.exportPatch')} style={{ background: 'transparent', border: 'none', color: 'var(--paper-text-secondary)', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Download size={14} />
            </button>
          </div>
        </div>
        <div className="tree-scroll-container">
          {entityGroups.map(group => (
            <div key={group.key}>
              <div className="tree-node-item" style={{ padding: '8px 12px', fontWeight: 600, cursor: 'pointer', gap: '8px' }} onClick={() => toggleGroup(group.key)}>
                {expandedGroups.has(group.key) ? <ChevronDown size={16} style={{ flexShrink: 0 }} /> : <ChevronRight size={16} style={{ flexShrink: 0 }} />}
                <span className="tree-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                  <span style={{ flexShrink: 0, fontSize: '1.2rem' }}>{group.icon}</span>
                  <span className="tree-label">{group.label}</span>
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--paper-text-tertiary)', flexShrink: 0 }}>
                  {group.entities.reduce((s, e) => s + e.docCount, 0)}
                </span>
              </div>
              {expandedGroups.has(group.key) && group.entities.map(entity => {
                const entityDocs = getEntityDocs(group.entityType, entity.index, data)
                const isEntityExpanded = expandedGroups.has(`${group.key}-${entity.index}`)
                return (
                  <div key={`${group.key}-${entity.index}`}>
                    <div className="tree-node-item" style={{ paddingLeft: '24px', cursor: 'pointer', gap: '6px' }} onClick={() => toggleGroup(`${group.key}-${entity.index}`)}>
                      {isEntityExpanded ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} style={{ flexShrink: 0 }} />}
                      <span className="tree-label" style={{ fontSize: '0.95rem' }}>{entity.name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--paper-text-tertiary)', flexShrink: 0 }}>{entity.docCount}</span>
                      <div className="tree-item-actions">
                        <button className="tree-more-btn" onClick={e => { e.stopPropagation(); addDoc(group.entityType, entity.index) }} title={t('others.newFile')}>
                          <FilePlus size={14} />
                        </button>
                      </div>
                    </div>
                    {isEntityExpanded && renderDocTree(
                      buildDocTree(entityDocs).children || {},
                      group.key,
                      entity.index,
                      group.entityType,
                      0,
                      `${group.key}-${entity.index}`
                    )}
                    {isEntityExpanded && entityDocs.length === 0 && (
                      <div style={{ padding: '6px 12px 6px 44px', fontSize: '0.75rem', color: 'var(--paper-text-tertiary)', fontStyle: 'italic' }}>
                        {t('others.noDocuments')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="editor-main-area">
        {selectedDoc ? (
          <div className="document-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="editor-toolbar">
              <div className="toolbar-group">
                <button onClick={() => wrapSelection('**', '**', 'Bold')} title="Bold"><Bold size={16} /></button>
                <button onClick={() => wrapSelection('*', '*', 'Italic')} title="Italic"><Italic size={16} /></button>
                <div className="toolbar-divider" />
                <button onClick={() => insertAtLineStart('# ')} title="H1"><Heading size={16} /></button>
                <button onClick={() => insertAtLineStart('- ')} title="List"><List size={16} /></button>
                <div className="toolbar-divider" />
                <button onClick={() => wrapSelection('[', '](url)', 'Link')} title="Link"><LinkIcon size={16} /></button>
              </div>
              <div className="toolbar-group" style={{ marginLeft: '8px' }}>
                <label className="priority-toggle" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px', borderRadius: '6px', background: selectedDoc.static_priority !== undefined ? 'rgba(251, 191, 36, 0.15)' : 'var(--paper-bg-primary)', border: selectedDoc.static_priority !== undefined ? '1px solid rgba(251, 191, 36, 0.3)' : '1px solid var(--paper-border-color)', cursor: 'pointer', transition: 'all 0.2s', fontSize: '0.8rem', color: selectedDoc.static_priority !== undefined ? '#fbbf24' : 'var(--paper-text-secondary)' }}>
                  <input type="checkbox" checked={selectedDoc.static_priority !== undefined} onChange={(e) => updateDocPriority(e.target.checked ? 10 : undefined)} style={{ cursor: 'pointer', width: '14px', height: '14px', accentColor: '#fbbf24' }} />
                  <span>{t('others.staticPriority')}</span>
                  {selectedDoc.static_priority !== undefined && (
                    <input type="number" value={selectedDoc.static_priority} onClick={(e) => e.stopPropagation()} onChange={(e) => updateDocPriority(parseInt(e.target.value) || 0)} style={{ width: '50px', padding: '2px 6px', fontSize: '0.8rem', background: 'var(--paper-bg-primary)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '4px', color: '#fbbf24', fontWeight: 600, textAlign: 'center' }} title={t('others.priority')} min={0} />
                  )}
                </label>
                <button onClick={(e) => { e.stopPropagation(); showAlert(t('others.staticPriorityHint')) }} style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--paper-border-color)', borderRadius: '50%', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--paper-text-tertiary)', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t('others.help')}>?</button>
              </div>
              <div className="toolbar-group" style={{ marginLeft: '8px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '6px', background: selectedDoc.condition ? 'rgba(99, 102, 241, 0.15)' : 'var(--paper-bg-primary)', border: selectedDoc.condition ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid var(--paper-border-color)', fontSize: '0.8rem', color: selectedDoc.condition ? '#818cf8' : 'var(--paper-text-secondary)', flex: 1, minWidth: 0 }}>
                  <span style={{ whiteSpace: 'nowrap' }}>{t('others.condition')}</span>
                  <input type="text" value={selectedDoc.condition || ''} onChange={(e) => updateDocCondition(e.target.value)} placeholder={t('others.conditionPlaceholder')} style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem', background: 'var(--paper-bg-primary)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '4px', color: selectedDoc.condition ? '#818cf8' : 'var(--paper-text-primary)', minWidth: 0 }} title={t('others.conditionHint')} />
                </div>
                <button onClick={(e) => { e.stopPropagation(); showAlert(t('others.conditionHint')) }} style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--paper-border-color)', borderRadius: '50%', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--paper-text-tertiary)', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t('others.help')}>?</button>
              </div>
              <div className="toolbar-path">
                {selection ? `${getEntityLabel(selection.entityType, selection.entityIndex, data)} / ${selectedDoc.name}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface-primary)', minWidth: 0 }}>
                <textarea className="setting-editor-textarea" value={selectedDoc.content} onChange={e => updateDocContent(e.target.value)} placeholder={t('others.startWriting')} spellCheck={false} style={{ flex: 1, width: '100%', padding: '20px 28px', background: 'transparent', border: 'none', color: 'var(--paper-text-primary)', fontFamily: 'monospace', fontSize: '1rem', lineHeight: '1.75', resize: 'none', outline: 'none' }} />
              </div>
            </div>
            <div className="editor-footer">
               <span>{t('others.lines', { count: selectedDoc.content.split('\n').length })}</span>
               <span>{t('others.chars', { count: selectedDoc.content.length })}</span>
            </div>
          </div>
        ) : (
          <div className="empty-editor-state">
            <FileText size={48} opacity={0.2} />
            <p>{t('others.selectDocument')}</p>
          </div>
        )}
      </div>

      {/* Export Patch Modal */}
      {showExportModal && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="modal-content"
            style={{ background: 'var(--paper-bg-primary)', borderRadius: '12px', border: '1px solid var(--paper-border-color, #e2e8f0)', width: '500px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--paper-border-color, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{t('others.exportPatch')}</h3>
              <button onClick={() => setShowExportModal(false)} style={{ background: 'none', border: 'none', color: 'var(--paper-text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              <p style={{ marginBottom: '12px', color: 'var(--paper-text-secondary)', fontSize: '0.85rem' }}>
                {t('others.exportPatchHint')}
              </p>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={() => {
                  const all = new Set<string>()
                  entityGroups.forEach(g => g.entities.forEach(e => {
                    getEntityDocs(g.entityType, e.index, data).forEach((_, di) => all.add(`${g.entityType}|${e.index}|${di}`))
                  }))
                  setExportSelections(all)
                }}>{t('others.selectAll')}</button>
                <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={() => setExportSelections(new Set())}>
                  {t('others.deselectAll')}
                </button>
              </div>
              {entityGroups.map(group => (
                group.entities.map(entity => {
                  const docs = getEntityDocs(group.entityType, entity.index, data)
                  if (docs.length === 0) return null
                  const entityKeys = docs.map((_, di) => `${group.entityType}|${entity.index}|${di}`)
                  const allSelected = entityKeys.every(k => exportSelections.has(k))
                  const someSelected = entityKeys.some(k => exportSelections.has(k))
                  return (
                    <div key={`export-${group.key}-${entity.index}`} style={{ marginBottom: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--paper-bg-primary)', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                          onChange={() => toggleAllEntityDocs(group.entityType, entity.index, docs)}
                          style={{ accentColor: 'var(--paper-electric-blue)' }}
                        />
                        <span>{group.icon} {entity.name}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--paper-text-tertiary)' }}>{docs.length}</span>
                      </label>
                      <div style={{ paddingLeft: '24px', marginTop: '2px' }}>
                        {docs.map((doc, di) => {
                          const key = `${group.entityType}|${entity.index}|${di}`
                          return (
                            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                              <input type="checkbox" checked={exportSelections.has(key)} onChange={() => toggleExportSelection(key)} style={{ accentColor: 'var(--paper-electric-blue)' }} />
                              <FileText size={12} style={{ color: 'var(--paper-text-secondary)', flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              ))}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--paper-border-color, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--paper-text-tertiary)' }}>
                {t('others.selectedCount', { count: exportSelections.size })}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-secondary" onClick={() => setShowExportModal(false)}>{t('common:cancel')}</button>
                <button className="btn-primary" onClick={handleExport} disabled={exportSelections.size === 0}>
                  <Download size={14} style={{ marginRight: '4px' }} />
                  {t('others.exportPatch')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Resolution Modal */}
      {showImportResolveModal && unmatchedEntries.length > 0 && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            className="modal-content"
            style={{ background: 'var(--paper-bg-primary)', borderRadius: '12px', border: '1px solid var(--paper-border-color, #e2e8f0)', width: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--paper-border-color, #e2e8f0)', background: 'rgba(251, 191, 36, 0.08)' }}>
              <h3 style={{ margin: 0, color: '#fbbf24' }}>{t('others.unmatchedDocs')}</h3>
              <p style={{ color: 'var(--paper-text-secondary)', fontSize: '0.85rem', margin: '6px 0 0' }}>
                {t('others.unmatchedDocsHint')}
              </p>
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              {unmatchedEntries.map((entry, i) => (
                <div key={i} style={{ marginBottom: '16px', padding: '12px', background: 'var(--paper-bg-primary)', borderRadius: '8px', border: '1px solid var(--paper-border-color, #e2e8f0)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{entry.entityName}</span>
                      <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--paper-text-tertiary)' }}>
                        (ID: {entry.entityId})
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--paper-text-tertiary)' }}>
                      {entry.documents.length} {t('others.file')}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--paper-text-tertiary)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.documents.map(d => d.name).join(', ')}
                  </div>
                  <select
                    value={unmatchedAssignments[i] || 'discard'}
                    onChange={(e) => setUnmatchedAssignments(prev => ({ ...prev, [i]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'var(--paper-bg-secondary)', border: '1px solid var(--paper-border-color, #e2e8f0)', color: 'var(--paper-text-primary)', fontSize: '0.85rem' }}
                  >
                    <option value="discard">{t('others.discardDocs')}</option>
                    <option value="world|-1">🌍 {t('tabs.world')}</option>
                    {creatures.map((c, ci) => (
                      <option key={`c-${ci}`} value={`creature|${ci}`}>
                        👤 {c.Creature?.name || t('common:unnamed')}
                      </option>
                    ))}
                    {regions.map((r, ri) => (
                      <option key={`r-${ri}`} value={`region|${ri}`}>
                        🗺️ {r.Metadata?.name || r.Region?.region_name || t('common:unnamed')}
                      </option>
                    ))}
                    {organizations.map((o, oi) => (
                      <option key={`o-${oi}`} value={`organization|${oi}`}>
                        🏛️ {o.Organization?.name || t('common:unnamed')}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--paper-border-color, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn-secondary" onClick={() => { setShowImportResolveModal(false); setUnmatchedEntries([]) }}>
                {t('common:cancel')}
              </button>
              <button className="btn-primary" onClick={handleResolveUnmatched}>
                {t('others.applyImport')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================================
// 开局故事编辑器
// ============================================================================

export const GameInitialStoryEditor: React.FC<{
  story: GameInitialStory | undefined
  onChange: (story: GameInitialStory) => void
}> = ({ story, onChange }) => {
  const { t } = useTranslation('editor')
  const currentStory = story || { background: '', start_story: '' }

  const renderEditorPane = (
    label: string,
    value: string,
    onChangeVal: (val: string) => void,
    placeholder: string
  ) => (
    <div className="editor-main-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div className="editor-toolbar">
        <div className="toolbar-group">
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--paper-text-primary)', letterSpacing: '0.02em' }}>{label}</span>
        </div>
      </div>
      <textarea
        className="editor-textarea"
        value={value}
        onChange={e => onChangeVal(e.target.value)}
        placeholder={placeholder}
      />
      <div className="editor-footer">
        <span>Lines: {value.split('\n').length}</span>
        <span>Words: {value.length}</span>
      </div>
    </div>
  )

  return (
    <div className="editor-section">
      <div style={{ marginBottom: '16px' }}>
      </div>
      <div className="editor-maximize-container" style={{ height: 'calc(100vh - 280px)', margin: 0 }}>
        {renderEditorPane(
          t('others.backgroundStory'),
          currentStory.background,
          val => onChange({ ...currentStory, background: val }),
          t('others.backgroundPlaceholder')
        )}
        <div style={{ width: '1px', background: 'var(--paper-bg-primary)', flexShrink: 0 }} />
        {renderEditorPane(
          t('others.openingStory'),
          currentStory.start_story,
          val => onChange({ ...currentStory, start_story: val }),
          t('others.openingPlaceholder')
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 游戏百科编辑器 - 紧凑表格形式
// ============================================================================

export const GameWikiEntryEditor: React.FC<{
  entries?: GameWikiEntry
  onChange: (entries: GameWikiEntry) => void
}> = ({ entries, onChange }) => {
  const { t } = useTranslation('editor')
  const currentEntries = entries || []

  const addEntry = () => {
    onChange([...currentEntries, { title: t('others.newEntry'), content: '' }])
  }

  const updateEntry = (index: number, updates: Partial<{ title: string; content: string }>) => {
    const newEntries = [...currentEntries]
    newEntries[index] = { ...newEntries[index], ...updates }
    onChange(newEntries)
  }

  const removeEntry = (index: number) => {
    onChange(currentEntries.filter((_, i) => i !== index))
  }

  return (
    <div className="editor-section">
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0 }}>{t('others.wikiTitle', { count: currentEntries.length })}</h3>
          <p className="field-hint" style={{ margin: '4px 0 0' }}>{t('others.wikiHint')}</p>
        </div>
        <button className="btn-add" onClick={addEntry}>
          {t('others.addEntry')}
        </button>
      </div>
      
      {currentEntries.length > 0 ? (
        <div className="wiki-table" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* 表头 */}
          <div className="wiki-table-header" style={{ 
            display: 'grid', 
            gridTemplateColumns: '200px 1fr 60px', 
            gap: '12px', 
            padding: '8px 12px',
            background: 'var(--paper-bg-primary)',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--paper-text-secondary)'
          }}>
            <span>{t('others.entryTitle')}</span>
            <span>{t('others.entryContent')}</span>
            <span style={{ textAlign: 'center' }}>{t('common:actions')}</span>
          </div>
          
          {/* 词条列表 */}
          {currentEntries.map((entry, index) => (
            <div 
              key={`wiki-${index}`} 
              className="wiki-table-row"
              style={{ 
                display: 'grid', 
                gridTemplateColumns: '200px 1fr 60px', 
                gap: '12px', 
                padding: '8px 12px',
                background: 'rgba(30, 41, 59, 0.4)',
                borderRadius: '6px',
                border: '1px solid var(--paper-border-color, #e2e8f0)',
                alignItems: 'center'
              }}
            >
              <input
                type="text"
                value={entry.title}
                onChange={e => updateEntry(index, { title: e.target.value })}
                placeholder={t('others.entryTitle')}
                style={{ padding: '6px 10px', fontSize: '0.9rem' }}
              />
              <input
                type="text"
                value={entry.content}
                onChange={e => updateEntry(index, { content: e.target.value })}
                placeholder={t('others.briefDescription')}
                style={{ padding: '6px 10px', fontSize: '0.9rem' }}
              />
              <button
                className="btn-delete"
                onClick={async () => {
                  if (await showConfirm(t('others.confirmDeleteEntry', { title: entry.title }))) {
                    removeEntry(index)
                  }
                }}
                title={t('others.deleteEntry')}
                style={{ padding: '4px 8px', fontSize: '0.8rem' }}
              >
                {t('common:delete')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ textAlign: 'center', padding: '32px', color: 'var(--paper-text-tertiary)' }}>
          <p>{t('others.noWikiEntries')}</p>
          <p className="hint" style={{ fontSize: '0.85rem' }}>{t('others.clickToAddEntry')}</p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 剧情历史编辑器 - 卡片式布局，模态框查看/编辑
// ============================================================================

export const StoryHistoryEditor: React.FC<{
  history?: StoryHistoryEntry[]
}> = ({ history }) => {
  const { t } = useTranslation('editor')
  const currentHistory = history || []
  const [viewingIndex, setViewingIndex] = useState<number | null>(null)

  const getContentPreview = (content: any): string => {
    if (content === null || content === undefined) return t('others.empty')
    if (typeof content === 'string') {
      return content.length > 100 ? content.substring(0, 100) + '...' : content
    }
    try {
      const str = JSON.stringify(content)
      return str.length > 100 ? str.substring(0, 100) + '...' : str
    } catch {
      return t('others.cannotPreview')
    }
  }

  const getContentDisplay = (content: any): string => {
    if (content === null || content === undefined) return t('others.empty')
    if (typeof content === 'string') return content
    try {
      return JSON.stringify(content, null, 2)
    } catch {
      return t('others.cannotSerialize')
    }
  }

  const viewingEntry = viewingIndex !== null ? currentHistory[viewingIndex] : null

  return (
    <div className="editor-section">
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <div className="section-hint" style={{ marginTop: '0px', color: 'var(--paper-text-secondary)' }}>
            {t('others.totalRecords', { count: currentHistory.length })}
          </div>
        </div>
      </div>

      {currentHistory.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '48px', color: 'var(--paper-text-tertiary)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📭</div>
          <p>{t('others.noStoryHistory')}</p>
        </div>
      ) : (
        <div className="history-cards" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '16px'
        }}>
          {currentHistory.map((entry, index) => (
            <div
              key={`history-${entry.turn_id}-${index}`}
              className="history-card"
              onClick={() => setViewingIndex(index)}
              style={{
                background: 'var(--paper-bg-secondary)',
                borderRadius: 'var(--paper-radius-xl, 16px)',
                border: '2.5px solid var(--paper-dark, #1a1a2e)',
                boxShadow: '4px 4px 0px var(--paper-dark, #1a1a2e)',
                padding: 'var(--paper-space-4, 16px)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'transform 0.2s',
                cursor: 'pointer',
              }}
            >
              {/* 卡片头部 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--paper-primary, #6366f1)', fontSize: '1.2rem', marginBottom: '4px' }}>
                    #{index + 1}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--paper-text-secondary)', fontWeight: 'bold' }}>
                    Turn: <code style={{ background: 'var(--paper-bg-tertiary)', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--paper-border-color)' }}>{entry.turn_id}</code>
                  </div>
                </div>
                {entry.story.checkpoint_id && (
                  <span style={{
                    background: 'var(--paper-success-bg, #dcfce7)',
                    color: 'var(--paper-success-text, #166534)',
                    padding: '4px 8px',
                    borderRadius: 'var(--paper-radius-md, 8px)',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    border: '1px solid var(--paper-success-text, #166534)'
                  }}>
                    💾 {entry.story.checkpoint_id}
                  </span>
                )}
              </div>

              {/* 内容预览 */}
              <div style={{
                background: 'var(--paper-bg-tertiary)',
                padding: '12px',
                borderRadius: '8px',
                border: '2px dashed var(--paper-border-color)',
                fontSize: '0.85rem',
                color: 'var(--paper-text-secondary)',
                fontFamily: 'var(--paper-font-mono, monospace)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1
              }}>
                {getContentPreview(entry.story.content)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 查看模态框 */}
      {viewingEntry && viewingIndex !== null && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setViewingIndex(null)}
        >
          <div
            className="modal-content"
            style={{
              background: 'var(--paper-bg-primary)',
              borderRadius: '12px',
              border: '1px solid var(--paper-border-color, #e2e8f0)',
              width: '80%',
              maxWidth: '800px',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--paper-border-color, #e2e8f0)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0 }}>{t('others.storyRecordNum', { num: viewingIndex + 1 })}</h3>
              <button
                onClick={() => setViewingIndex(null)}
                style={{ background: 'none', border: 'none', color: 'var(--paper-text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Turn ID</label>
                <code style={{ background: 'var(--paper-bg-primary)', padding: '8px 12px', borderRadius: '6px', display: 'block' }}>
                  {viewingEntry.turn_id}
                </code>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Checkpoint ID</label>
                <code style={{ background: 'var(--paper-bg-primary)', padding: '8px 12px', borderRadius: '6px', display: 'block' }}>
                  {viewingEntry.story.checkpoint_id || t('others.none')}
                </code>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Content</label>
                <pre style={{
                  background: 'var(--paper-bg-primary)',
                  padding: '16px',
                  borderRadius: '8px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  fontSize: '0.85rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {getContentDisplay(viewingEntry.story.content)}
                </pre>
              </div>
            </div>
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--paper-border-color, #e2e8f0)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button className="btn-primary" onClick={() => setViewingIndex(null)}>
                {t('common:close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================================
// 存档管理组件
// ============================================================================

export const SaveManager: React.FC<{
  onClose: () => void
  onListSaves: () => Promise<Array<{ checkpointId: string; metadata?: any }>>
  onLoadSave: (checkpointId: string) => Promise<void>
  onDeleteSave: (checkpointId: string) => Promise<void>
  onClearSaves: () => Promise<void>
  onAfterLoad: () => Promise<void>
}> = ({ onClose, onListSaves, onLoadSave, onDeleteSave, onClearSaves, onAfterLoad }) => {
  const { t } = useTranslation(['editor', 'common'])
  const [saves, setSaves] = useState<Array<{ checkpointId: string; metadata?: any }>>([])
  const [loading, setLoading] = useState(false)
  const [selectedSave, setSelectedSave] = useState<string | null>(null)

  // 加载存档列表
  const loadSaves = useCallback(async () => {
    setLoading(true)
    try {
      const result = await onListSaves()
      setSaves(result)
    } catch (e) {
      showAlert(t('others.loadSavesError', { message: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [onListSaves, t])

  // 初始加载
  React.useEffect(() => {
    loadSaves()
  }, [])

  // 加载存档
  const handleLoad = async (checkpointId: string) => {
    if (!await showConfirm(t('others.confirmLoadSave'))) return
    
    try {
      setLoading(true)
      await onLoadSave(checkpointId)
      await onAfterLoad()
      showAlert(t('others.saveLoaded'))
      onClose()
    } catch (e) {
      showAlert(t('others.loadSaveError', { message: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }

  // 删除存档
  const handleDelete = async (checkpointId: string) => {
    if (!await showConfirm(t('others.confirmDeleteSave'))) return
    
    try {
      setLoading(true)
      await onDeleteSave(checkpointId)
      showAlert(t('others.saveDeleted'))
      await loadSaves()
      if (selectedSave === checkpointId) {
        setSelectedSave(null)
      }
    } catch (e) {
      showAlert(t('others.deleteSaveError', { message: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }

  // 清空所有存档
  const handleClearAll = async () => {
    if (!await showConfirm(t('others.confirmClearSaves'))) return
    
    try {
      setLoading(true)
      await onClearSaves()
      showAlert(t('others.savesCleared'))
      await loadSaves()
      setSelectedSave(null)
    } catch (e) {
      showAlert(t('others.clearSavesError', { message: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }

  // 查看存档详情
  const getMetadataDisplay = (metadata: any) => {
    if (!metadata) return t('others.noMetadata')
    try {
      return JSON.stringify(metadata, null, 2)
    } catch {
      return t('others.cannotParseMetadata')
    }
  }

  return (
    <div className="ai-modal-overlay">
      <div className="ai-modal" style={{ maxWidth: '800px', maxHeight: '80vh' }}>
        <div className="modal-header">
          <h3>{t('others.saveManagerTitle')}</h3>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal-content" style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>
          {loading && <p style={{ textAlign: 'center', color: '#888' }}>{t('common:loading')}</p>}
          
          {!loading && saves.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
              <p style={{ fontSize: '48px', marginBottom: '16px' }}>📭</p>
              <p>{t('others.noSaves')}</p>
            </div>
          )}
          
          {!loading && saves.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '8px',
                paddingBottom: '8px',
                borderBottom: '1px solid #e0e0e0'
              }}>
                <span style={{ color: '#666', fontSize: '0.9em' }}>{t('others.totalSaves', { count: saves.length })}</span>
                <button 
                  className="btn-danger-sm"
                  onClick={handleClearAll}
                  disabled={loading}
                >
                  {t('others.clearAllSaves')}
                </button>
              </div>
              
              {saves.map((save, index) => {
                const isSelected = selectedSave === save.checkpointId
                const metadataStr = getMetadataDisplay(save.metadata)
                
                return (
                  <div 
                    key={save.checkpointId}
                    style={{
                      border: isSelected ? '2px solid #667eea' : '1px solid #ddd',
                      borderRadius: '8px',
                      padding: '16px',
                      background: isSelected ? '#f8f9ff' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => setSelectedSave(save.checkpointId)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '18px' }}>{t('others.saveNum', { num: index + 1 })}</span>
                          {isSelected && <span style={{ color: '#667eea', fontSize: '14px' }}>{t('others.selected')}</span>}
                        </div>
                        <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '4px' }}>
                          <strong>ID:</strong> <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>{save.checkpointId}</code>
                        </div>
                        {isSelected && (
                          <div style={{ fontSize: '0.85em', color: '#666', marginTop: '8px' }}>
                            <strong>{t('others.metadata')}:</strong>
                            <pre style={{
                              background: '#f5f5f5',
                              padding: '8px',
                              borderRadius: '4px',
                              marginTop: '4px',
                              fontSize: '0.9em',
                              maxHeight: '150px',
                              overflow: 'auto'
                            }}>
                              {metadataStr}
                            </pre>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginLeft: '16px' }} onClick={e => e.stopPropagation()}>
                        <button
                          className="btn-primary-sm"
                          onClick={() => handleLoad(save.checkpointId)}
                          disabled={loading}
                          title={t('commonEditors.loadThisSave')}
                        >
                          📥 {t('common:load')}
                        </button>
                        <button
                          className="btn-danger-sm"
                          onClick={() => handleDelete(save.checkpointId)}
                          disabled={loading}
                          title={t('commonEditors.deleteThisSave')}
                        >
                          🗑️ {t('common:delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        
        <div style={{ 
          display: 'flex', 
          gap: '12px', 
          justifyContent: 'flex-end',
          padding: '16px',
          borderTop: '1px solid #e0e0e0'
        }}>
          <button 
            className="btn-toolbar"
            onClick={loadSaves}
            disabled={loading}
          >
            🔄 {t('others.refresh')}
          </button>
          <button 
            className="btn-toolbar"
            onClick={onClose}
          >
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>
  )
}