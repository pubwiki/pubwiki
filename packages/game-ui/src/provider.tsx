/**
 * GameDataProvider — Subscribes to all watch services and provides
 * structured game data + cross-reference resolvers via React context.
 *
 * Usage:
 *   <GameProvider>            // from game-sdk (connection)
 *     <GameDataProvider>      // from game-ui (data)
 *       <App />
 *     </GameDataProvider>
 *   </GameProvider>
 */

import React, { createContext, useContext, useMemo } from 'react'

import {
  useCreatures,
  usePlayer,
  useRegions,
  useOrganizations,
  useWorld,
} from './hooks/index.ts'
import type {
  CreatureEntity,
  RegionEntity,
  OrganizationEntity,
  WorldSnapshot,
  CreatureAttrField,
  CustomComponentDef,
} from './types.ts'

// ── Resolver interface ──

export interface GameResolvers {
  /** Region ID → display name */
  regionName(regionId: string): string
  /** Region ID + Location ID → location display name */
  locationName(regionId: string, locationId: string): string
  /** Organization ID → display name */
  orgName(orgId: string): string
  /** Creature ID → display name */
  creatureName(creatureId: string): string
  /** Attr field_name → { label, hint } from Registry */
  attrDisplay(fieldName: string): { label: string; hint: string } | null
  /** Custom component_key → { name, schema, isArray, dataRegistry } */
  componentDef(componentKey: string): CustomComponentDef | null
  /** Get ordered attr field definitions from Registry */
  attrFields(): CreatureAttrField[]
}

// ── Context value ──

export interface GameData {
  player: CreatureEntity | null
  creatures: Map<string, CreatureEntity>
  regions: Map<string, RegionEntity>
  organizations: Map<string, OrganizationEntity>
  world: WorldSnapshot | null
  /** Whether at least the initial data has loaded */
  ready: boolean
  /** Cross-reference resolvers */
  resolve: GameResolvers
}

const GameDataCtx = createContext<GameData | null>(null)

/** Access the game data context. Throws if used outside GameDataProvider. */
export function useGameData(): GameData {
  const ctx = useContext(GameDataCtx)
  if (!ctx) throw new Error('useGameData() must be used inside <GameDataProvider>')
  return ctx
}

// ── Provider ──

interface Props {
  children: React.ReactNode
  /** Shown while initial data is loading */
  fallback?: React.ReactNode
}

export function GameDataProvider({ children, fallback }: Props) {
  // Subscribe to all watch services
  const { player, npcs, ready: creaturesReady } = useCreatures()
  const { regions, ready: regionsReady } = useRegions()
  const { organizations, ready: orgsReady } = useOrganizations()
  const { world, ready: worldReady } = useWorld()

  const ready = creaturesReady || regionsReady || orgsReady || worldReady

  // Debug: log raw values from hooks to diagnose Lua empty-table issues
  console.log('[GameDataProvider] raw hook values:', {
    player: player,
    npcs: npcs,
    npcsType: typeof npcs,
    npcsIsArray: Array.isArray(npcs),
    regions: regions,
    regionsType: typeof regions,
    regionsIsArray: Array.isArray(regions),
    organizations: organizations,
    orgsType: typeof organizations,
    orgsIsArray: Array.isArray(organizations),
  })

  // Build lookup maps (data is normalized at hook boundary — arrays are safe)
  const safeNpcs = npcs
  const safeRegions = regions
  const safeOrgs = organizations

  const creatureMap = useMemo(() => {
    const map = new Map<string, CreatureEntity>()
    if (player?.Creature) map.set(player.Creature.creature_id, player)
    for (const npc of safeNpcs) {
      if (npc.Creature) map.set(npc.Creature.creature_id, npc)
    }
    return map
  }, [player, safeNpcs])

  const regionMap = useMemo(() => {
    const map = new Map<string, RegionEntity>()
    for (const r of safeRegions) {
      if (r.Region) map.set(r.Region.region_id, r)
    }
    return map
  }, [safeRegions])

  const orgMap = useMemo(() => {
    const map = new Map<string, OrganizationEntity>()
    for (const o of safeOrgs) {
      if (o.Organization) map.set(o.Organization.organization_id, o)
    }
    return map
  }, [safeOrgs])

  // Build resolvers
  const resolve = useMemo<GameResolvers>(() => ({
    regionName(regionId: string): string {
      return regionMap.get(regionId)?.Region?.region_name ?? regionId
    },

    locationName(regionId: string, locationId: string): string {
      const region = regionMap.get(regionId)
      if (!region?.Region?.locations) return locationId
      const locs = region.Region.locations ?? []
      const loc = locs.find(l => l.id === locationId)
      return loc?.name ?? locationId
    },

    orgName(orgId: string): string {
      return orgMap.get(orgId)?.Organization?.name ?? orgId
    },

    creatureName(creatureId: string): string {
      return creatureMap.get(creatureId)?.Creature?.name ?? creatureId
    },

    attrDisplay(fieldName: string): { label: string; hint: string } | null {
      const fields = world?.Registry?.creature_attr_fields ?? []
      const field = fields.find(f => f.field_name === fieldName)
      if (!field) return null
      return { label: field.field_display_name ?? field.field_name, hint: field.hint ?? '' }
    },

    componentDef(componentKey: string): CustomComponentDef | null {
      const defs = world?.CustomComponentRegistry?.custom_components ?? []
      return defs.find(d => d.component_key === componentKey) ?? null
    },

    attrFields(): CreatureAttrField[] {
      return world?.Registry?.creature_attr_fields ?? []
    },
  }), [creatureMap, regionMap, orgMap, world])

  const value = useMemo<GameData>(() => ({
    player,
    creatures: creatureMap,
    regions: regionMap,
    organizations: orgMap,
    world,
    ready,
    resolve,
  }), [player, creatureMap, regionMap, orgMap, world, ready, resolve])

  if (!ready && fallback) {
    return <>{fallback}</>
  }

  return (
    <GameDataCtx.Provider value={value}>
      {children}
    </GameDataCtx.Provider>
  )
}
