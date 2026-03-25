import { create } from 'zustand'
import type { CreatureEntity, OrganizationEntity, RegionEntity } from '../../../api/types'
import type { InfoModalContent } from '../../components/InfoModal'
import { useCreatureStore } from './creatureStore'

interface ModalState {
  thinkingModalOpen: boolean
  thinkingModalContent: string
  infoModalOpen: boolean
  infoModalContent: InfoModalContent | null
  creatureModalOpen: boolean
  creatureModalEntity: CreatureEntity | null
  organizationModalOpen: boolean
  organizationModalEntity: OrganizationEntity | null
  locationModalOpen: boolean
  locationModalRegion: RegionEntity | null
  locationModalLocationId: string | null
  entryModalOpen: boolean
  entryModalName: string
  publishModalOpen: boolean
  publishStartTurn: number
  publishEndTurn: number
  publishTitle: string
  publishVisibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED'
  publishing: boolean

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
}

export const useModalStore = create<ModalState>((set) => ({
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

  openThinkingModal: (content) => set({ thinkingModalOpen: true, thinkingModalContent: content }),
  closeThinkingModal: () => set({ thinkingModalOpen: false }),
  openInfoModal: (content) => set({ infoModalOpen: true, infoModalContent: content }),
  closeInfoModal: () => set({ infoModalOpen: false }),

  openCreatureModal: (creatureId) => {
    const { creaturesMap } = useCreatureStore.getState()
    const creature = creaturesMap.get(creatureId)
    if (creature) {
      set({ creatureModalEntity: creature, creatureModalOpen: true })
    }
  },
  closeCreatureModal: () => set({ creatureModalOpen: false }),

  openOrganizationModal: (organizationId) => {
    const { organizationsMap } = useCreatureStore.getState()
    const org = organizationsMap.get(organizationId)
    if (org) {
      set({ organizationModalEntity: org, organizationModalOpen: true })
    }
  },
  closeOrganizationModal: () => set({ organizationModalOpen: false }),

  openLocationModal: (regionId, locationId) => {
    const { regionsMap } = useCreatureStore.getState()
    const region = regionsMap.get(regionId)
    if (region) {
      set({ locationModalRegion: region, locationModalLocationId: locationId, locationModalOpen: true })
    }
  },
  closeLocationModal: () => set({ locationModalOpen: false }),

  openEntryModal: (entryName) => set({ entryModalName: entryName, entryModalOpen: true }),
  closeEntryModal: () => set({ entryModalOpen: false }),

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
  setPublishing: (publishing) => set({ publishing: publishing })
}))
