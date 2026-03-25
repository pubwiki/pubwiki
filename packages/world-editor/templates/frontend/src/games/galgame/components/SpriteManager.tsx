/**
 * SpriteManager — 角色立绘管理面板
 *
 * 网格布局: 行=角色, 列=8种表情。
 * 支持上传/替换/删除、导出/导入。
 */

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSpriteStore } from '../stores/spriteStore'
import { useRegistryStore } from '../stores/registryStore'
import { readImageFile, IMAGE_ACCEPT } from '../../../api/imageUtils'
import type { GalExpression } from '../types'

const ALL_EXPRESSIONS: GalExpression[] = [
  'normal', 'happy', 'angry', 'sad', 'surprised', 'shy', 'disgusted', 'dazed'
]

const EXPRESSION_KEYS: Record<GalExpression, string> = {
  normal: 'galgame.expressions.normal',
  happy: 'galgame.expressions.happy',
  angry: 'galgame.expressions.angry',
  sad: 'galgame.expressions.sad',
  surprised: 'galgame.expressions.surprised',
  shy: 'galgame.expressions.shy',
  disgusted: 'galgame.expressions.disgusted',
  dazed: 'galgame.expressions.dazed',
}

interface Props {
  open: boolean
  onClose: () => void
}

export function SpriteManager({ open, onClose }: Props) {
  const { t } = useTranslation('game')
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const sprites = useSpriteStore(s => s.sprites)
  const setSprite = useSpriteStore(s => s.setSprite)
  const removeSprite = useSpriteStore(s => s.removeSprite)
  const clearAll = useSpriteStore(s => s.clearAll)
  const exportSprites = useSpriteStore(s => s.exportSprites)
  const importSprites = useSpriteStore(s => s.importSprites)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<{
    creatureId: string
    expression: GalExpression
  } | null>(null)

  if (!open) return null

  const creatures = Array.from(creaturesRegistry.entries())

  const handleCellClick = (creatureId: string, expression: GalExpression) => {
    setUploadTarget({ creatureId, expression })
    // Delay click to ensure ref state is set
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uploadTarget) return
    try {
      const uploaded = await readImageFile(file)
      setSprite(uploadTarget.creatureId, uploadTarget.expression,
        uploaded.dataUrl!, uploaded.mimeType!)
    } catch (err) {
      alert(t('galgame.sprite.uploadFailed', { error: (err as Error).message }))
    }
    e.target.value = ''
    setUploadTarget(null)
  }

  const handleExport = async () => {
    const data = await exportSprites()
    if (data.sprites.length === 0) {
      alert(t('galgame.sprite.noSpritesToExport'))
      return
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sprites-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => {
    importInputRef.current?.click()
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const count = await importSprites(data)
      alert(t('galgame.sprite.importSuccess', { count }))
    } catch (err) {
      alert(t('galgame.sprite.importFailed', { error: (err as Error).message }))
    }
    e.target.value = ''
  }

  const makeKey = (cid: string, expr: GalExpression) => `${cid}__${expr}`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content sprite-manager-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('galgame.sprite.title')}</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body sprite-manager-body">
          {/* Hidden file inputs */}
          <input ref={fileInputRef} type="file" accept={IMAGE_ACCEPT}
            style={{ display: 'none' }} onChange={handleFileChange} />
          <input ref={importInputRef} type="file" accept=".json"
            style={{ display: 'none' }} onChange={handleImportFile} />

          {creatures.length === 0 ? (
            <div className="sprite-empty">{t('galgame.sprite.noData')}</div>
          ) : (
            <div className="sprite-grid">
              {/* Header row */}
              <div className="sprite-grid-header">
                <div className="sprite-name-header">{t('galgame.sprite.character')}</div>
                {ALL_EXPRESSIONS.map(expr => (
                  <div key={expr} className="sprite-expr-header">
                    {t(EXPRESSION_KEYS[expr])}
                  </div>
                ))}
              </div>

              {/* Creature rows */}
              {creatures.map(([creatureId, info]) => (
                <div key={creatureId} className="sprite-grid-row">
                  <div className="sprite-creature-name" title={creatureId}>
                    {info.name}
                  </div>
                  {ALL_EXPRESSIONS.map(expr => {
                    const key = makeKey(creatureId, expr)
                    const dataUrl = sprites.get(key)
                    return (
                      <div
                        key={expr}
                        className="sprite-cell"
                        onClick={() => handleCellClick(creatureId, expr)}
                        title={t('galgame.sprite.clickToUpload', { name: info.name, expression: t(EXPRESSION_KEYS[expr]) })}
                      >
                        {dataUrl ? (
                          <div className="sprite-thumb-wrap">
                            <img src={dataUrl} className="sprite-thumb" alt="" />
                            <button
                              className="sprite-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeSprite(creatureId, expr)
                              }}
                              title={t('galgame.sprite.delete')}
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <div className="sprite-placeholder">+</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="sprite-toolbar">
            <button className="sprite-toolbar-btn" onClick={handleExport}>
              {t('galgame.sprite.exportSprites')}
            </button>
            <button className="sprite-toolbar-btn" onClick={handleImportClick}>
              {t('galgame.sprite.importSprites')}
            </button>
            <button
              className="sprite-toolbar-btn danger"
              onClick={() => {
                if (confirm(t('galgame.sprite.confirmClear'))) clearAll()
              }}
            >
              {t('galgame.sprite.clearAll')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
