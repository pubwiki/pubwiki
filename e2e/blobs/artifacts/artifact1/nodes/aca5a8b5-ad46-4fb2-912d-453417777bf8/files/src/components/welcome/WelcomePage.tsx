/**
 * WelcomePage - Full-screen onboarding for first-time users
 *
 * Step 1: API configuration (baseUrl + apiKey + model)
 * Step 2: Choose starting point (lorebook / files / idea) + input + launch WorldBuilder
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { LLMConfig, SetAPIConfigInput, UploadedFile } from '../../api/types'
import type { LorebookData } from '../../api/worldBuilderNextTypes'
import { parseSillyTavernLorebook } from '../../api/lorebookParser'
import {
    loadAPIConfigFromStorage,
    saveAPIConfigToStorage,
    syncAPIConfigToBackend,
    fetchAvailableModels,
    testAPIConnection,
    type EndpointTestResult,
} from '../APIConfigModal'
import { useFileStore } from '../../stores/fileStore'
import { useLorebookStore } from '../../stores/lorebookStore'
import LanguageSelector from '../../i18n/LanguageSelector'
import './WelcomePage.css'

// ─── Types ──────────────────────────────────────────────────────────────

export interface WelcomePageProps {
    onComplete: (result: WelcomeResult) => void
    onSkip: () => void
}

export interface WelcomeResult {
    startingPoint: 'lorebook' | 'files' | 'idea'
    prompt: string
}

type WelcomeStep = 'api-config' | 'starting-point'
type StartingPoint = 'lorebook' | 'files' | 'idea' | null

// ─── Inline Model Combobox (simplified) ─────────────────────────────────

const SimpleModelCombobox: React.FC<{
    value: string
    onChange: (v: string) => void
    models: string[]
    placeholder?: string
}> = ({ value, onChange, models, placeholder }) => {
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    const filtered = useMemo(() => {
        if (!models.length) return []
        const q = value.toLowerCase()
        if (!q) return models
        return models.filter(m => m.toLowerCase().includes(q))
    }, [models, value])

    return (
        <div className="model-combobox" ref={containerRef} style={{ flex: 1 }}>
            <input
                type="text"
                placeholder={placeholder}
                value={value}
                onChange={e => { onChange(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
            />
            {models.length > 0 && (
                <button
                    type="button"
                    className="model-combobox-toggle"
                    tabIndex={-1}
                    onClick={() => setOpen(o => !o)}
                >
                    ▾
                </button>
            )}
            {open && filtered.length > 0 && (
                <ul className="model-combobox-list">
                    {filtered.map(m => (
                        <li
                            key={m}
                            className={`model-combobox-item${m === value ? ' selected' : ''}`}
                            onMouseDown={e => { e.preventDefault(); onChange(m); setOpen(false) }}
                        >
                            {m}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ─── Main Component ─────────────────────────────────────────────────────

const WelcomePage: React.FC<WelcomePageProps> = ({ onComplete, onSkip }) => {
    const { t } = useTranslation('editor')

    // Pre-load existing API config (for returning users)
    const existingConfig = useMemo(() => loadAPIConfigFromStorage(), [])
    const hasExistingConfig = !!(existingConfig.generationModel?.apiKey && existingConfig.generationModel?.baseUrl)

    // Wizard step — skip API config if already configured
    const [step, setStep] = useState<WelcomeStep>(hasExistingConfig ? 'starting-point' : 'api-config')

    // ── Step 1: API Config State (pre-fill from existing config) ──
    const [baseUrl, setBaseUrl] = useState(existingConfig.generationModel?.baseUrl || '')
    const [apiKey, setApiKey] = useState(existingConfig.generationModel?.apiKey || '')
    const [model, setModel] = useState(existingConfig.generationModel?.model || '')
    const [secondaryModel, setSecondaryModel] = useState(existingConfig.retrievalModel?.model || '')
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [isFetching, setIsFetching] = useState(false)
    const [testResult, setTestResult] = useState<EndpointTestResult | null>(null)
    const [isTesting, setIsTesting] = useState(false)

    const apiConfigInputRef = useRef<HTMLInputElement>(null)

    const handleImportAPIConfig = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target?.result as string) as SetAPIConfigInput
                if (imported.generationModel || imported.retrievalModel || imported.updateModel) {
                    const gen = imported.generationModel
                    setBaseUrl(gen?.baseUrl || '')
                    setApiKey(gen?.apiKey || '')
                    setModel(gen?.model || '')
                    setSecondaryModel(imported.retrievalModel?.model || gen?.model || '')
                    // Also save to storage immediately so it persists
                    saveAPIConfigToStorage(imported)
                } else {
                    alert(t('apiConfig.importInvalid'))
                }
            } catch {
                alert(t('apiConfig.importFailed'))
            }
        }
        reader.readAsText(file)
        e.target.value = ''
    }, [t])

    const canProceedStep1 = baseUrl.trim() && apiKey.trim() && model.trim()

    const handleFetchModels = useCallback(async () => {
        if (!baseUrl.trim() || !apiKey.trim()) return
        setIsFetching(true)
        try {
            const models = await fetchAvailableModels(baseUrl.trim(), apiKey.trim())
            setAvailableModels(models)
        } catch (e: any) {
            console.error('Failed to fetch models:', e)
        } finally {
            setIsFetching(false)
        }
    }, [baseUrl, apiKey])

    const handleTestConnection = useCallback(async () => {
        if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) return
        setIsTesting(true)
        setTestResult(null)
        try {
            const result = await testAPIConnection(baseUrl.trim(), apiKey.trim(), model.trim())
            setTestResult(result)
        } catch (e: any) {
            setTestResult({ success: false, latency: 0, error: e.message })
        } finally {
            setIsTesting(false)
        }
    }, [baseUrl, apiKey, model])

    const handleStep1Next = useCallback(async () => {
        if (!canProceedStep1) return
        const shared: LLMConfig = {
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            temperature: 0.7,
            maxTokens: 20480,
        }
        const primary: LLMConfig = { ...shared, model: model.trim() }
        const secondary: LLMConfig = { ...shared, model: secondaryModel.trim() || model.trim() }
        const config: SetAPIConfigInput = {
            generationModel: primary,
            retrievalModel: secondary,
            updateModel: secondary,
        }
        saveAPIConfigToStorage(config)
        await syncAPIConfigToBackend().catch(() => {})
        setStep('starting-point')
    }, [canProceedStep1, baseUrl, apiKey, model, secondaryModel])

    // ── Step 2: Starting Point State ──
    const [selectedPoint, setSelectedPoint] = useState<StartingPoint>(null)
    const [prompt, setPrompt] = useState('')
    const [lorebookError, setLorebookError] = useState('')

    // File/Lorebook stores
    const storeFiles = useFileStore(s => s.files)
    const storeAddFile = useFileStore(s => s.addFile)
    const storeRemoveFile = useFileStore(s => s.removeFile)
    const storeLorebooks = useLorebookStore(s => s.lorebooks)
    const storeAddLorebook = useLorebookStore(s => s.addLorebook)
    const storeRemoveLorebook = useLorebookStore(s => s.removeLorebook)

    const initFiles = useFileStore(s => s.initFiles)
    const initLorebooks = useLorebookStore(s => s.initLorebooks)
    useEffect(() => { initFiles(); initLorebooks() }, [initFiles, initLorebooks])

    const fileInputRef = useRef<HTMLInputElement>(null)
    const lorebookInputRef = useRef<HTMLInputElement>(null)

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files
        if (!fileList) return
        Array.from(fileList).forEach(file => {
            const reader = new FileReader()
            reader.onload = () => {
                const content = reader.result as string
                const ext = file.name.split('.').pop()?.toLowerCase() || ''
                const typeMap: Record<string, UploadedFile['type']> = {
                    md: 'md', json: 'json', txt: 'txt',
                    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
                }
                storeAddFile({
                    name: file.name,
                    content,
                    type: typeMap[ext] || 'txt',
                    size: file.size,
                    uploadedAt: Date.now(),
                })
            }
            reader.readAsText(file)
        })
        e.target.value = ''
    }, [storeAddFile])

    const handleLorebookUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files
        if (!fileList) return
        setLorebookError('')
        Array.from(fileList).forEach(file => {
            const reader = new FileReader()
            reader.onload = () => {
                try {
                    const json = JSON.parse(reader.result as string)
                    const parsed = parseSillyTavernLorebook(json, file.name)
                    if (!parsed) {
                        setLorebookError(t('welcome.lorebookParseError'))
                        return
                    }
                    storeAddLorebook(parsed)
                } catch {
                    setLorebookError(t('welcome.lorebookParseError'))
                }
            }
            reader.readAsText(file)
        })
        e.target.value = ''
    }, [storeAddLorebook, t])

    const canStartBuilding = (() => {
        if (!selectedPoint) return false
        if (selectedPoint === 'lorebook') return storeLorebooks.length > 0
        if (selectedPoint === 'files') return storeFiles.length > 0
        if (selectedPoint === 'idea') return prompt.trim().length > 0
        return false
    })()

    const handleStartBuilding = useCallback(() => {
        if (!selectedPoint || !canStartBuilding) return

        // Build prompt with upload markers so the LLM knows what was uploaded
        const parts: string[] = []

        if (selectedPoint === 'lorebook') {
            for (const lb of storeLorebooks) {
                parts.push(`[Uploaded Lorebook] ${lb.name} (${lb.entries.length} entries, ${(lb.totalChars / 1000).toFixed(0)}K chars)`)
            }
        } else if (selectedPoint === 'files') {
            for (const f of storeFiles) {
                parts.push(`[Uploaded File] ${f.name}`)
            }
        }

        if (prompt.trim()) {
            parts.push(prompt.trim())
        } else if (selectedPoint !== 'idea') {
            parts.push(t('welcome.defaultPrompt'))
        }

        onComplete({ startingPoint: selectedPoint, prompt: parts.join('\n') })
    }, [selectedPoint, canStartBuilding, prompt, storeLorebooks, storeFiles, onComplete, t])

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes}B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    }

    // ─── Render ───

    return (
        <div className="welcome-overlay paper-editor">
            <div className="welcome-lang-selector">
                <LanguageSelector />
            </div>
            <div className="welcome-container">
                {/* Step indicator */}
                <div className="welcome-steps">
                    <div className={`welcome-step-dot ${step === 'api-config' ? 'active' : 'completed'}`} />
                    <div className={`welcome-step-dot ${step === 'starting-point' ? 'active' : ''}`} />
                </div>

                {/* ────────── Step 1: API Config ────────── */}
                {step === 'api-config' && (
                    <>
                        <div className="welcome-header">
                            <h1 className="welcome-title">{t('welcome.title')}</h1>
                            <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
                        </div>

                        <div className="welcome-api-form">
                            <div className="welcome-form-row">
                                <div className="welcome-form-group">
                                    <label>{t('welcome.baseUrlLabel')}</label>
                                    <input
                                        type="text"
                                        value={baseUrl}
                                        onChange={e => setBaseUrl(e.target.value)}
                                        placeholder={t('welcome.baseUrlPlaceholder')}
                                    />
                                </div>
                                <div className="welcome-form-group">
                                    <label>{t('welcome.apiKeyLabel')}</label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={e => setApiKey(e.target.value)}
                                        placeholder={t('welcome.apiKeyPlaceholder')}
                                    />
                                </div>
                            </div>

                            <div className="welcome-form-group">
                                <label>{t('welcome.secondaryModelLabel')}</label>
                                <div className="welcome-model-row">
                                    <SimpleModelCombobox
                                        value={secondaryModel}
                                        onChange={setSecondaryModel}
                                        models={availableModels}
                                        placeholder={t('welcome.secondaryModelPlaceholder')}
                                    />
                                    <button
                                        className="welcome-btn-secondary"
                                        onClick={handleFetchModels}
                                        disabled={isFetching || !baseUrl.trim() || !apiKey.trim()}
                                    >
                                        {isFetching ? t('welcome.fetchingModels') : t('welcome.fetchModels')}
                                    </button>
                                </div>
                            </div>

                            <div className="welcome-form-group">
                                <label>{t('welcome.primaryModelLabel')}</label>
                                <div className="welcome-model-row">
                                    <SimpleModelCombobox
                                        value={model}
                                        onChange={setModel}
                                        models={availableModels}
                                        placeholder={t('welcome.primaryModelPlaceholder')}
                                    />
                                </div>
                            </div>

                            {/* 模型推荐 */}
                            <details className="model-recommendations welcome-recommendations">
                                <summary className="recommendations-toggle">
                                    💡 {t('apiConfig.modelRecommendations')}
                                </summary>
                                <div className="recommendations-content">
                                    <div className="rec-section">
                                        <div className="rec-title">🔍🔄 {t('welcome.secondaryModelLabel')}</div>
                                        <p className="rec-desc">{t('apiConfig.recRetrievalDesc')}</p>
                                        <div className="rec-models">
                                            {['google/gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite-preview', 'x-ai/grok-4-fast'].map(m => (
                                                <button key={m} className="rec-model-chip" onClick={() => setSecondaryModel(m)}>{m}</button>
                                            ))}
                                        </div>
                                        <p className="rec-note">{t('apiConfig.recRetrievalNote')}</p>
                                    </div>
                                    <div className="rec-section">
                                        <div className="rec-title">✨ {t('welcome.primaryModelLabel')}</div>
                                        <p className="rec-desc">{t('apiConfig.recGenerationDesc')}</p>
                                        <div className="rec-models">
                                            {['deepseek/deepseek-v3.2', 'z-ai/glm-4.7', 'z-ai/glm-5', 'moonshotai/kimi-k2.5', 'xiaomi/mimo-v2-pro'].map(m => (
                                                <button key={m} className="rec-model-chip" onClick={() => setModel(m)}>{m}</button>
                                            ))}
                                        </div>
                                        <div className="rec-models">
                                            {['google/gemini-3.1-pro-preview', 'anthropic/claude-sonnet-4.6'].map(m => (
                                                <button key={m} className="rec-model-chip premium" onClick={() => setModel(m)}>{m}</button>
                                            ))}
                                        </div>
                                        <p className="rec-note">{t('apiConfig.recGenerationNote')}</p>
                                    </div>
                                    <p className="rec-footnote">{t('apiConfig.recFootnote')}</p>
                                </div>
                            </details>

                            {/* Test connection + Import config */}
                            <div className="welcome-btn-row" style={{ justifyContent: 'flex-start' }}>
                                <button
                                    className="welcome-btn-secondary"
                                    onClick={handleTestConnection}
                                    disabled={isTesting || !canProceedStep1}
                                >
                                    {isTesting ? t('welcome.testing') : t('welcome.testConnection')}
                                </button>
                                <input
                                    ref={apiConfigInputRef}
                                    type="file"
                                    accept=".json"
                                    style={{ display: 'none' }}
                                    onChange={handleImportAPIConfig}
                                />
                                <button
                                    className="welcome-btn-secondary"
                                    onClick={() => apiConfigInputRef.current?.click()}
                                >
                                    📥 {t('welcome.importConfig')}
                                </button>
                                {testResult && (
                                    <div className={`welcome-test-result ${testResult.success ? 'success' : 'error'}`}>
                                        {testResult.success
                                            ? t('welcome.testSuccess', { latency: testResult.latency })
                                            : t('welcome.testFailed', { error: testResult.error })
                                        }
                                    </div>
                                )}
                            </div>

                            {/* Next button */}
                            <div className="welcome-btn-row">
                                <button
                                    className="welcome-btn-primary"
                                    onClick={handleStep1Next}
                                    disabled={!canProceedStep1}
                                >
                                    {t('welcome.nextStep')}
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* ────────── Step 2: Starting Point ────────── */}
                {step === 'starting-point' && (
                    <>
                        <button className="welcome-back" onClick={() => setStep('api-config')}>
                            ← {t('welcome.back')}
                        </button>

                        <div className="welcome-header">
                            <h1 className="welcome-title">{t('welcome.step2Title')}</h1>
                            <p className="welcome-subtitle">{t('welcome.step2Subtitle')}</p>
                        </div>

                        {/* Three cards */}
                        <div className="welcome-cards-grid">
                            <button
                                className={`welcome-card ${selectedPoint === 'lorebook' ? 'selected' : ''}`}
                                onClick={() => setSelectedPoint('lorebook')}
                            >
                                <div className="welcome-card-icon">📖</div>
                                <h4>{t('welcome.optionLorebook')}</h4>
                                <p>{t('welcome.optionLorebookDesc')}</p>
                            </button>
                            <button
                                className={`welcome-card ${selectedPoint === 'files' ? 'selected' : ''}`}
                                onClick={() => setSelectedPoint('files')}
                            >
                                <div className="welcome-card-icon">📁</div>
                                <h4>{t('welcome.optionFiles')}</h4>
                                <p>{t('welcome.optionFilesDesc')}</p>
                            </button>
                            <button
                                className={`welcome-card ${selectedPoint === 'idea' ? 'selected' : ''}`}
                                onClick={() => setSelectedPoint('idea')}
                            >
                                <div className="welcome-card-icon">💡</div>
                                <h4>{t('welcome.optionIdea')}</h4>
                                <p>{t('welcome.optionIdeaDesc')}</p>
                            </button>
                        </div>

                        {/* Input area based on selection */}
                        {selectedPoint && (
                            <div className="welcome-input-area">
                                {/* Lorebook upload */}
                                {selectedPoint === 'lorebook' && (
                                    <>
                                        <input
                                            ref={lorebookInputRef}
                                            type="file"
                                            accept=".json"
                                            multiple
                                            style={{ display: 'none' }}
                                            onChange={handleLorebookUpload}
                                        />
                                        {storeLorebooks.length === 0 ? (
                                            <div
                                                className="welcome-upload-zone"
                                                onClick={() => lorebookInputRef.current?.click()}
                                            >
                                                <div className="welcome-upload-zone-text">
                                                    📖 {t('welcome.lorebookUpload')}
                                                </div>
                                                <div className="welcome-upload-zone-hint">
                                                    {t('welcome.lorebookHint')}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="welcome-file-list">
                                                {storeLorebooks.map(lb => (
                                                    <div key={lb.filename} className="welcome-lorebook-summary">
                                                        <div className="welcome-lorebook-info">
                                                            <span className="welcome-lorebook-name">📖 {lb.name}</span>
                                                            <span className="welcome-lorebook-meta">
                                                                {lb.entries.length} entries · {(lb.totalChars / 1000).toFixed(0)}K chars
                                                            </span>
                                                        </div>
                                                        <button
                                                            className="welcome-file-remove"
                                                            onClick={() => storeRemoveLorebook(lb.filename)}
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    className="welcome-btn-secondary"
                                                    style={{ alignSelf: 'flex-start' }}
                                                    onClick={() => lorebookInputRef.current?.click()}
                                                >
                                                    + {t('welcome.addMore')}
                                                </button>
                                            </div>
                                        )}
                                        {lorebookError && <div className="welcome-error">{lorebookError}</div>}
                                        <div className="welcome-form-group" style={{ marginTop: 'var(--paper-space-4)' }}>
                                            <label>{t('welcome.additionalContext')}</label>
                                            <textarea
                                                value={prompt}
                                                onChange={e => setPrompt(e.target.value)}
                                                placeholder={t('welcome.additionalContextPlaceholder')}
                                            />
                                        </div>
                                    </>
                                )}

                                {/* File upload */}
                                {selectedPoint === 'files' && (
                                    <>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".md,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.svg"
                                            multiple
                                            style={{ display: 'none' }}
                                            onChange={handleFileUpload}
                                        />
                                        {storeFiles.length === 0 ? (
                                            <div
                                                className="welcome-upload-zone"
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                <div className="welcome-upload-zone-text">
                                                    📁 {t('welcome.filesUpload')}
                                                </div>
                                                <div className="welcome-upload-zone-hint">
                                                    {t('welcome.filesAccepted')}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="welcome-file-list">
                                                {storeFiles.map(f => (
                                                    <div key={f.name} className="welcome-file-item">
                                                        <div className="welcome-file-item-info">
                                                            <span className="welcome-file-item-name">{f.name}</span>
                                                            <span className="welcome-file-item-meta">{formatFileSize(f.size)}</span>
                                                        </div>
                                                        <button
                                                            className="welcome-file-remove"
                                                            onClick={() => storeRemoveFile(f.name)}
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    className="welcome-btn-secondary"
                                                    style={{ alignSelf: 'flex-start' }}
                                                    onClick={() => fileInputRef.current?.click()}
                                                >
                                                    + {t('welcome.addMore')}
                                                </button>
                                            </div>
                                        )}
                                        <div className="welcome-form-group" style={{ marginTop: 'var(--paper-space-4)' }}>
                                            <label>{t('welcome.additionalContext')}</label>
                                            <textarea
                                                value={prompt}
                                                onChange={e => setPrompt(e.target.value)}
                                                placeholder={t('welcome.additionalContextPlaceholder')}
                                            />
                                        </div>
                                    </>
                                )}

                                {/* Idea text input */}
                                {selectedPoint === 'idea' && (
                                    <div className="welcome-form-group">
                                        <label>{t('welcome.ideaLabel')}</label>
                                        <textarea
                                            value={prompt}
                                            onChange={e => setPrompt(e.target.value)}
                                            placeholder={t('welcome.ideaPlaceholder')}
                                            style={{ minHeight: '180px' }}
                                        />
                                    </div>
                                )}

                                {/* Start Building button */}
                                <div className="welcome-btn-row">
                                    <button
                                        className="welcome-btn-primary"
                                        onClick={handleStartBuilding}
                                        disabled={!canStartBuilding}
                                    >
                                        {t('welcome.startBuilding')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Skip link */}
                <button className="welcome-skip" onClick={onSkip}>
                    {t('welcome.skip')}
                </button>
            </div>
        </div>
    )
}

export default WelcomePage
