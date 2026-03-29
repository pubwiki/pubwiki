---
title: Game UI Components Guide
description: How to use @pubwiki/game-ui unstyled compound components to display player, creature, region, and organization data
---

# Game UI Components Guide

`@pubwiki/game-ui` provides **unstyled compound components** for rendering structured game entity data. All components output semantic HTML with `data-slot` attributes for easy CSS targeting — zero inline styles.

All hooks return **fully resolved structured data** — inventory items, status effects, custom components, and other linked entities are automatically materialized from the underlying RDF triples.

## Quick Start — Pre-composed Panels

For rapid prototyping, use ready-made panels that handle data fetching internally:

```tsx
import { PlayerPanel, CreatureList, RegionList, OrgList } from '@pubwiki/game-ui'

function GameScreen() {
  return (
    <div>
      <PlayerPanel fallback={<p>No player found</p>} />
      <CreatureList />
      <RegionList />
      <OrgList />
    </div>
  )
}
```

Style them with CSS using `data-slot` selectors:

```css
[data-slot="creature"] { border: 1px solid #ccc; padding: 1rem; }
[data-slot="creature-name"] { font-size: 1.5rem; font-weight: bold; }
[data-slot="creature-stats"] { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; }
[data-slot="item-equipped"] { color: gold; }
[data-slot="effect-name"] { font-weight: 600; }
```

## Data Types

All hooks return **structured TypeScript types**, not raw triples:

```typescript
import type { Creature, Region, Organization, World } from '@pubwiki/game-sdk'

// Creature has: id, name, gender, race, personality, emotion, goal,
//   description, appearance, attrs, titles, known_infos, is_player,
//   organization_id, location, inventory (InventoryItem[]),
//   status_effects (StatusEffect[]), custom_components, interaction, log

// Region has: id, name, description, locations (RegionLocation[]),
//   paths (RegionPath[]), metadata, status_effects, interaction, log

// Organization has: id, name, description, territories (Territory[]),
//   status_effects, interaction, log

// World has: id, game_time, registry, custom_component_registry,
//   director_notes, events, interaction, base_interaction, log
```

## Compound Components — Custom Layouts

### Creature

```tsx
import { Creature } from '@pubwiki/game-ui'
import { useCreatures } from '@pubwiki/game-sdk'

function NPCCard({ creature }) {
  return (
    <Creature.Root value={creature} className="npc-card">
      <Creature.Identity />         {/* Name (Gender · Race) */}
      <Creature.Titles />           {/* <ul> of titles */}
      <Creature.Emotion />          {/* Current emotion text */}
      <Creature.Personality />      {/* Personality text */}
      <Creature.Description />      {/* Description text */}
      <Creature.Appearance />       {/* <dl> with body + clothing */}
      <Creature.Stats />            {/* <dl> of attribute key-value pairs */}
      <Creature.Goal />             {/* Goal text */}
      <Creature.Location />         {/* Region · Point */}
      <Creature.Organization />     {/* Organization ID */}
      <Creature.Inventory />        {/* <ul> of resolved InventoryItems */}
      <Creature.StatusEffects />    {/* <ul> of resolved StatusEffects */}
      <Creature.CustomComponents /> {/* <dl> of custom component data */}
      <Creature.KnownInfos />      {/* <ul> of known information */}
    </Creature.Root>
  )
}
```

#### Custom rendering via render props

`Inventory`, `StatusEffects`, and `CustomComponents` accept render props for full control:

```tsx
<Creature.Root value={creature}>
  <Creature.Inventory>
    {(item, i) => (
      <li key={item.id}>
        {item.name} ×{item.count}
        {item.equipped && ' ⚔️'}
        {item.description && <small>{item.description}</small>}
      </li>
    )}
  </Creature.Inventory>

  <Creature.StatusEffects>
    {(effect, i) => (
      <li key={effect.instance_id}>
        <strong>{effect.display_name}</strong>
        {effect.remark && <span> — {effect.remark}</span>}
      </li>
    )}
  </Creature.StatusEffects>

  <Creature.CustomComponents>
    {(comp, i) => (
      <div key={comp.component_key}>
        <h4>{comp.component_key}</h4>
        <pre>{JSON.stringify(comp.data, null, 2)}</pre>
      </div>
    )}
  </Creature.CustomComponents>
</Creature.Root>
```

### Player

`Player` wraps `Creature` with auto `usePlayer()` hook:

```tsx
import { Player } from '@pubwiki/game-ui'

function Sidebar() {
  return (
    <Player.Root fallback={<p>Loading...</p>} className="sidebar">
      <Player.Identity />
      <Player.Stats />
      <Player.Inventory />
      <Player.StatusEffects />
      <Player.CustomComponents />
      <Player.Location />
    </Player.Root>
  )
}
```

### Region

```tsx
import { Region } from '@pubwiki/game-ui'
import { useRegions } from '@pubwiki/game-sdk'

function RegionMap() {
  const regions = useRegions()
  return regions.map(r => (
    <Region.Root key={r.id} value={r}>
      <Region.Name />
      <Region.Description />
      <Region.Metadata />
      <Region.Locations />       {/* <ul> of RegionLocation */}
      <Region.Paths />           {/* <ul> of RegionPath (from → to) */}
      <Region.StatusEffects />
    </Region.Root>
  ))
}
```

`Locations` and `Paths` also support render props:

```tsx
<Region.Locations>
  {(loc, i) => <li key={loc.id}>{loc.name}: {loc.description}</li>}
</Region.Locations>
```

### Organization

```tsx
import { Org } from '@pubwiki/game-ui'
import { useOrganizations } from '@pubwiki/game-sdk'

function OrgPanel() {
  const orgs = useOrganizations()
  return orgs.map(o => (
    <Org.Root key={o.id} value={o}>
      <Org.Name />
      <Org.Description />
      <Org.Territories />        {/* <ul> of Territory */}
      <Org.StatusEffects />
    </Org.Root>
  ))
}
```

## Accessing Data Directly

You can also use hooks directly without UI components:

```tsx
import { usePlayer, useCreatures, useRegions, useOrganizations, useWorld, useNPCs } from '@pubwiki/game-sdk'
import type { Creature } from '@pubwiki/game-sdk'

function GameLogic() {
  const player = usePlayer()           // Creature | undefined
  const npcs = useNPCs()               // Creature[] (non-player only)
  const creatures = useCreatures()     // Creature[] (all)
  const regions = useRegions()         // Region[]
  const orgs = useOrganizations()      // Organization[]
  const world = useWorld()             // World

  // All data is fully resolved:
  player?.inventory         // InventoryItem[] with name, count, equipped, etc.
  player?.status_effects    // StatusEffect[] with display_name, remark, data
  player?.custom_components // CustomComponentInstance[] with component_key, data
  player?.attrs             // Record<string, number | string>
  player?.location          // { region_id, point }

  // World has registry info for data-driven rendering:
  world.registry                    // CreatureAttrField[] — what attrs exist
  world.custom_component_registry   // CustomComponentDef[] — schemas
  world.events                      // EventEntry[] — plot events
  world.game_time                   // GameTime — year/month/day/hour/minute
}
```

## Pre-composed Panels Reference

| Component | Internal Hook | Props |
|-----------|--------------|-------|
| `PlayerPanel` | `usePlayer()` | `className`, `fallback` |
| `CreatureCard` | — | `creature: Creature`, `className` |
| `CreatureList` | `useCreatures()` | `creatures?: Creature[]`, `className` |
| `RegionDetail` | — | `region: Region`, `className` |
| `RegionList` | `useRegions()` | `regions?: Region[]`, `className` |
| `OrgDetail` | — | `org: Organization`, `className` |
| `OrgList` | `useOrganizations()` | `orgs?: Organization[]`, `className` |
