/**
 * Organization compound components — ID-based, self-resolving.
 *
 * <Org.Root id="hua_luo_sect">
 *   <Org.Name />
 *   <Org.Territories />   // auto-resolves region/location names
 *   <Org.Members />       // auto-lists creatures with this org_id
 * </Org.Root>
 */

import React, { createContext, useContext } from 'react'
import { useGameData, type GameResolvers } from '../provider.tsx'
import type { OrganizationEntity, Territory } from '../types.ts'


interface OrgCtxValue { entity: OrganizationEntity; resolve: GameResolvers }
const OrgCtx = createContext<OrgCtxValue | null>(null)
function useCtx() {
  const ctx = useContext(OrgCtx)
  if (!ctx) throw new Error('Org.* must be used inside <Org.Root>')
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
  const { organizations, resolve } = useGameData()
  const entity = organizations.get(id)
  if (!entity) return fallback ? <>{fallback}</> : null
  return (
    <OrgCtx.Provider value={{ entity, resolve }}>
      <Tag data-slot="org" data-org-id={id} className={className}>{children}</Tag>
    </OrgCtx.Provider>
  )
}

interface SlotProps { as?: keyof React.JSX.IntrinsicElements; className?: string }

function Name({ as: Tag = 'h3', className }: SlotProps) {
  const { entity: e } = useCtx()
  return <Tag data-slot="org-name" className={className}>{e.Organization?.name}</Tag>
}

function Description({ as: Tag = 'p', className }: SlotProps) {
  const { entity: e } = useCtx()
  if (!e.Organization?.description) return null
  return <Tag data-slot="org-description" className={className}>{e.Organization.description}</Tag>
}

/** Territories — auto-resolves region/location names */
function Territories({ className, children }: { className?: string; children?: (t: Territory, i: number) => React.ReactNode }) {
  const { entity: e, resolve } = useCtx()
  const territories = e.Organization?.territories ?? []
  if (!territories.length) return null
  if (children) return <ul data-slot="org-territories" className={className}>{territories.map((t, i) => children(t, i))}</ul>
  return (
    <ul data-slot="org-territories" className={className}>
      {territories.map((t, i) => {
        const regionName = resolve.regionName(t.region_id)
        const locName = t.location_id ? resolve.locationName(t.region_id, t.location_id) : ''
        return (
          <li key={i} data-slot="org-territory">
            {regionName}{locName ? ` · ${locName}` : ''}
          </li>
        )
      })}
    </ul>
  )
}

/** Members — auto-lists all creatures with this organization_id */
function Members({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const { creatures } = useGameData()
  const orgId = e.Organization?.organization_id
  if (!orgId) return null

  const members: Array<{ id: string; name: string }> = []
  for (const [cid, creature] of creatures) {
    if (creature.Creature?.organization_id === orgId) {
      members.push({ id: cid, name: creature.Creature.name })
    }
  }
  if (members.length === 0) return null

  return (
    <ul data-slot="org-members" className={className}>
      {members.map((m) => (
        <li key={m.id} data-slot="org-member" data-creature-id={m.id}>{m.name}</li>
      ))}
    </ul>
  )
}

function StatusEffects({ className }: { className?: string }) {
  const { entity: e } = useCtx()
  const effects = e.StatusEffects?.status_effects ?? []
  if (!effects.length) return null
  return (
    <ul data-slot="org-status-effects" className={className}>
      {effects.map((eff, i) => (
        <li key={eff.instance_id || i} data-slot="org-status-effect">
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
  const base = world?.BaseInteraction?.organization_options ?? []
  const all = [...base, ...own]
  if (all.length === 0) return null
  return (
    <ul data-slot="org-interactions" className={className}>
      {all.map((opt) => (
        <li key={opt.id} data-slot="interaction-option">
          <span data-slot="interaction-title">{opt.title}</span>
          {opt.usage && <span data-slot="interaction-usage">{opt.usage}</span>}
        </li>
      ))}
    </ul>
  )
}

export const Org = { Root, Name, Description, Territories, Members, StatusEffects, Interactions }
