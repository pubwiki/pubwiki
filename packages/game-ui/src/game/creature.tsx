/**
 * Creature compound components — ID-based, self-resolving.
 *
 * Usage:
 *   <Creature.Root id="liu_yan_er">
 *     <Creature.Name />
 *     <Creature.Stats />          // auto field_display_name from Registry
 *     <Creature.Location />       // auto resolves region/location names
 *     <Creature.Organization />   // auto resolves org name
 *     <Creature.CustomComponents /> // auto resolves component_name from Registry
 *   </Creature.Root>
 */

import React, { createContext, useContext } from 'react'
import { useGameData, type GameResolvers } from '../provider.tsx'
import type {
  CreatureEntity,
  InventoryItem,
  StatusEffect,
  CustomComponentInstance,
  CustomComponentDef,
} from '../types.ts'

// ── Context ──

interface CreatureCtxValue {
  entity: CreatureEntity
  resolve: GameResolvers
}

const CreatureCtx = createContext<CreatureCtxValue | null>(null)

function useCtx(): CreatureCtxValue {
  const ctx = useContext(CreatureCtx)
  if (!ctx) throw new Error('Creature.* must be used inside <Creature.Root>')
  return ctx
}

// ── Root ──

interface RootProps {
  id: string
  children: React.ReactNode
  as?: keyof React.JSX.IntrinsicElements
  className?: string
  fallback?: React.ReactNode
}

function Root({ id, children, as: Tag = 'section', className, fallback }: RootProps) {
  const { creatures, resolve } = useGameData()
  const entity = creatures.get(id)
  if (!entity) return fallback ? <>{fallback}</> : null

  return (
    <CreatureCtx.Provider value={{ entity, resolve }}>
      <Tag data-slot="creature" data-creature-id={id} className={className}>
        {children}
      </Tag>
    </CreatureCtx.Provider>
  )
}

// ── Slots ──

interface SlotProps {
  as?: keyof React.JSX.IntrinsicElements
  className?: string
}

function Name({ as: Tag = 'h3', className }: SlotProps) {
  const { entity: e } = useCtx()
  return <Tag data-slot="creature-name" className={className}>{e.Creature?.name}</Tag>
}

function Description({ as: Tag = 'p', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Creature?.description) return null
  return <Tag data-slot="creature-description" className={className}>{e.Creature.description}</Tag>
}

function Gender({ as: Tag = 'span', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Creature?.gender) return null
  return <Tag data-slot="creature-gender" className={className}>{e.Creature.gender}</Tag>
}

function Race({ as: Tag = 'span', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Creature?.race) return null
  return <Tag data-slot="creature-race" className={className}>{e.Creature.race}</Tag>
}

function Personality({ as: Tag = 'p', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Creature?.personality) return null
  return <Tag data-slot="creature-personality" className={className}>{e.Creature.personality}</Tag>
}

function Emotion({ as: Tag = 'span', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Creature?.emotion) return null
  return <Tag data-slot="creature-emotion" className={className}>{e.Creature.emotion}</Tag>
}

function Goal({ as: Tag = 'p', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Creature?.goal) return null
  return <Tag data-slot="creature-goal" className={className}>{e.Creature.goal}</Tag>
}

function Titles({ as: Tag = 'ul', className }: SlotProps) {
  const { entity: e } = useCtx()
  const titles = e.Creature?.titles ?? []
  if (!titles.length) return null
  return (
    <Tag data-slot="creature-titles" className={className}>
      {titles.map((t, i) => <li key={i} data-slot="creature-title">{String(t)}</li>)}
    </Tag>
  )
}

function Identity({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const c = e.Creature
  if (!c) return null
  const parts = [c.gender, c.race].filter(Boolean).join(' · ')
  return (
    <div data-slot="creature-identity" className={className}>
      <span data-slot="creature-name">{c.name}</span>
      {parts && <span data-slot="creature-identity-meta"> ({parts})</span>}
    </div>
  )
}

function AppearanceSlot({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const a = e.Creature?.appearance
  if (!a?.body && !a?.clothing) return null
  return (
    <dl data-slot="creature-appearance" className={className}>
      {a.body && <><dt data-slot="creature-appearance-label">外貌</dt><dd data-slot="creature-appearance-body">{a.body}</dd></>}
      {a.clothing && <><dt data-slot="creature-appearance-label">服装</dt><dd data-slot="creature-appearance-clothing">{a.clothing}</dd></>}
    </dl>
  )
}

/** Stats — auto-resolves field_display_name from World.Registry */
function Stats({ className }: { className?: string }) {
  const { entity: e, resolve } = useCtx()
  const attrs = e.Creature?.attrs
  if (!attrs || Object.keys(attrs).length === 0) return null

  // Use registry order if available, fallback to Object.keys
  const fields = resolve.attrFields()
  const orderedKeys = fields.length > 0
    ? fields.map(f => f.field_name).filter(k => k in attrs)
    : Object.keys(attrs)

  return (
    <dl data-slot="creature-stats" className={className}>
      {orderedKeys.map((key) => {
        const display = resolve.attrDisplay(key)
        return (
          <React.Fragment key={key}>
            <dt data-slot="creature-stat-key" title={display?.hint}>{display?.label ?? key}</dt>
            <dd data-slot="creature-stat-value">{String(attrs[key])}</dd>
          </React.Fragment>
        )
      })}
    </dl>
  )
}

/** Location — auto-resolves region + location names */
function Location({ className }: { className?: string }) {
  const { entity: e, resolve } = useCtx()
  const loc = e.LocationRef
  if (!loc?.region_id && !loc?.location_id) return null
  const regionName = loc.region_id ? resolve.regionName(loc.region_id) : ''
  const locationName = loc.region_id && loc.location_id
    ? resolve.locationName(loc.region_id, loc.location_id)
    : loc.location_id ?? ''
  return (
    <span data-slot="creature-location" className={className}>
      {regionName}{locationName ? ` · ${locationName}` : ''}
    </span>
  )
}

/** Organization — auto-resolves org name */
function OrganizationSlot({ as: Tag = 'span', className }: SlotProps) {
  const { entity: e, resolve } = useCtx()
  if (!e.Creature?.organization_id) return null
  return (
    <Tag data-slot="creature-organization" className={className}>
      {resolve.orgName(e.Creature.organization_id)}
    </Tag>
  )
}

function KnownInfos({ as: Tag = 'ul', className }: SlotProps) {
  const { entity: e } = useCtx()
  const infos = e.Creature?.known_infos ?? []
  if (!infos.length) return null
  return (
    <Tag data-slot="creature-known-infos" className={className}>
      {infos.map((info, i) => <li key={i} data-slot="creature-known-info">{String(info)}</li>)}
    </Tag>
  )
}

function Inventory({ className, children }: { className?: string; children?: (item: InventoryItem, i: number) => React.ReactNode }) {
  const { entity: e } = useCtx()
  const items = e.Inventory?.items ?? []
  if (!items.length) return null
  if (children) return <ul data-slot="creature-inventory" className={className}>{items.map((item, i) => children(item, i))}</ul>
  return (
    <ul data-slot="creature-inventory" className={className}>
      {items.map((item, i) => (
        <li key={item.id || i} data-slot="creature-inventory-item" data-equipped={item.equipped || undefined}>
          <span data-slot="item-name">{item.name}</span>
          {item.count > 1 && <span data-slot="item-count"> ×{item.count}</span>}
          {item.equipped && <span data-slot="item-equipped">装备中</span>}
          {item.description && <span data-slot="item-description">{item.description}</span>}
          {(item.details ?? []).map((d, j) => <span key={j} data-slot="item-detail">{String(d)}</span>)}
        </li>
      ))}
    </ul>
  )
}

function StatusEffects({ className, children }: { className?: string; children?: (eff: StatusEffect, i: number) => React.ReactNode }) {
  const { entity: e } = useCtx()
  const effects = e.StatusEffects?.status_effects ?? []
  if (!effects.length) return null
  if (children) return <ul data-slot="creature-status-effects" className={className}>{effects.map((eff, i) => children(eff, i))}</ul>
  return (
    <ul data-slot="creature-status-effects" className={className}>
      {effects.map((eff, i) => (
        <li key={eff.instance_id || i} data-slot="creature-status-effect">
          <span data-slot="effect-name">{eff.display_name ?? eff.instance_id}</span>
          {eff.remark && <span data-slot="effect-remark">{eff.remark}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Render a single value based on JSON Schema type info */
function renderSchemaValue(value: unknown, schema?: Record<string, unknown>): React.ReactNode {
  if (value == null) return <span data-slot="custom-component-null">—</span>

  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) return <span data-slot="custom-component-empty">空</span>
    const itemSchema = schema?.items as Record<string, unknown> | undefined
    return (
      <ul data-slot="custom-component-array">
        {value.map((item, i) => (
          <li key={i} data-slot="custom-component-array-item">
            {renderSchemaValue(item, itemSchema)}
          </li>
        ))}
      </ul>
    )
  }

  // Object — render each property with schema labels
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>
    const keys = Object.keys(props).length > 0 ? Object.keys(props) : Object.keys(obj)
    return (
      <dl data-slot="custom-component-object">
        {keys.filter(k => k in obj).map((k) => {
          const propSchema = props[k]
          const label = (propSchema?.description as string) || (propSchema?.title as string) || k
          return (
            <React.Fragment key={k}>
              <dt data-slot="custom-component-field-key" title={k}>{label}</dt>
              <dd data-slot="custom-component-field-value">
                {renderSchemaValue(obj[k], propSchema)}
              </dd>
            </React.Fragment>
          )
        })}
      </dl>
    )
  }

  // Boolean
  if (typeof value === 'boolean') return <span data-slot="custom-component-bool">{value ? '是' : '否'}</span>

  // Primitive
  return <span data-slot="custom-component-value">{String(value)}</span>
}

/** CustomComponents — auto-resolves component_name + schema-driven rendering from Registry */
function CustomComponents({ className, children }: { className?: string; children?: (comp: CustomComponentInstance, def: CustomComponentDef | null, i: number) => React.ReactNode }) {
  const { entity: e, resolve } = useCtx()
  const comps = e.CustomComponents?.custom_components ?? []
  if (!comps.length) return null

  if (children) {
    return (
      <div data-slot="creature-custom-components" className={className}>
        {comps.map((comp, i) => children(comp, resolve.componentDef(comp.component_key), i))}
      </div>
    )
  }

  return (
    <div data-slot="creature-custom-components" className={className}>
      {comps.map((comp, i) => {
        const def = resolve.componentDef(comp.component_key)
        const schema = def?.type_schema as Record<string, unknown> | undefined
        return (
          <div key={comp.component_key || i} data-slot="custom-component-instance">
            <h5 data-slot="custom-component-key">{def?.component_name ?? comp.component_key}</h5>
            {renderSchemaValue(comp.data, schema)}
          </div>
        )
      })}
    </div>
  )
}

/** Interaction options (entity-specific + inherited from BaseInteraction) */
function Interactions({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const { world } = useGameData()
  const own = e.Interaction?.options ?? []
  const base = world?.BaseInteraction?.creature_options ?? []
  const all = [...base, ...own]
  if (all.length === 0) return null
  return (
    <ul data-slot="creature-interactions" className={className}>
      {all.map((opt) => (
        <li key={opt.id} data-slot="interaction-option">
          <span data-slot="interaction-title">{opt.title}</span>
          {opt.usage && <span data-slot="interaction-usage">{opt.usage}</span>}
        </li>
      ))}
    </ul>
  )
}

export const Creature = {
  Root, Name, Description, Gender, Race, Personality, Emotion, Goal,
  Titles, Identity,
  Appearance: AppearanceSlot,
  Stats, Location,
  Organization: OrganizationSlot,
  KnownInfos, Inventory, StatusEffects, CustomComponents, Interactions,
}
