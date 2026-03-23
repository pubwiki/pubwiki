import { create } from 'zustand'
import i18next from 'i18next'
import type { CreatureEntity, OrganizationEntity, RegionEntity, DirectorNotes, EventEntry, StateData } from '../../../api/types'
import type { GameTime } from '../types'
import { getGameState, getPlayerEntity, getNPCEntities } from '../../utils'

interface CreatureState {
  // 状态
  playerEntity: CreatureEntity | null
  playerLoading: boolean
  creaturesMap: Map<string, CreatureEntity>
  organizationsMap: Map<string, OrganizationEntity>
  regionsMap: Map<string, RegionEntity>
  gameTime: GameTime | null
  directorNotes: DirectorNotes | null
  events: EventEntry[]

  // Actions
  setPlayerEntity: (entity: CreatureEntity | null) => void
  setPlayerLoading: (loading: boolean) => void
  setCreaturesMap: (map: Map<string, CreatureEntity>) => void
  setOrganizationsMap: (map: Map<string, OrganizationEntity>) => void
  setRegionsMap: (map: Map<string, RegionEntity>) => void
  setGameTime: (time: GameTime | null) => void
  refreshCreatures: () => Promise<void>
  loadEntityMaps: (prefetchedData?: StateData) => Promise<void>
  reset: () => void
}

export const useCreatureStore = create<CreatureState>((set, get) => ({
  playerEntity: null,
  playerLoading: false,
  creaturesMap: new Map(),
  organizationsMap: new Map(),
  regionsMap: new Map(),
  gameTime: null,
  directorNotes: null,
  events: [],

  setPlayerEntity: (entity) => set({ playerEntity: entity }),
  setPlayerLoading: (loading) => set({ playerLoading: loading }),
  setCreaturesMap: (map) => set({ creaturesMap: map }),
  setOrganizationsMap: (map) => set({ organizationsMap: map }),
  setRegionsMap: (map) => set({ regionsMap: map }),
  setGameTime: (time) => set({ gameTime: time }),

  // 重置所有状态
  reset: () => set({
    playerEntity: null,
    playerLoading: false,
    creaturesMap: new Map(),
    organizationsMap: new Map(),
    regionsMap: new Map(),
    gameTime: null,
    directorNotes: null,
    events: [],
  }),

  refreshCreatures: async () => {
    try {
      set({ playerLoading: true })
      const newCreaturesMap = new Map<string, CreatureEntity>()

      // 加载玩家
      const playerData = await getPlayerEntity()
      if (playerData.found && playerData.Creature) {
        const entity: CreatureEntity = {
          entity_id: playerData.entity_id!,
          is_player: true,
          Creature: playerData.Creature,
          LocationRef: playerData.LocationRef,
          Inventory: playerData.Inventory,
          StatusEffects: playerData.StatusEffects,
          CustomComponents: playerData.CustomComponents,
          Relationship: playerData.Relationship,
          Log: playerData.Log,
          BindSetting: playerData.BindSetting
        }
        newCreaturesMap.set(playerData.Creature.creature_id, entity)
        set({ playerEntity: entity })
      }

      // 加载NPC
      const npcsData = await getNPCEntities()
      if (npcsData.success) {
        npcsData.entities?.forEach((npc: any) => {
          if (npc.Creature) {
            const npcEntity: CreatureEntity = {
              entity_id: npc.entity_id,
              is_player: false,
              Creature: npc.Creature,
              LocationRef: npc.LocationRef,
              Inventory: npc.Inventory,
              StatusEffects: npc.StatusEffects,
              CustomComponents: npc.CustomComponents,
              Relationship: npc.Relationship,
              Log: npc.Log,
              BindSetting: npc.BindSetting
            }
            newCreaturesMap.set(npc.Creature.creature_id, npcEntity)
          }
        })
      }

      set({ creaturesMap: newCreaturesMap })
    } catch (e) {
      console.error('Failed to refresh creatures:', e)
    } finally {
      set({ playerLoading: false })
    }
  },

  loadEntityMaps: async (prefetchedData?: StateData) => {
    try {
      let data: StateData
      if (prefetchedData) {
        data = prefetchedData
      } else {
        const gameState = await getGameState()
        if (!gameState.success || !gameState.data) {
          throw new Error(gameState.error || i18next.t('game:ink.error.getStateFailed'))
        }
        data = gameState.data
      }

      const { World, Regions, Organizations } = data

      // 设置游戏时间
      if (World?.GameTime) {
        set({
          gameTime: {
            year: World.GameTime.year || 0,
            month: World.GameTime.month || 0,
            day: World.GameTime.day || 0,
            hour: World.GameTime.hour || 0,
            minute: World.GameTime.minute || 0
          }
        })
      }

      // 设置导演笔记
      set({ directorNotes: World?.DirectorNotes || null })

      // 设置剧情事件
      const rawEvents = World?.Events?.events
      set({ events: Array.isArray(rawEvents) ? rawEvents : [] })

      // 构建组织实体映射
      if (Organizations) {
        const newOrganizationsMap = new Map<string, OrganizationEntity>()
        Organizations.forEach((org) => {
          if (org.Organization) {
            const orgId = org.Organization.organization_id
            newOrganizationsMap.set(orgId, {
              entity_id: org.entity_id,
              Organization: org.Organization,
              Log: org.Log,
              BindSetting: org.BindSetting
            } as OrganizationEntity)
          }
        })
        set({ organizationsMap: newOrganizationsMap })
      }

      // 构建地域实体映射
      if (Regions) {
        const newRegionsMap = new Map<string, RegionEntity>()
        Regions.forEach((region) => {
          if (region.Region) {
            const regionId = region.Region.region_id
            newRegionsMap.set(regionId, region as RegionEntity)
          }
        })
        set({ regionsMap: newRegionsMap })
      }
    } catch (e) {
      console.error('Failed to load entity maps:', e)
    }
  }
}))
