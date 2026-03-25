/**
 * InkGame - Main Entry Component (Refactored with Zustand)
 * 
 * This is the refactored version using Zustand for state management.
 * The original file has been backed up to index_backup.tsx
 * 
 * Architecture:
 * - stores/gameStore.ts - Core game logic (inkTurns, generateStory, etc.)
 * - stores/registryStore.ts - Registry data (skills, items, moves, etc.)
 * - stores/creatureStore.ts - Creature/entity state
 * - stores/modalStore.ts - Modal states
 * - stores/uiStore.ts - UI state (panels, collapsed sections)
 */

import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameStore } from './stores/gameStore'
import { useCreatureStore } from './stores/creatureStore'
import { useRegistryStore } from './stores/registryStore'
import { useModalStore } from './stores/modalStore'
import { useUIStore } from './stores/uiStore'
import { refreshAllGameData } from './stores/refreshCoordinator'
import { InfoModal, CreatureModal, OrganizationModal, LocationModal, EntryModal, type GameRegistries } from '../components'
import CreaturePanel from '../../components/CreaturePanel'
import { isStoryTurn, isPlayerActionTurn, isErrorTurn } from './types'
import { PublishModal, PublishCheckpointModal, WorldOverview, StoryBlock } from './components'
import { TimelinePanel } from './components/TimelinePanel'
import { loadSave, listSaves, getStoryHistory, setNewStoryHistory } from '../utils'
import { parseTimelineDesc, cleanSaveTitle } from './utils/timelineUtils'
import { CompactLanguageSelector } from '../../i18n/CompactLanguageSelector'
import './InkGame.css'

interface InkGameProps {
  onBack: () => void
}

export default function InkGame({ onBack }: InkGameProps) {
  // ==================== Zustand Stores ====================
  
  // Game Store
  const gameStarted = useGameStore(s => s.gameStarted)
  const backgroundStory = useGameStore(s => s.backgroundStory)
  const inkTurns = useGameStore(s => s.inkTurns)
  const currentPhase = useGameStore(s => s.currentPhase)
  const startGame = useGameStore(s => s.startGame)
  const loadInitialData = useGameStore(s => s.loadInitialData)
  const loadStoryHistory = useGameStore(s => s.loadStoryHistory)
  
  // Creature Store
  const playerEntity = useCreatureStore(s => s.playerEntity)
  const playerLoading = useCreatureStore(s => s.playerLoading)
  const creaturesMap = useCreatureStore(s => s.creaturesMap)
  const organizationsMap = useCreatureStore(s => s.organizationsMap)
  const regionsMap = useCreatureStore(s => s.regionsMap)
  const gameTime = useCreatureStore(s => s.gameTime)
  const directorNotes = useCreatureStore(s => s.directorNotes)
  // Registry Store
  const skillsRegistry = useRegistryStore(s => s.skillsRegistry)
  const itemsRegistry = useRegistryStore(s => s.itemsRegistry)
  const movesRegistry = useRegistryStore(s => s.movesRegistry)
  const customComponentRegistry = useRegistryStore(s => s.customComponentRegistry)
  const organizationsRegistry = useRegistryStore(s => s.organizationsRegistry)
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const locationsRegistry = useRegistryStore(s => s.locationsRegistry)
  const regionsRegistry = useRegistryStore(s => s.regionsRegistry)
  const entriesMap = useRegistryStore(s => s.entriesMap)
  const attrFields = useRegistryStore(s => s.attrFields)
  
  // Modal Store
  const thinkingModalOpen = useModalStore(s => s.thinkingModalOpen)
  const thinkingModalContent = useModalStore(s => s.thinkingModalContent)
  const creatureModalOpen = useModalStore(s => s.creatureModalOpen)
  const creatureModalEntity = useModalStore(s => s.creatureModalEntity)
  const organizationModalOpen = useModalStore(s => s.organizationModalOpen)
  const organizationModalEntity = useModalStore(s => s.organizationModalEntity)
  const locationModalOpen = useModalStore(s => s.locationModalOpen)
  const locationModalRegion = useModalStore(s => s.locationModalRegion)
  const locationModalLocationId = useModalStore(s => s.locationModalLocationId)
  const entryModalOpen = useModalStore(s => s.entryModalOpen)
  const entryModalName = useModalStore(s => s.entryModalName)
  const closeThinkingModal = useModalStore(s => s.closeThinkingModal)
  const openCreatureModal = useModalStore(s => s.openCreatureModal)
  const closeCreatureModal = useModalStore(s => s.closeCreatureModal)
  const openOrganizationModal = useModalStore(s => s.openOrganizationModal)
  const closeOrganizationModal = useModalStore(s => s.closeOrganizationModal)
  const openLocationModal = useModalStore(s => s.openLocationModal)
  const closeLocationModal = useModalStore(s => s.closeLocationModal)
  const openEntryModal = useModalStore(s => s.openEntryModal)
  const closeEntryModal = useModalStore(s => s.closeEntryModal)
  const openPublishModal = useModalStore(s => s.openPublishModal)
  const infoModalOpen = useModalStore(s => s.infoModalOpen)
  const infoModalContent = useModalStore(s => s.infoModalContent)
  const openInfoModal = useModalStore(s => s.openInfoModal)
  const closeInfoModal = useModalStore(s => s.closeInfoModal)
  
  // UI Store
  const isLeftPanelOpen = useUIStore(s => s.isLeftPanelOpen)
  const setIsLeftPanelOpen = useUIStore(s => s.setIsLeftPanelOpen)
  const isWorldOverviewOpen = useUIStore(s => s.isWorldOverviewOpen)
  const toggleLeftPanel = useUIStore(s => s.toggleLeftPanel)
  const toggleWorldOverview = useUIStore(s => s.toggleWorldOverview)
  const closeWorldOverview = useUIStore(s => s.closeWorldOverview)
  const isTimelinePanelOpen = useUIStore(s => s.isTimelinePanelOpen)
  const toggleTimelinePanel = useUIStore(s => s.toggleTimelinePanel)
  const closeTimelinePanel = useUIStore(s => s.closeTimelinePanel)
  const totalParagraphs = useUIStore(s => s.totalParagraphs)
  const setTotalParagraphs = useUIStore(s => s.setTotalParagraphs)
  const typewriterSpeed = useUIStore(s => s.typewriterSpeed)
  const setTypewriterSpeed = useUIStore(s => s.setTypewriterSpeed)
  const narrativePerson = useUIStore(s => s.narrativePerson)
  const setNarrativePerson = useUIStore(s => s.setNarrativePerson)
  const diceMode = useUIStore(s => s.diceMode)
  const setDiceMode = useUIStore(s => s.setDiceMode)
  const autoScrollEnabled = useUIStore(s => s.autoScrollEnabled)
  const setAutoScrollEnabled = useUIStore(s => s.setAutoScrollEnabled)
  const isRefreshing = useUIStore(s => s.isRefreshing)

  // Reset functions for fresh initialization
  const resetGameStore = useGameStore(s => s.reset)
  const resetCreatureStore = useCreatureStore(s => s.reset)
  const resetRegistryStore = useRegistryStore(s => s.reset)
  
  const { t } = useTranslation('game')

  // ==================== Refs ====================
  const inkFlowRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const userScrolledUpRef = useRef(false)

  // ==================== Computed Values ====================
  const registries: GameRegistries = useMemo(() => ({
    skills: skillsRegistry,
    items: itemsRegistry,
    moves: movesRegistry,
    customComponents: customComponentRegistry,
    organizations: organizationsRegistry,
    creatures: creaturesRegistry,
    locations: locationsRegistry,
    regions: regionsRegistry,
    entries: entriesMap
  }), [skillsRegistry, itemsRegistry, movesRegistry, customComponentRegistry, organizationsRegistry, creaturesRegistry, locationsRegistry, regionsRegistry, entriesMap])
  
  // ==================== Callbacks ====================
  
  // 滚动到底部（尊重用户设置和主动向上滚动的意图）
  const scrollToBottom = useCallback((force: boolean = false) => {
    if (inkFlowRef.current) {
      const container = inkFlowRef.current
      const { autoScrollEnabled } = useUIStore.getState()

      if (force) {
        // 强制滚动（用户主动操作后触发，如选择选项），重置滚动意图
        userScrolledUpRef.current = false
        container.scrollTop = container.scrollHeight
        return
      }

      // 用户关闭了自动滚动，或主动向上滚动过
      if (!autoScrollEnabled || userScrolledUpRef.current) return

      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [])
  
  // 时间线加载存档
  const handleLoadTimeline = useCallback(async (checkpointId: string) => {
    await loadSave(checkpointId)
    await refreshAllGameData()
    // 重建 timelineChain
    try {
      const saves = await listSaves()
      const target = saves.saves.find(s => s.checkpointId === checkpointId)
      if (target) {
        const chain = parseTimelineDesc(target.description) || []
        const title = cleanSaveTitle(target.title)
        useGameStore.setState({ timelineChain: [...chain, { id: checkpointId, t: title }] })
      }
    } catch (e) {
      console.warn('Failed to rebuild timeline chain:', e)
    }

    // 加载存档后，最后一条剧情历史的 checkpoint_id 为 "unknown"
    // 用已知的 checkpointId 重新写入，修复后续剧情构建时间线所需的存档描述
    try {
      const historyResponse = await getStoryHistory()
      if (historyResponse.success && historyResponse.data?.turn_ids?.length && historyResponse.data.story) {
        const lastTurnId = historyResponse.data.turn_ids[historyResponse.data.turn_ids.length - 1]
        const lastEntry = historyResponse.data.story[lastTurnId]
        if (lastEntry && lastEntry.checkpoint_id === 'unknown') {
          await setNewStoryHistory({
            turn_id: lastTurnId,
            data: {
              content: lastEntry.content,
              checkpoint_id: checkpointId
            }
          })
        }
      }
    } catch (e) {
      console.warn('Failed to patch story history checkpoint:', e)
    }

    await loadStoryHistory()
    closeTimelinePanel()
  }, [loadStoryHistory, closeTimelinePanel])

  // ==================== Effects ====================

  // 移动端默认关闭左侧面板
  useEffect(() => {
    if (window.innerWidth <= 768) {
      setIsLeftPanelOpen(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 监听用户滚动意图：向上滚动时暂停自动滚动，回到底部时恢复
  useEffect(() => {
    const container = inkFlowRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledUpRef.current = true
      }
    }

    const handleScroll = () => {
      // 用户手动滚回底部附近时，恢复自动滚动
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 50) {
        userScrolledUpRef.current = false
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('scroll', handleScroll)
    }
  }, [])

  // 初始化 - 每次组件挂载时重置并加载数据
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    
    const init = async () => {
      // 重置所有 store 到初始状态
      resetGameStore()
      resetCreatureStore()
      resetRegistryStore()

      // 加载初始数据（内部使用 refreshAllGameData 统一刷新）
      await loadInitialData()
      await loadStoryHistory()
    }

    init()
  }, [loadInitialData, loadStoryHistory, resetGameStore, resetCreatureStore, resetRegistryStore])
  
  // 渲染小说流
  const renderInkFlow = () => {
    return (
      <div className="ink-flow" ref={inkFlowRef}>
        {/* 回合列表 */}
        {inkTurns.map((turn) => {
          if (isStoryTurn(turn)) {
            return (
              <div key={turn.id} className={`ink-turn turn-${turn.type}`}>
                <StoryBlock turn={turn} scrollToBottom={scrollToBottom} />
              </div>
            )
          }
          
          if (isPlayerActionTurn(turn)) {
            return (
              <div key={turn.id} className="ink-turn">
                <div className="action-block">
                  <div className="action-label">
                    <span>🎭 {t('ink.action.yourAction')}</span>
                    {turn.isCustomInput && <span className="custom-action-badge">{t('ink.action.custom')}</span>}
                    {turn.selectedChoice?.is_special && <span className="special-action-badge">⭐ {t('ink.action.special')}</span>}
                    {turn.diceResult && (
                      <span className={`dice-result-badge ${turn.diceResult.success ? 'success' : 'fail'}`}>
                        🎲 {turn.diceResult.roll}/{turn.diceResult.difficulty} {turn.diceResult.success ? t('ink.dice.success') : t('ink.dice.fail')}
                        {turn.diceResult.retried && ` (${t('ink.dice.retried')})`}
                      </span>
                    )}
                  </div>
                  <div className="action-content">{turn.playerAction}</div>
                </div>
              </div>
            )
          }
          
          if (isErrorTurn(turn)) {
            return (
              <div key={turn.id} className="ink-turn">
                <div className="error-block">
                  <div className="error-message">❌ {turn.errorMessage}</div>
                  {turn.retryAction && (
                    <button onClick={turn.retryAction} className="retry-btn">
                      🔄 {t('ink.error.retry')}
                    </button>
                  )}
                </div>
              </div>
            )
          }
          
          return null
        })}
        
        {/* 状态指示器已移到 right-panel */}
      </div>
    )
  }
  
  // ==================== Main Render ====================
  
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 设置控件（统一放在模态框中）
  const settingsControls = (
    <>
      <button
        className={`narrative-person-btn ${narrativePerson}`}
        title={narrativePerson === 'second' ? t('ink.settings.secondPersonTitle') : t('ink.settings.thirdPersonTitle')}
        onClick={() => setNarrativePerson(narrativePerson === 'second' ? 'third' : 'second')}
      >
        {narrativePerson === 'second' ? t('ink.settings.secondPerson') : t('ink.settings.thirdPerson')}
      </button>
      <button
        className={`dice-mode-btn ${diceMode}`}
        title={
          diceMode === 'off' ? t('ink.settings.diceOffTitle') :
          diceMode === 'visible' ? t('ink.settings.diceVisibleTitle') :
          t('ink.settings.diceHiddenTitle')
        }
        onClick={() => {
          const next = diceMode === 'off' ? 'visible' : diceMode === 'visible' ? 'hidden' : 'off'
          setDiceMode(next)
        }}
      >
        {diceMode === 'off' ? `🎲 ${t('ink.settings.diceOff')}` : diceMode === 'visible' ? `🎲 ${t('ink.settings.diceVisible')}` : `🎲 ${t('ink.settings.diceHidden')}`}
      </button>
      <div className="paragraph-slider" title={t('ink.settings.paragraphsTitle')}>
        <label>📝 {t('ink.settings.paragraphs', { count: totalParagraphs })}</label>
        <input
          type="range"
          min={10}
          max={24}
          value={totalParagraphs}
          onChange={(e) => setTotalParagraphs(Number(e.target.value))}
        />
      </div>
      <div className="paragraph-slider" title={t('ink.settings.typewriterSpeedTitle')}>
        <label>⌨️ {typewriterSpeed >= 9999 ? t('ink.settings.typewriterInstant') : t('ink.settings.typewriterSpeed', { speed: typewriterSpeed })}</label>
        <input
          type="range"
          min={20}
          max={130}
          step={10}
          value={typewriterSpeed >= 9999 ? 130 : typewriterSpeed}
          onChange={(e) => {
            const v = Number(e.target.value)
            setTypewriterSpeed(v >= 130 ? 9999 : v)
          }}
        />
      </div>
      <label className="auto-scroll-toggle" title={t('ink.settings.autoFollowTitle')}>
        <input
          type="checkbox"
          checked={autoScrollEnabled}
          onChange={(e) => setAutoScrollEnabled(e.target.checked)}
        />
        <span>{t('ink.settings.autoFollow')}</span>
      </label>
    </>
  )

  return (
    <div className="ink-game">
      {/* 极简边栏 */}
      <div className="slim-sidebar">
        <div className="sidebar-top">
          <button className="sidebar-icon-btn" onClick={onBack} title={t('ink.sidebar.backToWorkspace')}>
            ⌂
          </button>

          {gameStarted && (
            <>
              <div className="sidebar-divider" />
              <button className="sidebar-icon-btn" onClick={toggleWorldOverview} title={t('ink.sidebar.worldOverview')}>
                🌍
              </button>
              <button className="sidebar-icon-btn" onClick={toggleTimelinePanel} title={t('ink.sidebar.timeline')}>
                🕰️
              </button>
              <button className="sidebar-icon-btn" onClick={() => openPublishModal(0, inkTurns.length - 1)} title={t('ink.sidebar.publishArticle')}>
                📤
              </button>
              <button
                className="sidebar-icon-btn settings-btn"
                onClick={() => setSettingsOpen(true)}
                title={t('ink.settings.gameSettings')}
              >
                ⚙️
              </button>
            </>
          )}
        </div>

        <div className="sidebar-bottom">
          <CompactLanguageSelector />
          {gameStarted && (
            <>
              <button
                className={`sidebar-icon-btn toggle-panel-btn ${isLeftPanelOpen ? 'active' : ''}`}
                onClick={toggleLeftPanel}
                title={isLeftPanelOpen ? t('ink.sidebar.collapsePanel') : t('ink.sidebar.expandPanel')}
              >
                {isLeftPanelOpen ? '◀' : '▶'}
              </button>
            </>
          )}
        </div>
      </div>
      
      
      <div className="ink-layout">
        {!gameStarted ? (
          <div className="start-container">
            <div className="start-content paper-panel">
              <div className="game-intro">
                <h2 className="title">{t('ink.intro')}</h2>
                <div className="divider-ornament"></div>
                <p className="subtitle">{t('ink.introDesc')}</p>
                {backgroundStory && (
                  <div className="background-preview scrollable-paper">
                    <h3 className="section-title">{t('ink.backgroundStory')}</h3>
                    <div className="background-story-text">{backgroundStory}</div>
                  </div>
                )}
              </div>
              <button className="start-btn paper-btn" onClick={startGame}>
                {t('ink.startAdventure')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 移动端顶部栏 */}
            <div className="mobile-ink-header">
              <div className="header-left">
                <button className="icon-btn" onClick={toggleLeftPanel}>
                  {isLeftPanelOpen ? '✕' : '☰'}
                </button>
                <button className="icon-btn" onClick={onBack} title={t('ink.sidebar.backToWorkspace')}>⌂</button>
              </div>
              <div className="header-right">
                <button className="icon-btn" onClick={toggleWorldOverview} title={t('ink.sidebar.worldOverview')}>🌍</button>
                <button className="icon-btn" onClick={toggleTimelinePanel} title={t('ink.sidebar.timeline')}>🕰️</button>
                <button className="icon-btn" onClick={() => openPublishModal(0, inkTurns.length - 1)} title={t('ink.sidebar.publishArticle')}>📤</button>
                <button
                  className="icon-btn"
                  onClick={() => refreshAllGameData()}
                  disabled={isRefreshing}
                  title={t('ink.refresh.button')}
                >
                  <span className={isRefreshing ? 'spinning' : ''}>↻</span>
                </button>
                <button className="icon-btn" onClick={() => setSettingsOpen(true)} title={t('ink.settings.gameSettings')}>⚙️</button>
              </div>
            </div>

            {/* 移动端遮罩 */}
            {isLeftPanelOpen && <div className="panel-overlay" onClick={toggleLeftPanel} />}

            {/* 左侧面板 */}
            <div className={`left-panel ${isLeftPanelOpen ? 'open' : 'closed'}`}>
              <div className="panel-header">
                <h2>PAGES</h2>
                <button className="panel-add-btn" title="Add Page">+</button>
              </div>
              <div className="panel-content">
                <CreaturePanel
                  creature={playerEntity}
                  loading={playerLoading}
                  customComponentRegistry={customComponentRegistry}
                  regionsRegistry={regionsRegistry}
                  locationsRegistry={locationsRegistry}
                  organizationsRegistry={organizationsRegistry}
                  creaturesRegistry={creaturesRegistry}
                  attrFields={attrFields}
                  onShowInfo={(info) => {
                    openInfoModal(info)
                  }}
                  onShowOrganization={openOrganizationModal}
                  onShowLocation={openLocationModal}
                />
              </div>
            </div>

            {/* 右侧内容区 */}
            <div className="right-panel">
              <div className="main-header">
                <div className="header-breadcrumbs">
                  <span className="breadcrumb-active">Gameplay</span>
                  <span className="breadcrumb-item">Player</span>
                  <span className="breadcrumb-item">Game Master</span>
                </div>
                <div className="header-right">
                  <button
                    className="header-refresh-btn"
                    onClick={() => refreshAllGameData()}
                    disabled={isRefreshing}
                    title={t('ink.refresh.button')}
                  >
                    <span className={isRefreshing ? 'spinning' : ''}>↻</span>
                  </button>
                  {gameTime && (
                    <div className="game-time">{t('ink.time.format', { year: gameTime.year, month: gameTime.month, day: gameTime.day, hour: gameTime.hour, minute: gameTime.minute.toString().padStart(2, '0') })}</div>
                  )}
                </div>
              </div>
              
              {renderInkFlow()}
              
              {/* 状态指示 */}
              {currentPhase !== 'idle' && currentPhase !== 'waiting-choice' && currentPhase !== 'dice-rolling' && (
                <div className="phase-indicator">
                  {currentPhase === 'generating-story' && `✍️ ${t('ink.phase.generatingStory')}`}
                  {currentPhase === 'updating-state' && `⏳ ${t('ink.phase.updatingState')}`}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      
      {/* ==================== Modals ==================== */}

      {/* 统一设置模态框 */}
      {settingsOpen && (
        <div className="paper-settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="paper-settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="paper-settings-header">
              <h3>{t('ink.settings.gameSettings')}</h3>
              <button onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="paper-settings-body">
              {settingsControls}
              <div className="paper-settings-footer">
                {gameTime && (
                  <div className="game-time">{t('ink.time.format', { year: gameTime.year, month: gameTime.month, day: gameTime.day, hour: gameTime.hour, minute: gameTime.minute.toString().padStart(2, '0') })}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 角色模态框 */}
      {creatureModalOpen && creatureModalEntity && (
        <CreatureModal
          open={creatureModalOpen}
          creature={creatureModalEntity}
          onClose={closeCreatureModal}
          registries={registries}
          onShowInfo={openInfoModal}
          onShowOrganization={openOrganizationModal}
          onShowLocation={openLocationModal}
        />
      )}
      
      {/* 组织模态框 */}
      {organizationModalOpen && organizationModalEntity && (
        <OrganizationModal
          open={organizationModalOpen}
          organization={organizationModalEntity}
          onClose={closeOrganizationModal}
          registries={registries}
          onShowInfo={openInfoModal}
        />
      )}
      
      {/* 地点模态框 */}
      {locationModalOpen && locationModalRegion && locationModalLocationId && (
        <LocationModal
          open={locationModalOpen}
          regionEntity={locationModalRegion}
          locationId={locationModalLocationId}
          registries={registries}
          onClose={closeLocationModal}
          onShowInfo={openInfoModal}
        />
      )}
      
      {/* 词条模态框 */}
      {entryModalOpen && (
        <EntryModal
          open={entryModalOpen}
          entryName={entryModalName}
          entryContent={entriesMap.get(entryModalName) || ''}
          entriesMap={entriesMap}
          onClose={closeEntryModal}
          onShowEntry={openEntryModal}
        />
      )}
      
      {/* 信息模态框 */}
      <InfoModal
        open={infoModalOpen}
        content={infoModalContent}
        onClose={closeInfoModal}
      />
      
      {/* 思考过程模态框 */}
      {thinkingModalOpen && (
        <div className="modal-overlay" onClick={closeThinkingModal}>
          <div className="modal-content thinking-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('ink.sections.thinking')}</h3>
              <button onClick={closeThinkingModal}>×</button>
            </div>
            <div className="modal-body">
              <pre>{thinkingModalContent}</pre>
            </div>
          </div>
        </div>
      )}
      
      {/* 发布模态框 */}
      <PublishModal />
      <PublishCheckpointModal />

      {/* 世界概览面板 */}
      <WorldOverview
        open={isWorldOverviewOpen}
        onClose={closeWorldOverview}
        creaturesMap={creaturesMap}
        regionsMap={regionsMap}
        organizationsMap={organizationsMap}
        directorNotes={directorNotes}
        onShowCreature={openCreatureModal}
        onShowLocation={openLocationModal}
        onShowOrganization={openOrganizationModal}
      />

      <TimelinePanel
        open={isTimelinePanelOpen}
        onClose={closeTimelinePanel}
        onLoadCheckpoint={handleLoadTimeline}
      />

      {/* 刷新遮罩 */}
      {isRefreshing && (
        <div className="refresh-overlay">
          <div className="refresh-spinner">
            <span>↻</span>
            <span>{t('ink.refresh.loading')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
