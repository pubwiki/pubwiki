/**
 * normalize.ts — Sanitize raw backend data into trusted frontend types.
 *
 * Backend data may have:
 * - Lua empty tables `{}` arriving as JS `{}` (object) instead of `[]` (array)
 * - Missing optional fields
 * - AI-created entities with incomplete data
 *
 * These functions run ONCE at the data boundary (in hooks),
 * so all downstream code can trust the data shape.
 */

import type {
  CreatureEntity,
  RegionEntity,
  OrganizationEntity,
  WorldSnapshot,
  BaseInteraction,
} from './types.ts'

/** Coerce Lua empty table `{}` to array `[]`. */
function arr<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val
  return []
}

/** Ensure value is a string, defaulting to empty. */
function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback
}

// ── Creature ──

export function normalizeCreature(raw: unknown): CreatureEntity {
  const e = (raw ?? {}) as Record<string, unknown>
  const c = (e.Creature ?? {}) as Record<string, unknown>
  const inv = (e.Inventory ?? {}) as Record<string, unknown>
  const se = (e.StatusEffects ?? {}) as Record<string, unknown>
  const cc = (e.CustomComponents ?? {}) as Record<string, unknown>
  const log = (e.Log ?? {}) as Record<string, unknown>
  const bs = (e.BindSetting ?? {}) as Record<string, unknown>
  const inter = (e.Interaction ?? {}) as Record<string, unknown>
  const loc = (e.LocationRef ?? {}) as Record<string, unknown>

  return {
    entity_id: e.entity_id as string ?? '',
    Creature: {
      creature_id: str(c.creature_id),
      name: str(c.name),
      gender: c.gender as string | undefined,
      race: c.race as string | undefined,
      emotion: c.emotion as string | undefined,
      personality: c.personality as string | undefined,
      description: c.description as string | undefined,
      goal: c.goal as string | undefined,
      organization_id: c.organization_id as string | undefined,
      titles: arr(c.titles),
      attrs: (c.attrs && typeof c.attrs === 'object' && !Array.isArray(c.attrs)) ? c.attrs as Record<string, number | string> : {},
      known_infos: arr(c.known_infos),
      appearance: {
        body: str((c.appearance as Record<string, unknown>)?.body),
        clothing: str((c.appearance as Record<string, unknown>)?.clothing),
      },
    },
    IsPlayer: e.IsPlayer ? (e.IsPlayer as Record<string, unknown>) : undefined,
    LocationRef: {
      region_id: str(loc.region_id),
      location_id: str(loc.location_id),
    },
    Inventory: { items: arr(inv.items) },
    StatusEffects: { status_effects: arr(se.status_effects) },
    CustomComponents: { custom_components: arr(cc.custom_components) },
    Log: { entries: arr(log.entries) },
    BindSetting: { documents: arr(bs.documents) },
    Interaction: { options: arr(inter.options) },
  }
}

// ── Region ──

export function normalizeRegion(raw: unknown): RegionEntity {
  const e = (raw ?? {}) as Record<string, unknown>
  const r = (e.Region ?? {}) as Record<string, unknown>
  const meta = (e.Metadata ?? {}) as Record<string, unknown>
  const se = (e.StatusEffects ?? {}) as Record<string, unknown>
  const log = (e.Log ?? {}) as Record<string, unknown>
  const bs = (e.BindSetting ?? {}) as Record<string, unknown>
  const inter = (e.Interaction ?? {}) as Record<string, unknown>

  return {
    entity_id: e.entity_id as string ?? '',
    Region: {
      region_id: str(r.region_id),
      region_name: str(r.region_name),
      description: str(r.description),
      locations: arr(r.locations),
      paths: arr(r.paths),
    },
    Metadata: meta.name ? { name: str(meta.name), desc: str(meta.desc) } : undefined,
    StatusEffects: { status_effects: arr(se.status_effects) },
    Log: { entries: arr(log.entries) },
    BindSetting: { documents: arr(bs.documents) },
    Interaction: { options: arr(inter.options) },
  }
}

// ── Organization ──

export function normalizeOrganization(raw: unknown): OrganizationEntity {
  const e = (raw ?? {}) as Record<string, unknown>
  const o = (e.Organization ?? {}) as Record<string, unknown>
  const se = (e.StatusEffects ?? {}) as Record<string, unknown>
  const log = (e.Log ?? {}) as Record<string, unknown>
  const bs = (e.BindSetting ?? {}) as Record<string, unknown>
  const inter = (e.Interaction ?? {}) as Record<string, unknown>

  return {
    entity_id: e.entity_id as string ?? '',
    Organization: {
      organization_id: str(o.organization_id),
      name: str(o.name),
      description: str(o.description),
      territories: arr(o.territories),
    },
    StatusEffects: { status_effects: arr(se.status_effects) },
    Log: { entries: arr(log.entries) },
    BindSetting: { documents: arr(bs.documents) },
    Interaction: { options: arr(inter.options) },
  }
}

// ── World ──

export function normalizeWorld(raw: unknown): WorldSnapshot {
  const e = (raw ?? {}) as Record<string, unknown>
  const reg = (e.Registry ?? {}) as Record<string, unknown>
  const ccr = (e.CustomComponentRegistry ?? {}) as Record<string, unknown>
  const dn = (e.DirectorNotes ?? {}) as Record<string, unknown>
  const ev = (e.Events ?? {}) as Record<string, unknown>
  const log = (e.Log ?? {}) as Record<string, unknown>
  const bs = (e.BindSetting ?? {}) as Record<string, unknown>
  const inter = (e.Interaction ?? {}) as Record<string, unknown>
  const bi = (e.BaseInteraction ?? {}) as Record<string, unknown>

  return {
    entity_id: e.entity_id as number | string | undefined,
    GameTime: e.GameTime as WorldSnapshot['GameTime'],
    Registry: { creature_attr_fields: arr(reg.creature_attr_fields) },
    CustomComponentRegistry: { custom_components: arr(ccr.custom_components) },
    DirectorNotes: dn ? {
      notes: arr(dn.notes),
      flags: (dn.flags && typeof dn.flags === 'object' && !Array.isArray(dn.flags)) ? dn.flags as Record<string, { id: string; value: boolean; remark?: string }> : {},
      stage_goal: dn.stage_goal as string | undefined,
    } : undefined,
    Events: { events: arr(ev.events) },
    Log: { entries: arr(log.entries) },
    BindSetting: { documents: arr(bs.documents) },
    Interaction: { options: arr(inter.options) },
    BaseInteraction: normalizeBaseInteraction(e.BaseInteraction),
  }
}

function normalizeBaseInteraction(raw: unknown): BaseInteraction | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const bi = raw as Record<string, unknown>
  return {
    creature_options: arr(bi.creature_options),
    region_options: arr(bi.region_options),
    organization_options: arr(bi.organization_options),
  }
}
