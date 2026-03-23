import { create } from 'zustand'
import i18next from 'i18next'
import type { CreatureAttrField, StateData } from '../../../api/types'
import type { ItemInfo, MoveInfo, SkillInfo, CustomComponentDefInfo } from '../types'
import { getGameState } from '../../utils'

interface RegistryState {
  // 注册表状态
  skillsRegistry: Map<string, SkillInfo>
  itemsRegistry: Map<string, ItemInfo>
  movesRegistry: Map<string, MoveInfo>
  customComponentRegistry: Map<string, CustomComponentDefInfo>
  organizationsRegistry: Map<string, { name: string }>
  creaturesRegistry: Map<string, { name: string }>
  locationsRegistry: Map<string, { name: string; description?: string }>
  regionsRegistry: Map<string, { name: string }>
  entriesMap: Map<string, string>
  attrFields: CreatureAttrField[]

  // Actions
  setSkillsRegistry: (registry: Map<string, SkillInfo>) => void
  setItemsRegistry: (registry: Map<string, ItemInfo>) => void
  setMovesRegistry: (registry: Map<string, MoveInfo>) => void
  setCustomComponentRegistry: (registry: Map<string, CustomComponentDefInfo>) => void
  setOrganizationsRegistry: (registry: Map<string, { name: string }>) => void
  setCreaturesRegistry: (registry: Map<string, { name: string }>) => void
  setLocationsRegistry: (registry: Map<string, { name: string; description?: string }>) => void
  setRegionsRegistry: (registry: Map<string, { name: string }>) => void
  setEntriesMap: (entries: Map<string, string>) => void
  setAttrFields: (fields: CreatureAttrField[]) => void
  loadRegistries: (prefetchedData?: StateData) => Promise<void>
  reset: () => void
}

export const useRegistryStore = create<RegistryState>((set, get) => ({
  skillsRegistry: new Map(),
  itemsRegistry: new Map(),
  movesRegistry: new Map(),
  customComponentRegistry: new Map(),
  organizationsRegistry: new Map(),
  creaturesRegistry: new Map(),
  locationsRegistry: new Map(),
  regionsRegistry: new Map(),
  entriesMap: new Map(),
  attrFields: [],

  setSkillsRegistry: (registry) => set({ skillsRegistry: registry }),
  setItemsRegistry: (registry) => set({ itemsRegistry: registry }),
  setMovesRegistry: (registry) => set({ movesRegistry: registry }),
  setCustomComponentRegistry: (registry) => set({ customComponentRegistry: registry }),
  setOrganizationsRegistry: (registry) => set({ organizationsRegistry: registry }),
  setCreaturesRegistry: (registry) => set({ creaturesRegistry: registry }),
  setLocationsRegistry: (registry) => set({ locationsRegistry: registry }),
  setRegionsRegistry: (registry) => set({ regionsRegistry: registry }),
  setEntriesMap: (entries) => set({ entriesMap: entries }),
  setAttrFields: (fields) => set({ attrFields: fields }),

  // 重置所有状态
  reset: () => set({
    skillsRegistry: new Map(),
    itemsRegistry: new Map(),
    movesRegistry: new Map(),
    customComponentRegistry: new Map(),
    organizationsRegistry: new Map(),
    creaturesRegistry: new Map(),
    locationsRegistry: new Map(),
    regionsRegistry: new Map(),
    entriesMap: new Map(),
    attrFields: []
  }),

  loadRegistries: async (prefetchedData?: StateData) => {
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

      const { World, Creatures, Regions, Organizations, GameWikiEntry } = data
      
      // 注意：gameTime 已移到 creatureStore
      
      // 1. 构建注册表映射
      if (World?.Registry) {
        const registry = World.Registry
        
        // 属性字段定义
        if (Array.isArray(registry.creature_attr_fields)) {
          set({ attrFields: registry.creature_attr_fields })
        }
      }
      
      // 2. 构建自定义组件注册表映射
      if (World?.CustomComponentRegistry?.custom_components) {
        const customComponentMap = new Map<string, CustomComponentDefInfo>()
        World.CustomComponentRegistry.custom_components.forEach((def: any) => {
          customComponentMap.set(def.component_key, {
            component_key: def.component_key,
            component_name: def.component_name || def.component_key,
            is_array: def.is_array || false,
            type_schema: def.type_schema
          })
        })
        set({ customComponentRegistry: customComponentMap })
      }
      
      // 3. 构建组织映射
      if (Organizations) {
        const orgsMap = new Map<string, { name: string }>()
        Organizations.forEach((org) => {
          if (org.Organization) {
            const orgId = org.Organization.organization_id
            orgsMap.set(orgId, { name: org.Organization.name })
          }
        })
        set({ organizationsRegistry: orgsMap })
        // 注意：organizationsMap (完整实体) 在 creatureStore 中
      }
      
      // 4. 构建角色映射
      if (Creatures) {
        const creaturesMap = new Map<string, { name: string }>()
        Creatures.forEach((creature) => {
          if (creature.Creature) {
            creaturesMap.set(creature.Creature.creature_id, {
              name: creature.Creature.name
            })
          }
        })
        set({ creaturesRegistry: creaturesMap })
      }
      
      // 5. 构建地点映射
      if (Regions) {
        const locationsMap = new Map<string, { name: string; description?: string }>()
        const newRegionsRegistry = new Map<string, { name: string }>()
        
        Regions.forEach((region) => {
          if (region.Region) {
            const regionId = region.Region.region_id
            const regionName = region.Region.region_name || region.Metadata?.name || regionId
            newRegionsRegistry.set(regionId, { name: regionName })
            // 保存地点注册表
            region.Region.locations?.forEach((loc: any) => {
              locationsMap.set(loc.id, { name: loc.name, description: loc.description })
            })
          }
        })
        set({ locationsRegistry: locationsMap, regionsRegistry: newRegionsRegistry })
        // 注意：regionsMap (完整实体) 在 creatureStore 中
      }
      
      // 6. 加载词条映射
      if (GameWikiEntry && Array.isArray(GameWikiEntry)) {
        const newEntriesMap = new Map<string, string>()
        GameWikiEntry.forEach((entry) => {
          newEntriesMap.set(entry.title, entry.content)
        })
        set({ entriesMap: newEntriesMap })
      }
    } catch (e) {
      console.error('Failed to load registries:', e)
    }
  }
}))
