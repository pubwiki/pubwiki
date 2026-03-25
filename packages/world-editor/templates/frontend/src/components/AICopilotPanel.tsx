/**
 * AICopilotPanel - AI 编辑助手侧边栏面板
 *
 * 功能：
 * - 可折叠的侧边栏
 * - 聊天界面（支持流式输出）
 * - 聊天会话管理（新建/切换/删除对话）
 * - 工作记忆管理
 * - 工具调用可视化
 * - 文件上传和管理
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  StateData,
  CopilotConfig,
  CopilotMessage,
  CopilotToolName,
  UploadedFile,
  StoredSkill,
  StoredMemory,
  CopilotChatSession
} from '../api/types'
import {
  loadCopilotConfigFromAPIConfig,
  generateMessageId,
  loadUploadedFiles,
  addUploadedFile,
  removeUploadedFile,
  clearUploadedFiles,
  getFileType,
  // Skills
  loadSkills,
  getSkill,
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  exportSkill,
  importSkill,
  initializeBuiltInSkills,
  // WorkingMemory
  loadMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  clearMemories,
  // Chat sessions
  loadChatSessions,
  getCurrentSessionId,
  setCurrentSessionId,
  createChatSession,
  updateChatSession,
  deleteChatSession,
  clearChatSessions,
  // IndexedDB init
  initCopilotDB
} from '../api/copilotService'
import { streamCopilotChat, resetSkillReadTracking, type ToolExecutionContext, type CopilotStreamEvent, type QueryUserRequest, type QueryUserField } from './copilot'
import { readFileWithEncoding } from '../api/encodingUtils'
import { readImageFile, IMAGE_ACCEPT } from '../api/imageUtils'
import { showAlert, showConfirm } from './AlertDialog'
import ReactMarkdown from 'react-markdown'
import './AICopilotPanel.css'
import { APIConfigModal } from './APIConfigModal'

// ============================================================================
// 类型定义
// ============================================================================

interface AICopilotPanelProps {
  state: StateData
  onStateChange: (newState: StateData) => void
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

interface ToolCallDisplay {
  id: string
  name: CopilotToolName
  arguments: string
  result?: string
  isExecuting?: boolean
}

// ============================================================================
// 辅助组件
// ============================================================================

/**
 * 文件管理区域
 */
const FileManager: React.FC<{
  files: UploadedFile[]
  onFilesChange: (files: UploadedFile[]) => void
}> = ({ files, onFilesChange }) => {
  const { t } = useTranslation('copilot')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null)

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (!selectedFiles) return

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      const fileType = getFileType(file.name)

      if (!fileType) {
        showAlert(t('files.unsupportedType', { name: file.name }))
        continue
      }

      try {
        let uploadedFile: UploadedFile
        if (fileType === 'image') {
          uploadedFile = await readImageFile(file)
        } else {
          const { content, detectedEncoding } = await readFileWithEncoding(file)
          uploadedFile = {
            name: file.name,
            content,
            type: fileType,
            size: file.size,
            uploadedAt: Date.now(),
            detectedEncoding
          }
        }
        const allFiles = addUploadedFile(uploadedFile)
        onFilesChange([...allFiles])
      } catch (err) {
        showAlert(t('files.readFailed', { name: file.name }))
      }
    }

    // 清空 input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [files, onFilesChange, t])

  const handleRemove = useCallback((filename: string) => {
    const remaining = removeUploadedFile(filename)
    onFilesChange([...remaining])
  }, [onFilesChange])

  const handleClearAll = useCallback(async () => {
    if (files.length === 0) return
    if (await showConfirm(t('files.confirmClearAll'))) {
      clearUploadedFiles()
      onFilesChange([])
    }
  }, [files.length, onFilesChange, t])

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'md': return '📝'
      case 'json': return '📋'
      case 'txt': return '📄'
      case 'image': return '🖼️'
      default: return '📁'
    }
  }

  return (
    <div className="file-manager">
      <div className="file-manager-header">
        <span>{t('files.count', { count: files.length })}</span>
        <div className="file-manager-actions">
          <button
            className="btn-icon small"
            onClick={() => fileInputRef.current?.click()}
            title={t('files.upload')}
          >
            ➕
          </button>
          {files.length > 0 && (
            <button
              className="btn-icon small"
              onClick={handleClearAll}
              title={t('files.clearAll')}
            >
              🗑️
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={`.md,.json,.txt,${IMAGE_ACCEPT}`}
        multiple
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      {files.length === 0 ? (
        <div className="file-manager-empty" onClick={() => fileInputRef.current?.click()}>
          <span>{t('files.uploadHint')}</span>
        </div>
      ) : (
        <div className="file-list">
          {files.map(file => (
            <div key={file.name} className="file-item">
              {file.type === 'image' && file.dataUrl ? (
                <img className="file-thumbnail" src={file.dataUrl} alt={file.name} />
              ) : (
                <span className="file-icon">{getFileIcon(file.type)}</span>
              )}
              <span className="file-name" title={file.name}>{file.name}</span>
              <span className="file-size">{formatSize(file.size)}</span>
              {file.detectedEncoding && file.detectedEncoding !== 'UTF-8' && file.detectedEncoding !== 'ascii' && (
                <span className="file-encoding" title={t('files.encoding')}>
                  {file.detectedEncoding}
                </span>
              )}
              <button
                className="btn-icon small"
                onClick={() => setPreviewFile(file)}
                title={t('files.preview')}
              >
                👁️
              </button>
              <button
                className="btn-remove"
                onClick={() => handleRemove(file.name)}
                title={t('sessions.delete')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 文件预览弹窗 */}
      {previewFile && (
        <div className="file-preview-overlay" onClick={() => setPreviewFile(null)}>
          <div className="file-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="file-preview-header">
              <span className="file-preview-title">{previewFile.name}</span>
              {previewFile.detectedEncoding && (
                <span className="file-preview-encoding">
                  {t('files.encoding')}: {previewFile.detectedEncoding}
                </span>
              )}
              <button
                className="btn-close"
                onClick={() => setPreviewFile(null)}
              >
                ✕
              </button>
            </div>
            {previewFile.type === 'image' && previewFile.dataUrl ? (
              <div className="file-preview-image-container">
                <img className="file-preview-image" src={previewFile.dataUrl} alt={previewFile.name} />
              </div>
            ) : (
              <pre className="file-preview-content">
                {previewFile.content}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 聊天会话管理器
 */
const SessionManager: React.FC<{
  sessions: CopilotChatSession[]
  currentSessionId: string | null
  onSessionChange: (sessionId: string) => void
  onNewSession: () => void
  onDeleteSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, newTitle: string) => void
  defaultExpanded?: boolean
}> = ({ sessions, currentSessionId, onSessionChange, onNewSession, onDeleteSession, onRenameSession, defaultExpanded = false }) => {
  const { t } = useTranslation('copilot')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const handleStartRename = (session: CopilotChatSession) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleFinishRename = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="session-manager">
      <div className="session-manager-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span>{t('sessions.count', { count: sessions.length })}</span>
        <div className="session-manager-actions" onClick={e => e.stopPropagation()}>
          <button
            className="btn-icon small"
            onClick={onNewSession}
            title={t('sessions.new')}
          >
            ➕
          </button>
          <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {isExpanded && (
        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="session-list-empty">{t('sessions.empty')}</div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                onClick={() => onSessionChange(session.id)}
              >
                {editingId === session.id ? (
                  <input
                    className="session-title-input"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleFinishRename()
                      if (e.key === 'Escape') { setEditingId(null); setEditTitle('') }
                    }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="session-title" title={session.title}>{session.title}</span>
                    <span className="session-time">{formatTime(session.updatedAt)}</span>
                    <div className="session-actions">
                      <button
                        className="btn-mini"
                        onClick={e => { e.stopPropagation(); handleStartRename(session) }}
                        title={t('sessions.rename')}
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-mini"
                        onClick={e => { e.stopPropagation(); onDeleteSession(session.id) }}
                        title={t('sessions.delete')}
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 技能管理器 (Skills - 只读 + 导入/导出)
 */
const SkillManager: React.FC<{
  skills: StoredSkill[]
  onSkillsChange: () => void
  defaultExpanded?: boolean
}> = ({ skills, onSkillsChange, defaultExpanded = false }) => {
  const { t } = useTranslation('copilot')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [viewingSkill, setViewingSkill] = useState<StoredSkill | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ title: '', description: '', content: '' })
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleCreate = () => {
    setEditForm({ title: '', description: '', content: '' })
    setIsEditing(true)
    setViewingSkill(null)
  }

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    let importedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        const skill = importSkill(data)
        if (skill) importedCount++
        else showAlert(t('skills.importInvalid', { name: file.name }))
      } catch {
        showAlert(t('files.readFailed', { name: file.name }))
      }
    }
    if (importedCount > 0) onSkillsChange()
    if (importInputRef.current) importInputRef.current.value = ''
  }, [onSkillsChange, t])

  const handleExport = useCallback((skill: StoredSkill) => {
    const data = exportSkill(skill.id)
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `skill_${skill.id}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [])

  const handleEdit = (skill: StoredSkill) => {
    if (skill.isBuiltIn) {
      showAlert(t('skills.cannotEditBuiltin'))
      return
    }
    setEditForm({ title: skill.title, description: skill.description || '', content: skill.content })
    setViewingSkill(skill)
    setIsEditing(true)
  }

  const handleSave = () => {
    if (!editForm.title.trim()) {
      showAlert(t('skills.enterTitle'))
      return
    }
    if (viewingSkill) {
      updateUserSkill(viewingSkill.id, {
        title: editForm.title,
        description: editForm.description,
        content: editForm.content
      })
    } else {
      createUserSkill(editForm.title, editForm.content, editForm.description)
    }
    setIsEditing(false)
    setViewingSkill(null)
    onSkillsChange()
  }

  const handleDelete = async (id: string) => {
    const skill = skills.find(s => s.id === id)
    if (skill?.isBuiltIn) {
      showAlert(t('skills.cannotDeleteBuiltin'))
      return
    }
    if (await showConfirm(t('skills.confirmDelete'))) {
      deleteUserSkill(id)
      onSkillsChange()
    }
  }

  return (
    <div className="memory-manager">
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        multiple
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      <div className="memory-manager-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span>{t('skills.count', { count: skills.length })}</span>
        <div className="memory-manager-actions" onClick={e => e.stopPropagation()}>
          <button
            className="btn-icon small"
            onClick={() => importInputRef.current?.click()}
            title={t('skills.import')}
          >
            📥
          </button>
          <button
            className="btn-icon small"
            onClick={handleCreate}
            title={t('skills.new')}
          >
            ➕
          </button>
          <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {isExpanded && (
        <div className="memory-list">
          {skills.length === 0 ? (
            <div className="memory-list-empty">
              {t('skills.empty')}<br />
              <small>{t('skills.emptyHint')}</small>
            </div>
          ) : (
            skills.map(skill => (
              <div
                key={skill.id}
                className={`memory-item ${skill.isBuiltIn ? 'built-in' : ''}`}
                onClick={() => { setViewingSkill(skill); setIsEditing(false) }}
              >
                <div className="memory-title">
                  {skill.isBuiltIn ? '📖' : '📝'} {skill.title}
                  {skill.isBuiltIn && <span className="built-in-badge">{t('skills.builtIn')}</span>}
                </div>
                <div className="memory-summary">{skill.description || t('skills.noDescription')}</div>
                <div className="memory-meta">
                  {!skill.isBuiltIn && (
                    <div className="memory-actions">
                      <button
                        className="btn-mini"
                        onClick={e => { e.stopPropagation(); handleExport(skill) }}
                        title={t('skills.export')}
                      >
                        📤
                      </button>
                      <button
                        className="btn-mini"
                        onClick={e => { e.stopPropagation(); handleEdit(skill) }}
                        title={t('sessions.rename')}
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-mini"
                        onClick={e => { e.stopPropagation(); handleDelete(skill.id) }}
                        title={t('sessions.delete')}
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 查看/编辑 Skill 弹窗 */}
      {(viewingSkill || isEditing) && (
        <div className="copilot-modal-overlay" onClick={() => { setViewingSkill(null); setIsEditing(false) }}>
          <div className="copilot-modal memory-modal" onClick={e => e.stopPropagation()}>
            <div className="copilot-modal-header">
              <h3>{isEditing ? (viewingSkill ? t('skills.editTitle') : t('skills.createTitle')) : t('skills.viewTitle')}</h3>
              <button className="btn-close" onClick={() => { setViewingSkill(null); setIsEditing(false) }}>✕</button>
            </div>
            <div className="copilot-modal-content">
              {isEditing ? (
                <>
                  <div className="config-field">
                    <label>{t('skills.labelTitle')}</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                      placeholder={t('skills.placeholderTitle')}
                    />
                  </div>
                  <div className="config-field">
                    <label>{t('skills.labelDescription')}</label>
                    <input
                      type="text"
                      value={editForm.description}
                      onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                      placeholder={t('skills.placeholderDescription')}
                    />
                  </div>
                  <div className="config-field">
                    <label>{t('skills.labelContent')}</label>
                    <textarea
                      className="memory-content-input"
                      value={editForm.content}
                      onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                      placeholder={t('skills.placeholderContent')}
                      rows={10}
                    />
                  </div>
                </>
              ) : viewingSkill && (
                <>
                  <div className="memory-view-title">
                    {viewingSkill.isBuiltIn ? '📖' : '📝'} {viewingSkill.title}
                    {viewingSkill.isBuiltIn && <span className="built-in-badge">{t('skills.builtIn')}</span>}
                  </div>
                  <div className="memory-view-summary">{viewingSkill.description || t('skills.noDescription')}</div>
                  <div className="memory-view-content">
                    <pre>{viewingSkill.content || t('skills.noContent')}</pre>
                  </div>
                </>
              )}
            </div>
            <div className="copilot-modal-footer">
              {isEditing ? (
                <>
                  <button className="btn-secondary" onClick={() => { setViewingSkill(null); setIsEditing(false) }}>{t('config.cancel')}</button>
                  <button className="btn-primary" onClick={handleSave}>{t('config.save')}</button>
                </>
              ) : (
                <>
                  {viewingSkill && !viewingSkill.isBuiltIn && (
                    <button className="btn-secondary" onClick={() => setIsEditing(true)}>{t('sessions.rename')}</button>
                  )}
                  <button className="btn-primary" onClick={() => { setViewingSkill(null); setIsEditing(false) }}>OK</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 工作记忆管理器 (WorkingMemory - 可读写)
 */
const MemoryManager: React.FC<{
  memories: StoredMemory[]
  onMemoriesChange: () => void
  defaultExpanded?: boolean
}> = ({ memories, onMemoriesChange, defaultExpanded = false }) => {
  const { t } = useTranslation('copilot')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [viewingMemory, setViewingMemory] = useState<StoredMemory | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ title: '', content: '' })

  const handleCreate = () => {
    setEditForm({ title: '', content: '' })
    setIsEditing(true)
    setViewingMemory(null)
  }

  const handleEdit = (memory: StoredMemory) => {
    setEditForm({ title: memory.title, content: memory.content })
    setViewingMemory(memory)
    setIsEditing(true)
  }

  const handleSave = () => {
    if (!editForm.title.trim()) {
      showAlert(t('memories.enterTitle'))
      return
    }
    if (viewingMemory) {
      updateMemory(viewingMemory.id, { title: editForm.title, content: editForm.content })
    } else {
      createMemory(editForm.title, editForm.content)
    }
    setIsEditing(false)
    setViewingMemory(null)
    onMemoriesChange()
  }

  const handleDelete = async (id: string) => {
    if (await showConfirm(t('memories.confirmDelete'))) {
      deleteMemory(id)
      onMemoriesChange()
    }
  }

  const handleClearAll = async () => {
    if (memories.length === 0) {
      showAlert(t('memories.nothingToClear'))
      return
    }
    if (await showConfirm(t('memories.confirmClearAll', { count: memories.length }))) {
      clearMemories()
      onMemoriesChange()
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <div className="memory-manager">
      <div className="memory-manager-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span>{t('memories.count', { count: memories.length })}</span>
        <div className="memory-manager-actions" onClick={e => e.stopPropagation()}>
          <button
            className="btn-icon small"
            onClick={handleCreate}
            title={t('memories.new')}
          >
            ➕
          </button>
          {memories.length > 0 && (
            <button
              className="btn-icon small"
              onClick={handleClearAll}
              title={t('memories.clearAll')}
            >
              🗑️
            </button>
          )}
          <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {isExpanded && (
        <div className="memory-list">
          {memories.length === 0 ? (
            <div className="memory-list-empty">
              {t('memories.empty')}<br />
              <small>{t('memories.emptyHint')}</small>
            </div>
          ) : (
            memories.map(memory => (
              <div
                key={memory.id}
                className="memory-item"
                onClick={() => { setViewingMemory(memory); setIsEditing(false) }}
              >
                <div className="memory-title">📝 {memory.title}</div>
                <div className="memory-summary">{memory.content.substring(0, 60)}...</div>
                <div className="memory-meta">
                  <span className="memory-time">{formatTime(memory.updatedAt)}</span>
                  <div className="memory-actions">
                    <button
                      className="btn-mini"
                      onClick={e => { e.stopPropagation(); handleEdit(memory) }}
                      title={t('sessions.rename')}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-mini"
                      onClick={e => { e.stopPropagation(); handleDelete(memory.id) }}
                      title={t('sessions.delete')}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 查看/编辑 Memory 弹窗 */}
      {(viewingMemory || isEditing) && (
        <div className="copilot-modal-overlay" onClick={() => { setViewingMemory(null); setIsEditing(false) }}>
          <div className="copilot-modal memory-modal" onClick={e => e.stopPropagation()}>
            <div className="copilot-modal-header">
              <h3>{isEditing ? (viewingMemory ? t('memories.editTitle') : t('memories.createTitle')) : t('memories.viewTitle')}</h3>
              <button className="btn-close" onClick={() => { setViewingMemory(null); setIsEditing(false) }}>✕</button>
            </div>
            <div className="copilot-modal-content">
              {isEditing ? (
                <>
                  <div className="config-field">
                    <label>{t('memories.labelTitle')}</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                      placeholder={t('memories.placeholderTitle')}
                    />
                  </div>
                  <div className="config-field">
                    <label>{t('memories.labelContent')}</label>
                    <textarea
                      className="memory-content-input"
                      value={editForm.content}
                      onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                      placeholder={t('memories.placeholderContent')}
                      rows={10}
                    />
                  </div>
                </>
              ) : viewingMemory && (
                <>
                  <div className="memory-view-title">📝 {viewingMemory.title}</div>
                  <div className="memory-view-time">
                    {t('memories.createdLabel')}: {formatTime(viewingMemory.createdAt)} | {t('memories.updatedLabel')}: {formatTime(viewingMemory.updatedAt)}
                  </div>
                  <div className="memory-view-content">
                    <pre>{viewingMemory.content || t('memories.noContent')}</pre>
                  </div>
                </>
              )}
            </div>
            <div className="copilot-modal-footer">
              {isEditing ? (
                <>
                  <button className="btn-secondary" onClick={() => { setViewingMemory(null); setIsEditing(false) }}>{t('config.cancel')}</button>
                  <button className="btn-primary" onClick={handleSave}>{t('config.save')}</button>
                </>
              ) : (
                <>
                  {viewingMemory && (
                    <button className="btn-secondary" onClick={() => setIsEditing(true)}>{t('sessions.rename')}</button>
                  )}
                  <button className="btn-primary" onClick={() => { setViewingMemory(null); setIsEditing(false) }}>OK</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * @ 提及弹出菜单
 */
interface MentionItem {
  type: 'file' | 'skill' | 'memory'
  id: string
  name: string
  icon: string
}

const MentionPopup: React.FC<{
  files: UploadedFile[]
  skills: StoredSkill[]
  memories: StoredMemory[]
  query: string
  selectedIndex: number
  onSelect: (item: MentionItem) => void
  position?: { top: number; left: number }
}> = ({ files, skills, memories, query, selectedIndex, onSelect, position }) => {
  const { t } = useTranslation('copilot')

  // 过滤匹配项
  const filteredItems = useMemo(() => {
    const q = query.toLowerCase()
    const result: MentionItem[] = []

    // 文件
    files.forEach(file => {
      if (file.name.toLowerCase().includes(q)) {
        result.push({
          type: 'file',
          id: file.name,
          name: file.name,
          icon: '📁'
        })
      }
    })

    // Skills
    skills.forEach(skill => {
      if (skill.title.toLowerCase().includes(q) || skill.id.toLowerCase().includes(q)) {
        result.push({
          type: 'skill',
          id: skill.id,
          name: skill.title,
          icon: skill.isBuiltIn ? '📖' : '📝'
        })
      }
    })

    // Memories
    memories.forEach(memory => {
      if (memory.title.toLowerCase().includes(q) || memory.id.toLowerCase().includes(q)) {
        result.push({
          type: 'memory',
          id: memory.id,
          name: memory.title,
          icon: '📝'
        })
      }
    })

    return result
  }, [files, skills, memories, query])

  if (filteredItems.length === 0) {
    return (
      <div className="mention-popup" style={position}>
        <div className="mention-empty">{t('mention.noResults')}</div>
      </div>
    )
  }

  return (
    <div className="mention-popup" style={position}>
      {filteredItems.map((item, index) => (
        <div
          key={`${item.type}-${item.id}`}
          className={`mention-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(item)}
        >
          <span className="mention-icon">{item.icon}</span>
          <span className="mention-name">{item.name}</span>
          <span className="mention-type">{item.type === 'file' ? t('mention.file') : item.type === 'skill' ? t('mention.skill') : t('mention.memory')}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * queryUser 交互式表单组件
 */
type CopilotFieldMode = 'normal' | 'ai_decide' | 'custom'

const QueryUserForm: React.FC<{
  request: QueryUserRequest
  onSubmit: (data: Record<string, unknown>) => void
}> = ({ request, onSubmit }) => {
  const { t } = useTranslation('copilot')
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {}
    request.fields.forEach(f => {
      if (f.default !== undefined) {
        defaults[f.key] = f.default
      } else if (f.type === 'checkbox') {
        defaults[f.key] = false
      } else if (f.type === 'multiselect') {
        defaults[f.key] = []
      } else if (f.type === 'number') {
        defaults[f.key] = 0
      } else {
        defaults[f.key] = ''
      }
    })
    return defaults
  })

  const [fieldModes, setFieldModes] = useState<Record<string, CopilotFieldMode>>(() => {
    const modes: Record<string, CopilotFieldMode> = {}
    request.fields.forEach(f => { modes[f.key] = 'normal' })
    return modes
  })
  const [customTexts, setCustomTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {}
    request.fields.forEach(f => { texts[f.key] = '' })
    return texts
  })

  const handleFieldChange = (key: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  const setMode = (key: string, mode: CopilotFieldMode) =>
    setFieldModes(prev => ({ ...prev, [key]: prev[key] === mode ? 'normal' : mode }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const result: Record<string, unknown> = {}
    for (const field of request.fields) {
      const mode = fieldModes[field.key]
      if (mode === 'ai_decide') {
        result[field.key] = '__AI_DECIDE__'
      } else if (mode === 'custom') {
        result[field.key] = customTexts[field.key] || ''
      } else {
        result[field.key] = formData[field.key]
      }
    }
    onSubmit(result)
  }

  const renderFieldModeBar = (field: QueryUserField) => {
    const mode = fieldModes[field.key]
    const hasOptions = field.type === 'select' || field.type === 'multiselect'
    return (
      <div className="query-field-mode-bar">
        <button
          type="button"
          className={`query-field-mode-btn ${mode === 'ai_decide' ? 'active ai-decide' : ''}`}
          onClick={() => setMode(field.key, 'ai_decide')}
        >
          🤖 {t('form.letAIDecide')}
        </button>
        {hasOptions && (
          <button
            type="button"
            className={`query-field-mode-btn ${mode === 'custom' ? 'active custom' : ''}`}
            onClick={() => setMode(field.key, 'custom')}
          >
            ✏️ {t('form.customInput')}
          </button>
        )}
      </div>
    )
  }

  const renderField = (field: QueryUserField) => {
    const mode = fieldModes[field.key]

    if (mode === 'ai_decide') {
      return <div className="query-field-ai-decide-placeholder">🤖 {t('form.aiWillDecide')}</div>
    }
    if (mode === 'custom') {
      return (
        <textarea
          className="query-field-textarea"
          value={customTexts[field.key] || ''}
          placeholder={t('form.inputPlaceholder')}
          rows={2}
          onChange={e => setCustomTexts(prev => ({ ...prev, [field.key]: e.target.value }))}
        />
      )
    }

    const value = formData[field.key]
    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            className="query-field-input"
            value={(value as string) || ''}
            placeholder={field.placeholder || ''}
            required={field.required}
            onChange={e => handleFieldChange(field.key, e.target.value)}
          />
        )
      case 'textarea':
        return (
          <textarea
            className="query-field-textarea"
            value={(value as string) || ''}
            placeholder={field.placeholder || ''}
            required={field.required}
            rows={3}
            onChange={e => handleFieldChange(field.key, e.target.value)}
          />
        )
      case 'number':
        return (
          <input
            type="number"
            className="query-field-input"
            value={(value as number) ?? 0}
            placeholder={field.placeholder || ''}
            required={field.required}
            onChange={e => handleFieldChange(field.key, parseFloat(e.target.value) || 0)}
          />
        )
      case 'select':
        return (
          <select
            className="query-field-select"
            value={(value as string) || ''}
            required={field.required}
            onChange={e => handleFieldChange(field.key, e.target.value)}
          >
            <option value="">{field.placeholder || t('form.selectDefault')}</option>
            {(field.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      case 'multiselect':
        return (
          <div className="query-field-multiselect">
            {(field.options || []).map(opt => {
              const selected = ((value as string[]) || []).includes(opt)
              return (
                <label key={opt} className={`multiselect-option ${selected ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const arr = ((value as string[]) || []).slice()
                      if (selected) {
                        handleFieldChange(field.key, arr.filter(v => v !== opt))
                      } else {
                        handleFieldChange(field.key, [...arr, opt])
                      }
                    }}
                  />
                  <span>{opt}</span>
                </label>
              )
            })}
          </div>
        )
      case 'checkbox':
        return (
          <label className="query-field-checkbox">
            <input
              type="checkbox"
              checked={!!value}
              onChange={e => handleFieldChange(field.key, e.target.checked)}
            />
            <span>{field.placeholder || ''}</span>
          </label>
        )
      default:
        return null
    }
  }

  return (
    <div className="query-user-form">
      <div className="query-form-header">
        <span className="query-form-icon">📋</span>
        <span className="query-form-title">{request.title}</span>
      </div>
      <form onSubmit={handleSubmit}>
        {request.fields.map(field => (
          <div key={field.key} className="query-form-field">
            <label className="query-field-label">
              {field.label}
              {field.required && <span className="required-mark">*</span>}
            </label>
            {renderFieldModeBar(field)}
            {renderField(field)}
          </div>
        ))}
        <div className="query-form-actions">
          <button type="submit" className="query-submit-btn">
            ✅ {t('form.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * 已提交的表单摘要（只读）
 */
const QueryUserSummary: React.FC<{
  request: QueryUserRequest
  data: Record<string, unknown>
}> = ({ request, data }) => {
  return (
    <div className="query-user-summary">
      <div className="query-form-header">
        <span className="query-form-icon">✅</span>
        <span className="query-form-title">{request.title}</span>
      </div>
      <div className="query-summary-fields">
        {request.fields.map(field => {
          const value = data[field.key]
          if (value === undefined || value === '' || value === null) return null
          let displayValue: string
          if (Array.isArray(value)) {
            displayValue = value.join(', ')
          } else if (typeof value === 'boolean') {
            displayValue = value ? '✓' : '✗'
          } else {
            displayValue = String(value)
          }
          return (
            <div key={field.key} className="query-summary-item">
              <span className="query-summary-label">{field.label}:</span>
              <span className="query-summary-value">{displayValue}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 工具调用显示组件
 */
const ToolCallCard: React.FC<{
  toolCall: ToolCallDisplay
}> = ({ toolCall }) => {
  const { t } = useTranslation('copilot')
  const [expanded, setExpanded] = useState(false)

  const toolIcons: Record<CopilotToolName, string> = {
    get_state_overview: '📊',
    check_state_error: '⚠️',
    get_game_creation_checklist: '📋',
    list_workspace_files: '📁',
    get_workspace_file_content: '📖',
    use_workspace_file_agent: '🤖',
    get_state_content: '📥',
    update_state_with_javascript: '📝',
    list_skills: '📖',
    get_skill_content: '📝',
    list_memories: '🧠',
    get_memory_content: '📝',
    save_memory: '💾',
    delete_memory: '🗑️',
    query_user: '📋'
  }

  const toolLabels: Record<CopilotToolName, string> = {
    get_state_overview: t('tools.get_state_overview'),
    check_state_error: t('tools.check_state_error'),
    get_game_creation_checklist: t('tools.get_game_creation_checklist'),
    list_workspace_files: t('tools.list_workspace_files'),
    get_workspace_file_content: t('tools.get_workspace_file_content'),
    use_workspace_file_agent: t('tools.use_workspace_file_agent'),
    get_state_content: t('tools.get_state_content'),
    update_state_with_javascript: t('tools.update_state_with_javascript'),
    list_skills: t('tools.list_skills'),
    get_skill_content: t('tools.get_skill_content'),
    list_memories: t('tools.list_memories'),
    get_memory_content: t('tools.get_memory_content'),
    save_memory: t('tools.save_memory'),
    delete_memory: t('tools.delete_memory'),
    query_user: t('tools.query_user')
  }

  return (
    <div className={`tool-call-card ${toolCall.isExecuting ? 'executing' : ''}`}>
      <div
        className="tool-call-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tool-icon">{toolIcons[toolCall.name] || '🔧'}</span>
        <span className="tool-name">{toolLabels[toolCall.name] || toolCall.name}</span>
        {toolCall.isExecuting && <span className="executing-indicator">{t('tools.executing')}</span>}
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-call-details">
          <div className="tool-args">
            <strong>{t('tools.args')}</strong>
            <pre>{toolCall.arguments || t('tools.noArgs')}</pre>
          </div>
          {toolCall.result && (
            <div className="tool-result">
              <strong>{t('tools.result')}</strong>
              <pre>{toolCall.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 代码块组件 - 支持语言标签和复制按钮
 */
const CodeBlock: React.FC<{
  className?: string
  children?: React.ReactNode
}> = ({ className, children }) => {
  const { t } = useTranslation('copilot')
  const [copied, setCopied] = useState(false)
  const lang = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || 'code'}</span>
        <button className="code-block-copy" onClick={handleCopy} title={t('message.copyCode')}>
          {copied ? '✓' : '📋'}
        </button>
      </div>
      <pre><code className={className}>{code}</code></pre>
    </div>
  )
}

/**
 * 消息组件
 */
const MessageItem: React.FC<{
  message: CopilotMessage
  toolCalls: ToolCallDisplay[]
  isLast?: boolean
  onRegenerate?: () => void
  onResend?: () => void
}> = ({ message, toolCalls, isLast, onRegenerate, onResend }) => {
  const { t } = useTranslation('copilot')
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) {
    return null
  }

  const messageToolCalls: ToolCallDisplay[] = (message.toolCalls || []).map(mtc => {
    const globalTc = toolCalls.find(tc => tc.id === mtc.id)
    if (globalTc) return globalTc
    return {
      id: mtc.id,
      name: mtc.name,
      arguments: mtc.arguments,
      result: mtc.result,
      isExecuting: false
    } as ToolCallDisplay
  })

  const isWaitingForTools = message.isStreaming && messageToolCalls.length > 0 && !message.content

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Markdown components with enhanced code blocks
  const markdownComponents = {
    code: ({ className, children, ...props }: any) => {
      // Detect if this is an inline code or block code
      const isBlock = className?.startsWith('language-') || String(children).includes('\n')
      if (isBlock) {
        return <CodeBlock className={className}>{children}</CodeBlock>
      }
      return <code className={className} {...props}>{children}</code>
    },
    pre: ({ children }: any) => <>{children}</> // CodeBlock handles the <pre> wrapper
  }

  if (isUser) {
    return (
      <div className="message-item user">
        <div className="message-content">
          <div className="message-bubble">{message.content}</div>
          {onResend && (
            <div className="message-actions">
              <button className="message-action-btn" onClick={handleCopy} title={t('message.copy')}>
                {copied ? `✓ ${t('message.copied')}` : `📋 ${t('message.copy')}`}
              </button>
              <button className="message-action-btn" onClick={onResend} title={t('message.resendTitle')}>
                🔄 {t('message.resend')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="message-item assistant">
      <div className="message-content">
        {message.content ? (
          <div className="message-text-flow">
            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
            {message.isStreaming && <span className="streaming-cursor">●</span>}
          </div>
        ) : isWaitingForTools ? (
          <div className="tool-calling-hint">{t('message.callingTools')}</div>
        ) : null}
        {messageToolCalls.length > 0 && (
          <div className="message-tool-calls">
            {messageToolCalls.map(tc => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
        {/* Action buttons: copy + regenerate */}
        {message.content && !message.isStreaming && (
          <div className="message-actions">
            <button className="message-action-btn" onClick={handleCopy} title={t('message.copy')}>
              {copied ? `✓ ${t('message.copied')}` : `📋 ${t('message.copy')}`}
            </button>
            {isLast && onRegenerate && (
              <button className="message-action-btn" onClick={onRegenerate} title={t('message.regenerateTitle')}>
                🔄 {t('message.regenerate')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// ============================================================================
// ============================================================================
// 主组件
// ============================================================================


export const AICopilotPanel: React.FC<AICopilotPanelProps> = ({
  state,
  onStateChange,
  isExpanded,
  onExpandedChange,
}) => {
  const { t } = useTranslation('editor')
  // 面板状态
  const [showConfig, setShowConfig] = useState(false)
  // 悬浮按钮弹出面板: 'sessions' | 'files' | 'skills' | 'memories' | null
  const [activePanel, setActivePanel] = useState<'sessions' | 'files' | 'skills' | 'memories' | null>(null)

  // 配置
  const [config, setConfig] = useState<CopilotConfig>(() => {
    return loadCopilotConfigFromAPIConfig()
  })

  // 文件状态
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const uploadedFilesRef = useRef<UploadedFile[]>(uploadedFiles)

  // 更新 ref
  useEffect(() => {
    uploadedFilesRef.current = uploadedFiles
  }, [uploadedFiles])

  // Expose config to window for external use
  useEffect(() => {
    (window as any).__copilotConfig = config
    return () => { delete (window as any).__copilotConfig }
  }, [config])

  // 聊天会话状态
  const [chatSessions, setChatSessions] = useState<CopilotChatSession[]>([])
  const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(null)

  // Skills 状态
  const [skills, setSkills] = useState<StoredSkill[]>(() => {
    initializeBuiltInSkills()
    return loadSkills()
  })

  // WorkingMemory 状态
  const [memories, setMemories] = useState<StoredMemory[]>([])

  // 从 IndexedDB 异步加载 chat sessions、working memory、uploaded files
  useEffect(() => {
    initCopilotDB().then(({ sessions, memories: mems, files }) => {
      setChatSessions(sessions)
      setMemories(mems)
      setUploadedFiles(files)
      setCurrentSessionIdState(getCurrentSessionId())
    })
  }, [])

  // 聊天状态
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // queryUser 交互状态
  const [pendingQuery, setPendingQuery] = useState<{ request: QueryUserRequest; toolCallId: string } | null>(null)
  const [submittedQueries, setSubmittedQueries] = useState<Array<{ request: QueryUserRequest; data: Record<string, unknown>; toolCallId: string }>>([])
  const pendingQueryResolveRef = useRef<((data: Record<string, unknown>) => void) | null>(null)

  // @ 提及状态
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStartPos, setMentionStartPos] = useState(0)


  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const configRef = useRef<CopilotConfig>(config)
  const stateRef = useRef<StateData>(state)
  const onStateChangeRef = useRef(onStateChange)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestGenRef = useRef(0) // 请求代际计数器，防止旧请求的流事件混入新请求

  // 加载当前会话的消息
  // 注意：当正在发送消息时，不重新加载，避免覆盖正在处理的消息
  useEffect(() => {
    if (isLoading) return // 发送消息过程中不重新加载

    if (currentSessionId) {
      const session = chatSessions.find(s => s.id === currentSessionId)
      if (session) {
        setMessages(session.messages)
        setToolCalls([])
      }
    } else {
      setMessages([])
      setToolCalls([])
    }
  }, [currentSessionId, chatSessions, isLoading])

  // 保存消息到当前会话
  const saveMessagesToSession = useCallback((newMessages: CopilotMessage[]) => {
    if (currentSessionId) {
      updateChatSession(currentSessionId, { messages: newMessages })
      setChatSessions(loadChatSessions())
    }
  }, [currentSessionId])

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // pendingQuery 出现时也需要滚动到底部，确保用户能看到表单
  useEffect(() => {
    if (pendingQuery) {
      scrollToBottom()
    }
  }, [pendingQuery, scrollToBottom])

  // 获取文件的回调函数
  const getFiles = useCallback(() => uploadedFilesRef.current, [])

  // 更新 refs
  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    stateRef.current = state
    onStateChangeRef.current = onStateChange
  }, [state, onStateChange])

  // 检查配置是否有效
  const isConfigValid = useMemo(() => {
    return !!(config.primaryModel.apiKey && config.primaryModel.model)
  }, [config])

  
  // 会话管理函数
  const handleNewSession = useCallback(() => {
    const session = createChatSession()
    setChatSessions(loadChatSessions())
    setCurrentSessionIdState(session.id)
    setMessages([])
    setToolCalls([])
    resetSkillReadTracking()  // Reset schema read tracking for new session
  }, [])

  const handleSessionChange = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId)
    setCurrentSessionIdState(sessionId)
    resetSkillReadTracking()  // Reset schema read tracking when switching sessions

    // 直接加载会话消息，避免 isLoading guard 导致的问题
    const session = chatSessions.find(s => s.id === sessionId)
    if (session) {
      setMessages(session.messages)
      setToolCalls([])
    }
  }, [chatSessions])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (await showConfirm(t('copilotPanel.confirmDeleteSession'))) {
      deleteChatSession(sessionId)
      setChatSessions(loadChatSessions())
      const newCurrentId = getCurrentSessionId()
      setCurrentSessionIdState(newCurrentId)
    }
  }, [])

  const handleRenameSession = useCallback((sessionId: string, newTitle: string) => {
    updateChatSession(sessionId, { title: newTitle })
    setChatSessions(loadChatSessions())
  }, [])

  // 刷新 Skills 和 Memories
  const refreshSkillsAndMemories = useCallback(() => {
    setSkills(loadSkills())
    setMemories(loadMemories())
  }, [])

  // 发送消息（overrideContent / overrideMessages 用于 resend / regenerate 场景）
  const handleSend = useCallback(async (overrideContent?: string, overrideMessages?: CopilotMessage[]) => {
    const rawContent = overrideContent ?? inputValue
    const baseMessages = overrideMessages ?? messages
    if (!rawContent.trim() || isLoading || !configRef.current.primaryModel.apiKey) return

    // 解析并替换 @ 引用为元数据
    // 使用手动解析来正确处理文件名中包含方括号的情况
    const parseReferences = (text: string): string => {
      let result = ''
      let i = 0

      while (i < text.length) {
        // 检测 @[ 开始
        if (text[i] === '@' && text[i + 1] === '[') {
          // 找到匹配的结束括号（考虑嵌套）
          let depth = 1
          let j = i + 2
          while (j < text.length && depth > 0) {
            if (text[j] === '[') depth++
            else if (text[j] === ']') depth--
            j++
          }

          if (depth === 0) {
            // 成功找到匹配的括号
            const refContent = text.substring(i + 2, j - 1)

            if (refContent.startsWith('skill:')) {
              // Skill 引用
              const skillName = refContent.substring('skill:'.length)
              const skill = skills.find(s => s.title === skillName)
              if (skill) {
                const size = skill.content.length
                result += `@[skill:${skillName}](id:${skill.id}, size:${size}chars${skill.isBuiltIn ? ', builtin' : ''})`
              } else {
                result += text.substring(i, j)
              }
            } else {
              // 文件引用
              const file = uploadedFiles.find(f => f.name === refContent)
              if (file) {
                const sizeKB = (file.size / 1024).toFixed(1)
                const uploaded = new Date(file.uploadedAt).toLocaleString()
                result += `@[${refContent}](type:${file.type}, size:${sizeKB}KB, ${t('copilot:chat.uploaded', { datetime: uploaded })})`
              } else {
                result += text.substring(i, j)
              }
            }
            i = j
          } else {
            // 没有找到匹配的括号，保持原样
            result += text[i]
            i++
          }
        } else {
          result += text[i]
          i++
        }
      }

      return result
    }

    const processedContent = parseReferences(rawContent.trim())

    // 如果没有当前会话，先创建一个
    let sessionId = currentSessionId
    if (!sessionId) {
      const session = createChatSession(rawContent.trim().substring(0, 30) + (rawContent.trim().length > 30 ? '...' : ''))
      setChatSessions(loadChatSessions())
      setCurrentSessionIdState(session.id)
      sessionId = session.id
    }

    const userMessage: CopilotMessage = {
      id: generateMessageId(),
      role: 'user',
      content: processedContent,
      timestamp: Date.now()
    }

    const newMessages = [...baseMessages, userMessage]
    setMessages(newMessages)
    setInputValue('')
    setIsLoading(true)

    // 先中止上一个还在跑的请求（防止两个流同时输出混杂）
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    // 递增代际计数器，后续流事件检查此值来丢弃过时更新
    const gen = ++requestGenRef.current

    // 立即保存用户消息到会话，防止中断时数据丢失
    if (sessionId) {
      updateChatSession(sessionId, { messages: newMessages })
      setChatSessions(loadChatSessions())
    }

    // 创建工具执行上下文
    // 重要：使用 latestState 变量追踪最新状态，避免连续工具调用时的 stale closure 问题
    let latestState = stateRef.current;
    const toolContext: ToolExecutionContext = {
      get state() { return latestState; },
      config: configRef.current,
      getFiles,
      onStateChange: (newState: StateData) => {
        latestState = newState;  // 更新本地引用，确保下一次工具调用看到最新状态
        onStateChangeRef.current(newState);  // 调用原始 handler 更新 UI
      },
      onSkillsOrMemoryChange: refreshSkillsAndMemories,
      queryUser: (request: QueryUserRequest) => {
        return new Promise<Record<string, unknown>>((resolve) => {
          // Find the current tool call ID being executed
          // We set it via closure from the tool execution loop below
          const currentToolCallId = queryToolCallIdRef.current || 'unknown'
          setPendingQuery({ request, toolCallId: currentToolCallId })
          pendingQueryResolveRef.current = resolve
        })
      }
    }
    // Ref to track current tool call ID for queryUser
    const queryToolCallIdRef = { current: '' }

    // 构建完整对话历史用于 API 调用
    // Gemini 3 的 tool_calls 需要在顶层携带 thought_signature
    let apiMessages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string }; thought_signature?: string }>;
    }> = [...messages, userMessage]
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'tool' as const,
            content: m.content,
            tool_call_id: m.toolCallId
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: tc.arguments
              },
              ...(tc.thought_signature ? { thought_signature: tc.thought_signature } : {})
            }))
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content
        };
      });

    // 多轮工具调用循环
    const MAX_TOOL_ROUNDS = 50
    let toolRound = 0
    let shouldContinue = true

    try {
      while (shouldContinue && toolRound < MAX_TOOL_ROUNDS && !abortController.signal.aborted && gen === requestGenRef.current) {
        toolRound++

        // 在创建新助手消息占位之前，先清除所有现有消息的 isStreaming 状态
        setMessages(prev => prev.map(m => ({ ...m, isStreaming: false })))

        // 创建助手消息占位
        const assistantMessageId = generateMessageId()
        const assistantMessage: CopilotMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
          toolCalls: []
        }
        setMessages(prev => [...prev, assistantMessage])

        let currentContent = ''
        const pendingToolCalls: Array<{ id: string; name: string; arguments: string; thought_signature?: string }> = []

        // 流式调用
        for await (const event of streamCopilotChat(configRef.current, apiMessages, toolContext, abortController.signal)) {
          if (abortController.signal.aborted || gen !== requestGenRef.current) break
          switch (event.type) {
            case 'text_delta':
              currentContent += event.delta
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: currentContent }
                  : m
              ))
              break

            case 'tool_call_start':
              // 工具调用开始
              setToolCalls(prev => {
                const existing = prev.find(t => t.id === event.toolCallId)
                if (existing) return prev
                return [...prev, {
                  id: event.toolCallId,
                  name: event.toolName as CopilotToolName,
                  arguments: '',
                  isExecuting: true
                }]
              })
              break

            case 'tool_call_delta':
              // 工具调用参数增量（可选：显示实时累积）
              setToolCalls(prev => prev.map(t =>
                t.id === event.toolCallId
                  ? { ...t, arguments: (t.arguments || '') + event.delta }
                  : t
              ))
              break

            case 'tool_call_complete':
              // 工具调用完整参数已累积
              pendingToolCalls.push({
                id: event.toolCallId,
                name: event.toolName,
                arguments: event.arguments,
                thought_signature: event.thought_signature
              })
              // 更新 UI 显示完整参数
              setToolCalls(prev => prev.map(t =>
                t.id === event.toolCallId
                  ? { ...t, arguments: event.arguments }
                  : t
              ))
              // 更新消息中的 toolCalls（保留 thought_signature 用于会话持久化）
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId
                  ? {
                    ...m,
                    toolCalls: pendingToolCalls.map(tc => ({
                      id: tc.id,
                      name: tc.name as CopilotToolName,
                      arguments: tc.arguments,
                      thought_signature: tc.thought_signature
                    }))
                  }
                  : m
              ))
              break

            case 'done':
              // 流结束
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: currentContent, isStreaming: false }
                  : m
              ))

              // 检查是否有工具需要执行
              if (event.hasToolCalls && pendingToolCalls.length > 0) {
                // 需要执行工具，然后继续对话
                const toolResults: Array<{ tool_call_id: string; content: string }> = []

                for (const tc of pendingToolCalls) {
                  // 解析参数
                  let args: Record<string, unknown> = {}
                  try {
                    args = JSON.parse(tc.arguments || '{}')
                  } catch {
                    console.warn(`Failed to parse tool arguments: ${tc.arguments}`)
                  }

                  // 执行工具
                  queryToolCallIdRef.current = tc.id  // Track for queryUser
                  const { executeTool } = await import('./copilot')
                  let result = await executeTool(tc.name, args, toolContext)

                  // Dynamic warning for consecutive tool rounds without user interaction
                  if (toolRound >= 3) {
                    result += '\n\n⚠️ 【系统警告】你已经连续执行了 ' + toolRound +
                      ' 轮工具调用而没有与用户交流。请在本轮完成后立刻向用户汇报进展和阶段性成果，确认后续方向。不要继续埋头工作！'
                  }

                  toolResults.push({
                    tool_call_id: tc.id,
                    content: result
                  })

                  // 更新 UI
                  setToolCalls(prev => prev.map(t =>
                    t.id === tc.id
                      ? { ...t, result: result, isExecuting: false }
                      : t
                  ))

                  // 更新消息中的工具结果
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId
                      ? {
                        ...m,
                        toolCalls: (m.toolCalls || []).map(mtc =>
                          mtc.id === tc.id
                            ? { ...mtc, result: result }
                            : mtc
                        )
                      }
                      : m
                  ))

                  // 如果是操作 Memory 的工具，刷新列表
                  if (tc.name === 'save_memory' || tc.name === 'delete_memory') {
                    refreshSkillsAndMemories()
                  }
                }

                // 添加助手消息和工具结果到对话历史
                // 重要：必须包含 tool_calls，否则 API 会报错
                // Gemini 3 要求 tool_calls 顶层携带 thought_signature
                apiMessages.push({
                  role: 'assistant',
                  content: currentContent,
                  tool_calls: pendingToolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                      name: tc.name,
                      arguments: tc.arguments
                    },
                    ...(tc.thought_signature ? { thought_signature: tc.thought_signature } : {})
                  }))
                })
                for (const tr of toolResults) {
                  apiMessages.push({
                    role: 'tool',
                    content: tr.content,
                    tool_call_id: tr.tool_call_id
                  })
                }

                // 如果本轮有 get_workspace_image_content 调用，注入图片到后续消息
                const requestedImageNames: string[] = []
                for (const tc of pendingToolCalls) {
                  if (tc.name === 'get_workspace_image_content') {
                    try {
                      const a = JSON.parse(tc.arguments || '{}')
                      const names = Array.isArray(a.filename) ? a.filename as string[] : [a.filename as string]
                      requestedImageNames.push(...names)
                    } catch { /* ignore */ }
                  }
                }
                if (requestedImageNames.length > 0) {
                  const allFiles = toolContext.getFiles()
                  const imageParts = requestedImageNames
                    .map(name => allFiles.find(f => f.name === name && f.type === 'image' && f.dataUrl))
                    .filter(Boolean)
                    .map(f => ({ type: 'image_url' as const, image_url: { url: f!.dataUrl!, detail: 'auto' as const } }))
                  if (imageParts.length > 0) {
                    apiMessages.push({
                      role: 'user',
                      content: [
                        { type: 'text' as const, text: `[系统] 以下是你请求查看的 ${imageParts.length} 张图片：` },
                        ...imageParts
                      ]
                    } as any)
                  }
                }

                // 继续下一轮（等待模型处理工具结果并回复）
                shouldContinue = true
              } else {
                // 没有工具调用，结束循环
                shouldContinue = false
              }
              break

            case 'error':
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: t('copilotPanel.error', { error: event.error }), isStreaming: false }
                  : m
              ))
              shouldContinue = false
              break
          }
        }
      }

      if (toolRound >= MAX_TOOL_ROUNDS) {
        console.warn('Reached maximum tool rounds limit')
      }
    } catch (e) {
      setMessages(prev => {
        const lastAssistant = prev.filter(m => m.role === 'assistant').pop()
        if (lastAssistant) {
          return prev.map(m =>
            m.id === lastAssistant.id
              ? { ...m, content: t('copilotPanel.occurredError', { error: (e as Error).message }), isStreaming: false }
              : m
          )
        }
        return prev
      })
    } finally {
      // 只有当前代际的请求才清理全局状态，避免旧请求的 finally 覆盖新请求
      if (gen === requestGenRef.current) {
        abortControllerRef.current = null
        setIsLoading(false)
        // 确保所有消息的 isStreaming 都设置为 false，并过滤掉空的占位消息
        setMessages(prev => {
          const filtered = prev.filter(m => {
            // 过滤掉空内容且无工具调用的 assistant 占位消息
            if (m.role === 'assistant' && !m.content && (!m.toolCalls || m.toolCalls.length === 0)) {
              return false
            }
            return true
          })
          return filtered.map(m => ({ ...m, isStreaming: false }))
        })
        // 保存消息到当前会话
        if (sessionId) {
          // 获取最新的消息状态
          setMessages(currentMessages => {
            updateChatSession(sessionId, { messages: currentMessages })
            setChatSessions(loadChatSessions())
            return currentMessages
          })
        }
        // 刷新 Skills 和 Memories（AI 可能已经更新了）
        refreshSkillsAndMemories()
      }
    }
  }, [inputValue, isLoading, messages, currentSessionId, refreshSkillsAndMemories, uploadedFiles, skills, memories])

  // 计算过滤后的mention项目数量
  const getFilteredMentionItems = useCallback(() => {
    const q = mentionQuery.toLowerCase()
    let count = 0
    uploadedFiles.forEach(file => {
      if (file.name.toLowerCase().includes(q)) count++
    })
    skills.forEach(skill => {
      if (skill.title.toLowerCase().includes(q) || skill.id.toLowerCase().includes(q)) count++
    })
    memories.forEach(memory => {
      if (memory.title.toLowerCase().includes(q) || memory.id.toLowerCase().includes(q)) count++
    })
    return count
  }, [uploadedFiles, skills, memories, mentionQuery])

  // 处理mention选择
  const handleMentionSelect = useCallback((item: MentionItem) => {
    const before = inputValue.substring(0, mentionStartPos)
    const after = inputValue.substring(mentionStartPos + mentionQuery.length + 1) // +1 for @
    const mention = item.type === 'file'
      ? `@[${item.name}]`
      : item.type === 'skill' ? `@[skill:${item.name}]` : `@[memory:${item.name}]`
    const newValue = before + mention + after
    setInputValue(newValue)
    setMentionActive(false)
    setMentionQuery('')
    setMentionIndex(0)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputValue, mentionStartPos, mentionQuery])

  // 处理输入变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setInputValue(newValue)

    // 检测 @ 触发
    if (newValue[cursorPos - 1] === '@') {
      // 检查是否是新的 @（前面是空格或开头）
      if (cursorPos === 1 || /\s/.test(newValue[cursorPos - 2] || '')) {
        setMentionActive(true)
        setMentionStartPos(cursorPos - 1)
        setMentionQuery('')
        setMentionIndex(0)
        return
      }
    }

    // 更新 mention 查询
    if (mentionActive) {
      const queryStart = mentionStartPos + 1
      if (cursorPos >= queryStart && cursorPos <= newValue.length) {
        // 查找查询结束位置（遇到空格或到达光标位置）
        let queryEnd = cursorPos
        const query = newValue.substring(queryStart, queryEnd)
        // 如果遇到空格或特殊字符，关闭菜单
        if (/\s/.test(query) || query.includes('[') || query.includes(']')) {
          setMentionActive(false)
          setMentionQuery('')
        } else {
          setMentionQuery(query)
          setMentionIndex(0)
        }
      } else {
        // 光标移出了 mention 范围
        setMentionActive(false)
        setMentionQuery('')
      }
    }
  }, [mentionActive, mentionStartPos])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mention 菜单导航
    if (mentionActive) {
      const itemCount = getFilteredMentionItems()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(prev => (prev + 1) % Math.max(1, itemCount))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(prev => (prev - 1 + Math.max(1, itemCount)) % Math.max(1, itemCount))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        // 获取选中项并插入
        const q = mentionQuery.toLowerCase()
        const items: MentionItem[] = []
        uploadedFiles.forEach(file => {
          if (file.name.toLowerCase().includes(q)) {
            items.push({ type: 'file', id: file.name, name: file.name, icon: '📁' })
          }
        })
        skills.forEach(skill => {
          if (skill.title.toLowerCase().includes(q) || skill.id.toLowerCase().includes(q)) {
            items.push({ type: 'skill', id: skill.id, name: skill.title, icon: skill.isBuiltIn ? '📖' : '📝' })
          }
        })
        memories.forEach(memory => {
          if (memory.title.toLowerCase().includes(q) || memory.id.toLowerCase().includes(q)) {
            items.push({ type: 'memory', id: memory.id, name: memory.title, icon: '📝' })
          }
        })
        if (items[mentionIndex]) {
          handleMentionSelect(items[mentionIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionActive(false)
        setMentionQuery('')
        return
      }
    }

    // 普通发送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, mentionActive, mentionQuery, mentionIndex, getFilteredMentionItems, uploadedFiles, skills, memories, handleMentionSelect])

  // 清空当前对话
  const handleClear = useCallback(() => {
    if (currentSessionId) {
      updateChatSession(currentSessionId, { messages: [] })
      setChatSessions(loadChatSessions())
    }
    setMessages([])
    setToolCalls([])
    setSubmittedQueries([])
    setPendingQuery(null)
  }, [currentSessionId])

  // 导出当前对话
  const handleExportChat = useCallback(() => {
    if (messages.length === 0) return

    const currentSession = chatSessions.find(s => s.id === currentSessionId)
    const title = currentSession?.title || 'AI Chat'
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')

    // 生成 Markdown 内容
    let markdown = `# ${title}\n\n`
    markdown += `*Exported at: ${new Date().toLocaleString()}*\n\n---\n\n`

    messages.forEach(msg => {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant'
      markdown += `## ${role}\n\n`
      markdown += `${msg.content}\n\n`

      // 添加工具调用信息（完整导出用于调试）
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        markdown += `### Tool Calls\n\n`
        msg.toolCalls.forEach(tc => {
          markdown += `#### ${tc.name}\n\n`
          if (tc.arguments) {
            markdown += `**Arguments:**\n\`\`\`json\n${tc.arguments}\n\`\`\`\n\n`
          }
          if (tc.result) {
            markdown += `**Result:**\n\`\`\`\n${tc.result}\n\`\`\`\n\n`
          }
        })
      }
      markdown += `---\n\n`
    })

    // 创建下载
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat_${timestamp}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [messages, chatSessions, currentSessionId])

  // 停止生成
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  // 重新生成最后一条 AI 回复
  const handleRegenerate = useCallback(() => {
    if (isLoading || messages.length === 0) return
    // 找到最后一条用户消息的位置，删除其后的所有 AI 回复
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return
    const userMsg = messages[lastUserIdx]
    const restored = messages.slice(0, lastUserIdx)
    handleSend(userMsg.content, restored)
  }, [isLoading, messages, handleSend])

  // 重发某条用户消息（删除该消息及之后所有消息，然后重新发送）
  const handleResend = useCallback((messageId: string) => {
    if (isLoading) return
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx < 0 || messages[idx].role !== 'user') return
    const content = messages[idx].content
    const restored = messages.slice(0, idx)
    handleSend(content, restored)
  }, [isLoading, messages, handleSend])

  // 面板收起时不渲染（由菜单栏按钮控制）
  if (!isExpanded) {
    return null
  }

  return (
    <div className="copilot-panel expanded">
      {/* 头部 */}
      <div className="copilot-header">
        <div className="copilot-title">
          <span>🤖 {t('copilot:title')}</span>
        </div>
        <div className="copilot-actions">
          <button
            className="btn-icon"
            onClick={() => setShowConfig(true)}
            title={t('copilotPanel.configApi')}
          >
            ⚙️
          </button>
          <button
            className="btn-icon"
            onClick={handleExportChat}
            disabled={messages.length === 0}
            title={t('copilotPanel.exportChat')}
          >
            📤
          </button>
          <button
            className="btn-icon"
            onClick={handleClear}
            title={t('copilotPanel.clearConversation')}
          >
            🗑️
          </button>
          <button
            className="btn-icon"
            onClick={() => onExpandedChange(false)}
            title={t('copilotPanel.collapse')}
          >
            ✕
          </button>
        </div>
      </div>

      {(
        <div className="copilot-messages">
          {messages.length === 0 ? (
            <div className="copilot-welcome">
              <div className="welcome-icon">🤖</div>
              <h3>{t('copilotPanel.welcomeTitle')}</h3>
              <p>{t('copilotPanel.welcomeDescription')}</p>
              <ul>
                <li>{t('copilotPanel.welcomeHelp1')}</li>
                <li>{t('copilotPanel.welcomeHelp2')}</li>
                <li>{t('copilotPanel.welcomeHelp3')}</li>
                <li>{t('copilotPanel.welcomeHelp4')}</li>
              </ul>
              {!isConfigValid && (
                <div className="config-warning">
                  ⚠️ {t('copilotPanel.configWarning')}
                </div>
              )}
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isLastAssistant = msg.role === 'assistant' && !msg.isStreaming &&
                idx === messages.length - 1 || (idx === messages.length - 1 && msg.role === 'assistant')
              return (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  toolCalls={toolCalls}
                  isLast={isLastAssistant && !isLoading}
                  onRegenerate={isLastAssistant && !isLoading ? handleRegenerate : undefined}
                  onResend={msg.role === 'user' && !isLoading ? () => handleResend(msg.id) : undefined}
                />
              )
            })
          )}
          {/* queryUser submitted summaries */}
          {submittedQueries.map((sq, i) => (
            <QueryUserSummary key={`submitted-${i}`} request={sq.request} data={sq.data} />
          ))}
          {/* queryUser pending form — rendered as modal below */}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 底部操作区域 */}
      {(
      <div className="copilot-bottom-area">
        {/* 快捷操作按钮组 */}
        <div className="copilot-quick-actions">
          <button
            className={`quick-action-btn ${activePanel === 'sessions' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'sessions' ? null : 'sessions')}
            title={t('copilotPanel.sessionManager')}
          >
            💬
            {chatSessions.length > 0 && <span className="quick-action-badge">{chatSessions.length}</span>}
          </button>
          <button
            className={`quick-action-btn ${activePanel === 'files' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'files' ? null : 'files')}
            title={t('copilotPanel.fileManager')}
          >
            📁
            {uploadedFiles.length > 0 && <span className="quick-action-badge">{uploadedFiles.length}</span>}
          </button>
          <button
            className={`quick-action-btn ${activePanel === 'skills' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'skills' ? null : 'skills')}
            title={t('copilotPanel.skills')}
          >
            📖
            {skills.length > 0 && <span className="quick-action-badge">{skills.length}</span>}
          </button>
          <button
            className={`quick-action-btn ${activePanel === 'memories' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'memories' ? null : 'memories')}
            title={t('copilotPanel.memories')}
          >
            🧠
            {memories.length > 0 && <span className="quick-action-badge">{memories.length}</span>}
          </button>
        </div>

        {/* 弹出面板（从底部弹出） */}
        {activePanel && (
          <div className="copilot-bottom-popup">
            <div className="popup-header">
              <span>
                {activePanel === 'sessions' && `💬 ${t('copilotPanel.sessionManager')}`}
                {activePanel === 'files' && `📁 ${t('copilotPanel.fileManager')}`}
                {activePanel === 'skills' && `📖 ${t('copilotPanel.skills')}`}
                {activePanel === 'memories' && `🧠 ${t('copilotPanel.memories')}`}
              </span>
              <button className="popup-close" onClick={() => setActivePanel(null)}>✕</button>
            </div>
            <div className="popup-content">
              {activePanel === 'sessions' && (
                <SessionManager
                  sessions={chatSessions}
                  currentSessionId={currentSessionId}
                  onSessionChange={(id) => { handleSessionChange(id); setActivePanel(null) }}
                  onNewSession={() => { handleNewSession(); setActivePanel(null) }}
                  onDeleteSession={handleDeleteSession}
                  onRenameSession={handleRenameSession}
                  defaultExpanded={true}
                />
              )}
              {activePanel === 'files' && (
                <FileManager
                  files={uploadedFiles}
                  onFilesChange={setUploadedFiles}
                />
              )}
              {activePanel === 'skills' && (
                <SkillManager
                  skills={skills}
                  onSkillsChange={refreshSkillsAndMemories}
                  defaultExpanded={true}
                />
              )}
              {activePanel === 'memories' && (
                <MemoryManager
                  memories={memories}
                  onMemoriesChange={refreshSkillsAndMemories}
                  defaultExpanded={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 输入区域 */}
        {(
          <div className="copilot-input-area">
            {mentionActive && (
              <MentionPopup
                files={uploadedFiles}
                skills={skills}
                memories={memories}
                query={mentionQuery}
                selectedIndex={mentionIndex}
                onSelect={handleMentionSelect}
              />
            )}
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isConfigValid ? t('copilotPanel.inputPlaceholder') : t('copilotPanel.inputPlaceholderNoConfig')}
              disabled={!isConfigValid || isLoading}
              rows={2}
            />
            {isLoading ? (
              <button
                className="btn-send btn-stop"
                onClick={handleStop}
                title={t('copilot:chat.stopGeneration')}
              >
                ■
              </button>
            ) : (
              <button
                className="btn-send"
                onClick={() => handleSend()}
                disabled={!isConfigValid || !inputValue.trim()}
                title={t('copilotPanel.send')}
              >
                ➤
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* 配置模态框 */}
      <APIConfigModal
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        onSave={() => {
          const newConfig = loadCopilotConfigFromAPIConfig()
          setConfig(newConfig)
          configRef.current = newConfig
        }}
      />

      {/* queryUser 模态框 */}
      {pendingQuery && (
        <div className="copilot-modal-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="copilot-modal" onClick={(e) => e.stopPropagation()}>
            <QueryUserForm
              request={pendingQuery.request}
              onSubmit={(data) => {
                setSubmittedQueries(prev => [...prev, { request: pendingQuery.request, data, toolCallId: pendingQuery.toolCallId }])
                if (pendingQueryResolveRef.current) {
                  pendingQueryResolveRef.current(data)
                  pendingQueryResolveRef.current = null
                }
                setPendingQuery(null)
              }}
            />
          </div>
        </div>
      )}

    </div >
  )
}

export default AICopilotPanel