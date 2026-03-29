/**
 * Game UI hooks — watch-based reactive hooks for game state.
 *
 * Data is normalized at the boundary (here), so all downstream
 * components can trust arrays are arrays, strings are strings, etc.
 */

import { useMemo } from 'react'
import { useWatch } from './use-watch.ts'
import {
  normalizeCreature,
  normalizeRegion,
  normalizeOrganization,
  normalizeWorld,
} from '../normalize.ts'
import type {
  CreatureEntity,
  RegionEntity,
  OrganizationEntity,
  WorldSnapshot,
} from '../types.ts'

/** Coerce Lua empty table. Used only in this file for raw service results. */
function arr<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val
  return []
}

// ── Creatures ──

interface CreaturesData {
  player: CreatureEntity | null
  npcs: CreatureEntity[]
}

export interface UseCreaturesResult {
  player: CreatureEntity | null
  npcs: CreatureEntity[]
  ready: boolean
  lastChange: {
    added?: CreatureEntity[]
    deleted?: string[]
    modified?: CreatureEntity[]
  } | null
}

export function useCreatures(): UseCreaturesResult {
  const { data, ready, lastChange } = useWatch<
    { player: unknown; npcs: unknown },
    CreaturesData
  >({
    namespace: 'watch',
    name: 'Creatures',
    extractSnapshot: (e) => {
      const d = e.data ?? {}
      const playerRaw = (d as Record<string, unknown>).player
      const npcsRaw = arr((d as Record<string, unknown>).npcs)
      return {
        player: playerRaw ? normalizeCreature(playerRaw) : null,
        npcs: npcsRaw.map(normalizeCreature),
      }
    },
    mergeChanges: (current, event) => {
      const added = arr(event.added).map(normalizeCreature)
      const deletedIds = new Set(arr<string>(event.deleted))
      const modified = arr(event.modified).map(normalizeCreature)

      const map = new Map<string, CreatureEntity>()
      if (current.player?.Creature) map.set(current.player.Creature.creature_id, current.player)
      for (const npc of current.npcs) {
        if (npc.Creature) map.set(npc.Creature.creature_id, npc)
      }

      for (const id of deletedIds) map.delete(id)
      for (const ent of [...added, ...modified]) {
        if (ent.Creature) map.set(ent.Creature.creature_id, ent)
      }

      let player: CreatureEntity | null = null
      const npcs: CreatureEntity[] = []
      for (const ent of map.values()) {
        if (ent.IsPlayer) player = ent
        else npcs.push(ent)
      }
      return { player, npcs }
    },
    initialFetch: async (pub) => {
      const [playerRes, npcsRes] = await Promise.all([
        (pub as any).ecs.system['Query.getPlayerEntity']({}),
        (pub as any).ecs.system['Query.getNPCEntities']({}),
      ])
      return {
        player: playerRes?.success && playerRes?.found ? normalizeCreature(playerRes) : null,
        npcs: arr(npcsRes?.entities).map(normalizeCreature),
      }
    },
  })

  return useMemo(() => ({
    player: data?.player ?? null,
    npcs: data?.npcs ?? [],
    ready,
    lastChange: lastChange as UseCreaturesResult['lastChange'],
  }), [data, ready, lastChange])
}

// ── Player ──

export interface UsePlayerResult {
  player: CreatureEntity | null
  ready: boolean
  change: 'added' | 'modified' | 'deleted' | null
}

export function usePlayer(): UsePlayerResult {
  const { data, ready, lastChange } = useWatch<unknown, CreatureEntity | null>({
    namespace: 'watch',
    name: 'Player',
    extractSnapshot: (e) => e.data ? normalizeCreature(e.data) : null,
    mergeChanges: (_current, event) => {
      return event.data ? normalizeCreature(event.data) : null
    },
    initialFetch: async (pub) => {
      const res = await (pub as any).ecs.system['Query.getPlayerEntity']({})
      return res?.success && res?.found ? normalizeCreature(res) : null
    },
  })

  return useMemo(() => ({
    player: data,
    ready,
    change: (lastChange?.change as 'added' | 'modified' | 'deleted') ?? null,
  }), [data, ready, lastChange])
}

// ── NPCs ──

export function useNPCs(): { npcs: CreatureEntity[]; ready: boolean } {
  const { npcs, ready } = useCreatures()
  return useMemo(() => ({ npcs, ready }), [npcs, ready])
}

// ── Regions ──

export interface UseRegionsResult {
  regions: RegionEntity[]
  ready: boolean
  lastChange: {
    added?: RegionEntity[]
    deleted?: string[]
    modified?: RegionEntity[]
  } | null
}

export function useRegions(): UseRegionsResult {
  const { data, ready, lastChange } = useWatch<
    { regions: unknown },
    RegionEntity[]
  >({
    namespace: 'watch',
    name: 'Regions',
    extractSnapshot: (e) => arr((e.data as Record<string, unknown>)?.regions).map(normalizeRegion),
    mergeChanges: (current, event) => {
      const added = arr(event.added).map(normalizeRegion)
      const deletedIds = new Set(arr<string>(event.deleted))
      const modified = arr(event.modified).map(normalizeRegion)

      const map = new Map<string, RegionEntity>()
      for (const r of current) {
        if (r.Region) map.set(r.Region.region_id, r)
      }
      for (const id of deletedIds) map.delete(id)
      for (const ent of [...added, ...modified]) {
        if (ent.Region) map.set(ent.Region.region_id, ent)
      }
      return Array.from(map.values())
    },
    initialFetch: async (pub) => {
      const res = await (pub as any).ecs.system['Query.getRegionEntities']({})
      return res?.success ? arr(res.regions).map(normalizeRegion) : []
    },
  })

  return useMemo(() => ({
    regions: data ?? [],
    ready,
    lastChange: lastChange as UseRegionsResult['lastChange'],
  }), [data, ready, lastChange])
}

// ── Organizations ──

export interface UseOrganizationsResult {
  organizations: OrganizationEntity[]
  ready: boolean
  lastChange: {
    added?: OrganizationEntity[]
    deleted?: string[]
    modified?: OrganizationEntity[]
  } | null
}

export function useOrganizations(): UseOrganizationsResult {
  const { data, ready, lastChange } = useWatch<
    { organizations: unknown },
    OrganizationEntity[]
  >({
    namespace: 'watch',
    name: 'Organizations',
    extractSnapshot: (e) => arr((e.data as Record<string, unknown>)?.organizations).map(normalizeOrganization),
    mergeChanges: (current, event) => {
      const added = arr(event.added).map(normalizeOrganization)
      const deletedIds = new Set(arr<string>(event.deleted))
      const modified = arr(event.modified).map(normalizeOrganization)

      const map = new Map<string, OrganizationEntity>()
      for (const o of current) {
        if (o.Organization) map.set(o.Organization.organization_id, o)
      }
      for (const id of deletedIds) map.delete(id)
      for (const ent of [...added, ...modified]) {
        if (ent.Organization) map.set(ent.Organization.organization_id, ent)
      }
      return Array.from(map.values())
    },
    initialFetch: async (pub) => {
      const res = await (pub as any).ecs.system['Query.getOrganizationEntities']({})
      return res?.success ? arr(res.organizations).map(normalizeOrganization) : []
    },
  })

  return useMemo(() => ({
    organizations: data ?? [],
    ready,
    lastChange: lastChange as UseOrganizationsResult['lastChange'],
  }), [data, ready, lastChange])
}

// ── World ──

interface WorldData {
  World: WorldSnapshot
  GameInitialStory?: { background: string; start_story: string }
  GameWikiEntry?: Array<{ title: string; content: string }>
  AppInfo?: { publish_type?: string }
  GameInitChoice?: unknown
}

export interface UseWorldResult {
  world: WorldSnapshot | null
  ready: boolean
  changedAspects: string[]
}

export function useWorld(): UseWorldResult {
  const { data, ready, lastChange } = useWatch<WorldData, WorldData>({
    namespace: 'watch',
    name: 'World',
    extractSnapshot: (e) => {
      const d = e.data as Record<string, unknown> ?? {}
      return {
        World: normalizeWorld(d.World),
        GameInitialStory: d.GameInitialStory as WorldData['GameInitialStory'],
        GameWikiEntry: d.GameWikiEntry as WorldData['GameWikiEntry'],
        AppInfo: d.AppInfo as WorldData['AppInfo'],
        GameInitChoice: d.GameInitChoice,
      }
    },
    mergeChanges: (_current, event) => {
      const d = event.data as Record<string, unknown> ?? {}
      return {
        World: normalizeWorld(d.World),
        GameInitialStory: d.GameInitialStory as WorldData['GameInitialStory'],
        GameWikiEntry: d.GameWikiEntry as WorldData['GameWikiEntry'],
        AppInfo: d.AppInfo as WorldData['AppInfo'],
        GameInitChoice: d.GameInitChoice,
      }
    },
    initialFetch: async (pub) => {
      const [worldRes, storyRes] = await Promise.all([
        (pub as any).ecs.system['Query.getWorldEntity']({}),
        (pub as any).state.GetGameInitialStory({}),
      ])
      return {
        World: normalizeWorld(worldRes?.success && worldRes?.found ? worldRes : {}),
        GameInitialStory: storyRes?.found
          ? { background: storyRes.background, start_story: storyRes.start_story }
          : undefined,
      }
    },
  })

  return useMemo(() => ({
    world: data?.World ?? null,
    ready,
    changedAspects: lastChange?.changed_aspects as string[] ?? [],
  }), [data, ready, lastChange])
}
