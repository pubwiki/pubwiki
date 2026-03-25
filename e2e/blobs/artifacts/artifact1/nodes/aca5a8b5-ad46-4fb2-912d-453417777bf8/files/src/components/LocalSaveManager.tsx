import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { showAlert, showConfirm, showPrompt } from './AlertDialog'
import { type StateData, isV2SaveData } from '../api/types'
import { migrateStateData } from '../api/stateValidation'
import {
  type LocalSaveSlot,
  type LocalSavesIndex,
  initLocalSaveStorage,
  getLocalSavesIndex,
  getLocalSaveData,
  saveLocalSaveData,
  deleteLocalSave,
  generateSlotId,
} from '../api/localSaveStorage'

// ============================================================================
// 本地存档管理组件
// ============================================================================

export interface LocalSaveManagerProps {
  open: boolean
  mode: 'save' | 'load'
  currentData?: StateData
  onClose: () => void
  onSave?: (slotId: string, slotName: string) => void
  onLoad?: (data: StateData, slotName: string) => void
}

export const LocalSaveManager: React.FC<LocalSaveManagerProps> = ({
  open,
  mode,
  currentData,
  onClose,
  onSave,
  onLoad,
}) => {
  const { t } = useTranslation('editor')
  const [slots, setSlots] = useState<LocalSaveSlot[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [newSlotName, setNewSlotName] = useState('')
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  // 加载存档列表
  const loadSlots = useCallback(() => {
    const index = getLocalSavesIndex()
    setSlots(index.slots)
    // 默认选中最近使用的槽位
    if (index.lastUsedSlotId && index.slots.some(s => s.id === index.lastUsedSlotId)) {
      setSelectedSlotId(index.lastUsedSlotId)
    } else if (index.slots.length > 0) {
      setSelectedSlotId(index.slots[0].id)
    }
  }, [])

  useEffect(() => {
    if (open) {
      initLocalSaveStorage().then(() => {
        loadSlots()
      })
      setIsCreatingNew(false)
      setNewSlotName('')
    }
  }, [open, loadSlots])

  // 创建新存档槽位
  const handleCreateNew = useCallback(async () => {
    if (!newSlotName.trim()) {
      showAlert(t('localSaveManager.enterSaveName'))
      return
    }
    
    if (!currentData) {
      showAlert(t('localSaveManager.noDataToSave'))
      return
    }
    
    const slotId = generateSlotId()
    saveLocalSaveData(slotId, currentData, newSlotName.trim())
    showAlert(t('localSaveManager.createSuccess'))
    
    if (onSave) {
      onSave(slotId, newSlotName.trim())
    }
    
    loadSlots()
    setIsCreatingNew(false)
    setNewSlotName('')
    setSelectedSlotId(slotId)
  }, [newSlotName, currentData, onSave, loadSlots])

  // 覆盖现有存档
  const handleOverwrite = useCallback(async () => {
    if (!selectedSlotId) return
    
    const slot = slots.find(s => s.id === selectedSlotId)
    if (!slot) return
    
    if (!currentData) {
      showAlert(t('localSaveManager.noDataToSave'))
      return
    }
    
    const confirmed = await showConfirm(t('localSaveManager.confirmOverwrite', { name: slot.name }))
    if (!confirmed) return
    
    saveLocalSaveData(selectedSlotId, currentData, slot.name)
    showAlert(t('localSaveManager.saveSuccess'))
    
    if (onSave) {
      onSave(selectedSlotId, slot.name)
    }
    
    loadSlots()
  }, [selectedSlotId, slots, currentData, onSave, loadSlots, t])

  // 加载存档
  const handleLoad = useCallback(async () => {
    if (!selectedSlotId) return

    const slot = slots.find(s => s.id === selectedSlotId)
    if (!slot) return

    const data = getLocalSaveData(selectedSlotId)
    if (!data) {
      showAlert(t('localSaveManager.loadFailed'))
      return
    }

    if (!isV2SaveData(data)) {
      showAlert(t('localSaveManager.incompatibleVersion'))
      return
    }

    migrateStateData(data as Record<string, any>)

    if (onLoad) {
      onLoad(data, slot.name)
    }

    showAlert(t('localSaveManager.loaded', { name: slot.name }))
    onClose()
  }, [selectedSlotId, slots, onLoad, onClose, t])

  // 删除存档
  const handleDelete = useCallback(async () => {
    if (!selectedSlotId) return
    
    const slot = slots.find(s => s.id === selectedSlotId)
    if (!slot) return
    
    const confirmed = await showConfirm(t('localSaveManager.confirmDelete', { name: slot.name }))
    if (!confirmed) return
    
    deleteLocalSave(selectedSlotId)
    showAlert(t('localSaveManager.deleted'))
    loadSlots()
    setSelectedSlotId(null)
  }, [selectedSlotId, slots, loadSlots])

  // 重命名存档
  const handleRename = useCallback(async () => {
    if (!selectedSlotId) return
    
    const slot = slots.find(s => s.id === selectedSlotId)
    if (!slot) return
    
    const newName = await showPrompt(t('localSaveManager.enterNewName'), { defaultValue: slot.name })
    if (!newName || newName.trim() === slot.name) return
    
    const data = getLocalSaveData(selectedSlotId)
    if (!data) {
      showAlert(t('localSaveManager.renameFailed'))
      return
    }
    
    saveLocalSaveData(selectedSlotId, data, newName.trim())
    showAlert(t('localSaveManager.renamed'))
    loadSlots()
  }, [selectedSlotId, slots, loadSlots])

  const selectedSlot = useMemo(() => 
    slots.find(s => s.id === selectedSlotId),
    [slots, selectedSlotId]
  )

  if (!open) return null

  return (
    <div className="paper-editor paper-modal-overlay" onClick={onClose}>
      <div 
        className="paper-modal paper-modal-normal" 
        onClick={e => e.stopPropagation()}
        style={{ 
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* 标题栏 */}
        <div className="paper-modal-header">
          <h3>
            {mode === 'save' ? `${t('toolbar.localSave')}` : `${t('toolbar.localLoad')}`}
          </h3>
          <button 
            className="paper-modal-close"
            onClick={onClose}
          ></button>
        </div>
        
        {/* 内容区域 */}
        <div className="paper-modal-body" style={{ maxHeight: 'calc(80vh - 140px)' }}>
          {/* 新建存档区域 (仅保存模式) */}
          {mode === 'save' && (
            <div style={{ marginBottom: '16px' }}>
              {isCreatingNew ? (
                <div style={{ 
                  display: 'flex', 
                  gap: '8px', 
                  alignItems: 'center',
                  padding: '12px',
                  background: 'var(--paper-lime-green-alpha)',
                  border: '1px solid var(--paper-lime-green)',
                  borderRadius: 'var(--paper-radius-md)'
                }}>
                  <input
                    type="text"
                    value={newSlotName}
                    onChange={e => setNewSlotName(e.target.value)}
                    placeholder={t('localSaveManager.namePlaceholder')}
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'var(--paper-bg-secondary)',
                      border: '1px solid var(--paper-border-color)',
                      borderRadius: 'var(--paper-radius-sm)',
                      color: 'var(--paper-text-primary)',
                      fontSize: 'var(--paper-font-size-sm)'
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateNew()
                      if (e.key === 'Escape') setIsCreatingNew(false)
                    }}
                  />
                  <button
                    onClick={handleCreateNew}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--paper-lime-green)',
                      border: 'none',
                      borderRadius: 'var(--paper-radius-sm)',
                      color: 'var(--paper-text-primary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontWeight: 'var(--paper-font-weight-bold)'
                    }}
                  >
                    {t('common:confirm')}
                  </button>
                  <button
                    onClick={() => setIsCreatingNew(false)}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--paper-bg-tertiary)',
                      border: '1px solid var(--paper-border-color)',
                      borderRadius: 'var(--paper-radius-sm)',
                      color: 'var(--paper-text-secondary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {t('common:cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingNew(true)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--paper-lime-green-alpha)',
                    border: '1px dashed var(--paper-lime-green)',
                    borderRadius: 'var(--paper-radius-md)',
                    color: 'var(--paper-text-primary)',
                    cursor: 'pointer',
                    fontSize: 'var(--paper-font-size-sm)',
                    fontWeight: 'var(--paper-font-weight-bold)'
                  }}
                >
                  {t('localSaveManager.saveToNewSlot')}
                </button>
              )}
            </div>
          )}

          {/* 存档列表 */}
          {slots.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--paper-text-tertiary)' }}>
              <p style={{ fontSize: '48px', marginBottom: '16px' }}></p>
              <p>{t('common:noContent')}</p>
              {mode === 'save' && (
                <p style={{ fontSize: 'var(--paper-font-size-sm)', color: 'var(--paper-text-secondary)' }}>{t('localSaveManager.createFirstSave')}</p>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ 
                color: 'var(--paper-text-secondary)', 
                fontSize: 'var(--paper-font-size-sm)', 
                marginBottom: '8px',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--paper-border-color)'
              }}>
                {t('localSaveManager.totalSaves', { count: slots.length })} {mode === 'save' && t('localSaveManager.selectToOverwrite')}
              </div>
              
              {slots.map(slot => {
                const isSelected = selectedSlotId === slot.id
                const slotData = getLocalSaveData(slot.id)
                const isV2 = isV2SaveData(slotData)
                const isIncompatible = mode === 'load' && !isV2
                return (
                  <div
                    key={slot.id}
                    onClick={() => setSelectedSlotId(slot.id)}
                    style={{
                      padding: '12px 16px',
                      background: isSelected ? 'var(--paper-electric-blue-alpha)' : 'var(--paper-bg-tertiary)',
                      border: isSelected ? '2px solid var(--paper-electric-blue)' : '1px solid var(--paper-border-color)',
                      borderRadius: 'var(--paper-radius-md)',
                      cursor: 'pointer',
                      opacity: isIncompatible ? 0.5 : 1,
                      transition: 'all 0.2s var(--paper-ease-bounce)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontWeight: 'var(--paper-font-weight-bold)',
                          marginBottom: '4px',
                          color: 'var(--paper-text-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span>{slot.name}</span>
                          {isIncompatible && <span style={{ color: 'var(--paper-coral)', fontSize: '0.75em' }}>{t('localSaveManager.oldVersion')}</span>}
                          {isSelected && !isIncompatible && <span style={{ color: 'var(--paper-electric-blue)', fontSize: '0.85em' }}></span>}
                        </div>
                        <div style={{ fontSize: 'var(--paper-font-size-xs)', color: 'var(--paper-text-tertiary)' }}>
                          {t('localSaveManager.updatedAt', { time: new Date(slot.updatedAt).toLocaleString() })}
                        </div>
                        {slot.preview && (
                          <div style={{ 
                            fontSize: 'var(--paper-font-size-xs)', 
                            color: 'var(--paper-text-secondary)', 
                            marginTop: '4px',
                            display: 'flex',
                            gap: '12px'
                          }}>
                            <span>{t('localSaveManager.previewCreatures', { count: slot.preview.creaturesCount })}</span>
                            <span>{t('localSaveManager.previewRegions', { count: slot.preview.regionsCount })}</span>
                            <span>{t('localSaveManager.previewOrganizations', { count: slot.preview.organizationsCount })}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div style={{ 
          display: 'flex', 
          gap: '12px', 
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderTop: '1px solid var(--paper-border-color)'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedSlot && (
              <>
                <button 
                  onClick={handleRename}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--paper-bg-tertiary)',
                    border: '1px solid var(--paper-border-color)',
                    borderRadius: 'var(--paper-radius-sm)',
                    color: 'var(--paper-text-secondary)',
                    cursor: 'pointer',
                    fontSize: 'var(--paper-font-size-sm)'
                  }}
                >
                  {t('common:rename')}
                </button>
                <button 
                  onClick={handleDelete}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--paper-coral)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--paper-radius-sm)',
                    cursor: 'pointer',
                    fontSize: 'var(--paper-font-size-sm)'
                  }}
                >
                  {t('common:delete')}
                </button>
              </>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: 'var(--paper-bg-tertiary)',
                border: '1px solid var(--paper-border-color)',
                borderRadius: 'var(--paper-radius-sm)',
                color: 'var(--paper-text-secondary)',
                cursor: 'pointer'
              }}
            >
              {t('common:cancel')}
            </button>
            {mode === 'save' && selectedSlot && (
              <button 
                onClick={handleOverwrite}
                style={{
                  padding: '8px 16px',
                  background: 'var(--paper-electric-blue)',
                  border: 'none',
                  borderRadius: 'var(--paper-radius-sm)',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 'var(--paper-font-weight-bold)'
                }}
              >
                {t('saves.saveAs')}
              </button>
            )}
            {mode === 'load' && selectedSlot && (
              <button 
                onClick={handleLoad}
                style={{
                  padding: '8px 16px',
                  background: 'var(--paper-electric-blue)',
                  border: 'none',
                  borderRadius: 'var(--paper-radius-sm)',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 'var(--paper-font-weight-bold)'
                }}
              >
                {t('saves.loadSave')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Re-export storage API for external use
export { getLocalSavesIndex, getLocalSaveData, saveLocalSaveData, deleteLocalSave, generateSlotId }
export type { LocalSaveSlot, LocalSavesIndex }

export default LocalSaveManager
