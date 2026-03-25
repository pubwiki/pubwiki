import React, { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { showAlert, showConfirm, showPrompt } from './AlertDialog'

export interface SaveManagerProps {
  open: boolean
  onClose: () => void
  onAfterLoad?: () => Promise<void>
}

export const SaveManager: React.FC<SaveManagerProps> = ({ open, onClose, onAfterLoad }) => {
  const { t } = useTranslation('editor')
  const [saves, setSaves] = useState<Array<{ checkpointId: string; metadata?: any }>>([])
  const [loading, setLoading] = useState(false)
  const [selectedSave, setSelectedSave] = useState<string | null>(null)

  // 加载存档列表
  const loadSaves = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.ListGameSaves()
      setSaves(result.saves || [])
    } catch (e) {
      showAlert(t('saveManager.loadListFailed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    if (open) {
      loadSaves()
    }
  }, [open, loadSaves])

  // 创建存档
  const handleCreate = async () => {
    const title = await showPrompt(t('saveManager.enterSaveName'), { defaultValue: t('saveManager.newSave') })
    if (!title) return
    
    try {
      setLoading(true)
      await window.CreateGameSave({ title })
      showAlert(t('saveManager.createSuccess'))
      await loadSaves()
    } catch (e) {
      showAlert(t('saveManager.createFailed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }

  // 加载存档
  const handleLoad = async (checkpointId: string) => {
    if (!await showConfirm(t('saveManager.confirmLoad'))) return
    
    try {
      setLoading(true)
      await window.LoadGameSave(checkpointId)
      if (onAfterLoad) {
        await onAfterLoad()
      }
      showAlert(t('saveManager.loadSuccess'))
      onClose()
    } catch (e) {
      showAlert(t('saveManager.loadFailed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }



  // 查看存档详情
  const getMetadataDisplay = (metadata: any) => {
    if (!metadata) return t('saveManager.noMetadata')
    try {
      return JSON.stringify(metadata, null, 2)
    } catch {
      return t('saveManager.parseMetadataFailed')
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="save-manager-modal" 
        onClick={e => e.stopPropagation()}
        style={{ 
          maxWidth: '700px', 
          maxHeight: '80vh',
          background: 'rgba(30, 42, 58, 0.98)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, color: '#f8d56b' }}>💾 {t('saves.title')}</h3>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a0aec0',
              fontSize: '20px',
              cursor: 'pointer'
            }}
          >✕</button>
        </div>
        
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '16px 20px',
          maxHeight: 'calc(80vh - 140px)'
        }}>
          {loading && <p style={{ textAlign: 'center', color: '#a0aec0' }}>{t('common:loading')}</p>}
          
          {!loading && saves.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#a0aec0' }}>
              <p style={{ fontSize: '48px', marginBottom: '16px' }}>📭</p>
              <p>{t('common:noContent')}</p>
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
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <span style={{ color: '#a0aec0', fontSize: '0.9em' }}>{t('saves.count', { count: saves.length })}</span>
              </div>
              
              {saves.map((save, index) => {
                const isSelected = selectedSave === save.checkpointId
                const metadata = save.metadata || {}
                const title = metadata.title || t('saveManager.saveNumber', { number: index + 1 })
                const isInitial = metadata.initial === true
                
                return (
                  <div 
                    key={save.checkpointId}
                    style={{
                      border: isSelected ? '2px solid #667eea' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      background: isSelected ? 'rgba(102, 126, 234, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => setSelectedSave(save.checkpointId)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ 
                          fontWeight: 'bold', 
                          marginBottom: '6px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px',
                          color: '#e0e0e0'
                        }}>
                          <span>{title}</span>
                          {isInitial && (
                            <span style={{ 
                              background: 'rgba(72, 187, 120, 0.2)', 
                              color: '#68d391', 
                              padding: '2px 8px', 
                              borderRadius: '4px', 
                              fontSize: '0.75em' 
                            }}>{t('saves.autoSave')}</span>
                          )}
                          {isSelected && <span style={{ color: '#667eea', fontSize: '0.85em' }}>✓</span>}
                        </div>
                        <div style={{ fontSize: '0.8em', color: '#718096' }}>
                          ID: {save.checkpointId}
                        </div>
                        {isSelected && metadata && Object.keys(metadata).length > 0 && (
                          <div style={{ fontSize: '0.8em', color: '#718096', marginTop: '8px' }}>
                            <pre style={{
                              background: 'rgba(0, 0, 0, 0.2)',
                              padding: '8px',
                              borderRadius: '4px',
                              margin: 0,
                              fontSize: '0.85em',
                              maxHeight: '100px',
                              overflow: 'auto'
                            }}>
                              {getMetadataDisplay(metadata)}
                            </pre>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleLoad(save.checkpointId)}
                          disabled={loading}
                          style={{
                            padding: '6px 12px',
                            background: 'rgba(102, 126, 234, 0.2)',
                            border: '1px solid rgba(102, 126, 234, 0.5)',
                            borderRadius: '6px',
                            color: '#a0c4ff',
                            fontSize: '0.85em',
                            cursor: 'pointer'
                          }}
                        >
                          📥 {t('saves.loadSave')}
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
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <button 
            onClick={handleCreate}
            disabled={loading}
            style={{
              padding: '8px 16px',
              background: 'rgba(72, 187, 120, 0.2)',
              border: '1px solid rgba(72, 187, 120, 0.5)',
              borderRadius: '6px',
              color: '#68d391',
              cursor: 'pointer'
            }}
          >
            ➕ {t('saveManager.newSave')}
          </button>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={loadSaves}
              disabled={loading}
              style={{
                padding: '8px 16px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                color: '#a0aec0',
                cursor: 'pointer'
              }}
            >
              🔄 {t('toolbar.refresh', { defaultValue: '刷新' })}
            </button>
            <button 
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                color: '#a0aec0',
                cursor: 'pointer'
              }}
            >
              {t('common:close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SaveManager
