/**
 * Game UI hooks — watch-based reactive hooks for game state.
 *
 * Each hook uses a two-phase strategy:
 * 1. Immediate one-shot fetch via existing query services (fast first paint)
 * 2. watch:* streaming subscription for real-time updates
 */

import { useMemo } from 'react'
import { useWatch, type WatchState } from './use-watch.ts'

/** Lua's empty `{}` may arrive as object instead of array. Coerce safely. */
function asArray<T>(val: T[] | Record<string, unknown> | null | undefined): T[] {
  if (Array.isArray(val)) return val
  return []
}
import type {
  CreatureEntity,
  RegionEntity,
  OrganizationEntity,
  WorldSnapshot,
  WatchCreaturesEvent,
  WatchPlayerEvent,
  WatchRegionsEvent,
  WatchOrganizationsEvent,
  WatchWorldEvent,
} from '../types.ts'

// ── Creatures ──

export interface UseCreaturesResult {
  player: CreatureEntity | null
  npcs: CreatureEntity[]
  ready: boolean
  added: string[]
  deleted: string[]
  modified: string[]
}

export function useCreatures(): UseCreaturesResult {
  const { data, ready, lastChange } = useWatch<
    WatchCreaturesEvent,
    WatchCreaturesEvent['data']
  >({
    namespace: 'watch',
    name: 'Creatures',
    extractData: (e) => {
      console.log('[useCreatures] watch event:', e.type, 'npcs raw:', e.data?.npcs, 'isArray:', Array.isArray(e.data?.npcs), 'type:', typeof e.data?.npcs)
      return e.data
    },
    initialFetch: async (pub) => {
      const [playerRes, npcsRes] = await Promise.all([
        (pub as any).ecs.system['Query.getPlayerEntity']({}),
        (pub as any).ecs.system['Query.getNPCEntities']({}),
      ])
      const result = {
        player: playerRes?.success && playerRes?.found ? playerRes : null,
        npcs: npcsRes?.success ? asArray(npcsRes.entities) : [],
      }
      console.log('[useCreatures] initialFetch result:', 'npcs:', result.npcs, 'isArray:', Array.isArray(result.npcs), 'raw entities:', npcsRes?.entities)
      return result
    },
  })

  return useMemo(() => ({
    player: data?.player ?? null,
    npcs: asArray(data?.npcs),
    ready,
    added: lastChange?.added as string[] ?? [],
    deleted: lastChange?.deleted as string[] ?? [],
    modified: lastChange?.modified as string[] ?? [],
  }), [data, ready, lastChange])
}

// ── Player ──

export interface UsePlayerResult {
  player: CreatureEntity | null
  ready: boolean
  change: 'added' | 'modified' | 'deleted' | null
}

export function usePlayer(): UsePlayerResult {
  const { data, ready, lastChange } = useWatch<WatchPlayerEvent, CreatureEntity | null>({
    namespace: 'watch',
    name: 'Player',
    extractData: (e) => e.data,
    initialFetch: async (pub) => {
      const res = await (pub as any).ecs.system['Query.getPlayerEntity']({})
      return res?.success && res?.found ? res : null
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
  added: string[]
  deleted: string[]
  modified: string[]
}

export function useRegions(): UseRegionsResult {
  const { data, ready, lastChange } = useWatch<WatchRegionsEvent, WatchRegionsEvent['data']>({
    namespace: 'watch',
    name: 'Regions',
    extractData: (e) => e.data,
    initialFetch: async (pub) => {
      const res = await (pub as any).state.GetStateFromGame({})
      if (!res?.success) return null
      return { regions: asArray(res.data?.Regions) }
    },
  })

  return useMemo(() => ({
    regions: asArray(data?.regions),
    ready,
    added: lastChange?.added as string[] ?? [],
    deleted: lastChange?.deleted as string[] ?? [],
    modified: lastChange?.modified as string[] ?? [],
  }), [data, ready, lastChange])
}

// ── Organizations ──

export interface UseOrganizationsResult {
  organizations: OrganizationEntity[]
  ready: boolean
  added: string[]
  deleted: string[]
  modified: string[]
}

export function useOrganizations(): UseOrganizationsResult {
  const { data, ready, lastChange } = useWatch<WatchOrganizationsEvent, WatchOrganizationsEvent['data']>({
    namespace: 'watch',
    name: 'Organizations',
    extractData: (e) => e.data,
    initialFetch: async (pub) => {
      const res = await (pub as any).state.GetStateFromGame({})
      if (!res?.success) return null
      return { organizations: asArray(res.data?.Organizations) }
    },
  })

  return useMemo(() => ({
    organizations: asArray(data?.organizations),
    ready,
    added: lastChange?.added as string[] ?? [],
    deleted: lastChange?.deleted as string[] ?? [],
    modified: lastChange?.modified as string[] ?? [],
  }), [data, ready, lastChange])
}

// ── World ──

export interface UseWorldResult {
  world: WorldSnapshot | null
  storyHistory: unknown[]
  ready: boolean
  changedAspects: string[]
}

export function useWorld(): UseWorldResult {
  const { data, ready, lastChange } = useWatch<WatchWorldEvent, WatchWorldEvent['data']>({
    namespace: 'watch',
    name: 'World',
    extractData: (e) => e.data,
    initialFetch: async (pub) => {
      const res = await (pub as any).state.GetStateFromGame({})
      if (!res?.success) return null
      return {
        World: res.data?.World ?? {},
        StoryHistory: res.data?.StoryHistory ?? [],
        GameInitialStory: res.data?.GameInitialStory,
        GameWikiEntry: res.data?.GameWikiEntry,
        AppInfo: res.data?.AppInfo,
        GameInitChoice: res.data?.GameInitChoice,
      }
    },
  })

  return useMemo(() => ({
    world: data?.World ?? null,
    storyHistory: data?.StoryHistory ?? [],
    ready,
    changedAspects: lastChange?.changed_aspects as string[] ?? [],
  }), [data, ready, lastChange])
}
