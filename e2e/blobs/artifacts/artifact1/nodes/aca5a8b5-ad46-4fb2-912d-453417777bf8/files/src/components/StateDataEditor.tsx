/**
 * StateDataEditor - 游戏状态编辑器主组件
 * 
 * 该组件已重构，将子编辑器拆分到 state-editor 目录中的多个文件
 */
import React, { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { type StateData } from '../api/types'
import { validateAndLoadState } from '../api/stateValidation'
import { showAlert, showConfirm, showChoice } from './AlertDialog'
import { showToast } from './Toast'
import { encodeDataToPng, decodeDataFromPng, blobToDataUrl } from '../utils/pngDataCodec'
// 使用多巴胺风格 CSS 架构
import '../styles/paper/index.css'
import TestGame from '../games/test/index'
import InkGame from '../games/ink/index'
import CustomTemplateGame from '../games/custom_template/index'

// 动态加载 custom 目录（用户自定义前端，可能不存在）
const customGameCheck = import('../games/custom/index')
  .then(() => true)
  .catch(() => false)

const CustomGame = lazy(() =>
  import('../games/custom/index').catch(() => {
    const Fallback = (_props: { onBack: () => void }) => <></>
    return { default: Fallback }
  })
)

function useCustomGameAvailable() {
  const [available, setAvailable] = useState(false)
  useEffect(() => { customGameCheck.then(setAvailable) }, [])
  return available
}

import LanguageSelector from '../i18n/LanguageSelector'


import {
  TabType,
  EditorProps,
  createEmptyWorld,
  validateStateData,
  luaList,
  ValidationPanel,
  CreaturesEditor,
  RegionsEditor,
  OrganizationsEditor,
  WorldEditor,
  GameInitialStoryEditor,
  GameWikiEntryEditor,
  StoryHistoryEditor,
  SaveManager
} from './state-editor'
import { EditorTabs } from './state-editor/EditorTabs'
import APIConfigModal, { syncAPIConfigToBackend } from './APIConfigModal'
import AICopilotPanel from './AICopilotPanel'
import WorldBuilderBanner from './world-builder/WorldBuilderBanner'
import type { WBNSession } from '../api/worldBuilderNextTypes'
import { loadWBNSession, getCurrentSessionId, startNewSession, endSession as endWBNSession, mergeReferenceFiles, mergeLorebooks, uploadedFilesToReferenceFiles, findPausedSession, deleteWBNSession } from '../api/worldBuilderNextService'
import { loadCopilotConfigFromAPIConfig } from '../api/copilotService'
import WelcomePage, { type WelcomeResult } from './welcome/WelcomePage'
import { getFilesSnapshot } from '../stores/fileStore'
import { getLorebooksSnapshot } from '../stores/lorebookStore'


// ============================================================================
// 主编辑器组件
// ============================================================================

const TAB_STORAGE_KEY = 'state-data-editor-active-tab'
const HISTORY_STORAGE_KEY = 'state-data-editor-history'


export const StateDataEditor: React.FC<EditorProps> = ({
  onSaveState,
  onLoadState,
  onListSaves,
  onLoadSave,
  onDeleteSave,
  onClearSaves,
  onPublishApp,
  disableImport,
  onLaunchGame
}) => {
  const { t } = useTranslation(['editor', 'common'])
  const hasCustomGame = useCustomGameAvailable()
  // 从 localStorage 恢复标签页状态
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem(TAB_STORAGE_KEY)
    return (saved as TabType) || 'world'
  })

  const [data, setData] = useState<StateData>(() => {
    return {
      World: createEmptyWorld(),
      Creatures: [],
      Regions: [],
      Organizations: [],
      StoryHistory: [],
      GameInitialStory: undefined
    }
  })

  // 撤销/重做历史记录
  const [history, setHistory] = useState<StateData[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const isUndoRedoRef = useRef(false)

  // 脏数据跟踪：记录上次保存的数据快照
  const savedDataRef = useRef<StateData | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // WorldBuilderNext session
  const [wbnSession, setWbnSession] = useState<WBNSession | null>(() => {
    const id = getCurrentSessionId()
    if (id) {
      const s = loadWBNSession(id)
      if (s && s.status === 'active') return s
    }
    return null
  })

  const [showWbnBanner, setShowWbnBanner] = useState(() => !!wbnSession)
  const [pausedWbnSession, setPausedWbnSession] = useState<WBNSession | null>(() => findPausedSession())

  const handleCloseWorldBuilder = useCallback(() => {
    setWbnSession(null)
    setShowWbnBanner(false)
    endWBNSession()
    // Re-check for paused sessions (the session we just closed might have been paused)
    setPausedWbnSession(findPausedSession())
  }, [])

  const handleDiscardPaused = useCallback(() => {
    if (pausedWbnSession) {
      deleteWBNSession(pausedWbnSession.id)
    }
    setPausedWbnSession(null)
  }, [pausedWbnSession])

  // Config for WorldBuilderBanner (loaded directly, not via window globals)
  const wbnConfigRef = useRef(loadCopilotConfigFromAPIConfig())

  // Welcome page (first-visit onboarding)
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem('welcome-completed')
  })

  // 异步操作 loading 状态
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingFromGame, setIsLoadingFromGame] = useState(false)
  const [isSyncingState, setIsSyncingState] = useState(false)

  // 保存标签页状态到 localStorage
  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab)
  }, [activeTab])

  // 脏数据检测
  useEffect(() => {
    if (savedDataRef.current === null) return
    const dirty = JSON.stringify(data) !== JSON.stringify(savedDataRef.current)
    setIsDirty(dirty)
  }, [data])


  // 离开页面警告
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // 更新数据并记录历史（用于撤销/重做）
  const updateDataWithHistory = useCallback((newData: StateData) => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false
      setData(newData)
      return
    }

    // 截断历史（如果在中间位置进行了新编辑）
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(data) // 保存当前状态

    // 限制历史记录数量（最多保存50条）
    if (newHistory.length > 50) {
      newHistory.shift()
    }

    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
    setData(newData)
  }, [data, history, historyIndex])

  // 撤销
  const handleUndo = useCallback(() => {
    if (historyIndex >= 0) {
      isUndoRedoRef.current = true
      const previousState = history[historyIndex]
      setHistoryIndex(historyIndex - 1)
      setData(previousState)
      showToast(t('common:undone'), 'info')
    }
  }, [history, historyIndex, t])

  // 重做
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isUndoRedoRef.current = true
      setHistoryIndex(historyIndex + 1)
      setData(history[historyIndex + 1])
      showToast(t('common:redone'), 'info')
    }
  }, [history, historyIndex, t])

  // Welcome page handlers (needs updateDataWithHistory)
  const handleWelcomeComplete = useCallback((result: WelcomeResult) => {
    localStorage.setItem('welcome-completed', 'true')
    setShowWelcome(false)

    // Refresh API config for WorldBuilder
    wbnConfigRef.current = loadCopilotConfigFromAPIConfig()

    // Clear editor data
    const emptyState: StateData = {
      World: createEmptyWorld(),
      Creatures: [],
      Regions: [],
      Organizations: [],
      StoryHistory: [],
      GameInitialStory: undefined,
    }
    updateDataWithHistory(emptyState)

    // Get reference files and lorebooks from stores, merge into single objects
    const refFile = mergeReferenceFiles(uploadedFilesToReferenceFiles(getFilesSnapshot()))
    const refLorebook = mergeLorebooks(getLorebooksSnapshot())

    // Create WorldBuilder session and auto-start
    const session = startNewSession(result.prompt, refFile, refLorebook)
    setWbnSession(session)
    setShowWbnBanner(true)
  }, [updateDataWithHistory])

  const handleWelcomeSkip = useCallback(() => {
    localStorage.setItem('welcome-completed', 'true')
    setShowWelcome(false)
  }, [])

  // 存档管理对话框状态
  const [showSaveManager, setShowSaveManager] = useState(false)

  // 游戏启动状态
  const [showGameSelect, setShowGameSelect] = useState(false)
  const [activeGame, setActiveGame] = useState<'custom_template' | 'custom' | 'test' | 'ink' | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)

  // API 配置模态框状态
  const [showAPIConfig, setShowAPIConfig] = useState(false)

  // Simple mode has been removed from backend
  const simpleMode = false

  // 加载游戏状态到编辑器（不询问，直接加载）
  const loadGameStateToEditor = useCallback(async () => {
    setIsSyncingState(true)
    try {
      const loadedState = await onLoadState()
      if (loadedState) {
        setData(loadedState)
        savedDataRef.current = loadedState
        return true
      }
    } catch (e) {
      console.debug('Load game state failed:', e)
    } finally {
      setIsSyncingState(false)
    }
    return false
  }, [onLoadState])

  // 初始化时自动加载游戏状态
  const hasInitializedRef = useRef(false)
  React.useEffect(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      loadGameStateToEditor()
    }
  }, [loadGameStateToEditor])

  // 从游戏返回编辑器时自动加载状态（不再询问）
  const prevActiveGameRef = useRef(activeGame)
  React.useEffect(() => {
    // 只有从游戏界面（非 null）返回到编辑器（null）时才触发
    if (prevActiveGameRef.current !== null && activeGame === null) {
      loadGameStateToEditor()
    }
    prevActiveGameRef.current = activeGame
  }, [activeGame, loadGameStateToEditor])

  // 页面从 bfcache 恢复时（如触控板左滑后退再前进），重新同步游戏状态
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        loadGameStateToEditor()
      }
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [loadGameStateToEditor])

  // 存档加载后的回调：从游戏加载最新状态
  const handleAfterLoadSave = useCallback(async () => {
    try {
      const loadedState = await onLoadState()
      if (loadedState) {
        setData(loadedState)
      } else {
        throw new Error(t('alerts.noGameState'))
      }
    } catch (e) {
      throw new Error(t('alerts.loadGameStateFailed', { error: (e as Error).message }))
    }
  }, [onLoadState, t])

  // onBack 回调

  const handleBackToEditor = useCallback(async () => {
    setIsSyncingState(true)
    try {
      const result = await window.GetStateFromGame()
      if (result.success && result.data) {
        const validation = validateAndLoadState(result.data)
        if (validation.accepted && validation.state) {
          setData(validation.state)
          savedDataRef.current = validation.state
          if (validation.autoFixes.length > 0) {
            showToast(t('file.autoFixApplied', { count: validation.autoFixes.length }), 'info')
          } else {
            showToast(t('game.loadedFromGame'), 'success')
          }
        } else {
          showAlert(t('file.validationFailed') + '\n\n' + validation.errors.join('\n'))
        }
      }
    } finally {
      setIsSyncingState(false)
    }
    setActiveGame(null)
  }, [t])

  // 打开存档管理
  const handleOpenSaveManager = useCallback(() => {
    if (!onListSaves || !onLoadSave || !onDeleteSave || !onClearSaves) {
      showAlert(t('saves.notAvailable'))
      return
    }
    setShowSaveManager(true)
  }, [onListSaves, onLoadSave, onDeleteSave, onClearSaves, t])

  // 发布中状态
  const [isPublishing, setIsPublishing] = useState(false)

  // 发布应用（直接发布当前状态，不修改 AppInfo）
  const handlePublish = useCallback(async () => {
    if (!onPublishApp) {
      showAlert(t('publish.notAvailable'))
      return
    }

    try {
      setIsPublishing(true)
      // 保存当前状态到游戏
      showToast(t('publish.savingState'), 'info')
      await onSaveState(data)
      savedDataRef.current = data

      // 调用发布服务
      showToast(t('publish.publishing'), 'info')
      const result = await onPublishApp()

      if (result.success) {
        const message = result.artifactId
          ? t('publish.successWithId', { id: result.artifactId })
          : t('publish.success')
        showToast(message, 'success', 4000)
      } else {
        throw new Error(result.error || t('publish.failed'))
      }
    } catch (e) {
      showAlert(t('publish.error', { error: (e as Error).message }))
    } finally {
      setIsPublishing(false)
    }
  }, [onPublishApp, onSaveState, data, t])

  // 切换应用类型（SetAppInfo + 同步 data.AppInfo + 保存状态到游戏）
  const handleSwitchAppType = useCallback(async (publishType: 'EDITOR' | 'INK') => {
    try {
      await window.SetAppInfo({ data: { publish_type: publishType } })
      const updatedData = { ...data, AppInfo: { publish_type: publishType } }
      await onSaveState(updatedData)
      setData(updatedData)
      savedDataRef.current = updatedData
      setCurrentAppType(publishType)
      showToast(t('app.switchSuccess', { type: publishType === 'EDITOR' ? t('app.typeEditor') : t('app.typeInk') }), 'success')
    } catch (e) {
      showAlert(t('publish.error', { error: (e as Error).message }))
    }
  }, [onSaveState, data, t])

  // 当前 AppInfo 类型（从 data.AppInfo 同步）
  const [currentAppType, setCurrentAppType] = useState<string>(() => {
    return data.AppInfo?.publish_type?.toUpperCase() || 'EDITOR'
  })
  useEffect(() => {
    setCurrentAppType(data.AppInfo?.publish_type?.toUpperCase() || 'EDITOR')
  }, [data.AppInfo?.publish_type])

  // 导出为 JSON 或 PNG 文件
  const handleExport = useCallback(async () => {
    const format = await showChoice<'json' | 'png'>(t('file.selectExportFormat'), [
      { value: 'json', label: t('file.jsonFile'), icon: '📄', description: t('file.exportJsonDesc') },
      { value: 'png', label: t('file.pngImage'), icon: '🖼️', description: t('file.exportPngDesc') }
    ])

    if (!format) return

    const dateStr = new Date().toISOString().slice(0, 10)

    // Stamp v2 version flag for export
    const exportData = { ...data, _save_version: 'v2' as const }

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `game-state-${dateStr}.json`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      try {
        // 先选择封面类型
        const coverType = await showChoice<'default' | 'custom'>(t('file.selectCover'), [
          { value: 'default', label: t('file.defaultCover'), icon: '🎨', description: t('file.defaultCoverDesc') },
          { value: 'custom', label: t('file.customCover'), icon: '📷', description: t('file.customCoverDesc') }
        ])

        if (!coverType) return

        let customImage: File | undefined

        if (coverType === 'custom') {
          // 让用户选择图片
          customImage = await new Promise<File | undefined>((resolve) => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0]
              resolve(file)
            }
            input.oncancel = () => resolve(undefined)
            input.click()
          })

          if (!customImage) return
        }

        const pngBlob = await encodeDataToPng(exportData, customImage)
        const dataUrl = await blobToDataUrl(pngBlob)

        // 提取翻译文本
        const i18nTexts = {
          pageTitle: t('file.exportPageTitle', { date: dateStr }),
          heading: t('file.exportHeading'),
          tips: t('file.exportTips'),
          imageAlt: t('file.exportImageAlt', { date: dateStr }),
          downloadBtn: t('file.downloadImage'),
          closeBtn: t('common:close')
        }

        // 在新窗口显示图片，让用户可以右键保存
        const win = window.open('', '_blank')
        if (win) {
          win.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <title>${i18nTexts.pageTitle}</title>
              <style>
                body {
                  margin: 0;
                  padding: 20px;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  font-family: Arial, sans-serif;
                }
                .container {
                  background: white;
                  padding: 30px;
                  border-radius: 12px;
                  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                  max-width: 90%;
                  text-align: center;
                }
                h2 {
                  margin: 0 0 10px 0;
                  color: #333;
                }
                .tips {
                  color: #666;
                  margin-bottom: 20px;
                  font-size: 14px;
                }
                img {
                  max-width: 100%;
                  height: auto;
                  border: 2px solid #ddd;
                  border-radius: 8px;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                  cursor: pointer;
                }
                img:hover {
                  border-color: #667eea;
                }
                .actions {
                  margin-top: 20px;
                  display: flex;
                  gap: 12px;
                  justify-content: center;
                }
                button {
                  padding: 10px 24px;
                  border: none;
                  border-radius: 6px;
                  font-size: 14px;
                  cursor: pointer;
                  transition: all 0.2s;
                }
                .btn-download {
                  background: #667eea;
                  color: white;
                }
                .btn-download:hover {
                  background: #5568d3;
                }
                .btn-close {
                  background: #f5f5f5;
                  color: #333;
                }
                .btn-close:hover {
                  background: #e0e0e0;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h2>${i18nTexts.heading}</h2>
                <p class="tips">${i18nTexts.tips}</p>
                <img src="${dataUrl}" alt="${i18nTexts.imageAlt}" />
                <div class="actions">
                  <button class="btn-download" onclick="downloadImage()">${i18nTexts.downloadBtn}</button>
                  <button class="btn-close" onclick="window.close()">${i18nTexts.closeBtn}</button>
                </div>
              </div>
              <script>
                function downloadImage() {
                  const a = document.createElement('a');
                  a.href = "${dataUrl}";
                  a.download = "game-state-${dateStr}.png";
                  a.click();
                }
              </script>
            </body>
            </html>
          `)
          win.document.close()
        } else {
          // 如果无法打开新窗口，降级为直接下载
          const a = document.createElement('a')
          a.href = dataUrl
          a.download = `game-state-${dateStr}.png`
          a.click()
        }
      } catch (e) {
        showAlert(t('file.exportFailed', { error: (e as Error).message }))
      }
    }
  }, [data, t])

  // 从 JSON 或 PNG 文件导入
  const handleImport = useCallback(async () => {
    const format = await showChoice<'json' | 'png'>(t('file.selectImportFormat'), [
      { value: 'json', label: t('file.jsonFile'), icon: '📄', description: t('file.importJsonDesc') },
      { value: 'png', label: t('file.pngImage'), icon: '🖼️', description: t('file.importPngDesc') }
    ])

    if (!format) return

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = format === 'json' ? '.json' : '.png,image/png'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        let raw: unknown
        if (format === 'json') {
          const text = await file.text()
          raw = JSON.parse(text)
        } else {
          raw = await decodeDataFromPng(file)
          if (!raw) {
            showAlert(t('file.noGameData'))
            return
          }
        }

        const validation = validateAndLoadState(raw, { requireV2: true })
        if (!validation.accepted || !validation.state) {
          const isVersionError = validation.errors.some(e => e.includes('_save_version'))
          if (isVersionError) {
            showAlert(t('file.incompatibleVersion'))
          } else {
            showAlert(t('file.validationFailed') + '\n\n' + validation.errors.join('\n'))
          }
          return
        }
        setData(validation.state)
        if (validation.autoFixes.length > 0) {
          showToast(t('file.autoFixApplied', { count: validation.autoFixes.length }), 'info')
        } else {
          showToast(t('common:importSuccess'), 'success')
        }
      } catch {
        showAlert(t('file.importFailed'))
      }
    }
    input.click()
  }, [t])

  // 清空数据
  const handleClear = useCallback(async () => {
    if (await showConfirm(t('file.confirmClear'))) {
      setData({
        World: createEmptyWorld(),
        Creatures: [],
        Regions: [],
        Organizations: [],
        StoryHistory: [],
        GameInitialStory: undefined
      })
    }
  }, [t])

  // 从游戏加载状态
  const handleLoadFromGame = useCallback(async () => {
    setIsLoadingFromGame(true)
    try {
      const loadedState = await onLoadState()
      if (loadedState) {
        setData(loadedState)
        savedDataRef.current = loadedState
        showToast(t('game.loadedFromGame'), 'success')
      } else {
        showAlert(t('game.loadFailed'))
      }
    } catch (e) {
      showAlert(t('game.readStateFailed', { error: (e as Error).message }))
    } finally {
      setIsLoadingFromGame(false)
    }
  }, [onLoadState, t])

  // 保存到游戏
  const handleSaveToGame = useCallback(async () => {
    // 先验证数据
    const errors = validateStateData(data)
    const criticalErrors = errors.filter(e => e.severity === 'error')
    if (criticalErrors.length > 0) {
      const confirmSave = await showConfirm(
        t('validation.errorsFound', { count: criticalErrors.length }) + '\n' +
        criticalErrors.slice(0, 3).map(e => `- ${e.message}`).join('\n') +
        (criticalErrors.length > 3 ? t('validation.moreErrors', { count: criticalErrors.length }) : '') +
        '\n\n' + t('validation.confirmSave')
      )
      if (!confirmSave) return
    }

    setIsSaving(true)
    try {
      await onSaveState(data)
      savedDataRef.current = data
      showToast(t('game.savedToGame'), 'success')
    } catch (e) {
      showAlert(t('game.saveFailed', { error: (e as Error).message }))
    } finally {
      setIsSaving(false)
    }
  }, [data, onSaveState, t])

  // 验证数据
  const validationErrors = useMemo(() => validateStateData(data), [data])

  // 快捷键帮助对话框
  const showKeyboardShortcuts = useCallback(() => {
    const pad = (s: string, len: number) => s + ' '.repeat(Math.max(0, len - s.length))
    showAlert(
      `${t('shortcuts.title')}\n\n` +
      `${pad('Ctrl+S', 16)} ${t('shortcuts.save')}\n` +
      `${pad('Ctrl+Z', 16)} ${t('shortcuts.undo')}\n` +
      `${pad('Ctrl+Shift+Z', 16)} ${t('shortcuts.redo')}\n` +
      `${pad('Ctrl+Y', 16)} ${t('shortcuts.redoAlt')}\n` +
      `${pad('Ctrl+/', 16)} ${t('shortcuts.showHelp')}`
    )
  }, [t])

  // 快捷键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果游戏界面正在显示，不处理快捷键
      if (activeGame) return

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault()
            handleSaveToGame()
            break
          case 'z':
            if (e.shiftKey) {
              // Ctrl+Shift+Z = 重做
              e.preventDefault()
              handleRedo()
            } else {
              // Ctrl+Z = 撤销
              e.preventDefault()
              handleUndo()
            }
            break
          case 'y':
            // Ctrl+Y = 重做
            e.preventDefault()
            handleRedo()
            break
          case '/':
            // Ctrl+/ = 快捷键帮助
            e.preventDefault()
            showKeyboardShortcuts()
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveToGame, handleUndo, handleRedo, activeGame, showKeyboardShortcuts])

  // 快速新建组织
  const handleCreateOrganization = useCallback((name: string): string | undefined => {
    const orgId = `org_${Date.now()}`
    const newOrg = {
      entity_id: Date.now(),
      Organization: {
        organization_id: orgId,
        name: name,
        description: ''
      },
      Inventory: { items: [] }
    }
    const newOrgs = [...(data.Organizations || []), newOrg]
    updateDataWithHistory({ ...data, Organizations: newOrgs })
    return orgId
  }, [data, updateDataWithHistory])

  // 快速新建地域
  const handleCreateRegion = useCallback((name: string): string | undefined => {
    const regionId = `region_${Date.now()}`
    const newRegion = {
      entity_id: Date.now(),
      Metadata: {
        name: name,
        desc: ''
      },
      Region: {
        region_id: regionId,
        region_name: name,
        description: '',
        locations: [],
        paths: []
      },
      Log: { entries: [] }
    }
    const newRegions = [...(data.Regions || []), newRegion]
    updateDataWithHistory({ ...data, Regions: newRegions })
    return regionId
  }, [data, updateDataWithHistory])

  const tabs: { key: TabType; label: string; icon: string }[] = [
    { key: 'world', label: t('tabs.world'), icon: '🌍' },
    { key: 'creatures', label: t('tabs.creatures'), icon: '👥' },
    { key: 'regions', label: t('tabs.regions'), icon: '🗺️' },
    { key: 'organizations', label: t('tabs.organizations'), icon: '🏛️' },
    { key: 'initial-story', label: t('tabs.initialStory'), icon: '🎬' },
    { key: 'story-history', label: t('tabs.storyHistory'), icon: '📜' },
    { key: 'wiki', label: t('tabs.wiki'), icon: '📖' },
  ]

  // 下拉菜单状态
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleDropdown = (menu: string) => {
    setActiveDropdown(activeDropdown === menu ? null : menu)
  }

  const closeDropdown = () => {
    setActiveDropdown(null)
  }

  // Copilot 面板展开状态
  const [isCopilotExpanded, setIsCopilotExpanded] = useState(false)



  return (
    <div className="paper-editor">
          {/* 顶部工具栏 */}
          <div className="paper-header">
          <div className="paper-header-left">
            <h1>{t('title')}</h1>
          </div>
          <div className="toolbar" ref={dropdownRef}>
            {/* 编辑菜单 */}
            <div className="dropdown-menu">
              <button className="btn-toolbar" onClick={() => toggleDropdown('edit')}>
                ✏️ {t('menus.edit')} ▾
              </button>
              {activeDropdown === 'edit' && (
                <div className="dropdown-content">
                  <button
                    onClick={() => { handleUndo(); closeDropdown(); }}
                    disabled={historyIndex < 0}
                  >
                    ↩️ {t('toolbar.undo')} {historyIndex >= 0 && <span className="history-badge">({historyIndex + 1})</span>} <span className="shortcut">Ctrl+Z</span>
                  </button>
                  <button
                    onClick={() => { handleRedo(); closeDropdown(); }}
                    disabled={historyIndex >= history.length - 1}
                  >
                    ↪️ {t('toolbar.redo')} {historyIndex < history.length - 1 && <span className="history-badge">({history.length - 1 - historyIndex})</span>} <span className="shortcut">Ctrl+Y</span>
                  </button>
                  <div className="dropdown-divider"></div>
                  <button onClick={() => { showKeyboardShortcuts(); closeDropdown(); }}>
                    ⌨️ {t('menus.keyboardShortcuts')} <span className="shortcut">Ctrl+/</span>
                  </button>
                </div>
              )}
            </div>

            {/* 文件菜单 */}
            {!disableImport && (
              <div className="dropdown-menu">
                <button className="btn-toolbar" onClick={() => toggleDropdown('file')}>
                  📁 {t('menus.file')} ▾
                </button>
                {activeDropdown === 'file' && (
                  <div className="dropdown-content">
                    <button onClick={() => { handleExport(); closeDropdown(); }}>
                      📤 {t('toolbar.exportFile')}
                    </button>
                    <button onClick={() => { handleImport(); closeDropdown(); }}>
                      📥 {t('toolbar.importFile')}
                    </button>
                    <div className="dropdown-divider"></div>
                    <button className="danger" onClick={() => { handleClear(); closeDropdown(); }}>
                      🗑️ {t('toolbar.clearData')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 启动游戏分体按钮 */}
            {!disableImport && (
              <div className="btn-split-group">
                <button
                  className={`btn-toolbar btn-launch btn-split-main${isLaunching ? ' btn-loading' : ''}`}
                  onClick={async () => {
                    if (isLaunching) return
                    setIsLaunching(true)
                    try {
                      await handleSaveToGame()
                      await syncAPIConfigToBackend()
                      if (onLaunchGame) {
                        await onLaunchGame()
                      } else {
                        setActiveGame('ink')
                      }
                    } finally {
                      setIsLaunching(false)
                    }
                  }}
                  disabled={isLaunching}
                  title={t('toolbar.launchGame')}
                >
                  🎮 <span className="btn-text">{isLaunching ? t('toolbar.launching') : t('toolbar.launch')}</span>
                </button>
                <button
                  className="btn-toolbar btn-launch btn-split-more"
                  onClick={() => {
                    if (onLaunchGame) {
                      showAlert(t('toolbar.gameRunningAlert'))
                    } else {
                      setShowGameSelect(true)
                    }
                  }}
                  disabled={isLaunching}
                  title={t('toolbar.launchMore')}
                >
                  ▾
                </button>
              </div>
            )}

            {/* AI 下拉菜单 (桌面端显示) */}
            <div className="dropdown-menu toolbar-desktop-only">
              <button
                className={`btn-toolbar btn-ai ${isCopilotExpanded || showWbnBanner || wbnSession ? 'active' : ''}`}
                onClick={() => toggleDropdown('ai')}
              >
                🤖 <span className="btn-text">AI</span> ▾
              </button>
              {activeDropdown === 'ai' && (
                <div className="dropdown-content">
                  <button onClick={() => { setIsCopilotExpanded(!isCopilotExpanded); closeDropdown(); }}>
                    🤖 {t('toolbar.aiAssistant')}
                    {isCopilotExpanded && <span className="check-mark">✓</span>}
                  </button>
                  <button onClick={() => { setShowWbnBanner(prev => !prev); closeDropdown(); }}>
                    🌍 {t('worldBuilder.toolbarLabel')}
                    {(showWbnBanner || wbnSession) && <span className="check-mark">✓</span>}
                  </button>
                </div>
              )}
            </div>

            {/* 应用下拉菜单 */}
            <div className="dropdown-menu toolbar-desktop-only">
              <button className="btn-toolbar" onClick={() => toggleDropdown('app')}>
                📦 <span className="btn-text">{t('app.label')}</span> ▾
              </button>
              {activeDropdown === 'app' && (
                <div className="dropdown-content">
                  <div className="dropdown-info">
                    {t('app.currentType', { type: currentAppType === 'EDITOR' ? t('app.typeEditor') : t('app.typeInk') })}
                  </div>
                  <div className="dropdown-divider"></div>
                  {onPublishApp && (
                    <button onClick={async () => { closeDropdown(); await handlePublish(); }}>
                      🚀 {t('app.publish')}
                    </button>
                  )}
                  {currentAppType !== 'EDITOR' ? (
                    <>
                      <button onClick={async () => { closeDropdown(); await handleSwitchAppType('EDITOR'); }}>
                        🔄 {t('app.switchToEditor')}
                      </button>
                      <div className="dropdown-hint">{t('app.switchToEditorHint')}</div>
                    </>
                  ) : (
                    <>
                      <button onClick={async () => { closeDropdown(); await handleSwitchAppType('INK'); }}>
                        🔄 {t('app.switchToInk')}
                      </button>
                      <div className="dropdown-hint">{t('app.switchToInkHint')}</div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* API 设置按钮 */}
            <button
              className="btn-toolbar btn-settings"
              onClick={() => setShowAPIConfig(true)}
              title={t('toolbar.apiConfig')}
            >
              ⚙️ <span className="btn-text">{t('toolbar.api')}</span>
            </button>

            {/* 语言切换器 (桌面端显示) */}
            <div className="toolbar-desktop-only">
              <LanguageSelector />
            </div>

            {/* 移动端溢出菜单 */}
            <div className="dropdown-menu toolbar-overflow-menu">
              <button className="btn-toolbar btn-overflow" onClick={() => toggleDropdown('overflow')}>
                ⋯
              </button>
              {activeDropdown === 'overflow' && (
                <div className="dropdown-content">
                  <button onClick={() => { setIsCopilotExpanded(!isCopilotExpanded); closeDropdown(); }}>
                    🤖 {t('toolbar.aiAssistant')}
                    {isCopilotExpanded && <span className="check-mark">✓</span>}
                  </button>
                  <button onClick={() => { setShowWbnBanner(prev => !prev); closeDropdown(); }}>
                    🌍 {t('worldBuilder.toolbarLabel')}
                    {(showWbnBanner || wbnSession) && <span className="check-mark">✓</span>}
                  </button>
                  <div className="dropdown-divider"></div>
                  <div className="dropdown-info">
                    {t('app.currentType', { type: currentAppType === 'EDITOR' ? t('app.typeEditor') : t('app.typeInk') })}
                  </div>
                  {onPublishApp && (
                    <button onClick={async () => { closeDropdown(); await handlePublish(); }}>
                      🚀 {t('app.publish')}
                    </button>
                  )}
                  {currentAppType !== 'EDITOR' ? (
                    <>
                      <button onClick={async () => { closeDropdown(); await handleSwitchAppType('EDITOR'); }}>
                        🔄 {t('app.switchToEditor')}
                      </button>
                      <div className="dropdown-hint">{t('app.switchToEditorHint')}</div>
                    </>
                  ) : (
                    <>
                      <button onClick={async () => { closeDropdown(); await handleSwitchAppType('INK'); }}>
                        🔄 {t('app.switchToInk')}
                      </button>
                      <div className="dropdown-hint">{t('app.switchToInkHint')}</div>
                    </>
                  )}
                  <div className="dropdown-divider"></div>
                  <button className="overflow-language-item" onClick={(e) => e.stopPropagation()}>
                    <LanguageSelector />
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* WorldBuilderNext Banner (above tabs) */}
        {showWbnBanner && (
          <WorldBuilderBanner
            session={wbnSession}
            onSessionChange={(s) => { setWbnSession(s); if (s) setPausedWbnSession(null); }}
            state={data}
            onStateChange={updateDataWithHistory}
            onTabChange={setActiveTab}
            config={wbnConfigRef.current}
            onClose={handleCloseWorldBuilder}
            pausedSession={!wbnSession ? pausedWbnSession : null}
            onDiscardPaused={handleDiscardPaused}
          />
        )}

        {/* 顶部标签导航 */}
        <EditorTabs activeTab={activeTab} onTabChange={setActiveTab} disabled={!!wbnSession} />

        {/* 主内容区：内容 + AI面板 */}
        <div className="paper-main">
          {/* 内容区 */}
          <div className="paper-content" style={wbnSession ? { position: 'relative' } : undefined}>
            {/* Generating overlay - blocks interaction */}
            {wbnSession && ['active', 'generating'].includes(wbnSession.phases[wbnSession.currentPhase]?.status) && (
              <div className="wbn-generating-overlay">
                <div className="wbn-generating-overlay-content">
                  <span className="wbn-spinner" />
                  <span>{t('worldBuilder.generatingOverlay')}</span>
                </div>
              </div>
            )}
            {/* Waiting/revising indicator - non-blocking subtle overlay */}
            {wbnSession && !['active', 'generating'].includes(wbnSession.phases[wbnSession.currentPhase]?.status) && (
              <div className="wbn-active-indicator" />
            )}

            {activeTab === 'world' && (
              <WorldEditor
                world={data.World}
                onChange={world => updateDataWithHistory({ ...data, World: world })}
                simpleMode={simpleMode}
              />
            )}
            {activeTab === 'creatures' && (
              <CreaturesEditor
                creatures={luaList(data.Creatures)}
                world={data.World}
                onChange={creatures => updateDataWithHistory({ ...data, Creatures: creatures })}
                organizations={luaList(data.Organizations)}
                regions={luaList(data.Regions)}
                onCreateOrganization={handleCreateOrganization}
                onCreateRegion={handleCreateRegion}
                simpleMode={simpleMode}
              />
            )}
            {activeTab === 'regions' && (
              <RegionsEditor
                regions={luaList(data.Regions)}
                onChange={regions => updateDataWithHistory({ ...data, Regions: regions })}
              />
            )}
            {activeTab === 'organizations' && (
              <OrganizationsEditor
                organizations={luaList(data.Organizations)}
                onChange={organizations => updateDataWithHistory({ ...data, Organizations: organizations })}
                regions={luaList(data.Regions)}
                world={data.World}
              />
            )}
            {activeTab === 'initial-story' && (
              <GameInitialStoryEditor
                story={data.GameInitialStory}
                onChange={story => updateDataWithHistory({ ...data, GameInitialStory: story })}
              />
            )}
            {activeTab === 'story-history' && (
              <StoryHistoryEditor
                history={data.StoryHistory}
              />
            )}
            {activeTab === 'wiki' && (
              <GameWikiEntryEditor
                entries={data.GameWikiEntry}
                onChange={entries => updateDataWithHistory({ ...data, GameWikiEntry: entries })}
              />
            )}
          </div>

          {/* AI Copilot 助手面板 */}
          {!activeGame && (
            <AICopilotPanel
              state={data}
              onStateChange={updateDataWithHistory}
              isExpanded={isCopilotExpanded}
              onExpandedChange={setIsCopilotExpanded}
            />
          )}
        </div>

        {/* 验证面板 */}
        <ValidationPanel errors={validationErrors} />

        {/* 发布等待遮罩 */}
        {isPublishing && (
          <div className="paper-modal-overlay" style={{ zIndex: 9999 }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              color: 'white',
              textAlign: 'center',
            }}>
              <div className="publishing-spinner" />
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{t('publish.publishing')}</div>
              <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{t('publish.pleaseWait')}</div>
            </div>
          </div>
        )}

        {/* 状态同步遮罩：防止在加载游戏最新状态期间操作编辑器 */}
        {isSyncingState && (
          <div className="paper-modal-overlay" style={{ zIndex: 9998 }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              color: 'white',
              textAlign: 'center',
            }}>
              <div className="publishing-spinner" />
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{t('game.syncingState')}</div>
            </div>
          </div>
        )}

        {/* 存档管理对话框 */}
        {showSaveManager && onListSaves && onLoadSave && onDeleteSave && onClearSaves && (
          <SaveManager
            onClose={() => setShowSaveManager(false)}
            onListSaves={onListSaves}
            onLoadSave={onLoadSave}
            onDeleteSave={onDeleteSave}
            onClearSaves={onClearSaves}
            onAfterLoad={handleAfterLoadSave}
          />
        )}

        {/* 游戏启动对话框 - 选择游戏前端 */}
        {showGameSelect && (
          <div className="paper-editor paper-modal-overlay">
            <div className="paper-modal" style={{ maxWidth: '520px' }}>
              <div className="paper-modal-header">
                <h3>🎮 {t('gameLaunch.selectFrontend')}</h3>
                <button className="paper-modal-close" onClick={() => {
                  setShowGameSelect(false)
                }}>✕</button>
              </div>
              <div className="paper-modal-body">
                <div className="game-select-grid">
                  <button
                    className="game-card"
                    onClick={async () => {
                      await handleSaveToGame()
                      await syncAPIConfigToBackend()
                      setShowGameSelect(false)
                      setActiveGame('test')
                    }}
                  >
                    <div className="game-icon">🧪</div>
                    <h4>{t('gameLaunch.testGame')}</h4>
                    <p>{t('gameLaunch.testGameDesc')}</p>
                  </button>

                  <button
                    className="game-card"
                    onClick={async () => {
                      await handleSaveToGame()
                      await syncAPIConfigToBackend()
                      setShowGameSelect(false)
                      setActiveGame('ink')
                    }}
                  >
                    <div className="game-icon">✨</div>
                    <h4>{t('gameLaunch.inkGame')}</h4>
                    <p>{t('gameLaunch.inkGameDesc')}</p>
                  </button>

                  <button
                    className="game-card"
                    onClick={async () => {
                      await handleSaveToGame()
                      await syncAPIConfigToBackend()
                      setShowGameSelect(false)
                      setActiveGame('custom_template')
                    }}
                  >
                    <div className="game-icon">🎮</div>
                    <h4>{t('gameLaunch.customTemplateGame')}</h4>
                    <p>{t('gameLaunch.customTemplateGameDesc')}</p>
                  </button>

                  {hasCustomGame && (
                    <button
                      className="game-card"
                      onClick={async () => {
                        await handleSaveToGame()
                        await syncAPIConfigToBackend()
                        setShowGameSelect(false)
                        setActiveGame('custom')
                      }}
                    >
                      <div className="game-icon">🎯</div>
                      <h4>{t('gameLaunch.customGame')}</h4>
                      <p>{t('gameLaunch.customGameDesc')}</p>
                    </button>
                  )}

                </div>
              </div>
            </div>
          </div>
        )}

        {activeGame === 'test' && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2000,
            background: '#1a202c'
          }}>
            <TestGame onBack={handleBackToEditor} />
          </div>
        )}

        {activeGame === 'ink' && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2000,
            background: '#1a202c'
          }}>
            <InkGame onBack={handleBackToEditor} />
          </div>
        )}

        {activeGame === 'custom_template' && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2000,
            background: '#1a202c'
          }}>
            <CustomTemplateGame onBack={handleBackToEditor} />
          </div>
        )}

        {activeGame === 'custom' && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2000,
            background: '#1a202c'
          }}>
            <Suspense fallback={<div>Loading...</div>}>
              <CustomGame onBack={handleBackToEditor} />
            </Suspense>
          </div>
        )}

        {/* API 配置模态框 */}
        <APIConfigModal
          isOpen={showAPIConfig}
          onClose={() => setShowAPIConfig(false)}
          onSave={() => { wbnConfigRef.current = loadCopilotConfigFromAPIConfig() }}
        />



        {/* (浮动窗口已移除) */}

        {/* Welcome Page Overlay (first-visit onboarding) */}
        {showWelcome && (
          <WelcomePage
            onComplete={handleWelcomeComplete}
            onSkip={handleWelcomeSkip}
          />
        )}
    </div>
  )
}

export default StateDataEditor
