/**
 * APIConfigModal - LLM API 配置模态框
 * 支持简单模式（共享 URL/Key + 自动拉取模型）和高级模式（每个模型独立配置）
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { LLMConfig, SetAPIConfigInput } from '../api/types'
import './APIConfigModal.css'

// ─── API 连接测试 ───────────────────────────────────────────────────

export interface EndpointTestResult {
  success: boolean
  latency: number
  error?: string
}


async function testEndpoint(url: string, headers: Record<string, string>, body: object): Promise<EndpointTestResult> {
  const start = performance.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    const latency = Math.round(performance.now() - start)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const msg = (data as any).error?.message || `HTTP ${res.status}`
      return { success: false, latency, error: msg }
    }
    return { success: true, latency }
  } catch (e: any) {
    return { success: false, latency: Math.round(performance.now() - start), error: e.message || 'Network error' }
  }
}

export async function testAPIConnection(baseUrl: string, apiKey: string, model: string): Promise<EndpointTestResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  }
  const base = baseUrl.replace(/\/+$/, '')

  return testEndpoint(`${base}/chat/completions`, headers, {
    model,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 1
  })
}

// ─── Storage ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'llm-api-config'
const MODE_STORAGE_KEY = 'llm-api-config-mode'

export interface APIConfigModalProps {
  isOpen: boolean
  onClose: () => void
  onSave?: (config: SetAPIConfigInput) => void
}

// 默认配置
const defaultConfig: LLMConfig = {
  model: '',
  temperature: 0.7,
  maxTokens: 20480,
  apiKey: '',
  baseUrl: '',
  organizationId: ''
}

// 从 localStorage 加载配置
export function loadAPIConfigFromStorage(): SetAPIConfigInput {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('Failed to load API config from storage:', e)
  }
  return {}
}

// 保存配置到 localStorage
export const API_CONFIG_CHANGED_EVENT = 'api-config-changed'
export function saveAPIConfigToStorage(config: SetAPIConfigInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    window.dispatchEvent(new CustomEvent(API_CONFIG_CHANGED_EVENT))
  } catch (e) {
    console.error('Failed to save API config to storage:', e)
  }
}

// 将配置发送到后端
export async function syncAPIConfigToBackend(): Promise<void> {
  const config = loadAPIConfigFromStorage()
  // 过滤掉空值
  const cleanConfig: SetAPIConfigInput = {}

  const cleanModelConfig = (model?: LLMConfig): LLMConfig | undefined => {
    if (!model) return undefined
    const cleaned: LLMConfig = {}
    if (model.model) cleaned.model = model.model
    if (model.temperature !== undefined) cleaned.temperature = model.temperature
    if (model.maxTokens !== undefined) cleaned.maxTokens = model.maxTokens
    if (model.apiKey) cleaned.apiKey = model.apiKey
    if (model.baseUrl) cleaned.baseUrl = model.baseUrl
    if (model.organizationId) cleaned.organizationId = model.organizationId
    if (model.reasoning && (model.reasoning.effort || model.reasoning.summary)) {
      cleaned.reasoning = {}
      if (model.reasoning.effort) cleaned.reasoning.effort = model.reasoning.effort
      if (model.reasoning.summary) cleaned.reasoning.summary = model.reasoning.summary
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined
  }

  cleanConfig.retrievalModel = cleanModelConfig(config.retrievalModel)
  cleanConfig.generationModel = cleanModelConfig(config.generationModel)
  cleanConfig.updateModel = cleanModelConfig(config.updateModel)

  if (Object.keys(cleanConfig).some(k => cleanConfig[k as keyof SetAPIConfigInput])) {
    try {
      await window.SetAPIConfig(cleanConfig)
      console.log('API config synced to backend')
    } catch (e) {
      console.error('Failed to sync API config to backend:', e)
    }
  }
}

// 从 API 拉取可用模型列表
export async function fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.data || []).map((m: any) => m.id).sort()
}

type ModelType = 'retrievalModel' | 'generationModel' | 'updateModel'
type ConfigMode = 'simple' | 'advanced'

// ─── 自定义模型下拉框 ──────────────────────────────────────────────────
interface ModelComboboxProps {
  value: string
  onChange: (value: string) => void
  models: string[]
  placeholder?: string
}

const ModelCombobox: React.FC<ModelComboboxProps> = ({ value, onChange, models, placeholder }) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 排序：前缀匹配 > 包含匹配 > 其余，各组内保持原序
  const sortedModels = React.useMemo(() => {
    if (!models.length) return []
    const query = value.toLowerCase()
    if (!query) return models
    const prefix: string[] = []
    const contains: string[] = []
    const rest: string[] = []
    for (const m of models) {
      const lower = m.toLowerCase()
      if (lower.startsWith(query)) prefix.push(m)
      else if (lower.includes(query)) contains.push(m)
      else rest.push(m)
    }
    return [...prefix, ...contains, ...rest]
  }, [models, value])

  return (
    <div className="model-combobox" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {models.length > 0 && (
        <button
          type="button"
          className="model-combobox-toggle"
          tabIndex={-1}
          onClick={() => { setOpen(o => !o); inputRef.current?.focus() }}
        >
          ▾
        </button>
      )}
      {open && sortedModels.length > 0 && (
        <ul className="model-combobox-list">
          {sortedModels.map(m => {
            const isPrefix = value && m.toLowerCase().startsWith(value.toLowerCase())
            return (
              <li
                key={m}
                className={`model-combobox-item${m === value ? ' selected' : ''}${isPrefix ? ' prefix-match' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onChange(m); setOpen(false) }}
              >
                {m}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export const APIConfigModal: React.FC<APIConfigModalProps> = ({ isOpen, onClose, onSave }) => {
  const { t } = useTranslation('editor')

  // 模式
  const [configMode, setConfigMode] = useState<ConfigMode>('simple')

  // 高级模式状态（保留原有逻辑）
  const [activeTab, setActiveTab] = useState<ModelType>('generationModel')
  const [config, setConfig] = useState<SetAPIConfigInput>({
    retrievalModel: { ...defaultConfig },
    generationModel: { ...defaultConfig },
    updateModel: { ...defaultConfig }
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  // 简单模式状态
  const [sharedBaseUrl, setSharedBaseUrl] = useState('')
  const [sharedApiKey, setSharedApiKey] = useState('')
  const [sharedTemperature, setSharedTemperature] = useState<number | undefined>(0.7)
  const [sharedMaxTokens, setSharedMaxTokens] = useState<number | undefined>(20480)
  const [simpleModels, setSimpleModels] = useState<{ generation: string; retrieval: string; update: string }>({
    generation: '', retrieval: '', update: ''
  })
  const [simpleReasoningEffort, setSimpleReasoningEffort] = useState<{ generation: string; retrieval: string; update: string }>({
    generation: '', retrieval: '', update: ''
  })

  // 模型拉取状态
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // API 测试状态
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  // 加载配置
  useEffect(() => {
    if (isOpen) {
      const saved = loadAPIConfigFromStorage()
      const gen = saved.generationModel
      const ret = saved.retrievalModel
      const upd = saved.updateModel

      // 判断应该使用哪个模式
      const savedMode = localStorage.getItem(MODE_STORAGE_KEY) as ConfigMode | null
      const hasDifferentUrls = ret?.baseUrl && ret.baseUrl !== gen?.baseUrl ||
                                upd?.baseUrl && upd.baseUrl !== gen?.baseUrl ||
                                ret?.apiKey && ret.apiKey !== gen?.apiKey ||
                                upd?.apiKey && upd.apiKey !== gen?.apiKey
      const mode = savedMode || (hasDifferentUrls ? 'advanced' : 'simple')
      setConfigMode(mode)

      const hasAdvanced = gen?.organizationId || gen?.reasoning?.effort || gen?.reasoning?.summary ||
                          ret?.organizationId || ret?.reasoning?.effort || ret?.reasoning?.summary ||
                          upd?.organizationId || upd?.reasoning?.effort || upd?.reasoning?.summary
      setShowAdvanced(!!hasAdvanced)

      setConfig({
        retrievalModel: saved.retrievalModel || { ...defaultConfig },
        generationModel: saved.generationModel || { ...defaultConfig },
        updateModel: saved.updateModel || { ...defaultConfig }
      })

      // 简单模式状态
      setSharedBaseUrl(gen?.baseUrl || '')
      setSharedApiKey(gen?.apiKey || '')
      setSharedTemperature(gen?.temperature ?? 0.7)
      setSharedMaxTokens(gen?.maxTokens ?? 20480)
      setSimpleModels({
        generation: gen?.model || '',
        retrieval: ret?.model || gen?.model || '',
        update: upd?.model || gen?.model || ''
      })
      setSimpleReasoningEffort({
        generation: gen?.reasoning?.effort || '',
        retrieval: ret?.reasoning?.effort || '',
        update: upd?.reasoning?.effort || ''
      })

      // 重置拉取和测试状态
      setAvailableModels([])
      setFetchError(null)
      setTestResult(null)
      setIsTesting(false)
    }
  }, [isOpen])

  // 高级模式的字段修改
  const handleFieldChange = useCallback((field: keyof LLMConfig, value: any) => {
    setConfig(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], [field]: value }
    }))
  }, [activeTab])

  // 拉取模型列表
  const handleFetchModels = useCallback(async () => {
    if (!sharedBaseUrl || !sharedApiKey) return
    setIsFetchingModels(true)
    setFetchError(null)
    try {
      const models = await fetchAvailableModels(sharedBaseUrl, sharedApiKey)
      setAvailableModels(models)
    } catch (e: any) {
      setFetchError(e.message || 'Unknown error')
    } finally {
      setIsFetchingModels(false)
    }
  }, [sharedBaseUrl, sharedApiKey])

  // 测试 API 连接
  const handleTestConnection = useCallback(async () => {
    const advCfg = config[activeTab]
    const url = configMode === 'simple' ? sharedBaseUrl : (advCfg?.baseUrl || '')
    const key = configMode === 'simple' ? sharedApiKey : (advCfg?.apiKey || '')
    const model = configMode === 'simple' ? simpleModels.generation : (advCfg?.model || '')
    if (!url || !key || !model) return

    setIsTesting(true)
    setTestResult(null)
    try {
      const result = await testAPIConnection(url, key, model)
      setTestResult(result)
    } finally {
      setIsTesting(false)
    }
  }, [configMode, sharedBaseUrl, sharedApiKey, simpleModels.generation, config, activeTab])

  // 模式切换
  const handleModeSwitch = useCallback((newMode: ConfigMode) => {
    if (newMode === configMode) return

    if (newMode === 'advanced') {
      // 简单 → 高级：同步简单模式的值到 config
      const shared: LLMConfig = {
        baseUrl: sharedBaseUrl,
        apiKey: sharedApiKey,
        temperature: sharedTemperature,
        maxTokens: sharedMaxTokens
      }
      const mkReasoning = (effort: string): LLMConfig['reasoning'] | undefined =>
        effort ? { effort: effort as any } : undefined
      setConfig({
        generationModel: { ...shared, model: simpleModels.generation, reasoning: mkReasoning(simpleReasoningEffort.generation) },
        retrievalModel: { ...shared, model: simpleModels.retrieval, reasoning: mkReasoning(simpleReasoningEffort.retrieval) },
        updateModel: { ...shared, model: simpleModels.update, reasoning: mkReasoning(simpleReasoningEffort.update) }
      })
    } else {
      // 高级 → 简单：从 generationModel 提取共享值
      const gen = config.generationModel
      setSharedBaseUrl(gen?.baseUrl || '')
      setSharedApiKey(gen?.apiKey || '')
      setSharedTemperature(gen?.temperature ?? 0.7)
      setSharedMaxTokens(gen?.maxTokens ?? 20480)
      setSimpleModels({
        generation: gen?.model || '',
        retrieval: config.retrievalModel?.model || gen?.model || '',
        update: config.updateModel?.model || gen?.model || ''
      })
      setSimpleReasoningEffort({
        generation: gen?.reasoning?.effort || '',
        retrieval: config.retrievalModel?.reasoning?.effort || '',
        update: config.updateModel?.reasoning?.effort || ''
      })
    }

    setConfigMode(newMode)
  }, [configMode, sharedBaseUrl, sharedApiKey, sharedTemperature, sharedMaxTokens, simpleModels, simpleReasoningEffort, config])

  // 保存
  const handleSave = useCallback(async () => {
    let finalConfig: SetAPIConfigInput

    if (configMode === 'simple') {
      const shared: Partial<LLMConfig> = {
        baseUrl: sharedBaseUrl,
        apiKey: sharedApiKey,
        temperature: sharedTemperature,
        maxTokens: sharedMaxTokens
      }
      const mkReasoning = (effort: string): LLMConfig['reasoning'] | undefined =>
        effort ? { effort: effort as any } : undefined
      finalConfig = {
        generationModel: { ...shared, model: simpleModels.generation, reasoning: mkReasoning(simpleReasoningEffort.generation) },
        retrievalModel: { ...shared, model: simpleModels.retrieval || simpleModels.generation, reasoning: mkReasoning(simpleReasoningEffort.retrieval) },
        updateModel: { ...shared, model: simpleModels.update || simpleModels.generation, reasoning: mkReasoning(simpleReasoningEffort.update) }
      }
    } else {
      // 高级模式
      finalConfig = config
    }

    saveAPIConfigToStorage(finalConfig)
    localStorage.setItem(MODE_STORAGE_KEY, configMode)

    await syncAPIConfigToBackend()

    onSave?.(finalConfig)
    onClose()
  }, [config, configMode, sharedBaseUrl, sharedApiKey, sharedTemperature, sharedMaxTokens, simpleModels, simpleReasoningEffort, onSave, onClose])

  // 导出配置
  const handleExport = useCallback(() => {
    const dataStr = JSON.stringify(config, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'api-config.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [config])

  // 导入配置
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const imported = JSON.parse(text) as SetAPIConfigInput
        if (imported.generationModel || imported.retrievalModel || imported.updateModel) {
          setConfig({
            retrievalModel: imported.retrievalModel || { ...defaultConfig },
            generationModel: imported.generationModel || { ...defaultConfig },
            updateModel: imported.updateModel || { ...defaultConfig }
          })
          // 同步到简单模式
          const gen = imported.generationModel
          setSharedBaseUrl(gen?.baseUrl || '')
          setSharedApiKey(gen?.apiKey || '')
          setSharedTemperature(gen?.temperature ?? 0.7)
          setSharedMaxTokens(gen?.maxTokens ?? 20480)
          setSimpleModels({
            generation: gen?.model || '',
            retrieval: imported.retrievalModel?.model || gen?.model || '',
            update: imported.updateModel?.model || gen?.model || ''
          })
          setSimpleReasoningEffort({
            generation: gen?.reasoning?.effort || '',
            retrieval: imported.retrievalModel?.reasoning?.effort || '',
            update: imported.updateModel?.reasoning?.effort || ''
          })

          alert(t('apiConfig.importSuccess'))
        } else {
          alert(t('apiConfig.importInvalid'))
        }
      } catch (err) {
        alert(t('apiConfig.importFailed'))
      }
    }
    reader.readAsText(file)

    if (importInputRef.current) {
      importInputRef.current.value = ''
    }
  }, [t])

  const currentConfig = config[activeTab]

  if (!isOpen) return null

  const tabs: { key: ModelType; label: string; icon: string; descKey: string }[] = [
    { key: 'retrievalModel', label: t('apiConfig.retrievalModel'), icon: '🔍', descKey: 'retrievalModelDesc' },
    { key: 'updateModel', label: t('apiConfig.updateModel'), icon: '🔄', descKey: 'updateModelDesc' },
    { key: 'generationModel', label: t('apiConfig.generationModel'), icon: '✨', descKey: 'generationModelDesc' },
  ]

  const modelSelectorEntries: { key: 'generation' | 'retrieval' | 'update'; icon: string; labelKey: string }[] = [
    { key: 'retrieval', icon: '🔍', labelKey: 'apiConfig.retrievalModel' },
    { key: 'update', icon: '🔄', labelKey: 'apiConfig.updateModel' },
    { key: 'generation', icon: '✨', labelKey: 'apiConfig.generationModel' },
  ]

  return (
    <div className="paper-editor paper-modal-overlay">
      <div className="paper-modal" style={{ width: '650px' }}>
        <div className="paper-modal-header">
          <h3>
            <span className="paper-modal-icon">⚙️</span>
            {t('apiConfig.title')}
          </h3>
          <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <button
              className="btn-import-export"
              onClick={() => importInputRef.current?.click()}
              title={t('apiConfig.importTitle')}
            >
              📥 {t('apiConfig.import')}
            </button>
            <button
              className="btn-import-export"
              onClick={handleExport}
              title={t('apiConfig.exportTitle')}
            >
              📤 {t('apiConfig.export')}
            </button>
            <button className="btn-save-header" onClick={handleSave}>💾 {t('apiConfig.save')}</button>
            <button className="paper-modal-close" onClick={onClose} style={{ marginLeft: '12px' }}>✕</button>
          </div>
        </div>

        <div className="paper-modal-body">
          {/* 模式切换 */}
          <div className="config-mode-toggle">
            <button
              className={`mode-btn ${configMode === 'simple' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('simple')}
            >
              {t('apiConfig.simpleMode')}
            </button>
            <button
              className={`mode-btn ${configMode === 'advanced' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('advanced')}
            >
              {t('apiConfig.advancedMode')}
            </button>
          </div>

          {configMode === 'simple' ? (
            /* ==================== 简单模式 ==================== */
            <div className="config-form">
              {/* 共享 BaseURL + API Key */}
              <div className="form-row">
                <div className="form-group">
                  <label>API Base URL</label>
                  <input
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    value={sharedBaseUrl}
                    onChange={(e) => { setSharedBaseUrl(e.target.value); setAvailableModels([]); setFetchError(null) }}
                  />
                </div>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={sharedApiKey}
                    onChange={(e) => { setSharedApiKey(e.target.value); setAvailableModels([]); setFetchError(null) }}
                  />
                </div>
              </div>

              {/* 获取模型 + 测试连接 */}
              <div className="fetch-models-row">
                <button
                  className="fetch-btn"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels || !sharedBaseUrl || !sharedApiKey}
                >
                  {isFetchingModels ? t('apiConfig.fetchingModels') : t('apiConfig.fetchModels')}
                </button>
                <button
                  className="fetch-btn test-btn"
                  onClick={handleTestConnection}
                  disabled={isTesting || !sharedBaseUrl || !sharedApiKey || !simpleModels.generation}
                >
                  {isTesting ? t('apiConfig.testing') : `🔌 ${t('apiConfig.testConnection')}`}
                </button>
                {availableModels.length > 0 && (
                  <span className="model-count-hint">
                    {t('apiConfig.fetchSuccess', { count: availableModels.length })}
                  </span>
                )}
                {fetchError && (
                  <span className="fetch-error-hint">
                    {t('apiConfig.fetchFailed', { error: fetchError })}
                  </span>
                )}
              </div>
              {testResult && (
                <div className="test-results">
                  <div className={`test-item ${testResult.success ? 'success' : 'fail'}`}>
                    {testResult.success ? '✅' : '❌'} Chat Completions
                    <span className="test-latency">{testResult.latency}ms</span>
                    {testResult.error && <span className="test-error" title={testResult.error}>{testResult.error}</span>}
                  </div>
                </div>
              )}

              {/* 三个模型选择器 */}
              <div className="model-selectors">
                {modelSelectorEntries.map(entry => (
                  <div key={entry.key} className="form-group model-selector-group">
                    <label><span className="model-selector-icon">{entry.icon}</span> {t(entry.labelKey)}</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <ModelCombobox
                        models={availableModels}
                        placeholder={t('apiConfig.selectModel')}
                        value={simpleModels[entry.key]}
                        onChange={(v) => setSimpleModels(prev => ({ ...prev, [entry.key]: v }))}
                      />
                      <select
                        className="reasoning-effort-select"
                        value={simpleReasoningEffort[entry.key]}
                        onChange={(e) => setSimpleReasoningEffort(prev => ({ ...prev, [entry.key]: e.target.value }))}
                        title={t('apiConfig.reasoningEffort')}
                      >
                        <option value="">🧠 —</option>
                        <option value="none">none</option>
                        <option value="minimal">minimal</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              {/* 模型推荐 */}
              <details className="model-recommendations">
                <summary className="recommendations-toggle">
                  💡 {t('apiConfig.modelRecommendations')}
                </summary>
                <div className="recommendations-content">
                  <div className="rec-section">
                    <div className="rec-title">🔍🔄 {t('apiConfig.retrievalModel')} / {t('apiConfig.updateModel')}</div>
                    <p className="rec-desc">{t('apiConfig.recRetrievalDesc')}</p>
                    <div className="rec-models">
                      {['google/gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite-preview', 'x-ai/grok-4-fast'].map(m => (
                        <button key={m} className="rec-model-chip" onClick={() => {
                          setSimpleModels(prev => ({ ...prev, retrieval: m, update: m }))
                        }}>{m}</button>
                      ))}
                    </div>
                    <p className="rec-note">{t('apiConfig.recRetrievalNote')}</p>
                  </div>
                  <div className="rec-section">
                    <div className="rec-title">✨ {t('apiConfig.generationModel')}</div>
                    <p className="rec-desc">{t('apiConfig.recGenerationDesc')}</p>
                    <div className="rec-models">
                      {['deepseek/deepseek-v3.2', 'z-ai/glm-4.7', 'z-ai/glm-5', 'moonshotai/kimi-k2.5', 'xiaomi/mimo-v2-pro'].map(m => (
                        <button key={m} className="rec-model-chip" onClick={() => {
                          setSimpleModels(prev => ({ ...prev, generation: m }))
                        }}>{m}</button>
                      ))}
                    </div>
                    <div className="rec-models">
                      {['google/gemini-3.1-pro-preview', 'anthropic/claude-sonnet-4.6'].map(m => (
                        <button key={m} className="rec-model-chip premium" onClick={() => {
                          setSimpleModels(prev => ({ ...prev, generation: m }))
                        }}>{m}</button>
                      ))}
                    </div>
                    <p className="rec-note">{t('apiConfig.recGenerationNote')}</p>
                  </div>
                  <p className="rec-footnote">{t('apiConfig.recFootnote')}</p>
                </div>
              </details>

              {/* 共享参数 */}
              <div className="form-row">
                <div className="form-group">
                  <label>Temperature</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    placeholder="0.7"
                    value={sharedTemperature ?? ''}
                    onChange={(e) => setSharedTemperature(e.target.value ? parseFloat(e.target.value) : undefined)}
                  />
                </div>
                <div className="form-group">
                  <label>Max Tokens</label>
                  <input
                    type="number"
                    min="1"
                    max="128000"
                    step="256"
                    placeholder="20480"
                    value={sharedMaxTokens ?? ''}
                    onChange={(e) => setSharedMaxTokens(e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* ==================== 高级模式 ==================== */
            <>
              {/* 模型选择标签页 */}
              <div className="model-tabs">
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    className={`model-tab ${activeTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <span className="tab-icon">{tab.icon}</span>
                    <span className="tab-label">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* 当前模型描述 */}
              <div className="model-desc">
                {t(`apiConfig.${tabs.find(tab => tab.key === activeTab)?.descKey}`)}
              </div>

              {/* 配置表单 */}
              <div className="config-form">
                <div className="form-row-3">
                  <div className="form-group">
                    <label>API Base URL</label>
                    <input
                      type="text"
                      placeholder="https://api.openai.com/v1"
                      value={currentConfig?.baseUrl || ''}
                      onChange={(e) => handleFieldChange('baseUrl', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>API Key</label>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={currentConfig?.apiKey || ''}
                      onChange={(e) => handleFieldChange('apiKey', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>{t('apiConfig.modelName')}</label>
                    <input
                      type="text"
                      placeholder="gpt-4o-mini"
                      value={currentConfig?.model || ''}
                      onChange={(e) => handleFieldChange('model', e.target.value)}
                    />
                  </div>
                </div>

                {/* 测试连接 */}
                <div className="fetch-models-row">
                  <button
                    className="fetch-btn test-btn"
                    onClick={handleTestConnection}
                    disabled={isTesting || !currentConfig?.baseUrl || !currentConfig?.apiKey || !currentConfig?.model}
                  >
                    {isTesting ? t('apiConfig.testing') : `🔌 ${t('apiConfig.testConnection')}`}
                  </button>
                </div>
                {testResult && (
                  <div className="test-results">
                    <div className={`test-item ${testResult.success ? 'success' : 'fail'}`}>
                      {testResult.success ? '✅' : '❌'} Chat Completions
                      <span className="test-latency">{testResult.latency}ms</span>
                      {testResult.error && <span className="test-error" title={testResult.error}>{testResult.error}</span>}
                    </div>
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label>Temperature</label>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="0.7"
                      value={currentConfig?.temperature ?? ''}
                      onChange={(e) => handleFieldChange('temperature', e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Max Tokens</label>
                    <input
                      type="number"
                      min="1"
                      max="128000"
                      step="256"
                      placeholder="20480"
                      value={currentConfig?.maxTokens ?? ''}
                      onChange={(e) => handleFieldChange('maxTokens', e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                  </div>
                </div>

                {/* 高级选项折叠区 */}
                <button
                  className="advanced-toggle"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? '▼' : '▶'} {t('apiConfig.advancedOptions')}
                </button>

                {showAdvanced && (
                  <div className="advanced-options">
                    <div className="form-row">
                      <div className="form-group">
                        <label>Organization ID</label>
                        <input
                          type="text"
                          placeholder="org-..."
                          value={currentConfig?.organizationId || ''}
                          onChange={(e) => handleFieldChange('organizationId', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Reasoning 配置 */}
                    <div className="form-row">
                      <div className="form-group">
                        <label>🧠 {t('apiConfig.reasoningEffort')}</label>
                        <select
                          value={currentConfig?.reasoning?.effort || ''}
                          onChange={(e) => {
                            const newReasoning = { ...currentConfig?.reasoning, effort: e.target.value || undefined }
                            if (!newReasoning.effort && !newReasoning.summary) {
                              handleFieldChange('reasoning', undefined)
                            } else {
                              handleFieldChange('reasoning', newReasoning)
                            }
                          }}
                        >
                          <option value="">{t('apiConfig.defaultOption')}</option>
                          <option value="none">none</option>
                          <option value="minimal">minimal</option>
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>🧠 {t('apiConfig.reasoningSummary')}</label>
                        <select
                          value={currentConfig?.reasoning?.summary || ''}
                          onChange={(e) => {
                            const newReasoning = { ...currentConfig?.reasoning, summary: e.target.value || undefined }
                            if (!newReasoning.effort && !newReasoning.summary) {
                              handleFieldChange('reasoning', undefined)
                            } else {
                              handleFieldChange('reasoning', newReasoning)
                            }
                          }}
                        >
                          <option value="">{t('apiConfig.defaultOption')}</option>
                          <option value="auto">auto</option>
                          <option value="concise">concise</option>
                          <option value="detailed">detailed</option>
                        </select>
                      </div>
                    </div>
                    <span className="hint">{t('apiConfig.reasoningHint')}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default APIConfigModal
