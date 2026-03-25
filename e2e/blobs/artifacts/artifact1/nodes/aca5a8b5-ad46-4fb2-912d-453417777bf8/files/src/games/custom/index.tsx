/**
 * GalgameGame - Visual Novel Main Entry
 *
 * Chat-style dialogue interface with P5/wabi-sabi aesthetics.
 * Each "act" plays back segments sequentially with typewriter effect.
 */

import { useEffect, useRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameStore } from './stores/gameStore'
import { useCreatureStore } from './stores/creatureStore'
import { useRegistryStore } from './stores/registryStore'
import { useModalStore } from './stores/modalStore'
import { useUIStore } from './stores/uiStore'
import { useSpriteStore } from './stores/spriteStore'
import { InfoModal, OrganizationModal, LocationModal, EntryModal, type GameRegistries } from '../components'
import CreaturePanel from '../../components/CreaturePanel'
import { VNPresenter } from './components/GalFlow'
import { VNCreaturePanel } from './components/VNCreaturePanel'
import { PublishModal, WorldOverview, SpriteManager } from './components'
import { ImageAPIConfigModal } from './components/ImageAPIConfigModal'
import { ResourceManager } from './components/ResourceManager'
import { ActGallery } from './components/ActGallery'
import './GalgameGame.css'

interface GalgameGameProps {
  onBack: () => void
}

export default function GalgameGame({ onBack }: GalgameGameProps) {
  const { t } = useTranslation('game')

  // ==================== Stores ====================

  const gameStarted = useGameStore(s => s.gameStarted)
  const backgroundStory = useGameStore(s => s.backgroundStory)
  const galTurns = useGameStore(s => s.galTurns)
  const startGame = useGameStore(s => s.startGame)
  const loadInitialData = useGameStore(s => s.loadInitialData)
  const loadStoryHistory = useGameStore(s => s.loadStoryHistory)
  const resetGameStore = useGameStore(s => s.reset)

  const playerEntity = useCreatureStore(s => s.playerEntity)
  const playerLoading = useCreatureStore(s => s.playerLoading)
  const creaturesMap = useCreatureStore(s => s.creaturesMap)
  const organizationsMap = useCreatureStore(s => s.organizationsMap)
  const regionsMap = useCreatureStore(s => s.regionsMap)
  const directorNotes = useCreatureStore(s => s.directorNotes)
  const refreshCreatures = useCreatureStore(s => s.refreshCreatures)
  const loadEntityMaps = useCreatureStore(s => s.loadEntityMaps)
  const resetCreatureStore = useCreatureStore(s => s.reset)

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
  const loadRegistries = useRegistryStore(s => s.loadRegistries)
  const resetRegistryStore = useRegistryStore(s => s.reset)

  const creatureModalOpen = useModalStore(s => s.creatureModalOpen)
  const creatureModalEntity = useModalStore(s => s.creatureModalEntity)
  const organizationModalOpen = useModalStore(s => s.organizationModalOpen)
  const organizationModalEntity = useModalStore(s => s.organizationModalEntity)
  const locationModalOpen = useModalStore(s => s.locationModalOpen)
  const locationModalRegion = useModalStore(s => s.locationModalRegion)
  const locationModalLocationId = useModalStore(s => s.locationModalLocationId)
  const entryModalOpen = useModalStore(s => s.entryModalOpen)
  const entryModalName = useModalStore(s => s.entryModalName)
  const closeCreatureModal = useModalStore(s => s.closeCreatureModal)
  const openCreatureModal = useModalStore(s => s.openCreatureModal)
  const closeOrganizationModal = useModalStore(s => s.closeOrganizationModal)
  const openOrganizationModal = useModalStore(s => s.openOrganizationModal)
  const closeLocationModal = useModalStore(s => s.closeLocationModal)
  const openLocationModal = useModalStore(s => s.openLocationModal)
  const closeEntryModal = useModalStore(s => s.closeEntryModal)
  const openEntryModal = useModalStore(s => s.openEntryModal)
  const openPublishModal = useModalStore(s => s.openPublishModal)
  const infoModalOpen = useModalStore(s => s.infoModalOpen)
  const infoModalContent = useModalStore(s => s.infoModalContent)
  const openInfoModal = useModalStore(s => s.openInfoModal)
  const closeInfoModal = useModalStore(s => s.closeInfoModal)
  const thinkingModalOpen = useModalStore(s => s.thinkingModalOpen)
  const thinkingModalContent = useModalStore(s => s.thinkingModalContent)
  const closeThinkingModal = useModalStore(s => s.closeThinkingModal)

  const isWorldOverviewOpen = useUIStore(s => s.isWorldOverviewOpen)
  const toggleWorldOverview = useUIStore(s => s.toggleWorldOverview)
  const closeWorldOverview = useUIStore(s => s.closeWorldOverview)
  const showCreaturePanel = useUIStore(s => s.showCreaturePanel)
  const setShowCreaturePanel = useUIStore(s => s.setShowCreaturePanel)

  const initSprites = useSpriteStore(s => s.initSprites)

  const [spriteManagerOpen, setSpriteManagerOpen] = useState(false)
  const [imageApiConfigOpen, setImageApiConfigOpen] = useState(false)
  const [resourceManagerOpen, setResourceManagerOpen] = useState(false)
  const [actGalleryOpen, setActGalleryOpen] = useState(false)

  // ==================== Computed ====================

  const initializedRef = useRef(false)

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

  // ==================== Init ====================

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const init = async () => {
      resetGameStore()
      resetCreatureStore()
      resetRegistryStore()

      await loadInitialData()
      await loadRegistries()
      await refreshCreatures()
      await loadEntityMaps()
      await loadStoryHistory()
      await initSprites()
    }

    init()
  }, [loadInitialData, loadRegistries, refreshCreatures, loadEntityMaps, loadStoryHistory, resetGameStore, resetCreatureStore, resetRegistryStore, initSprites])

  // ==================== Render ====================

  return (
    <div className="galgame-game">
      {!gameStarted ? (
        /* ── Start Screen ── */
        <div className="vn-start">
          <div className="vn-start-bg" />
          <div className="vn-start-content">
            <h1 className="vn-start-title">
              {backgroundStory
                ? backgroundStory.substring(0, 20).replace(/[。，！？、.!?,\s]+$/, '')
                : 'Visual Novel'}
            </h1>
            <div className="vn-start-subtitle">— Interactive Story —</div>
            {backgroundStory && (
              <div className="vn-start-prologue">
                <p>{backgroundStory.substring(0, 300)}{backgroundStory.length > 300 ? '...' : ''}</p>
              </div>
            )}
            <button className="vn-start-btn" onClick={startGame}>
              START
            </button>
            <button className="vn-back-btn" onClick={onBack}>
              {t('galgame.startGame.back')}
            </button>
          </div>
        </div>
      ) : (
        /* ── VN Game Screen ── */
        <div className="vn-container">
          {/* VN Presenter (scene + textbox + controls) */}
          <VNPresenter />

          {/* Nav buttons (top-left floating) */}
          <div className="vn-nav" onClick={(e) => e.stopPropagation()}>
            <button className="vn-nav-btn" onClick={onBack} title={t('galgame.nav.back')}>
              ⌂
            </button>
            <button className="vn-nav-btn" onClick={() => setShowCreaturePanel(true)} title={t('galgame.nav.characterInfo')}>
              📊
            </button>
            <button className="vn-nav-btn" onClick={toggleWorldOverview} title={t('galgame.nav.worldOverview')}>
              🌍
            </button>
            <button className="vn-nav-btn" onClick={() => setSpriteManagerOpen(true)} title={t('galgame.nav.spriteManager')}>
              🎨
            </button>
            <button className="vn-nav-btn" onClick={() => setImageApiConfigOpen(true)} title={t('galgame.nav.imageApiConfig')}>
              🖼
            </button>
            <button className="vn-nav-btn" onClick={() => setResourceManagerOpen(true)} title={t('galgame.nav.resourceManager')}>
              ⚡
            </button>
            <button className="vn-nav-btn" onClick={() => setActGalleryOpen(true)} title={t('galgame.actGallery.title')}>
              📖
            </button>
            <button
              className="vn-nav-btn"
              onClick={() => openPublishModal(0, galTurns.length - 1)}
              title={t('galgame.nav.publishArticle')}
            >
              📤
            </button>
          </div>
        </div>
      )}

      {/* ==================== Modals ==================== */}

      {/* Creature Panel Drawer */}
      {showCreaturePanel && (
        <div className="vn-creature-drawer-overlay" onClick={() => setShowCreaturePanel(false)}>
          <div className="vn-creature-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="vn-creature-drawer-header">
              <span>{t('galgame.nav.characterInfo')}</span>
              <button onClick={() => setShowCreaturePanel(false)}>×</button>
            </div>
            <div className="vn-creature-drawer-body">
              <CreaturePanel
                creature={playerEntity}
                loading={playerLoading}
                customComponentRegistry={customComponentRegistry}
                regionsRegistry={regionsRegistry}
                locationsRegistry={locationsRegistry}
                organizationsRegistry={organizationsRegistry}
                creaturesRegistry={creaturesRegistry}
                attrFields={attrFields}
                onShowInfo={openInfoModal}
                onShowOrganization={openOrganizationModal}
                onShowLocation={openLocationModal}
              />
            </div>
          </div>
        </div>
      )}

      {creatureModalOpen && creatureModalEntity && (
        <VNCreaturePanel
          open={creatureModalOpen}
          creature={creatureModalEntity}
          onClose={closeCreatureModal}
        />
      )}

      {organizationModalOpen && organizationModalEntity && (
        <OrganizationModal
          open={organizationModalOpen}
          organization={organizationModalEntity}
          onClose={closeOrganizationModal}
          registries={registries}
          onShowInfo={openInfoModal}
        />
      )}

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

      <InfoModal
        open={infoModalOpen}
        content={infoModalContent}
        onClose={closeInfoModal}
      />

      {thinkingModalOpen && (
        <div className="modal-overlay" onClick={closeThinkingModal}>
          <div className="modal-content thinking-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('galgame.thinking.title')}</h3>
              <button onClick={closeThinkingModal}>×</button>
            </div>
            <div className="modal-body">
              <pre>{thinkingModalContent}</pre>
            </div>
          </div>
        </div>
      )}

      <PublishModal />

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

      <SpriteManager open={spriteManagerOpen} onClose={() => setSpriteManagerOpen(false)} />
      <ImageAPIConfigModal open={imageApiConfigOpen} onClose={() => setImageApiConfigOpen(false)} />
      <ResourceManager open={resourceManagerOpen} onClose={() => setResourceManagerOpen(false)} />
      <ActGallery open={actGalleryOpen} onClose={() => setActGalleryOpen(false)} />
    </div>
  )
}
