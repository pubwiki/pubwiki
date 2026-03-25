import { create } from 'zustand'
import i18next from 'i18next'
import type { CreatureAttrField } from '../../../api/types'
import type { ItemInfo, MoveInfo, SkillInfo, CustomComponentDefInfo } from '../types'
import { getGameState } from '../../utils'

interface RegistryState {
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

  loadRegistries: () => Promise<void>
  reset: () => void
}

export const useRegistryStore = create<RegistryState>((set) => ({
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

  loadRegistries: async () => {
    try {
      const gameState = await getGameState()

      if (!gameState.success || !gameState.data) {
        throw new Error(gameState.error || i18next.t('game:galgame.error.getStateFailed'))
      }

      const { World, Creatures, Regions, Organizations, GameWikiEntry } = gameState.data

      if (World?.Registry) {
        const registry = World.Registry

        if (Array.isArray(registry.creature_attr_fields)) {
          set({ attrFields: registry.creature_attr_fields })
        }
      }

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

      if (Organizations) {
        const orgsMap = new Map<string, { name: string }>()
        Organizations.forEach((org) => {
          if (org.Organization) {
            const orgId = org.Organization.organization_id
            orgsMap.set(orgId, { name: org.Organization.name })
          }
        })
        set({ organizationsRegistry: orgsMap })
      }

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

      if (Regions) {
        const locationsMap = new Map<string, { name: string; description?: string }>()
        const newRegionsRegistry = new Map<string, { name: string }>()

        Regions.forEach((region) => {
          if (region.Region) {
            const regionId = region.Region.region_id
            const regionName = region.Region.region_name || region.Metadata?.name || regionId
            newRegionsRegistry.set(regionId, { name: regionName })
            region.Region.locations?.forEach((loc: any) => {
              locationsMap.set(loc.id, { name: loc.name, description: loc.description })
            })
          }
        })
        set({ locationsRegistry: locationsMap, regionsRegistry: newRegionsRegistry })
      }

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
