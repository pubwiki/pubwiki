/**
 * Pre-composed panels — zero-props, self-contained.
 *
 * <PlayerPanel />     // auto-finds player
 * <CreatureList />    // renders all creatures
 * <NPCList />         // renders non-player creatures
 * <RegionList />      // renders all regions
 * <OrgList />         // renders all orgs
 * <WorldPanel />      // renders world state
 */

import React from 'react'
import { useGameData } from '../provider.tsx'
import { Creature } from './creature.tsx'
import { Player } from './player.tsx'
import { Region } from './region.tsx'
import { Org } from './organization.tsx'

// ── PlayerPanel ──

export function PlayerPanel({ className, fallback }: { className?: string; fallback?: React.ReactNode }) {
  return (
    <Player.Root className={className} fallback={fallback}>
      <Player.Identity />
      <Player.Titles />
      <Player.Emotion />
      <Player.Personality />
      <Player.Description />
      <Player.Appearance />
      <Player.Stats />
      <Player.Location />
      <Player.Organization />
      <Player.Inventory />
      <Player.StatusEffects />
      <Player.CustomComponents />
      <Player.Interactions />
    </Player.Root>
  )
}

// ── CreatureList / NPCList ──

function CreatureCard({ id, className }: { id: string; className?: string }) {
  return (
    <Creature.Root id={id} as="article" className={className}>
      <Creature.Identity />
      <Creature.Titles />
      <Creature.Emotion />
      <Creature.Personality />
      <Creature.Description />
      <Creature.Appearance />
      <Creature.Stats />
      <Creature.Goal />
      <Creature.Location />
      <Creature.Organization />
      <Creature.Inventory />
      <Creature.StatusEffects />
      <Creature.CustomComponents />
      <Creature.KnownInfos />
      <Creature.Interactions />
    </Creature.Root>
  )
}

export function CreatureList({ className }: { className?: string }) {
  const { creatures } = useGameData()
  const ids = Array.from(creatures.keys())
  if (ids.length === 0) return null
  return (
    <div data-slot="creature-list" className={className}>
      {ids.map((id) => <CreatureCard key={id} id={id} />)}
    </div>
  )
}

export function NPCList({ className }: { className?: string }) {
  const { creatures } = useGameData()
  const ids: string[] = []
  for (const [id, e] of creatures) {
    if (!e.IsPlayer) ids.push(id)
  }
  if (ids.length === 0) return null
  return (
    <div data-slot="npc-list" className={className}>
      {ids.map((id) => <CreatureCard key={id} id={id} />)}
    </div>
  )
}

// ── RegionList ──

export function RegionList({ className }: { className?: string }) {
  const { regions } = useGameData()
  const ids = Array.from(regions.keys())
  if (ids.length === 0) return null
  return (
    <div data-slot="region-list" className={className}>
      {ids.map((id) => (
        <Region.Root key={id} id={id} as="article" className={className}>
          <Region.Name />
          <Region.Description />
          <Region.Metadata />
          <Region.Locations />
          <Region.Paths />
          <Region.StatusEffects />
          <Region.Interactions />
        </Region.Root>
      ))}
    </div>
  )
}

// ── OrgList ──

export function OrgList({ className }: { className?: string }) {
  const { organizations } = useGameData()
  const ids = Array.from(organizations.keys())
  if (ids.length === 0) return null
  return (
    <div data-slot="org-list" className={className}>
      {ids.map((id) => (
        <Org.Root key={id} id={id} as="article" className={className}>
          <Org.Name />
          <Org.Description />
          <Org.Territories />
          <Org.Members />
          <Org.StatusEffects />
          <Org.Interactions />
        </Org.Root>
      ))}
    </div>
  )
}

// ── WorldPanel ──

export function WorldPanel({ className }: { className?: string }) {
  const { world } = useGameData()
  if (!world) return null

  return (
    <div data-slot="world-panel" className={className}>
      {world.GameTime && (
        <div data-slot="world-game-time">
          {world.GameTime.year}年{world.GameTime.month}月{world.GameTime.day}日{' '}
          {String(world.GameTime.hour).padStart(2, '0')}:{String(world.GameTime.minute).padStart(2, '0')}
        </div>
      )}

      {world.Events?.events && world.Events.events.length > 0 && (
        <ul data-slot="world-events">
          {world.Events.events.map((ev) => (
            <li key={ev.event_id} data-slot="world-event">
              <span data-slot="event-title">{ev.title}</span>
              <span data-slot="event-summary">{ev.summary}</span>
            </li>
          ))}
        </ul>
      )}

      {world.DirectorNotes?.stage_goal && (
        <p data-slot="world-director-goal">{world.DirectorNotes.stage_goal}</p>
      )}
    </div>
  )
}
