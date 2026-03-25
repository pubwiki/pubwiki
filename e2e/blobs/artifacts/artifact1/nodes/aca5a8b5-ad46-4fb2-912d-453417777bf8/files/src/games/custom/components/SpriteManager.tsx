/**
 * SpriteManager — 角色图像配置面板
 *
 * 用户可以为每个角色上传：
 * - 立绘（standing）：在场景中展示的全身/半身图
 * - 表情头像（avatar）：在对话框中展示的小头像
 */

import { useState, useRef, useCallback } from 'react'
import type { SpriteExportData } from '../stores/spriteStore'
import { useTranslation } from 'react-i18next'
import { useCreatureStore } from '../stores/creatureStore'
import { useSpriteStore, type SpriteImageType } from '../stores/spriteStore'
import type { GalExpression } from '../types'

const ALL_EXPRESSIONS: GalExpression[] = [
  'normal', 'happy', 'angry', 'sad', 'surprised', 'shy', 'confused', 'thinking', 'smirk'
]

const EXPRESSION_LABELS: Record<GalExpression, string> = {
  normal: '😐', happy: '😊', angry: '😠', sad: '😢',
  surprised: '😲', shy: '😳', confused: '😕', thinking: '🤔', smirk: '😏',
}

interface SpriteManagerProps {
  open: boolean
  onClose: () => void
}

export function SpriteManager({ open, onClose }: SpriteManagerProps) {
  const { t } = useTranslation('game')
  const creaturesMap = useCreatureStore(s => s.creaturesMap)
  const playerEntity = useCreatureStore(s => s.playerEntity)

  const setSprite = useSpriteStore(s => s.setSprite)
  const removeSprite = useSpriteStore(s => s.removeSprite)
  const removeCreatureSprites = useSpriteStore(s => s.removeCreatureSprites)
  const getAvatarUrl = useSpriteStore(s => s.getAvatarUrl)
  const getStandingUrl = useSpriteStore(s => s.getStandingUrl)
  const getCreatureExpressions = useSpriteStore(s => s.getCreatureExpressions)
  const exportAll = useSpriteStore(s => s.exportAll)
  const importAll = useSpriteStore(s => s.importAll)
  const sprites = useSpriteStore(s => s.sprites) // subscribe to changes

  const [selectedCreatureId, setSelectedCreatureId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SpriteImageType>('standing')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<{ expression: GalExpression; imageType: SpriteImageType } | null>(null)

  // Build creature list: player first, then NPCs
  const creatureList = (() => {
    const list: Array<{ id: string; name: string; isPlayer: boolean }> = []
    const playerId = playerEntity?.Creature?.creature_id
    if (playerId) {
      list.push({ id: playerId, name: playerEntity?.Creature?.name || playerId, isPlayer: true })
    }
    for (const [id, entity] of creaturesMap) {
      if (id !== playerId) {
        list.push({ id, name: entity.Creature?.name || id, isPlayer: false })
      }
    }
    return list
  })()

  const handleExport = useCallback(async () => {
    const data = await exportAll()
    if (data.sprites.length === 0) return
    const json = JSON.stringify(data)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sprites-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportAll])

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data: SpriteExportData = JSON.parse(text)
      const count = await importAll(data)
      console.log(`Imported ${count} sprites`)
    } catch (err) {
      console.error('Import failed:', err)
    }
    e.target.value = ''
  }, [importAll])

  const handleFileSelect = useCallback((imageType: SpriteImageType, expression: GalExpression) => {
    setUploadTarget({ expression, imageType })
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedCreatureId || !uploadTarget) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setSprite(selectedCreatureId, uploadTarget.imageType, uploadTarget.expression, dataUrl, file.type)
      setUploadTarget(null)
    }
    reader.readAsDataURL(file)

    // Reset input so same file can be re-selected
    e.target.value = ''
  }, [selectedCreatureId, uploadTarget, setSprite])

  if (!open) return null

  const selectedCreature = creatureList.find(c => c.id === selectedCreatureId)

  return (
    <div className="sprite-manager-overlay" onClick={onClose}>
      <div className="sprite-manager-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sprite-manager-header">
          <h3>{t('galgame.spriteManager.title')}</h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="sprite-io-btn" onClick={handleExport}>
              {t('galgame.spriteManager.export')}
            </button>
            <button className="sprite-io-btn" onClick={() => importInputRef.current?.click()}>
              {t('galgame.spriteManager.import')}
            </button>
            <button className="sprite-manager-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="sprite-manager-body">
          {/* Left: Creature list */}
          <div className="sprite-manager-sidebar">
            <div className="sprite-manager-sidebar-title">
              {t('galgame.spriteManager.characters')}
            </div>
            {creatureList.map(c => (
              <button
                key={c.id}
                className={`sprite-creature-item ${selectedCreatureId === c.id ? 'active' : ''}`}
                onClick={() => setSelectedCreatureId(c.id)}
              >
                <span className="sprite-creature-name">{c.name}</span>
                {c.isPlayer && <span className="sprite-creature-badge">P</span>}
              </button>
            ))}
            {creatureList.length === 0 && (
              <div className="sprite-empty-hint">{t('galgame.spriteManager.noCharacters')}</div>
            )}
          </div>

          {/* Right: Image config */}
          <div className="sprite-manager-content">
            {!selectedCreatureId ? (
              <div className="sprite-empty-hint">{t('galgame.spriteManager.selectCharacter')}</div>
            ) : (
              <>
                {/* Character name */}
                <div className="sprite-content-header">
                  <span className="sprite-content-name">{selectedCreature?.name}</span>
                  <button
                    className="sprite-btn-danger"
                    onClick={() => {
                      removeCreatureSprites(selectedCreatureId)
                    }}
                  >
                    {t('galgame.spriteManager.clearAll')}
                  </button>
                </div>

                {/* Tabs: standing / avatar */}
                <div className="sprite-tabs">
                  <button
                    className={`sprite-tab ${activeTab === 'standing' ? 'active' : ''}`}
                    onClick={() => setActiveTab('standing')}
                  >
                    {t('galgame.spriteManager.standing')}
                  </button>
                  <button
                    className={`sprite-tab ${activeTab === 'avatar' ? 'active' : ''}`}
                    onClick={() => setActiveTab('avatar')}
                  >
                    {t('galgame.spriteManager.avatar')}
                  </button>
                </div>

                {activeTab === 'standing' ? (
                  /* Standing: single image */
                  <div className="sprite-standing-single">
                    <div
                      className="sprite-standing-preview"
                      onClick={() => handleFileSelect('standing', 'normal')}
                    >
                      {getStandingUrl(selectedCreatureId, 'normal') ? (
                        <img src={getStandingUrl(selectedCreatureId, 'normal')!} alt="standing" draggable={false} />
                      ) : (
                        <div className="sprite-expression-empty">+</div>
                      )}
                    </div>
                    {getStandingUrl(selectedCreatureId, 'normal') && (
                      <button
                        className="sprite-btn-danger"
                        onClick={() => removeSprite(selectedCreatureId, 'standing', 'normal')}
                        style={{ marginTop: 8 }}
                      >
                        {t('galgame.spriteManager.clearAll')}
                      </button>
                    )}
                  </div>
                ) : (
                  /* Avatar: expression grid */
                  <div className="sprite-expression-grid">
                    {ALL_EXPRESSIONS.map(expr => {
                      const url = getAvatarUrl(selectedCreatureId, expr)
                      return (
                        <div key={expr} className="sprite-expression-card">
                          <div className="sprite-expression-label">
                            <span>{EXPRESSION_LABELS[expr]}</span>
                            <span>{expr}</span>
                          </div>
                          <div
                            className="sprite-expression-preview"
                            onClick={() => handleFileSelect('avatar', expr)}
                          >
                            {url ? (
                              <img src={url} alt={expr} draggable={false} />
                            ) : (
                              <div className="sprite-expression-empty">+</div>
                            )}
                          </div>
                          {url && (
                            <button
                              className="sprite-expression-remove"
                              onClick={() => removeSprite(selectedCreatureId, 'avatar', expr)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
      </div>
    </div>
  )
}
