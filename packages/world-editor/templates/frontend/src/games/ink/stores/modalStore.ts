import { create } from 'zustand'
import type { CreatureEntity, OrganizationEntity, RegionEntity } from '../../../api/types'
import type { InfoModalContent } from '../../components/InfoModal'
import { useCreatureStore } from './creatureStore'
import { useRegistryStore } from './registryStore'

interface ModalState {
  // 思考过程模态框
  thinkingModalOpen: boolean
  thinkingModalContent: string
  
  // 信息模态框
  infoModalOpen: boolean
  infoModalContent: InfoModalContent | null
  
  // 角色模态框
  creatureModalOpen: boolean
  creatureModalEntity: CreatureEntity | null
  
  // 组织模态框
  organizationModalOpen: boolean
  organizationModalEntity: OrganizationEntity | null
  
  // 地点模态框
  locationModalOpen: boolean
  locationModalRegion: RegionEntity | null
  locationModalLocationId: string | null
  
  // 词条模态框
  entryModalOpen: boolean
  entryModalName: string
  
  // 发布模态框
  publishModalOpen: boolean
  publishStartTurn: number
  publishEndTurn: number
  publishTitle: string
  publishVisibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED'
  publishing: boolean

  // 发布存档模态框
  publishCheckpointModalOpen: boolean
  publishCheckpointId: string | null
  publishCheckpointListed: boolean
  publishingCheckpoint: boolean

  // Actions
  openThinkingModal: (content: string) => void
  closeThinkingModal: () => void
  
  openInfoModal: (content: InfoModalContent) => void
  closeInfoModal: () => void
  
  openCreatureModal: (creatureId: string) => void
  closeCreatureModal: () => void
  
  openOrganizationModal: (organizationId: string) => void
  closeOrganizationModal: () => void
  
  openLocationModal: (regionId: string, locationId: string) => void
  closeLocationModal: () => void
  
  openEntryModal: (entryName: string) => void
  closeEntryModal: () => void
  
  openPublishModal: (startTurn: number, endTurn: number) => void
  closePublishModal: () => void
  setPublishStartTurn: (turn: number) => void
  setPublishEndTurn: (turn: number) => void
  setPublishTitle: (title: string) => void
  setPublishVisibility: (visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED') => void
  setPublishing: (publishing: boolean) => void

  openPublishCheckpointModal: (checkpointId: string) => void
  closePublishCheckpointModal: () => void
  setPublishCheckpointListed: (listed: boolean) => void
  setPublishingCheckpoint: (publishing: boolean) => void
}

export const useModalStore = create<ModalState>((set, get) => ({
  // 初始状态
  thinkingModalOpen: false,
  thinkingModalContent: '',
  infoModalOpen: false,
  infoModalContent: null,
  creatureModalOpen: false,
  creatureModalEntity: null,
  organizationModalOpen: false,
  organizationModalEntity: null,
  locationModalOpen: false,
  locationModalRegion: null,
  locationModalLocationId: null,
  entryModalOpen: false,
  entryModalName: '',
  publishModalOpen: false,
  publishStartTurn: 0,
  publishEndTurn: 0,
  publishTitle: '',
  publishVisibility: 'UNLISTED',
  publishing: false,
  publishCheckpointModalOpen: false,
  publishCheckpointId: null,
  publishCheckpointListed: true,
  publishingCheckpoint: false,

  // 思考模态框
  openThinkingModal: (content) => set({ thinkingModalOpen: true, thinkingModalContent: content }),
  closeThinkingModal: () => set({ thinkingModalOpen: false }),

  // 信息模态框
  openInfoModal: (content) => set({ infoModalOpen: true, infoModalContent: content }),
  closeInfoModal: () => set({ infoModalOpen: false }),

  // 角色模态框
  openCreatureModal: (creatureId) => {
    const { creaturesMap } = useCreatureStore.getState()
    const creature = creaturesMap.get(creatureId)
    if (creature) {
      set({ creatureModalEntity: creature, creatureModalOpen: true })
    }
  },
  closeCreatureModal: () => set({ creatureModalOpen: false }),

  // 组织模态框
  openOrganizationModal: (organizationId) => {
    const { organizationsMap } = useCreatureStore.getState()
    const org = organizationsMap.get(organizationId)
    if (org) {
      set({ organizationModalEntity: org, organizationModalOpen: true })
    }
  },
  closeOrganizationModal: () => set({ organizationModalOpen: false }),

  // 地点模态框
  openLocationModal: (regionId, locationId) => {
    const { regionsMap } = useCreatureStore.getState()
    const region = regionsMap.get(regionId)
    if (region) {
      set({ locationModalRegion: region, locationModalLocationId: locationId, locationModalOpen: true })
    }
  },
  closeLocationModal: () => set({ locationModalOpen: false }),

  // 词条模态框
  openEntryModal: (entryName) => set({ entryModalName: entryName, entryModalOpen: true }),
  closeEntryModal: () => set({ entryModalOpen: false }),

  // 发布模态框
  openPublishModal: (startTurn, endTurn) => set({ 
    publishModalOpen: true, 
    publishStartTurn: startTurn, 
    publishEndTurn: endTurn,
    publishTitle: ''
  }),
  closePublishModal: () => set({ publishModalOpen: false }),
  setPublishStartTurn: (turn) => set({ publishStartTurn: turn }),
  setPublishEndTurn: (turn) => set({ publishEndTurn: turn }),
  setPublishTitle: (title) => set({ publishTitle: title }),
  setPublishVisibility: (visibility) => set({ publishVisibility: visibility }),
  setPublishing: (publishing) => set({ publishing: publishing }),

  // 发布存档模态框
  openPublishCheckpointModal: (checkpointId) => set({
    publishCheckpointModalOpen: true,
    publishCheckpointId: checkpointId,
    publishCheckpointListed: true,
    publishingCheckpoint: false,
  }),
  closePublishCheckpointModal: () => set({ publishCheckpointModalOpen: false }),
  setPublishCheckpointListed: (listed) => set({ publishCheckpointListed: listed }),
  setPublishingCheckpoint: (publishing) => set({ publishingCheckpoint: publishing }),
}))
