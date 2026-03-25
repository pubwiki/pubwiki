/**
 * InlineSettingDocsEditor - 内联设定文档编辑器
 * 用于在 CreaturesEditor / WorldEditor 中直接编辑实体的 BindSetting 文档
 * 支持内联编辑 + 模态框全屏编辑
 */
import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Bold, Italic, Heading, List, Link as LinkIcon, Pencil, Trash2, FilePlus, Maximize2, X } from 'lucide-react'
import type { SettingDocument } from '../../api/types'
import { showAlert, showConfirm, showPrompt } from '../AlertDialog'
import './InlineSettingDocsEditor.css'

// ============================================================================
// 模态框文档编辑器
// ============================================================================

interface DocEditorModalProps {
  doc: SettingDocument
  onContentChange: (content: string) => void
  onPriorityChange: (priority: number | undefined) => void
  onConditionChange: (condition: string) => void
  onDisableChange: (disabled: boolean) => void
  onClose: () => void
}

const DocEditorModal: React.FC<DocEditorModalProps> = ({ doc, onContentChange, onPriorityChange, onConditionChange, onDisableChange, onClose }) => {
  const { t } = useTranslation('editor')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Focus textarea on mount
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const wrapSelection = useCallback((prefix: string, suffix: string = '', placeholder: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const selected = text.substring(start, end)
    let newText: string, newStart: number, newEnd: number
    if (selected) {
      newText = text.substring(0, start) + prefix + selected + suffix + text.substring(end)
      newStart = start + prefix.length
      newEnd = newStart + selected.length
    } else {
      const insert = placeholder || 'text'
      newText = text.substring(0, start) + prefix + insert + suffix + text.substring(end)
      newStart = start + prefix.length
      newEnd = newStart + insert.length
    }
    onContentChange(newText)
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(newStart, newEnd) })
  }, [onContentChange])

  const insertAtLineStart = useCallback((prefix: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const text = textarea.value
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const newText = text.substring(0, lineStart) + prefix + text.substring(lineStart)
    onContentChange(newText)
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, start + prefix.length) })
  }, [onContentChange])

  return (
    <div className="doc-modal-overlay" onClick={onClose}>
      <div className="doc-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="doc-modal-header">
          <span className="doc-modal-title">📄 {doc.name}</span>
          <button className="doc-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Toolbar */}
        <div className="doc-modal-toolbar">
          <button onClick={() => wrapSelection('**', '**', 'Bold')} title="Bold"><Bold size={16} /></button>
          <button onClick={() => wrapSelection('*', '*', 'Italic')} title="Italic"><Italic size={16} /></button>
          <span className="toolbar-sep" />
          <button onClick={() => insertAtLineStart('# ')} title="Heading"><Heading size={16} /></button>
          <button onClick={() => insertAtLineStart('- ')} title="List"><List size={16} /></button>
          <span className="toolbar-sep" />
          <button onClick={() => wrapSelection('[', '](url)', 'Link')} title="Link"><LinkIcon size={16} /></button>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="doc-modal-textarea"
          value={doc.content}
          onChange={e => onContentChange(e.target.value)}
          placeholder={t('others.startWriting')}
          spellCheck={false}
        />

        {/* Meta */}
        <div className="doc-modal-meta">
          <label
            className={`priority-label ${doc.disable ? 'active' : ''}`}
            onClick={e => e.stopPropagation()}
            title={t('others.disableDocHint')}
          >
            <input
              type="checkbox"
              checked={!!doc.disable}
              onChange={e => onDisableChange(e.target.checked)}
              style={{ width: '14px', height: '14px', accentColor: '#ef4444', cursor: 'pointer' }}
            />
            <span>{t('others.disableDoc')}</span>
          </label>
          <label
            className={`priority-label ${doc.static_priority !== undefined ? 'active' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={doc.static_priority !== undefined}
              onChange={e => onPriorityChange(e.target.checked ? 10 : undefined)}
              style={{ width: '14px', height: '14px', accentColor: '#fbbf24', cursor: 'pointer' }}
            />
            <span>{t('others.staticPriority')}</span>
            {doc.static_priority !== undefined && (
              <input
                type="number"
                className="priority-input"
                value={doc.static_priority}
                onClick={e => e.stopPropagation()}
                onChange={e => onPriorityChange(parseInt(e.target.value) || 0)}
                min={0}
              />
            )}
          </label>
          <input
            type="text"
            className="condition-input"
            value={doc.condition || ''}
            onChange={e => onConditionChange(e.target.value)}
            placeholder={t('others.conditionPlaceholder')}
            title={t('others.conditionHint')}
          />
          <div className="doc-modal-stats">
            <span>{t('others.lines', { count: doc.content.split('\n').length })}</span>
            <span>{t('others.chars', { count: doc.content.length })}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 内联设定文档编辑器
// ============================================================================

interface InlineSettingDocsEditorProps {
  documents: SettingDocument[]
  onChange: (docs: SettingDocument[]) => void
}

export const InlineSettingDocsEditor: React.FC<InlineSettingDocsEditorProps> = ({ documents, onChange }) => {
  const { t } = useTranslation('editor')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [modalIndex, setModalIndex] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedDoc = selectedIndex !== null ? documents[selectedIndex] : null

  // === CRUD ===
  const addDoc = useCallback(async () => {
    const newName = await showPrompt(t('others.enterName', { type: t('others.file') }))
    if (!newName?.trim()) return
    if (documents.some(d => d.name === newName.trim())) {
      showAlert(t('others.nameExists'))
      return
    }
    const newDocs = [...documents, { name: newName.trim(), content: '' }]
    onChange(newDocs)
    setSelectedIndex(newDocs.length - 1)
  }, [documents, onChange, t])

  const removeDoc = useCallback(async (index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const doc = documents[index]
    if (!doc) return
    if (!(await showConfirm(t('others.confirmDeleteNode', { name: doc.name })))) return
    const newDocs = documents.filter((_, i) => i !== index)
    onChange(newDocs)
    if (selectedIndex === index) setSelectedIndex(null)
    else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1)
  }, [documents, onChange, selectedIndex, t])

  const renameDoc = useCallback(async (index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const doc = documents[index]
    if (!doc) return
    const newName = await showPrompt(t('others.rename'), { defaultValue: doc.name })
    if (!newName?.trim() || newName === doc.name) return
    if (documents.some((d, i) => i !== index && d.name === newName.trim())) {
      showAlert(t('others.nameExists'))
      return
    }
    onChange(documents.map((d, i) => i === index ? { ...d, name: newName.trim() } : d))
  }, [documents, onChange, t])

  const updateContent = useCallback((content: string) => {
    if (selectedIndex === null) return
    onChange(documents.map((d, i) => i === selectedIndex ? { ...d, content } : d))
  }, [documents, onChange, selectedIndex])

  const updatePriority = useCallback((priority: number | undefined) => {
    if (selectedIndex === null) return
    onChange(documents.map((d, i) => {
      if (i !== selectedIndex) return d
      if (priority === undefined) {
        const { static_priority: _, ...rest } = d
        return rest
      }
      return { ...d, static_priority: priority }
    }))
  }, [documents, onChange, selectedIndex])

  const updateCondition = useCallback((condition: string) => {
    if (selectedIndex === null) return
    onChange(documents.map((d, i) => {
      if (i !== selectedIndex) return d
      if (!condition) {
        const { condition: _, ...rest } = d
        return rest
      }
      return { ...d, condition }
    }))
  }, [documents, onChange, selectedIndex])

  const updateDisable = useCallback((disabled: boolean) => {
    if (selectedIndex === null) return
    onChange(documents.map((d, i) => {
      if (i !== selectedIndex) return d
      if (!disabled) {
        const { disable: _, ...rest } = d
        return rest
      }
      return { ...d, disable: true }
    }))
  }, [documents, onChange, selectedIndex])

  // === Formatting helpers ===
  const wrapSelection = useCallback((prefix: string, suffix: string = '', placeholder: string = '') => {
    const textarea = textareaRef.current
    if (!textarea || !selectedDoc) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const selected = text.substring(start, end)
    let newText: string, newStart: number, newEnd: number
    if (selected) {
      newText = text.substring(0, start) + prefix + selected + suffix + text.substring(end)
      newStart = start + prefix.length
      newEnd = newStart + selected.length
    } else {
      const insert = placeholder || 'text'
      newText = text.substring(0, start) + prefix + insert + suffix + text.substring(end)
      newStart = start + prefix.length
      newEnd = newStart + insert.length
    }
    updateContent(newText)
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(newStart, newEnd) })
  }, [selectedDoc, updateContent])

  const insertAtLineStart = useCallback((prefix: string) => {
    const textarea = textareaRef.current
    if (!textarea || !selectedDoc) return
    const start = textarea.selectionStart
    const text = textarea.value
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const newText = text.substring(0, lineStart) + prefix + text.substring(lineStart)
    updateContent(newText)
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, start + prefix.length) })
  }, [selectedDoc, updateContent])

  return (
    <div className="inline-docs-editor">
      {/* Header */}
      <div className="inline-docs-header">
        <h4>
          📚 {t('creatures.settingDocBinding')}
          <span className="doc-count">({documents.length})</span>
        </h4>
        <button className="btn-add-small" onClick={addDoc} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
          <FilePlus size={14} />
        </button>
      </div>

      {/* Document list */}
      {documents.length === 0 ? (
        <div className="inline-docs-empty">
          {t('others.noDocuments')}
        </div>
      ) : (
        <div className="inline-docs-list">
          {documents.map((doc, index) => {
            const isSelected = selectedIndex === index
            return (
              <div key={index} className="inline-doc-item">
                {/* Document header row */}
                <div
                  className={`inline-doc-item-header ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedIndex(isSelected ? null : index)}
                >
                  <span style={{ fontSize: '0.85rem', color: 'var(--paper-text-tertiary)' }}>
                    {isSelected ? '▼' : '▶'}
                  </span>
                  <span style={{ fontSize: '0.9rem' }}>📄</span>
                  <span className="doc-name" style={doc.disable ? { textDecoration: 'line-through', opacity: 0.5 } : undefined}>{doc.name}</span>
                  {doc.disable && (
                    <span style={{ fontSize: '0.7rem', color: '#ef4444', padding: '1px 4px', background: 'rgba(239,68,68,0.1)', borderRadius: '3px' }}>
                      {t('others.disableDoc')}
                    </span>
                  )}
                  {doc.static_priority !== undefined && (
                    <span style={{ fontSize: '0.7rem', color: '#fbbf24', padding: '1px 4px', background: 'rgba(251,191,36,0.1)', borderRadius: '3px' }}>
                      P{doc.static_priority}
                    </span>
                  )}
                  <div className="doc-actions">
                    <button onClick={(e) => renameDoc(index, e)} title={t('others.rename')}>
                      <Pencil size={13} />
                    </button>
                    <button className="delete-btn" onClick={(e) => removeDoc(index, e)} title={t('others.delete')}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Expanded editor */}
                {isSelected && (
                  <div className="inline-doc-editor">
                    {/* Mini toolbar */}
                    <div className="inline-doc-toolbar">
                      <button onClick={() => wrapSelection('**', '**', 'Bold')} title="Bold"><Bold size={14} /></button>
                      <button onClick={() => wrapSelection('*', '*', 'Italic')} title="Italic"><Italic size={14} /></button>
                      <span className="toolbar-sep" />
                      <button onClick={() => insertAtLineStart('# ')} title="Heading"><Heading size={14} /></button>
                      <button onClick={() => insertAtLineStart('- ')} title="List"><List size={14} /></button>
                      <span className="toolbar-sep" />
                      <button onClick={() => wrapSelection('[', '](url)', 'Link')} title="Link"><LinkIcon size={14} /></button>
                      <span className="toolbar-sep" />
                      <button onClick={() => setModalIndex(index)} title={t('others.expandEdit')} className="expand-btn">
                        <Maximize2 size={14} />
                      </button>
                    </div>

                    {/* Content textarea */}
                    <textarea
                      ref={textareaRef}
                      className="inline-doc-textarea"
                      value={doc.content}
                      onChange={e => updateContent(e.target.value)}
                      placeholder={t('others.startWriting')}
                      spellCheck={false}
                    />

                    {/* Disable + Priority + Condition */}
                    <div className="inline-doc-meta">
                      <label
                        className={`priority-label ${doc.disable ? 'active' : ''}`}
                        onClick={e => e.stopPropagation()}
                        title={t('others.disableDocHint')}
                      >
                        <input
                          type="checkbox"
                          checked={!!doc.disable}
                          onChange={e => updateDisable(e.target.checked)}
                          style={{ width: '13px', height: '13px', accentColor: '#ef4444', cursor: 'pointer' }}
                        />
                        <span>{t('others.disableDoc')}</span>
                      </label>
                      <label
                        className={`priority-label ${doc.static_priority !== undefined ? 'active' : ''}`}
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={doc.static_priority !== undefined}
                          onChange={e => updatePriority(e.target.checked ? 10 : undefined)}
                          style={{ width: '13px', height: '13px', accentColor: '#fbbf24', cursor: 'pointer' }}
                        />
                        <span>{t('others.staticPriority')}</span>
                        {doc.static_priority !== undefined && (
                          <input
                            type="number"
                            className="priority-input"
                            value={doc.static_priority}
                            onClick={e => e.stopPropagation()}
                            onChange={e => updatePriority(parseInt(e.target.value) || 0)}
                            min={0}
                          />
                        )}
                      </label>
                      <input
                        type="text"
                        className="condition-input"
                        value={doc.condition || ''}
                        onChange={e => updateCondition(e.target.value)}
                        placeholder={t('others.conditionPlaceholder')}
                        title={t('others.conditionHint')}
                      />
                    </div>

                    {/* Footer stats */}
                    <div className="inline-doc-footer">
                      <span>{t('others.lines', { count: doc.content.split('\n').length })}</span>
                      <span>{t('others.chars', { count: doc.content.length })}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal editor */}
      {modalIndex !== null && documents[modalIndex] && (
        <DocEditorModal
          doc={documents[modalIndex]}
          onContentChange={content => {
            onChange(documents.map((d, i) => i === modalIndex ? { ...d, content } : d))
          }}
          onPriorityChange={priority => {
            onChange(documents.map((d, i) => {
              if (i !== modalIndex) return d
              if (priority === undefined) {
                const { static_priority: _, ...rest } = d
                return rest
              }
              return { ...d, static_priority: priority }
            }))
          }}
          onConditionChange={condition => {
            onChange(documents.map((d, i) => {
              if (i !== modalIndex) return d
              if (!condition) {
                const { condition: _, ...rest } = d
                return rest
              }
              return { ...d, condition }
            }))
          }}
          onDisableChange={disabled => {
            onChange(documents.map((d, i) => {
              if (i !== modalIndex) return d
              if (!disabled) {
                const { disable: _, ...rest } = d
                return rest
              }
              return { ...d, disable: true }
            }))
          }}
          onClose={() => setModalIndex(null)}
        />
      )}
    </div>
  )
}
