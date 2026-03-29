/**
 * Region compound components — ID-based, self-resolving.
 *
 * <Region.Root id="jade_female_peak">
 *   <Region.Name />
 *   <Region.Paths />    // auto-resolves to_region → target name
 * </Region.Root>
 */

import React, { createContext, useContext } from 'react'
import { useGameData, type GameResolvers } from '../provider.tsx'
import type { RegionEntity, RegionLocation, RegionPath } from '../types.ts'


interface RegionCtxValue { entity: RegionEntity; resolve: GameResolvers }
const RegionCtx = createContext<RegionCtxValue | null>(null)
function useCtx() {
  const ctx = useContext(RegionCtx)
  if (!ctx) throw new Error('Region.* must be used inside <Region.Root>')
  return ctx
}

interface RootProps {
  id: string
  children: React.ReactNode
  as?: keyof React.JSX.IntrinsicElements
  className?: string
  fallback?: React.ReactNode
}

function Root({ id, children, as: Tag = 'section', className, fallback }: RootProps) {
  const { regions, resolve } = useGameData()
  const entity = regions.get(id)
  if (!entity) return fallback ? <>{fallback}</> : null
  return (
    <RegionCtx.Provider value={{ entity, resolve }}>
      <Tag data-slot="region" data-region-id={id} className={className}>{children}</Tag>
    </RegionCtx.Provider>
  )
}

interface SlotProps { as?: keyof React.JSX.IntrinsicElements; className?: string }

function Name({ as: Tag = 'h3', className }: SlotProps) {
  const { entity: e } = useCtx()
  return <Tag data-slot="region-name" className={className}>{e.Region?.region_name}</Tag>
}

function Description({ as: Tag = 'p', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Region?.description) return null
  return <Tag data-slot="region-description" className={className}>{e.Region.description}</Tag>
}

function Metadata({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  if (!e.Metadata) return null
  return (
    <dl data-slot="region-metadata" className={className}>
      {e.Metadata.name && <><dt>名称</dt><dd>{e.Metadata.name}</dd></>}
      {e.Metadata.desc && <><dt>描述</dt><dd>{e.Metadata.desc}</dd></>}
    </dl>
  )
}

function Locations({ className, children }: { className?: string; children?: (loc: RegionLocation, i: number) => React.ReactNode }) {
  const { entity: e } = useCtx()
  const locs = e.Region?.locations ?? []
  if (!locs.length) return null
  if (children) return <ul data-slot="region-locations" className={className}>{locs.map((l, i) => children(l, i))}</ul>
  return (
    <ul data-slot="region-locations" className={className}>
      {locs.map((loc, i) => (
        <li key={loc.id ?? i} data-slot="region-location">
          <span data-slot="region-location-name">{loc.name ?? loc.id}</span>
          {loc.description && <span data-slot="region-location-desc">{loc.description}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Paths — auto-resolves to_region and to_location to display names */
function Paths({ className, children }: { className?: string; children?: (path: RegionPath, i: number) => React.ReactNode }) {
  const { entity: e, resolve } = useCtx()
  const paths = e.Region?.paths ?? []
  if (!paths.length) return null
  if (children) return <ul data-slot="region-paths" className={className}>{paths.map((p, i) => children(p, i))}</ul>
  return (
    <ul data-slot="region-paths" className={className}>
      {paths.map((p, i) => {
        const toRegionName = resolve.regionName(p.to_region)
        const toLocName = p.to_location ? resolve.locationName(p.to_region, p.to_location) : ''
        const target = toLocName ? `${toRegionName} · ${toLocName}` : toRegionName
        return (
          <li key={i} data-slot="region-path" data-discovered={p.discovered}>
            <span data-slot="region-path-route">→ {target}</span>
            {p.description && <span data-slot="region-path-desc">{p.description}</span>}
            {!p.discovered && <span data-slot="region-path-undiscovered">未发现</span>}
          </li>
        )
      })}
    </ul>
  )
}

function StatusEffects({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const effects = e.StatusEffects?.status_effects ?? []
  if (!effects.length) return null
  return (
    <ul data-slot="region-status-effects" className={className}>
      {effects.map((eff, i) => (
        <li key={eff.instance_id || i} data-slot="region-status-effect">
          <span data-slot="effect-name">{eff.display_name ?? eff.instance_id}</span>
          {eff.remark && <span data-slot="effect-remark">{eff.remark}</span>}
        </li>
      ))}
    </ul>
  )
}

function Interactions({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const { world } = useGameData()
  const own = e.Interaction?.options ?? []
  const base = world?.BaseInteraction?.region_options ?? []
  const all = [...base, ...own]
  if (all.length === 0) return null
  return (
    <ul data-slot="region-interactions" className={className}>
      {all.map((opt) => (
        <li key={opt.id} data-slot="interaction-option">
          <span data-slot="interaction-title">{opt.title}</span>
          {opt.usage && <span data-slot="interaction-usage">{opt.usage}</span>}
        </li>
      ))}
    </ul>
  )
}

export const Region = { Root, Name, Description, Metadata, Locations, Paths, StatusEffects, Interactions }
