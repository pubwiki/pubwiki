/**
 * ImageAPIConfigModal — 图片 API 配置弹窗
 *
 * 四类配置：立绘生成、表情生成、CG 生成（预留）、Prompt 增强
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  loadImageAPIConfig,
  saveImageAPIConfig,
  type ImageAPIConfig,
} from '../services/imageApi'

interface ImageAPIConfigModalProps {
  open: boolean
  onClose: () => void
}

type TabType = 'standing' | 'avatar' | 'cg' | 'promptEnhancer'

const TABS: TabType[] = ['standing', 'avatar', 'cg', 'promptEnhancer']

export function ImageAPIConfigModal({ open, onClose }: ImageAPIConfigModalProps) {
  const { t } = useTranslation('game')
  const [config, setConfig] = useState<ImageAPIConfig>(loadImageAPIConfig)
  const [activeTab, setActiveTab] = useState<TabType>('standing')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setConfig(loadImageAPIConfig())
      setSaved(false)
    }
  }, [open])

  const handleSave = () => {
    saveImageAPIConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateField = (tab: TabType, field: string, value: string) => {
    setConfig(prev => ({
      ...prev,
      [tab]: { ...prev[tab], [field]: value },
    }))
    setSaved(false)
  }

  if (!open) return null

  const currentConfig = config[activeTab]

  const tabLabels: Record<TabType, string> = {
    standing: t('galgame.imageApi.standing'),
    avatar: t('galgame.imageApi.avatar'),
    cg: t('galgame.imageApi.cg'),
    promptEnhancer: t('galgame.imageApi.enhancer'),
  }

  const placeholders: Record<TabType, { endpoint: string; model: string }> = {
    standing: { endpoint: 'https://nano-gpt.com/api/v1/images/generations', model: 'flux-2-max' },
    avatar: { endpoint: 'https://nano-gpt.com/api/v1/images/generations', model: 'flux-2-max' },
    cg: { endpoint: 'https://nano-gpt.com/api/v1/images/generations', model: 'flux-2-max' },
    promptEnhancer: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  }

  const hints: Record<TabType, string> = {
    standing: t('galgame.imageApi.standingHint'),
    avatar: t('galgame.imageApi.avatarHint'),
    cg: t('galgame.imageApi.cgHint'),
    promptEnhancer: t('galgame.imageApi.enhancerHint'),
  }

  return (
    <div className="sprite-manager-overlay" onClick={onClose}>
      <div className="image-api-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sprite-manager-header">
          <h3>{t('galgame.imageApi.title')}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <span className="image-api-saved">{t('galgame.imageApi.saved')}</span>}
            <button className="image-api-save-btn" onClick={handleSave}>
              {t('galgame.imageApi.save')}
            </button>
            <button className="sprite-manager-close" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="sprite-tabs" style={{ margin: '12px 20px 0' }}>
          {TABS.map(tab => (
            <button
              key={tab}
              className={`sprite-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {/* Form */}
        <div className="image-api-form">
          <div className="image-api-field">
            <label>{t('galgame.imageApi.endpoint')}</label>
            <input
              type="text"
              value={currentConfig.endpoint}
              onChange={e => updateField(activeTab, 'endpoint', e.target.value)}
              placeholder={placeholders[activeTab].endpoint}
            />
          </div>

          <div className="image-api-field">
            <label>{t('galgame.imageApi.apiKey')}</label>
            <input
              type="password"
              value={currentConfig.apiKey}
              onChange={e => updateField(activeTab, 'apiKey', e.target.value)}
              placeholder={activeTab === 'promptEnhancer' ? 'sk-...' : 'nano-...'}
            />
          </div>

          <div className="image-api-field">
            <label>{t('galgame.imageApi.model')}</label>
            <input
              type="text"
              value={currentConfig.model}
              onChange={e => updateField(activeTab, 'model', e.target.value)}
              placeholder={placeholders[activeTab].model}
            />
          </div>

          {activeTab !== 'promptEnhancer' && (
            <div className="image-api-field">
              <label>{t('galgame.imageApi.extraParams')}</label>
              <textarea
                className="image-api-textarea"
                value={(currentConfig as any).extraParams || ''}
                onChange={e => updateField(activeTab, 'extraParams', e.target.value)}
                placeholder='{"lora_url_1": "https://civitai.com/api/download/models/..."}'
                rows={3}
              />
            </div>
          )}

          <div className="image-api-hint">
            {hints[activeTab]}
          </div>
        </div>
      </div>
    </div>
  )
}
