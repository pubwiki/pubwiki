/**
 * WorldBuilderBanner - 世界构建器顶部横幅
 *
 * 嵌入主编辑器内容区顶部，替代原有模态框。
 * 两大模式：
 *   - Setup 模式（无 session）：显示输入框 + 开始按钮
 *   - Active 模式（有 session）：生成中 → 等待反馈 → 修订中（循环）
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { StateData, CopilotConfig } from '../../api/types'
import type {
    WBNSession,
    WBNPhaseId,
    WBNDraftOutput,
    WBNGameStyle,
    QueryUserRequest,
} from '../../api/worldBuilderNextTypes'
import { WBN_PHASE_IDS } from '../../api/worldBuilderNextTypes'
import {
    advancePhase,
    saveWBNSession,
    startNewSession,
    getProgressInfo,
    getPhaseTab,
    applyPhaseToState,
    initCreatureBatching,
    extractUserDesignNotes,
    getCurrentBatch,
    mergeReferenceFiles,
    mergeLorebooks,
} from '../../api/worldBuilderNextService'
import type { WBNReferenceFile, LorebookData } from '../../api/worldBuilderNextTypes'
import { parseSillyTavernLorebook } from '../../api/lorebookParser'
import { streamWBNPhase, streamWBNRevision } from './worldBuilderNextChat'
import type { WBNToolContext } from './worldBuilderNextChat'
import type { TabType } from '../state-editor/types'
import { createEmptyWorld } from '../state-editor/types'
import './WorldBuilderBanner.css'

// ============================================================================
// Types
// ============================================================================

type BannerMode = 'setup' | 'generating' | 'waiting' | 'revising' | 'error'

interface LogEntry {
    time: number
    text: string
}

export interface WorldBuilderBannerProps {
    session: WBNSession | null
    onSessionChange: (session: WBNSession | null) => void
    state: StateData
    onStateChange: (state: StateData) => void
    onTabChange: (tab: TabType) => void
    config: CopilotConfig
    onClose: () => void
    /** A paused session detected at mount time (from IndexedDB) */
    pausedSession?: WBNSession | null
    /** Called when user chooses to discard the paused session */
    onDiscardPaused?: () => void
}

// ============================================================================
// Inline QueryUser Form
// ============================================================================

const InlineQueryUserForm: React.FC<{
    request: QueryUserRequest
    onSubmit: (data: Record<string, unknown>) => void
    t: (key: string, opts?: Record<string, unknown>) => string
}> = ({ request, onSubmit, t }) => {
    const [formData, setFormData] = useState<Record<string, unknown>>(() => {
        const defaults: Record<string, unknown> = {}
        request.fields.forEach(f => {
            if (f.default_value !== undefined) {
                defaults[f.key] = f.default_value
            } else if (f.type === 'multiselect') {
                defaults[f.key] = []
            } else {
                defaults[f.key] = ''
            }
        })
        return defaults
    })
    // Track which fields are in custom input mode
    const [customInputFields, setCustomInputFields] = useState<Set<string>>(new Set())

    const toggleCustomInput = (fieldKey: string) => {
        setCustomInputFields(prev => {
            const next = new Set(prev)
            if (next.has(fieldKey)) {
                next.delete(fieldKey)
            } else {
                next.add(fieldKey)
            }
            return next
        })
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        onSubmit(formData)
    }

    return (
        <form className="wbn-query-form" onSubmit={handleSubmit}>
            <div className="wbn-query-title">{request.title}</div>
            {request.fields.map(field => (
                <div key={field.key} className="wbn-query-field">
                    <label className="wbn-query-label">{field.label}</label>
                    {field.type === 'select' && field.options ? (
                        customInputFields.has(field.key) ? (
                            <div className="wbn-query-custom-row">
                                <input
                                    type="text"
                                    className="wbn-query-input"
                                    value={(formData[field.key] as string) || ''}
                                    placeholder={t('worldBuilder.queryCustomPlaceholder')}
                                    onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                                    autoFocus
                                />
                                <button type="button" className="wbn-query-custom-toggle active" onClick={() => toggleCustomInput(field.key)}>
                                    {t('worldBuilder.queryBackToOptions')}
                                </button>
                            </div>
                        ) : (
                            <div className="wbn-query-custom-row">
                                <select
                                    className="wbn-query-select"
                                    value={(formData[field.key] as string) || ''}
                                    onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                                >
                                    <option value="">{t('worldBuilder.querySelectPlaceholder')}</option>
                                    {field.options.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                                <button type="button" className="wbn-query-custom-toggle" onClick={() => toggleCustomInput(field.key)}>
                                    {t('worldBuilder.queryCustom')}
                                </button>
                            </div>
                        )
                    ) : field.type === 'multiselect' && field.options ? (
                        <div>
                            <div className="wbn-query-multiselect">
                                {field.options.map(opt => {
                                    const selected = ((formData[field.key] as string[]) || []).includes(opt)
                                    return (
                                        <label key={opt} className={`wbn-query-chip ${selected ? 'active' : ''}`}>
                                            <input
                                                type="checkbox"
                                                checked={selected}
                                                onChange={() => {
                                                    const current = (formData[field.key] as string[]) || []
                                                    const next = selected
                                                        ? current.filter(v => v !== opt)
                                                        : [...current, opt]
                                                    setFormData(prev => ({ ...prev, [field.key]: next }))
                                                }}
                                                style={{ display: 'none' }}
                                            />
                                            {opt}
                                        </label>
                                    )
                                })}
                                {/* Render custom-added values not in original options */}
                                {((formData[field.key] as string[]) || [])
                                    .filter(v => !(field.options || []).includes(v))
                                    .map(customVal => (
                                        <label key={customVal} className="wbn-query-chip active wbn-query-chip--custom-value">
                                            <input
                                                type="checkbox"
                                                checked={true}
                                                onChange={() => {
                                                    const current = (formData[field.key] as string[]) || []
                                                    setFormData(prev => ({ ...prev, [field.key]: current.filter(v => v !== customVal) }))
                                                }}
                                                style={{ display: 'none' }}
                                            />
                                            ✏️ {customVal}
                                        </label>
                                    ))
                                }
                                <button
                                    type="button"
                                    className={`wbn-query-chip wbn-query-chip--custom ${customInputFields.has(field.key) ? 'active' : ''}`}
                                    onClick={() => toggleCustomInput(field.key)}
                                >
                                    ✏️ {t('worldBuilder.queryCustomChip')}
                                </button>
                            </div>
                            {customInputFields.has(field.key) && (
                                <div className="wbn-query-custom-add" style={{ marginTop: 6 }}>
                                    <input
                                        type="text"
                                        className="wbn-query-input"
                                        placeholder={t('worldBuilder.queryCustomOptionPlaceholder')}
                                        autoFocus
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                const val = (e.target as HTMLInputElement).value.trim()
                                                if (val) {
                                                    const current = (formData[field.key] as string[]) || []
                                                    if (!current.includes(val)) {
                                                        setFormData(prev => ({ ...prev, [field.key]: [...current, val] }))
                                                    }
                                                    ;(e.target as HTMLInputElement).value = ''
                                                }
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    ) : (
                        <input
                            type="text"
                            className="wbn-query-input"
                            value={(formData[field.key] as string) || ''}
                            placeholder={field.default_value || ''}
                            onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                        />
                    )}
                </div>
            ))}
            <button type="submit" className="wbn-banner-btn wbn-banner-btn--primary" style={{ marginTop: 8, alignSelf: 'flex-end' }}>
                {t('worldBuilder.querySubmit')}
            </button>
        </form>
    )
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert literal \n sequences (from LLM output) into real newlines */
const fixNewlines = (text: string | undefined): string => {
    if (!text) return ''
    return text.replace(/\\n/g, '\n')
}

// ============================================================================
// Component
// ============================================================================

const WorldBuilderBanner: React.FC<WorldBuilderBannerProps> = ({
    session,
    onSessionChange,
    state,
    onStateChange,
    onTabChange,
    config,
    onClose,
    pausedSession,
    onDiscardPaused,
}) => {
    const { t } = useTranslation('editor')
    const getPhaseLabel = useCallback((phaseId: WBNPhaseId) => t(`worldBuilder.phases.${phaseId}`), [t])
    const [mode, setMode] = useState<BannerMode>(() => session ? 'generating' : 'setup')
    const [feedbackText, setFeedbackText] = useState('')
    const [errorMessage, setErrorMessage] = useState('')
    const [statusText, setStatusText] = useState('')
    const [revisionSummary, setRevisionSummary] = useState('')
    const [showSynopsisPreview, setShowSynopsisPreview] = useState(false)
    // Setup mode state
    const [setupPrompt, setSetupPrompt] = useState('')
    const [gameStyle, setGameStyle] = useState<WBNGameStyle>('narrative')
    const [skipOrgs, setSkipOrgs] = useState(true)
    const [clearBeforeGenerate, setClearBeforeGenerate] = useState(true)
    const [skipExtraction, setSkipExtraction] = useState(false)
    const abortRef = useRef(false)
    const stateRef = useRef(state)
    const sessionRef = useRef(session)
    const isRunningRef = useRef(false)
    // Log events (internal — shown in banner expandable log)
    const [logEvents, setLogEvents] = useState<LogEntry[]>([])
    const [showLog, setShowLog] = useState(false)
    const logEndRef = useRef<HTMLDivElement>(null)

    const onLogEvent = useCallback((event: string) => {
        setLogEvents(prev => [...prev.slice(-200), { time: Date.now(), text: event }])
    }, [])

    const handleExportLog = useCallback(() => {
        const lines: string[] = []
        // Session metadata header
        lines.push('=== World Builder Log Export ===')
        lines.push(`Export Time: ${new Date().toISOString()}`)
        if (sessionRef.current) {
            const s = sessionRef.current
            lines.push(`Session ID: ${s.id}`)
            lines.push(`Status: ${s.status}`)
            lines.push(`Current Phase: ${s.currentPhase}`)
            lines.push(`Game Style: ${s.gameStyle || 'N/A'}`)
            lines.push(`Skip Organizations: ${s.skipOrganizations ?? false}`)
            lines.push(`Skip Extraction: ${s.skipExtraction ?? false}`)
            lines.push(`Created: ${new Date(s.createdAt).toISOString()}`)
            lines.push(`Updated: ${new Date(s.updatedAt).toISOString()}`)
            lines.push(`Initial Prompt: ${s.initialPrompt}`)
            // Phase statuses
            lines.push('')
            lines.push('--- Phase Statuses ---')
            for (const phaseId of WBN_PHASE_IDS) {
                const phase = s.phases[phaseId]
                const outputSize = phase.output ? JSON.stringify(phase.output).length : 0
                lines.push(`  ${phaseId}: ${phase.status}${phase.error ? ` (error: ${phase.error})` : ''}${outputSize ? ` [output: ${outputSize} chars]` : ''}`)
            }
            if (s.creatureBatching) {
                lines.push(`Creature Batching: batch ${s.creatureBatching.currentBatch + 1}/${s.creatureBatching.totalBatches}`)
            }
        }
        lines.push('')
        lines.push('--- Log Entries ---')
        for (const entry of logEvents) {
            const ts = new Date(entry.time).toISOString()
            lines.push(`[${ts}] ${entry.text}`)
        }
        // Phase outputs (for debugging)
        if (sessionRef.current) {
            lines.push('')
            lines.push('--- Phase Outputs (JSON) ---')
            for (const phaseId of WBN_PHASE_IDS) {
                const phase = sessionRef.current.phases[phaseId]
                if (phase.output) {
                    lines.push(`\n== ${phaseId} ==`)
                    lines.push(JSON.stringify(phase.output, null, 2))
                }
            }
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        a.download = `world-builder-log-${ts}.txt`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [logEvents])

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logEvents])

    // Local file/lorebook state (multiple files + multiple lorebooks, merged on session start)
    const [setupFiles, setSetupFiles] = useState<WBNReferenceFile[]>([])
    const [setupLorebooks, setSetupLorebooks] = useState<LorebookData[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)
    const lorebookInputRef = useRef<HTMLInputElement>(null)
    const [lorebookError, setLorebookError] = useState<string>('')

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            const content = reader.result as string
            const ext = file.name.split('.').pop()?.toLowerCase() || ''
            const typeMap: Record<string, WBNReferenceFile['type']> = {
                md: 'md', json: 'json', txt: 'txt',
                png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
            }
            setSetupFiles(prev => [...prev, {
                name: file.name,
                content,
                type: typeMap[ext] || 'txt',
                size: file.size,
            }])
        }
        reader.readAsText(file)
        e.target.value = ''
    }, [])

    const handleRemoveFile = useCallback((index: number) => {
        setSetupFiles(prev => prev.filter((_, i) => i !== index))
    }, [])

    const handleLorebookUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setLorebookError('')
        const reader = new FileReader()
        reader.onload = () => {
            try {
                const json = JSON.parse(reader.result as string)
                const parsed = parseSillyTavernLorebook(json, file.name)
                if (!parsed) {
                    setLorebookError(t('worldBuilder.lorebookParseError'))
                    return
                }
                setSetupLorebooks(prev => [...prev, parsed])
            } catch {
                setLorebookError(t('worldBuilder.lorebookParseError'))
            }
        }
        reader.readAsText(file)
        e.target.value = ''
    }, [t])

    const handleRemoveLorebook = useCallback((index: number) => {
        setSetupLorebooks(prev => prev.filter((_, i) => i !== index))
    }, [])

    // Internal queryUser state
    const [pendingQuery, setPendingQuery] = useState<QueryUserRequest | null>(null)
    const pendingQueryResolveRef = useRef<((data: Record<string, unknown>) => void) | null>(null)

    const queryUser = useCallback((request: QueryUserRequest): Promise<Record<string, unknown>> => {
        return new Promise((resolve) => {
            pendingQueryResolveRef.current = resolve
            setPendingQuery(request)
        })
    }, [])

    // Keep refs in sync
    useEffect(() => { stateRef.current = state }, [state])
    useEffect(() => { sessionRef.current = session }, [session])

    // Auto-start generating on mount or when session advances
    useEffect(() => {
        if (!session) return
        const phase = session.phases[session.currentPhase]
        if (phase.status === 'active' && !isRunningRef.current) {
            runPhase()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.currentPhase, session?.creatureBatching?.currentBatch])

    // ========================================================================
    // Setup → Start Session
    // ========================================================================

    const handleStartSession = useCallback(() => {
        if (!setupPrompt.trim()) return
        // Clear existing data before generating
        if (clearBeforeGenerate) {
            onStateChange({
                World: createEmptyWorld(),
                Creatures: [],
                Regions: [],
                Organizations: [],
                StoryHistory: [],
                GameInitialStory: undefined,
            } as StateData)
        }
        const mergedFile = mergeReferenceFiles(setupFiles)
        const mergedLorebook = mergeLorebooks(setupLorebooks)
        const newSession = startNewSession(setupPrompt.trim(), mergedFile, mergedLorebook, { gameStyle, skipOrganizations: skipOrgs, skipExtraction })
        onSessionChange(newSession)
        setMode('generating')
        setLogEvents([])
    }, [setupPrompt, setupFiles, setupLorebooks, onSessionChange, clearBeforeGenerate, onStateChange, gameStyle, skipOrgs, skipExtraction])

    // ========================================================================
    // Phase Execution
    // ========================================================================

    const runPhase = useCallback(async () => {
        if (isRunningRef.current || !sessionRef.current) return
        isRunningRef.current = true
        abortRef.current = false

        const phaseId = sessionRef.current.currentPhase
        const label = getPhaseLabel(phaseId)
        const batchInfo = phaseId === 'creatures' ? getCurrentBatch(sessionRef.current) : null

        setMode('generating')
        setErrorMessage('')
        setRevisionSummary('')

        if (batchInfo) {
            setStatusText(t('worldBuilder.generatingPhaseBatch', { label, current: batchInfo.batchIndex + 1, total: batchInfo.totalBatches }))
        } else {
            setStatusText(t('worldBuilder.generatingPhase', { label }))
        }
        onLogEvent(t('worldBuilder.logStart', { label }))

        // Update phase status
        const s: WBNSession = { ...sessionRef.current! }
        s.phases = { ...s.phases }
        s.phases[phaseId] = { ...s.phases[phaseId], status: 'generating' }
        onSessionChange(s)
        sessionRef.current = s

        const context: WBNToolContext = {
            state: stateRef.current,
            session: sessionRef.current!,
            config,
            queryUser,
        }

        try {
            const gen = streamWBNPhase(config, sessionRef.current, phaseId, context)

            for await (const event of gen) {
                if (abortRef.current) break

                switch (event.type) {
                    case 'ai_text':
                        // Stream text to log panel (show last 200 chars)
                        onLogEvent(event.text.slice(-200))
                        break

                    case 'extraction_progress':
                        onLogEvent(event.message)
                        setStatusText(event.message)
                        break

                    case 'streaming_progress':
                        if (batchInfo) {
                            setStatusText(t('worldBuilder.streamingProgressBatch', {
                                label, current: batchInfo.batchIndex + 1,
                                total: batchInfo.totalBatches, chars: event.charCount
                            }))
                        } else {
                            setStatusText(t('worldBuilder.streamingProgress', { label, chars: event.charCount }))
                        }
                        break

                    case 'phase_output':
                        handlePhaseOutput(event.phaseId, event.output)
                        break

                    case 'draft_review':
                        // Auto-confirm draft — skip manual review, user can revise via AI feedback
                        handlePhaseOutput('synopsis', event.draft)
                        break

                    case 'validation_retry':
                        if (event.accepted) {
                            onLogEvent(t('worldBuilder.validationAccepted', { attempt: event.attempt, errorCount: event.errors.length }))
                            setStatusText(t('worldBuilder.generatingPhase', { label }))
                        } else {
                            onLogEvent(t('worldBuilder.validationRetry', { attempt: event.attempt, errors: event.errors.slice(0, 3).join('; ') }))
                            setStatusText(t('worldBuilder.validationRetryStatus', { attempt: event.attempt }))
                        }
                        break

                    case 'query_user':
                        onLogEvent(t('worldBuilder.logQueryUser', { title: event.request.title }))
                        setStatusText(t('worldBuilder.waitingInput', { title: event.request.title }))
                        break

                    case 'done':
                        onLogEvent(t('worldBuilder.logDone', { label }))
                        break

                    case 'error':
                        onLogEvent(t('worldBuilder.logError', { error: event.error }))
                        setMode('error')
                        setErrorMessage(event.error)
                        {
                            const ss: WBNSession = { ...sessionRef.current! }
                            ss.phases = { ...ss.phases }
                            ss.phases[phaseId] = { ...ss.phases[phaseId], status: 'error', error: event.error }
                            onSessionChange(ss)
                            sessionRef.current = ss
                            saveWBNSession(ss)
                        }
                        break
                }
            }
        } catch (e) {
            if (!abortRef.current) {
                const errMsg = (e as Error).message
                setMode('error')
                setErrorMessage(errMsg)
                onLogEvent(t('worldBuilder.logException', { error: errMsg }))
            }
        } finally {
            isRunningRef.current = false
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config, queryUser])

    // ========================================================================
    // Phase Output Handling
    // ========================================================================

    const handlePhaseOutput = useCallback(async (phaseId: WBNPhaseId, output: unknown) => {
        if (!sessionRef.current) return
        // Save output to session
        const s: WBNSession = { ...sessionRef.current }
        s.phases = { ...s.phases }

        // Creatures phase: accumulate across batches (merge by creature_id)
        let mergedOutput = output
        if (phaseId === 'creatures' && s.creatureBatching && s.creatureBatching.currentBatch > 0) {
            const prior = (s.phases[phaseId].output as any)?.creatures as any[] || []
            const incoming = (output as any)?.creatures as any[] || []
            const incomingIds = new Set(incoming.map((c: any) => c.Creature?.creature_id).filter(Boolean))
            const kept = prior.filter((c: any) => !incomingIds.has(c.Creature?.creature_id))
            mergedOutput = { ...(output as any), creatures: [...kept, ...incoming] }
        }

        s.phases[phaseId] = { ...s.phases[phaseId], status: 'completed', output: mergedOutput }
        s.updatedAt = Date.now()

        // Initialize creature batching and extract user design notes after synopsis
        if (phaseId === 'synopsis') {
            initCreatureBatching(s)
            extractUserDesignNotes(s)
        }

        onSessionChange(s)
        sessionRef.current = s
        saveWBNSession(s)

        // Apply data to state (skip synopsis)
        if (phaseId !== 'synopsis') {
            const newState = await applyPhaseToState(s, phaseId, stateRef.current)
            onStateChange(newState)
            stateRef.current = newState

            // Switch to corresponding tab
            const tab = getPhaseTab(phaseId)
            if (tab) {
                onTabChange(tab)
            }
        }

        // Transition to waiting mode
        const label = getPhaseLabel(phaseId)
        setMode('waiting')
        if (phaseId === 'synopsis') {
            const draftOutput = output as WBNDraftOutput
            const creatureCount = draftOutput?.creatures?.length || 0
            const regionCount = draftOutput?.regions?.length || 0
            const orgCount = draftOutput?.organizations?.length || 0
            setStatusText(t('worldBuilder.synopsisGenerated', { label, regions: regionCount, orgs: orgCount, creatures: creatureCount }))
            setShowSynopsisPreview(true)
            // Push draft content to log panel for user review
            const draftFields = [
                { key: 'tone', label: t('worldBuilder.draft.tone') },
                { key: 'opening', label: t('worldBuilder.draft.opening') },
                { key: 'storyline', label: t('worldBuilder.draft.storyline') },
                { key: 'mechanics', label: t('worldBuilder.draft.mechanics') },
                { key: 'protagonist', label: t('worldBuilder.draft.protagonist') },
            ] as const
            const text = draftFields.filter(f => draftOutput?.[f.key]).map(f => `【${f.label}】\n${draftOutput[f.key]}`).join('\n\n')
            if (text) onLogEvent(`\n${t('worldBuilder.logSynopsisHeader')}\n${text}`)
            if (draftOutput?.regions?.length) {
                const regionList = draftOutput.regions.map(r => `- ${r.region_id} — ${r.name}`).join('\n')
                onLogEvent(`\n${t('worldBuilder.logRegionsPlan', { count: regionCount })}\n${regionList}`)
            }
            if (draftOutput?.organizations?.length) {
                const orgList = draftOutput.organizations.map(o => `- ${o.organization_id} — ${o.name}`).join('\n')
                onLogEvent(`\n${t('worldBuilder.logOrgsPlan', { count: orgCount })}\n${orgList}`)
            }
            if (draftOutput?.creatures?.length) {
                const creatureList = draftOutput.creatures
                    .map(c => `- ${c.creature_id} — ${c.name}${c.is_player ? ` ${t('worldBuilder.player')}` : ''}`)
                    .join('\n')
                onLogEvent(`\n${t('worldBuilder.logCreaturesPlan', { count: creatureCount })}\n${creatureList}`)
            }
        } else {
            setStatusText(t('worldBuilder.phaseGenerated', { label }))
        }
        setFeedbackText('')
    }, [onSessionChange, onStateChange, onTabChange])

    // ========================================================================
    // Advance to Next Phase
    // ========================================================================

    const handleAdvance = useCallback(() => {
        if (!sessionRef.current) return
        setShowSynopsisPreview(false)
        const s: WBNSession = { ...sessionRef.current }

        // Re-calculate creature batching when advancing from synopsis
        // (user may have added/removed creatures via revision)
        if (s.currentPhase === 'synopsis') {
            initCreatureBatching(s)
        }

        const hasNext = advancePhase(s)

        if (hasNext) {
            onSessionChange(s)
            sessionRef.current = s
            saveWBNSession(s)
            // Phase execution will auto-trigger via useEffect
        } else {
            // All phases complete
            s.status = 'completed'
            onSessionChange(s)
            sessionRef.current = s
            saveWBNSession(s)

            // Auto-download to prevent data loss
            try {
                const now = new Date()
                const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
                const exportData = { ...stateRef.current, _save_version: 'v2' as const }
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `world-builder-${ts}.json`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                onLogEvent(`${t('worldBuilder.allComplete')} ${t('worldBuilder.autoDownloadCreated')}`)
            } catch (e) {
                console.error('Auto-download after world builder failed:', e)
                onLogEvent(t('worldBuilder.allComplete'))
            }

            onClose()
        }
    }, [onSessionChange, onLogEvent, onClose])

    // ========================================================================
    // Revision
    // ========================================================================

    const handleRevision = useCallback(async () => {
        if (!feedbackText.trim() || !sessionRef.current) return
        if (isRunningRef.current) return
        isRunningRef.current = true

        const phaseId = sessionRef.current.currentPhase
        const userMsg = feedbackText.trim()
        setFeedbackText('')
        setMode('revising')
        setStatusText(t('worldBuilder.revisingPhase', { label: getPhaseLabel(phaseId) }))
        onLogEvent(t('worldBuilder.logRevision', { msg: userMsg }))

        const context: WBNToolContext = {
            state: stateRef.current,
            session: sessionRef.current,
            config,
        }

        try {
            const gen = streamWBNRevision(config, sessionRef.current, phaseId, userMsg, context)

            for await (const event of gen) {
                if (abortRef.current) break

                switch (event.type) {
                    case 'ai_text':
                        onLogEvent(event.text.slice(-200))
                        break

                    case 'streaming_progress':
                        setStatusText(t('worldBuilder.revisingPhase', { label: getPhaseLabel(phaseId) }) + ` (${event.charCount} chars)`)
                        break

                    case 'tool_call_start':
                        onLogEvent(t('worldBuilder.logRevisionTool', { name: event.toolName }))
                        break

                    case 'revision_patch':
                        onLogEvent(t('worldBuilder.logPatch', { summary: event.summary }))
                        setRevisionSummary(prev => prev ? `${prev}; ${event.summary}` : event.summary)
                        // Re-apply current phase to state after patch
                        {
                            const currentOutput = sessionRef.current.phases[phaseId].output
                            if (currentOutput) {
                                const newState = await applyPhaseToState(sessionRef.current, phaseId, stateRef.current)
                                onStateChange(newState)
                                stateRef.current = newState
                            }
                        }
                        break

                    case 'revision_done':
                        onLogEvent(t('worldBuilder.logRevisionDone', { summary: event.summary }))
                        setMode('waiting')
                        setStatusText(t('worldBuilder.revisionDone', { summary: event.summary }))
                        saveWBNSession(sessionRef.current)
                        break

                    case 'done':
                        if (mode !== 'waiting') {
                            setMode('waiting')
                            setStatusText(t('worldBuilder.revisionComplete'))
                        }
                        saveWBNSession(sessionRef.current)
                        break

                    case 'error':
                        onLogEvent(t('worldBuilder.logRevisionError', { error: event.error }))
                        setMode('error')
                        setErrorMessage(event.error)
                        break
                }
            }
        } catch (e) {
            if (!abortRef.current) {
                setMode('error')
                setErrorMessage((e as Error).message)
            }
        } finally {
            isRunningRef.current = false
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feedbackText, config])

    // ========================================================================
    // Cancel / Retry
    // ========================================================================

    // ========================================================================
    // Pause — interrupt generation, save session, close banner
    // ========================================================================

    const handlePause = useCallback(() => {
        abortRef.current = true
        isRunningRef.current = false

        if (sessionRef.current) {
            const s: WBNSession = { ...sessionRef.current }
            s.status = 'paused'
            s.updatedAt = Date.now()
            // If the current phase was mid-generation, reset it to 'active' so it can be re-run on resume
            const phaseStatus = s.phases[s.currentPhase]?.status
            if (phaseStatus === 'generating') {
                s.phases = { ...s.phases }
                s.phases[s.currentPhase] = { ...s.phases[s.currentPhase], status: 'active' }
            }
            saveWBNSession(s)
            onSessionChange(null)
        }
        onClose()
    }, [onClose, onSessionChange])

    const handleCancel = useCallback(() => {
        abortRef.current = true
        isRunningRef.current = false
        onClose()
    }, [onClose])

    const handleRetry = useCallback(() => {
        if (!sessionRef.current) return
        setMode('generating')
        setErrorMessage('')
        // Reset phase status to active
        const s: WBNSession = { ...sessionRef.current }
        s.phases = { ...s.phases }
        s.phases[s.currentPhase] = {
            ...s.phases[s.currentPhase],
            status: 'active',
            output: undefined,
            error: undefined,
            chatHistory: [],
        }
        onSessionChange(s)
        sessionRef.current = s
        // Directly invoke runPhase — the auto-start Effect won't fire because
        // its dependencies (currentPhase, currentBatch) haven't changed.
        runPhase()
    }, [onSessionChange, runPhase])

    // ========================================================================
    // Render
    // ========================================================================

    // Resume a paused session
    const handleResumePaused = useCallback(() => {
        if (!pausedSession) return
        const s: WBNSession = { ...pausedSession, status: 'active', updatedAt: Date.now() }
        onSessionChange(s)
        saveWBNSession(s)
        setMode('generating')
        setLogEvents([])
    }, [pausedSession, onSessionChange])

    const handleDiscardPaused = useCallback(() => {
        onDiscardPaused?.()
    }, [onDiscardPaused])

    // Setup mode — no session yet
    if (mode === 'setup' || !session) {
        return (
            <div className="wbn-banner wbn-banner--setup">
                <div className="wbn-banner-main">
                    <span className="wbn-banner-icon"></span>
                    <div className="wbn-banner-text">
                        <div className="wbn-banner-title">{t('worldBuilder.title')}</div>
                        <div className="wbn-banner-subtitle">{t('worldBuilder.subtitle')}</div>
                    </div>
                    <div className="wbn-banner-actions">
                        <button className="wbn-banner-btn wbn-banner-btn--danger" onClick={onClose}>
                            {t('worldBuilder.close')}
                        </button>
                    </div>
                </div>

                {/* Resume paused session prompt */}
                {pausedSession && (
                    <div className="wbn-banner-resume">
                        <div className="wbn-banner-resume-text">
                            <span className="wbn-banner-resume-icon">⏸</span>
                            <span>{t('worldBuilder.pausedSessionFound', {
                                phase: getPhaseLabel(pausedSession.currentPhase),
                                date: new Date(pausedSession.updatedAt).toLocaleString(),
                            })}</span>
                        </div>
                        <div className="wbn-banner-resume-actions">
                            <button className="wbn-banner-btn wbn-banner-btn--primary" onClick={handleResumePaused}>
                                {t('worldBuilder.resumeSession')}
                            </button>
                            <button className="wbn-banner-btn wbn-banner-btn--danger" onClick={handleDiscardPaused}>
                                {t('worldBuilder.discardSession')}
                            </button>
                        </div>
                    </div>
                )}
                <div className="wbn-banner-setup">
                    <textarea
                        className="wbn-banner-setup-input"
                        placeholder={t('worldBuilder.placeholder')}
                        value={setupPrompt}
                        onChange={e => setSetupPrompt(e.target.value)}
                        rows={3}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey && setupPrompt.trim()) {
                                e.preventDefault()
                                handleStartSession()
                            }
                        }}
                    />
                    <div className="wbn-banner-setup-footer">
                        <div className="wbn-banner-attachments">
                            {/* Hidden file inputs */}
                            <input ref={fileInputRef} type="file" accept=".md,.txt,.json" style={{ display: 'none' }} onChange={handleFileUpload} />
                            <input ref={lorebookInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLorebookUpload} />

                            {/* File tags + add button */}
                            {setupFiles.map((f, i) => (
                                <span key={i} className="wbn-attach-tag">
                                    <span className="wbn-attach-tag-label" title={f.name}>{f.name}</span>
                                    <button type="button" className="wbn-attach-tag-remove" onClick={() => handleRemoveFile(i)}>&times;</button>
                                </span>
                            ))}
                            <button type="button" className="wbn-attach-btn" onClick={() => fileInputRef.current?.click()}>
                                + {t('worldBuilder.referenceFiles')}
                            </button>

                            {/* Lorebook tags + add button */}
                            {setupLorebooks.map((lb, i) => (
                                <span key={i} className="wbn-attach-tag wbn-attach-tag--lorebook">
                                    <span className="wbn-attach-tag-label" title={lb.filename}>
                                        {lb.name} ({lb.entries.length} entries)
                                    </span>
                                    <button type="button" className="wbn-attach-tag-remove" onClick={() => handleRemoveLorebook(i)}>&times;</button>
                                </span>
                            ))}
                            <button type="button" className="wbn-attach-btn" onClick={() => lorebookInputRef.current?.click()}>
                                + Lorebook
                            </button>

                            {lorebookError && (
                                <span className="wbn-banner-error" style={{ fontSize: '0.72rem', padding: '2px 6px' }}>
                                    {lorebookError}
                                </span>
                            )}
                        </div>
                        <div className="wbn-banner-setup-right">
                            <div className="wbn-banner-game-style">
                                <button
                                    type="button"
                                    className={`wbn-banner-style-btn ${gameStyle === 'narrative' ? 'active' : ''}`}
                                    onClick={() => setGameStyle('narrative')}
                                    title={t('worldBuilder.gameStyle.narrativeDesc')}
                                >
                                    {t('worldBuilder.gameStyle.narrative')}
                                </button>
                                <button
                                    type="button"
                                    className={`wbn-banner-style-btn ${gameStyle === 'numerical' ? 'active' : ''}`}
                                    onClick={() => setGameStyle('numerical')}
                                    title={t('worldBuilder.gameStyle.numericalDesc')}
                                >
                                    {t('worldBuilder.gameStyle.numerical')}
                                </button>
                            </div>
                            <label className="wbn-banner-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                                <input
                                    type="checkbox"
                                    checked={skipOrgs}
                                    onChange={e => setSkipOrgs(e.target.checked)}
                                />
                                {t('worldBuilder.skipOrganizations')}
                            </label>
                            <label className="wbn-banner-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                                <input
                                    type="checkbox"
                                    checked={clearBeforeGenerate}
                                    onChange={e => setClearBeforeGenerate(e.target.checked)}
                                />
                                {t('worldBuilder.clearBeforeGenerate')}
                            </label>
                            {(() => {
                                const totalChars = setupFiles.reduce((sum, f) => sum + (f.content?.length || 0), 0)
                                    + setupLorebooks.reduce((sum, lb) => sum + lb.totalChars, 0)
                                return totalChars > 0 && totalChars <= 100000
                            })() && (
                                <label className="wbn-banner-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                                    <input
                                        type="checkbox"
                                        checked={skipExtraction}
                                        onChange={e => setSkipExtraction(e.target.checked)}
                                    />
                                    {t('worldBuilder.skipExtraction')}
                                </label>
                            )}
                            <button
                                className="wbn-banner-btn wbn-banner-btn--primary"
                                onClick={handleStartSession}
                                disabled={!setupPrompt.trim() || !config.primaryModel.apiKey}
                            >
                                {t('worldBuilder.startBuilding')}
                            </button>
                        </div>
                    </div>
                    {!config.primaryModel.apiKey && (
                        <div className="wbn-banner-error" style={{ padding: '4px 0 0' }}>
                            {t('worldBuilder.configureApiKey')}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // Active mode — session exists
    const progress = getProgressInfo(session)
    const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0
    const progressLabel = getPhaseLabel(progress.phaseId) + (progress.batchInfo ? ` (${progress.batchInfo.current}/${progress.batchInfo.total})` : '')

    // Build step dots
    const stepDots = WBN_PHASE_IDS.filter(id => {
        if (id === 'organizations' && session.skipOrganizations) return false
        return true
    })

    return (
        <div className={`wbn-banner wbn-banner--${mode}`}>
            {/* Main status bar */}
            <div className="wbn-banner-main">
                <span className="wbn-banner-icon">
                    {(mode === 'generating' || mode === 'revising') && <span className="wbn-spinner" />}
                    {mode === 'waiting' && ''}
                    {mode === 'error' && ''}
                </span>

                <div className="wbn-banner-text">
                    <div className="wbn-banner-title">
                        {mode === 'generating' && t('worldBuilder.generating', { status: statusText })}
                        {mode === 'waiting' && statusText}
                        {mode === 'revising' && statusText}
                        {mode === 'error' && t('worldBuilder.errorTitle')}
                    </div>
                    {mode === 'generating' && (
                        <div className="wbn-banner-subtitle">
                            {progressLabel} ({progress.current}/{progress.total})
                        </div>
                    )}
                    {mode === 'revising' && revisionSummary && (
                        <div className="wbn-banner-subtitle">
                            {t('worldBuilder.revised', { summary: revisionSummary })}
                        </div>
                    )}
                </div>

                <div className="wbn-banner-actions">
                    {/* Log toggle & export buttons */}
                    {logEvents.length > 0 && (
                        <>
                            <button
                                className={`wbn-banner-btn ${showLog ? 'wbn-banner-btn--primary' : ''}`}
                                onClick={() => setShowLog(!showLog)}
                                style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                            >
                                {showLog ? t('worldBuilder.collapseLog') : t('worldBuilder.viewLog')}
                            </button>
                            <button
                                className="wbn-banner-btn"
                                onClick={handleExportLog}
                                style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                                title={t('worldBuilder.exportLogTitle')}
                            >
                                {t('worldBuilder.exportLog')}
                            </button>
                        </>
                    )}
                    {(mode === 'generating' || mode === 'revising') && (
                        <button className="wbn-banner-btn wbn-banner-btn--warning" onClick={handlePause}>
                            {t('worldBuilder.pause')}
                        </button>
                    )}
                    {mode === 'waiting' && (
                        <button className="wbn-banner-btn wbn-banner-btn--warning" onClick={handlePause}>
                            {t('worldBuilder.pause')}
                        </button>
                    )}
                    {(mode === 'generating' || mode === 'revising' || mode === 'waiting') && (
                        <button className="wbn-banner-btn wbn-banner-btn--danger" onClick={handleCancel}>
                            {t('worldBuilder.cancel')}
                        </button>
                    )}
                    {mode === 'error' && (
                        <>
                            <button className="wbn-banner-btn" onClick={handleRetry}>
                                {t('worldBuilder.retry')}
                            </button>
                            <button className="wbn-banner-btn wbn-banner-btn--warning" onClick={handlePause}>
                                {t('worldBuilder.pause')}
                            </button>
                            <button className="wbn-banner-btn wbn-banner-btn--danger" onClick={handleCancel}>
                                {t('worldBuilder.cancel')}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Scrollable content area */}
            <div className="wbn-banner-scroll">

            {/* Progress bar */}
            {(mode === 'generating' || mode === 'revising') && (
                <div className="wbn-banner-progress">
                    <div className="wbn-banner-progress-bar" style={{ width: `${progressPercent}%` }} />
                    <div className="wbn-banner-progress-shimmer" />
                </div>
            )}

            {/* Step dots */}
            <div className="wbn-banner-steps">
                {stepDots.map(id => {
                    const phase = session.phases[id]
                    let dotClass = 'wbn-banner-step-dot'
                    if (phase.status === 'completed') dotClass += ' wbn-banner-step-dot--completed'
                    else if (phase.status === 'generating' || phase.status === 'active') dotClass += ' wbn-banner-step-dot--active'
                    else if (phase.status === 'error') dotClass += ' wbn-banner-step-dot--error'
                    return <div key={id} className={dotClass} title={getPhaseLabel(id)} />
                })}
                <span className="wbn-banner-step-label">{progressLabel}</span>
            </div>

            {/* Draft preview (shown after synopsis completes) */}
            {showSynopsisPreview && !!session.phases.synopsis.output && (
                <div className="wbn-synopsis-preview">
                    <div className="wbn-synopsis-preview-header">
                        <span>{t('worldBuilder.draftPreview')}</span>
                        <button
                            className="wbn-banner-btn"
                            style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                            onClick={() => setShowSynopsisPreview(!showSynopsisPreview)}
                        >
                            {t('worldBuilder.collapse')}
                        </button>
                    </div>
                    <div className="wbn-synopsis-preview-content">
                        {(() => {
                            const output = session.phases.synopsis.output as WBNDraftOutput
                            return (
                                <>
                                    {(['tone', 'opening', 'storyline', 'mechanics', 'protagonist'] as const).map(field => (
                                        output[field] ? (
                                            <div key={field} style={{ marginBottom: 8 }}>
                                                <strong style={{ fontSize: '0.8rem' }}>{t(`worldBuilder.draft.${field}`)}</strong>
                                                <pre style={{ whiteSpace: 'pre-wrap', margin: '2px 0 0', fontFamily: 'inherit', fontSize: '0.8rem' }}>
                                                    {fixNewlines(output[field])}
                                                </pre>
                                            </div>
                                        ) : null
                                    ))}
                                    {output.regions?.length > 0 && (
                                        <div className="wbn-synopsis-section">
                                            <strong>{t('worldBuilder.draft.regions')} ({output.regions.length})</strong>
                                            {output.regions.map((r) => (
                                                <div key={r.region_id} className="wbn-synopsis-creature">
                                                    <span className="wbn-synopsis-creature-id">{r.region_id} — {r.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {output.organizations?.length > 0 && (
                                        <div className="wbn-synopsis-section">
                                            <strong>{t('worldBuilder.draft.organizations')} ({output.organizations.length})</strong>
                                            {output.organizations.map((o) => (
                                                <div key={o.organization_id} className="wbn-synopsis-creature">
                                                    <span className="wbn-synopsis-creature-id">{o.organization_id} — {o.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {output.creatures?.length > 0 && (
                                        <div className="wbn-synopsis-section">
                                            <strong>{t('worldBuilder.draft.creatures')} ({output.creatures.length})</strong>
                                            {output.creatures.map((c) => (
                                                <div key={c.creature_id} className="wbn-synopsis-creature">
                                                    <span className="wbn-synopsis-creature-id">
                                                        {c.creature_id} — {c.name} {c.is_player ? t('worldBuilder.player') : ''}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )
                        })()}
                    </div>
                </div>
            )}

            {/* Batch breakdown (shown during creatures phase with multi-batch) */}
            {session.currentPhase === 'creatures' && session.creatureBatching && session.creatureBatching.totalBatches > 1 && (() => {
                const draft = session.phases.synopsis.output as WBNDraftOutput | undefined
                const { currentBatch, totalBatches, batchPlan } = session.creatureBatching
                return (
                    <div className="wbn-batch-breakdown">
                        <div className="wbn-batch-breakdown-header">{t('worldBuilder.batchBreakdown')}</div>
                        <div className="wbn-batch-list">
                            {batchPlan.map((batch, idx) => {
                                const isActive = idx === currentBatch
                                const isCompleted = idx < currentBatch
                                const statusClass = isActive ? 'wbn-batch-item--active' : isCompleted ? 'wbn-batch-item--completed' : 'wbn-batch-item--pending'
                                const badge = isActive ? t('worldBuilder.batchCurrent') : isCompleted ? t('worldBuilder.batchCompleted') : t('worldBuilder.batchPending')
                                return (
                                    <div key={idx} className={`wbn-batch-item ${statusClass}`}>
                                        <div className="wbn-batch-item-label">
                                            <span className="wbn-batch-item-label-text">{t('worldBuilder.batchLabel', { index: idx + 1 })}</span>
                                            <span className="wbn-batch-item-badge">{badge}</span>
                                        </div>
                                        <div className="wbn-batch-item-creatures">
                                            {batch.creatureIds.map(cid => {
                                                const creature = draft?.creatures?.find(c => c.creature_id === cid)
                                                const name = creature?.name || cid
                                                const isPlayer = creature?.is_player
                                                return (
                                                    <span key={cid} className={`wbn-batch-creature-tag ${isPlayer ? 'wbn-batch-creature-tag--player' : ''}`}>
                                                        {name}{isPlayer ? ` ${t('worldBuilder.player')}` : ''}
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="wbn-batch-hint">
                            {t('worldBuilder.batchHint')}
                        </div>
                    </div>
                )
            })()}

            {/* Feedback input (waiting mode) */}
            {mode === 'waiting' && (
                <div className="wbn-banner-feedback">
                    <input
                        className="wbn-banner-feedback-input"
                        type="text"
                        placeholder={t('worldBuilder.feedbackPlaceholder')}
                        value={feedbackText}
                        onChange={e => setFeedbackText(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && feedbackText.trim()) {
                                handleRevision()
                            }
                        }}
                    />
                    <button
                        className="wbn-banner-btn wbn-banner-btn--primary"
                        onClick={handleRevision}
                        disabled={!feedbackText.trim()}
                    >
                        {t('worldBuilder.submitRevision')}
                    </button>
                    <button
                        className="wbn-banner-btn wbn-banner-btn--success"
                        onClick={handleAdvance}
                    >
                        {t('worldBuilder.satisfiedNext')}
                    </button>
                </div>
            )}

            {/* Error message */}
            {mode === 'error' && errorMessage && (
                <div className="wbn-banner-error">
                    {errorMessage}
                </div>
            )}

            {/* Inline QueryUser form (shown during synopsis) */}
            {pendingQuery && (
                <div className="wbn-banner-query">
                    <InlineQueryUserForm
                        request={pendingQuery}
                        t={t}
                        onSubmit={(data) => {
                            if (pendingQueryResolveRef.current) {
                                pendingQueryResolveRef.current(data)
                                pendingQueryResolveRef.current = null
                            }
                            setPendingQuery(null)
                            // Reset status text back to generating
                            if (sessionRef.current) {
                                const phaseId = sessionRef.current.currentPhase
                                const label = getPhaseLabel(phaseId)
                                setStatusText(t('worldBuilder.generatingPhase', { label }))
                            }
                        }}
                    />
                </div>
            )}

            {/* Inline log panel (collapsible) */}
            {showLog && logEvents.length > 0 && (
                <div className="wbn-banner-log">
                    {logEvents.map((entry, i) => (
                        <div key={i} className="wbn-banner-log-line">
                            <span className="wbn-banner-log-time">{new Date(entry.time).toLocaleTimeString()}</span>
                            {entry.text}
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>
            )}

            </div>{/* end wbn-banner-scroll */}
        </div>
    )
}

export default WorldBuilderBanner
