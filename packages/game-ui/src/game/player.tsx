/**
 * Player compound components — auto-finds the player creature, zero props needed.
 *
 * Usage:
 *   <Player.Root>
 *     <Player.Name />
 *     <Player.Stats />
 *   </Player.Root>
 */

import React from 'react'
import { useGameData } from '../provider.tsx'
import { Creature } from './creature.tsx'

interface RootProps {
  children: React.ReactNode
  as?: keyof React.JSX.IntrinsicElements
  className?: string
  fallback?: React.ReactNode
}

function Root({ children, as, className, fallback }: RootProps) {
  const { player } = useGameData()
  const playerId = player?.Creature?.creature_id
  if (!playerId) return fallback ? <>{fallback}</> : null

  return (
    <Creature.Root id={playerId} as={as} className={className} fallback={fallback}>
      {children}
    </Creature.Root>
  )
}

interface SlotProps {
  as?: keyof React.JSX.IntrinsicElements
  className?: string
}

function IsPlayer({ as: Tag = 'span', className }: SlotProps) {
  return <Tag data-slot="player-badge" className={className}>Player</Tag>
}

export const Player = {
  Root,
  IsPlayer,
  Name: Creature.Name,
  Description: Creature.Description,
  Gender: Creature.Gender,
  Race: Creature.Race,
  Personality: Creature.Personality,
  Emotion: Creature.Emotion,
  Goal: Creature.Goal,
  Titles: Creature.Titles,
  Identity: Creature.Identity,
  Appearance: Creature.Appearance,
  Stats: Creature.Stats,
  Location: Creature.Location,
  Organization: Creature.Organization,
  KnownInfos: Creature.KnownInfos,
  Inventory: Creature.Inventory,
  StatusEffects: Creature.StatusEffects,
  CustomComponents: Creature.CustomComponents,
  Interactions: Creature.Interactions,
}
