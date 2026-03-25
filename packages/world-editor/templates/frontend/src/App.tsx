import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import StateDataEditor from './components/StateDataEditor'
import type { StateData, SetAPIConfigInput } from './api/types'
import { initSandboxClient } from '@pubwiki/sandbox-client'
import './App.css'
import { normalizeLuaData, denormalizeLuaData } from './utils/normalizeLuaData'
import APIConfigModal, { syncAPIConfigToBackend } from './components/APIConfigModal'
import { Settings } from 'lucide-react'

// 游戏组件导入
import TestGame from './games/test/index'
import InkGame from './games/ink/index'
import CustomGame from './games/custom_template/index'
import GalgameGame from './games/galgame/index'

type AppView = 'loading' | 'editor' | 'game'
type GameType = 'NOVEL' | 'INK' | 'TEST' | 'CUSTOM' | 'GALGAME'

function App() {
  const { t } = useTranslation('editor')
  const [status, setStatus] = useState('Initializing System...')
  const [initError, setInitError] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState<AppView>('loading')
  const [activeGame, setActiveGame] = useState<GameType | null>(null)
  const [showEditorOverlay, setShowEditorOverlay] = useState(false)
  const [showAPIConfig, setShowAPIConfig] = useState(false)
  

  useEffect(() => {
    const initSystem = async () => {
      try {

        setStatus('Loading Sandbox Client...')
        try{
          window.client = initSandboxClient()
        }catch(e){
          console.error(e)
        }

        // 便捷函数：GetStateFromGame
        window.GetStateFromGame = async () => {
          return await window.callService('state:GetStateFromGame', {})
        }
        
        // 便捷函数：LoadStateToGame
        window.LoadStateToGame = async (data) => {
          // 发送给 Lua 前反规范化数据
          return await window.callService('state:LoadStateToGame', { data: denormalizeLuaData(data) })
        }
        
        // 存档管理函数
        window.ListGameSaves = async () => {
          return await window.callService('save:ListGameSaves', {})
        }
        
        window.LoadGameSave = async (checkpointId: string) => {
          return await window.callService('save:LoadGameSave', { checkpointId })
        }

        window.DeleteGameSave = async (checkpointId: string) => {
          return await window.callService('save:DeleteGameSave', { checkpointId })
        }
        
        window.CreateGameSave = async (input?: { title?: string; description?: string }) => {
          return await window.callService('save:CreateGameSave', input || {})
        }

        window.GetAppInfo = async () => {
          return await window.callService('state:GetAppInfo', {})
        }

        window.SetAppInfo = async (input) => {
          return await window.callService('state:SetAppInfo', input)
        }

        window.PublishApp = async () => {
          return await window.callService('publish:PublishApp', {})
        }

        window.PublishArticle = async (input) => {
          console.log('Publishing article with input:', input)
          return await window.callService('publish:PublishArticle', input)
        }

        window.PublishCheckpoint = async (input) => {
          return await window.callService('publish:PublishCheckpoint', input)
        }

        window.SetAPIConfig = async (input: SetAPIConfigInput) => {
          console.log('Setting API config:', input)
          return await window.callService('chat:SetAPIConfig', input)
        }

        const cacheServiceMap: Record<string, any> = {}
        
        // callService 方法
        window.callService = async <T = any>(serviceName: string, params: any = {}): Promise<T> => {
          if(!cacheServiceMap[serviceName]) {
            const service = await window.client.getService(serviceName)
            if (!service) {
              throw new Error(`Service "${serviceName}" is not available in the sandbox.`)
            }
            cacheServiceMap[serviceName] = service
          }
          const service = cacheServiceMap[serviceName]
          console.log(`Calling service "${serviceName}" with params:`, params)
          const result = await service.call(params)
          console.log(`Service "${serviceName}" returned:`, result)
          if (((result as any).error || (result as any)._error)) {
            // error 为 服务返回的错误信息
            // _error 为 Lua 内部错误信息
            if(result.error){
              console.error(`Service "${serviceName}" error:`, result.error)
            }
            if((result as any)._error){
              console.error(`Call Service "${serviceName}" internal error:`, (result as any)._error)
            }
            throw new Error((result as any).error || (result as any)._error)
          }
          // 规范化 Lua 返回的数据，处理空对象/空数组问题
          return normalizeLuaData(result) as T
        }
        
        setStatus(t('init.checkingBackend'))
        try {
          const checkResult = await window.callService('GameTemplate:CheckGameAvailable', {})
          if (!checkResult.available) {
            setInitError(t('init.backendInitFailed'))
            return
          }
        } catch (e) {
          console.error('Failed to check game availability:', e)
          setInitError(t('init.backendInitFailed'))
          return
        }

        setStatus('Checking App Info...')

        // 获取 AppInfo 决定显示模式
        try {
          const appInfoResult = await window.GetAppInfo()
          console.log('AppInfo result:', appInfoResult)
          
          if (appInfoResult.success && appInfoResult.data) {
            const info = appInfoResult.data
            const publishType = info.publish_type?.toUpperCase()
            
            // 根据 publish_type 决定显示模式
            if (!publishType || publishType === 'EDITOR') {
              // 编辑器模式：直接进入编辑器
              setCurrentView('editor')
            } else {
              // 游戏模式：先同步 API 配置，然后加载对应游戏
              await syncAPIConfigToBackend()
              setCurrentView('game')
              setActiveGame(publishType as GameType)
            }
          } else {
            // AppInfo 为空或获取失败，进入编辑器模式
            console.log('AppInfo is empty or failed, entering editor mode')
            setCurrentView('editor')
          }
        } catch (e) {
          // 获取 AppInfo 失败，进入编辑器模式
          console.error('Failed to get AppInfo:', e)
          setCurrentView('editor')
        }

      } catch (e) {
        console.error(e)
        setInitError((e as Error).message)
      }
    }

    initSystem()
  }, [])

  // 保存游戏状态
  const handleSaveState = useCallback(async (data: StateData) => {
    try {
      setStatus('Saving Game State...')
      console.log('Saving game state data:', data)
      const result = await window.LoadStateToGame(data)
      console.log('Game state saved:', result)
      if (result.success) {
      } else {
        throw new Error(result.error || 'Unknown error')
      }
    } catch (e) {
      console.error('Failed to save game state:', e)
    }
  }, [])

  // 加载游戏状态
  const handleLoadState = useCallback(async (): Promise<StateData | null> => {
    try {
      setStatus('Loading Game State...')
      const result = await window.GetStateFromGame()
      if (result.success && result.data) {
        return result.data
      } else {
        throw new Error(result.error || 'Unknown error')
      }
    } catch (e) {
      console.error('Failed to load game state:', e)
      return null
    }
  }, [])
  
  // 列出所有存档
  const handleListSaves = useCallback(async () => {
    try {
      const result = await window.ListGameSaves()
      return result.saves || []
    } catch (e) {
      console.error('Failed to list saves:', e)
      return []
    }
  }, [])
  
  // 加载指定存档
  const handleLoadSave = useCallback(async (checkpointId: string) => {
    try {
      setStatus('Loading Save...')
      const result = await window.LoadGameSave(checkpointId)
      if (!result.success) {
        throw new Error(result.error || 'Failed to load save')
      }
    } catch (e) {
      console.error('Failed to load save:', e)
      throw e
    }
  }, [])

  // 发布应用
  const handlePublishApp = useCallback(async () => {
    try {
      const result = await window.PublishApp()
      return result
    } catch (e) {
      console.error('Failed to publish app:', e)
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error'
      }
    }
  }, [])

  // 渲染游戏组件
  const renderGame = () => {
    switch (activeGame) {
      case 'INK':
        return <InkGame onBack={() => setShowEditorOverlay(true)} />
      case 'TEST':
        return <TestGame onBack={() => setShowEditorOverlay(true)} />
      case 'CUSTOM':
        return <CustomGame onBack={() => setShowEditorOverlay(true)} />
      case 'GALGAME':
        return <GalgameGame onBack={() => setShowEditorOverlay(true)} />
      default:
        return null
    }
  }

  // 加载界面
  if (currentView === 'loading') {
    return (
      <div className="app">
        <p className="loading-status">{status}</p>
        {initError && (
          <div className="loading-error">
            <pre>{initError}</pre>
          </div>
        )}
      </div>
    )
  }

  // 纯编辑器模式（publish_type 为空或 EDITOR）
  if (currentView === 'editor') {
    return (
      <>
        <StateDataEditor
          onSaveState={handleSaveState}
          onLoadState={handleLoadState}
          onListSaves={handleListSaves}
          onLoadSave={handleLoadSave}
          onPublishApp={handlePublishApp}
          disableImport={false}
        />

        {/* 悬浮 API 设置按钮 — 所有模式通用 */}
        <div className="fab-group">
          <div
            className="fab fab-settings"
            onClick={() => setShowAPIConfig(true)}
            title={t('fab.apiSettings')}
          >
            <Settings size={22} />
          </div>
        </div>
        <APIConfigModal
          isOpen={showAPIConfig}
          onClose={() => setShowAPIConfig(false)}
        />
      </>
    )
  }

  // 游戏模式（带悬浮编辑器按钮）
  if (currentView === 'game') {
    return (
      <div className="app game-view">
        {/* 游戏主界面 */}
        <div className="game-container">
          {renderGame()}
        </div>

        {/* 悬浮 API 设置按钮 — 所有模式通用 */}
        <div className="fab-group">
          <div
            className="fab fab-settings"
            onClick={() => setShowAPIConfig(true)}
            title={t('fab.apiSettings')}
          >
            <Settings size={22} />
          </div>
        </div>

        {/* 编辑器覆盖层 */}
        {showEditorOverlay && (
          <div className="editor-overlay">
            <button
              className="btn-close-overlay"
              onClick={() => setShowEditorOverlay(false)}
              title={t('fab.backToGame')}
            >
              ✕
            </button>
            <div className="editor-overlay-content">
              <StateDataEditor
                onSaveState={handleSaveState}
                onLoadState={handleLoadState}
                onListSaves={handleListSaves}
                onLoadSave={handleLoadSave}
                onPublishApp={handlePublishApp}
                disableImport={false}
              />
            </div>
          </div>
        )}

        <APIConfigModal
          isOpen={showAPIConfig}
          onClose={() => setShowAPIConfig(false)}
        />
      </div>
    )
  }

  return null
}

export default App
