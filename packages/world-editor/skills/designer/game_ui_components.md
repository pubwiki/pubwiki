---
title: Game UI Components Guide
description: How to use @pubwiki/game-ui ID-based compound components to display game entity data
---

# Game UI Components Guide

`@pubwiki/game-ui` provides **unstyled, ID-based compound components** for rendering game entities. Components look up their data from `GameDataProvider` context — just pass an entity ID.

All data is **normalized at the hook boundary** — arrays are guaranteed, missing fields have defaults. Components can use `?.xxx ?? []` safely without extra guards.

## Setup

```tsx
import { GameProvider } from '@pubwiki/game-sdk'
import { GameDataProvider } from '@pubwiki/game-ui'

<GameProvider>
  <GameDataProvider fallback={<p>Loading...</p>}>
    <App />
  </GameDataProvider>
</GameProvider>
```

## Creature — ID-based

Pass `id` (creature_id), the component auto-resolves all data from context:

```tsx
import { Creature } from '@pubwiki/game-ui'

<Creature.Root id="npc_01" className="npc-card">
  <Creature.Identity />           {/* Name (Gender · Race) */}
  <Creature.Emotion />            {/* Current emotion */}
  <Creature.Titles />             {/* <ul> of titles */}
  <Creature.Personality />        {/* Personality text */}
  <Creature.Description />        {/* Description text */}
  <Creature.Appearance />         {/* <dl> body + clothing */}
  <Creature.Stats />              {/* <dl> attrs, auto field_display_name from Registry */}
  <Creature.Goal />               {/* Goal text */}
  <Creature.Location />           {/* Auto-resolves region + location names */}
  <Creature.Organization />       {/* Auto-resolves org name */}
  <Creature.Inventory />          {/* <ul> of items */}
  <Creature.StatusEffects />      {/* <ul> of status effects */}
  <Creature.CustomComponents />   {/* Schema-driven rendering with type_schema */}
  <Creature.KnownInfos />         {/* <ul> of known information */}
  <Creature.Interactions />       {/* Options merged with BaseInteraction.creature_options */}
</Creature.Root>
```

### Render Props

`Inventory`, `StatusEffects`, `CustomComponents` accept render props:

```tsx
<Creature.Inventory>
  {(item, i) => (
    <li key={item.id}>
      {item.name} x{item.count}
      {item.equipped && ' [E]'}
    </li>
  )}
</Creature.Inventory>

<Creature.CustomComponents>
  {(comp, def, i) => (
    <div key={comp.component_key}>
      <h4>{def?.component_name ?? comp.component_key}</h4>
      <pre>{JSON.stringify(comp.data, null, 2)}</pre>
    </div>
  )}
</Creature.CustomComponents>
```

## Player — Zero Props

`Player.Root` takes zero props, auto-finds player from context:

```tsx
import { Player } from '@pubwiki/game-ui'

<Player.Root fallback={<p>No player</p>}>
  <Player.Identity />
  <Player.Stats />
  <Player.Inventory />
  <Player.Location />
</Player.Root>
```

All `Player.*` slots are identical to `Creature.*` — Player delegates to Creature.Root internally.

## Region — ID-based

```tsx
import { Region } from '@pubwiki/game-ui'

<Region.Root id="forest">
  <Region.Name />
  <Region.Description />
  <Region.Metadata />             {/* <dl> name + desc */}
  <Region.Locations />            {/* <ul> of location entries */}
  <Region.Paths />                {/* <ul> with auto-resolved target names */}
  <Region.StatusEffects />
  <Region.Interactions />         {/* Merged with BaseInteraction.region_options */}
</Region.Root>
```

`Locations` and `Paths` support render props:

```tsx
<Region.Paths>
  {(path, i) => <li key={i}>To: {path.to_region}/{path.to_location}</li>}
</Region.Paths>
```

## Organization — ID-based

```tsx
import { Org } from '@pubwiki/game-ui'

<Org.Root id="guild_01">
  <Org.Name />
  <Org.Description />
  <Org.Territories />             {/* Auto-resolves region/location names */}
  <Org.Members />                 {/* Auto-lists creatures with this org */}
  <Org.StatusEffects />
  <Org.Interactions />            {/* Merged with BaseInteraction.organization_options */}
</Org.Root>
```

## Pre-composed Panels (Zero Props)

For quick prototyping:

```tsx
import { PlayerPanel, NPCList, CreatureList, RegionList, OrgList, WorldPanel } from '@pubwiki/game-ui'

<PlayerPanel />      {/* Auto player, with all slots */}
<NPCList />          {/* All non-player creatures */}
<CreatureList />     {/* All creatures */}
<RegionList />       {/* All regions */}
<OrgList />          {/* All organizations */}
<WorldPanel />       {/* GameTime, Events, DirectorNotes */}
```

## Data Types

All data is normalized. Arrays are guaranteed to be JS arrays (not Lua empty table objects).

```typescript
// CreatureEntity — fully normalized
entity.Creature.titles          // string[] (never {} object)
entity.Creature.known_infos     // string[]
entity.Creature.attrs           // Record<string, number | string>
entity.Inventory.items          // InventoryItem[]
entity.StatusEffects.status_effects  // StatusEffect[]
entity.CustomComponents.custom_components  // CustomComponentInstance[]
entity.Interaction.options      // InteractionOption[]
entity.Log.entries              // LogEntry[]

// RegionEntity
entity.Region.locations         // RegionLocation[]
entity.Region.paths             // RegionPath[]

// OrganizationEntity
entity.Organization.territories // Territory[]

// WorldSnapshot
world.Registry.creature_attr_fields         // CreatureAttrField[]
world.CustomComponentRegistry.custom_components  // CustomComponentDef[]
world.Events.events             // EventEntry[]
world.BaseInteraction.creature_options      // InteractionOption[]
```

## Styling with data-slot

All components render with `data-slot` attributes, no inline styles:

```css
[data-slot="creature-name"] { font-size: 1.2rem; font-weight: bold; }
[data-slot="creature-stats"] { display: grid; gap: 0.5rem; }
[data-slot="creature-stat-key"] { color: #888; text-transform: uppercase; }
[data-slot="creature-stat-value"] { font-weight: 600; }
[data-slot="creature-location"] { color: #666; }
[data-slot="stream-text"] { line-height: 1.8; }
[data-slot="stream-cursor"] { /* blinking cursor */ }
```

## Cross-Reference Resolution

Components auto-resolve cross-entity references via `GameDataProvider`:

- `Creature.Stats` → reads `field_display_name` from `World.Registry`
- `Creature.Location` → resolves region/location names from region entities
- `Creature.Organization` → resolves org name from org entities
- `Creature.CustomComponents` → reads `type_schema` from `World.CustomComponentRegistry`
- `Region.Paths` → resolves target region/location names
- `Org.Territories` → resolves region/location names
- `Org.Members` → finds creatures by `organization_id`
- `Creature.Interactions` → merges entity options with `BaseInteraction.creature_options`
