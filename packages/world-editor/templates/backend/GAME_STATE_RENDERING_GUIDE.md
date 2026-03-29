# Game State & Rendering Guide

A guide for reading game state and turning it into a living, breathing UI. Covers the data model, query services, entity relationships, and practical patterns for rendering characters, inventory, maps, and everything else your custom frontend needs to display.

At a high level, the game world is an ECS (Entity Component System). There are four kinds of entities — World, Creatures, Regions, and Organizations — and each one carries a bunch of components (Inventory, StatusEffects, Location, etc.). Your job is to query these entities via services and render them however you like.

The good news: you only need two ways to read data. Either grab the full state snapshot, or query individual entity types. Both return the same underlying structures. Pick whichever fits your use case.

---

## Available Services

Here's the complete list of services you'll use for reading game state:

| Service | Input | Returns | What it does |
|:--------|:------|:--------|:-------------|
| `state:GetStateFromGame` | `{}` | `{ success, data: StateData }` | Full world snapshot — everything in one call |
| `ecs.system:Query.getPlayerEntity` | `{}` | `PlayerEntityOutput` | Player character with all components |
| `ecs.system:Query.getNPCEntities` | `{}` | `{ success, count, entities: NPCEntity[] }` | All NPC characters |
| `ecs.system:Events.getEvents` | `{}` | `{ success, events: EventEntry[] }` | Plot events list |
| `save:ListGameSaves` | `{}` | `{ success, saves }` | List all save checkpoints |
| `save:LoadGameSave` | `{ checkpointId }` | `{ success }` | Restore world to a checkpoint |
| `save:CreateGameSave` | `{ title?, description? }` | `{ success, checkpointId }` | Snapshot current world state |
| `save:DeleteGameSave` | `{ checkpointId }` | `{ success }` | Delete a checkpoint |
| `state:GetStoryHistory` | `{}` | `{ success, data: { turn_ids, story } }` | Full narrative turn history |
| `state:SetNewStoryHistory` | `{ turn_id, data }` | `void` | Write one turn's history |
| `state:ClearStoryHistory` | `{}` | `{ success }` | Wipe all history |
| `state:InitialGameFromChoice` | `{ choice_id }` | `{ success }` | Apply opening choice (set player, remove excluded entities) |
| `GameTemplate:Initialize` | `{}` | `{ success }` | Initialize game engine |

All services are called through the same unified interface — however your platform implements service dispatch. The service name is the first argument, the input object is the second.

---

## Two Ways to Read Game Data

### Option A: The Full Snapshot

Call `state:GetStateFromGame` and you get *everything* in one shot:

```typescript
// result.data is a StateData object containing:
{
  World: WorldSnapshot           // Game clock, registries, director notes, events, world-level interactions
  Creatures?: CreatureSnapshot[] // All characters (player + NPCs)
  Regions?: RegionSnapshot[]     // All geographic regions with locations and paths
  Organizations?: OrganizationSnapshot[]  // Factions, guilds, companies
  StoryHistory?: StoryHistoryEntry[]      // Narrative turn history
  GameInitialStory?: { background: string, start_story: string }
  GameInitChoice?: GameInitChoice         // Starting character/route selection
  GameWikiEntry?: Array<{ title, content }>  // In-game encyclopedia entries
}
```

This is the most complete view of the world. It's great for initial loading, post-save-load refreshes, and building lookup tables. The downside is that it's a big payload — you're getting everything whether you need it or not.

### Option B: Targeted Queries

If you just need specific entities:

- `ecs.system:Query.getPlayerEntity` — just the player character with all their components
- `ecs.system:Query.getNPCEntities` — all NPCs
- `ecs.system:Events.getEvents` — events list only

These are faster and more focused. The typical pattern is: use `state:GetStateFromGame` on initial load to populate all your caches, then use the targeted queries for refreshes after state updates.

Our INK game does exactly this — it calls `state:GetStateFromGame` once at startup to build lookup maps for regions, organizations, and registries, then calls `ecs.system:Query.getPlayerEntity` + `ecs.system:Query.getNPCEntities` after each turn to refresh character data. The full state doesn't change often enough to re-fetch every turn, but creature data changes every single turn (items, status effects, location, emotions).

---

## The Entity Model

Let's walk through each entity type and what you'll find inside. Think of this as a tour of the data model — once you understand these structures, you'll know exactly what your UI can display.

### World Entity

The World is a singleton. There's exactly one. It holds global game state that doesn't belong to any specific character or place.

```typescript
{
  GameTime?: {
    year: number, month: number, day: number, hour: number, minute: number
  }

  Registry?: {
    creature_attr_fields?: Array<{
      field_name: string          // e.g. "strength", "intelligence"
      hint: string                // Description for the AI
      field_display_name?: string // What to show in UI, e.g. "STR", "INT"
    }>
  }

  CustomComponentRegistry?: {
    custom_components: Array<{
      component_key: string       // e.g. "cyberware_state"
      component_name: string      // e.g. "Cyberware System"
      is_array: boolean           // Whether the data is an array or single object
      data_registry?: Array<{ item_id: string, data: any }>  // Predefined data items
      type_schema?: TypeSchema    // JSON Schema for the data structure
    }>
  }

  DirectorNotes?: {
    notes: string[]               // Rolling short-term memory for the AI
    flags: Record<string, { id: string, value: boolean, remark?: string }>
    stage_goal?: string | null    // Current narrative phase direction
  }

  Events?: {
    events: Array<{
      event_id: string, title: string, summary: string, content: string,
      related_entities?: string[], created_at?: string, updated_at?: string
    }>
  }

  Log?: { entries: Array<{ content: string, add_at: string }> }
  BindSetting?: { documents: SettingDocument[] }
  Interaction?: { options: InteractionOption[] }
  BaseInteraction?: {
    creature_options: InteractionOption[]      // Default interactions ALL NPCs inherit
    region_options: InteractionOption[]        // Default interactions ALL regions inherit
    organization_options: InteractionOption[]  // Default interactions ALL orgs inherit
  }
}
```

A few things worth calling out:

**Registry.creature_attr_fields** is how the game defines what attributes characters have. This isn't hardcoded — it's data-driven. One game might have `strength, dexterity, charisma`; another might have `hacking, stealth, social`. Your UI should read this list and render attribute displays dynamically, not hardcode attribute names.

**CustomComponentRegistry** is the extension mechanism. Game designers can define arbitrary data schemas that attach to entities. For example, a cyberpunk game might define a `cyberware_state` component with slots for implants. Your UI reads the registry to understand the schema, then reads each entity's `CustomComponents` to get the actual data. More on this below.

**DirectorNotes** is primarily for the AI, not the player. But power users might appreciate seeing the `stage_goal` (the AI's current narrative direction) or the `flags` (milestone markers like "first_kill=true"). Up to you whether to expose this.

**BaseInteraction** defines default interaction options inherited by all entities of a given type. If `creature_options` has a "Talk" option, every NPC in the game automatically gets it — even if their own `Interaction.options` is empty.

**Events** is the game's plot journal. Each event has a summary and full content, with links to related entities. Excellent material for a "quest log" or "event timeline" UI.

### Creature Entity (Player & NPCs)

Characters are the heart of most games. The player entity and NPC entities share the same structure — the only difference is that the player has an `IsPlayer` marker component (which has no data, it's just a flag).

`ecs.system:Query.getPlayerEntity` returns one entity. `ecs.system:Query.getNPCEntities` returns an array. The shape is the same:

```typescript
{
  entity_id: number

  Creature: {
    creature_id: string           // Semantic ID, e.g. "player_alex", "merchant_lin"
    name: string                  // Display name
    organization_id?: string      // Which faction/org they belong to
    titles: string[]              // e.g. ["Dragon Slayer", "Fugitive"]
    appearance?: {
      body: string                // Physical description
      clothing: string            // What they're wearing
    }
    gender?: string
    race?: string
    emotion?: string              // Current emotional state (free text, e.g. "anxious but determined")
    attrs: Record<string, number | string>  // Dynamic attributes defined by Registry
    known_infos: string[]         // What this character knows
    goal?: string                 // Current objective or intention
  }

  LocationRef?: {
    region_id: string             // Which region they're in
    location_id: string           // Specific location within the region
  }

  Inventory?: {
    items: Array<{
      id: string                  // Unique item ID, e.g. "healing_potion_01"
      name: string                // Display name
      count: number               // Stack count
      description: string         // Short description
      details: string[]           // Additional detail lines
      equipped?: boolean          // Whether currently equipped
    }>
  }

  StatusEffects?: {
    status_effects: Array<{
      instance_id: string         // Unique instance ID
      display_name?: string       // e.g. "Poisoned", "Inspired"
      remark?: string             // Details about the effect
      data?: any                  // Arbitrary structured data (damage per turn, duration, etc.)
      add_at?: string             // When added
      last_update_at?: string     // Last modification time
    }>
  }

  CustomComponents?: {
    custom_components: Array<{
      component_key: string       // Matches a key in CustomComponentRegistry
      data: any                   // Actual data (shape defined by registry's type_schema)
    }>
  }

  Log?: { entries: Array<{ content: string, add_at: string }> }

  BindSetting?: {
    documents: Array<{
      name: string                // e.g. "CombatStyle", "PersonalityProfile"
      content: string
      static_priority?: number    // Higher = more important for RAG
      disable?: boolean
      condition?: string          // Natural language retrieval condition
    }>
  }

  Interaction?: {
    options: Array<{
      id: string                  // Option ID
      title: string               // Display title
      usage?: string              // Player-facing usage instructions
      instruction: string         // AI instruction (static rules)
      memo?: string               // Mutable dynamic state (inventory, prices, cooldowns)
    }>
  }
}
```

There's a lot here, so let's talk about what matters most for rendering.

**Creature.attrs** is dynamic. Don't hardcode `player.Creature.attrs.strength` — instead, read `Registry.creature_attr_fields` to know what attributes exist, then render them from `attrs` using those field names. This way your UI automatically adapts to whatever attributes the game designer defined.

**Creature.emotion** is free text, not an enum. The AI writes things like "anxious but hopeful" or "quietly furious." You can display this as-is, or if you want icons/colors, you'll need to do some keyword matching.

**Inventory items** have both an `id` (for programmatic operations like removal) and a `name` (for display). The `details` array contains extra flavor text. `equipped` is a boolean for things like weapons and armor.

**StatusEffects** are temporary or conditional states — buffs, debuffs, injuries, curses, blessings, ongoing effects. The `data` field is freeform and can contain anything. `display_name` is what you show the player; `remark` has more detail for tooltips.

**CustomComponents** is the wild card. Its structure depends entirely on what the game designer defined in `CustomComponentRegistry`. You read the registry to understand the schema, then read the entity's custom components to get the data.

**Interaction.options** represents structured game mechanics (shops, crafting stations, skill panels). The `usage` field is the player-facing description; `memo` contains mutable state (like current shop stock). These are distinct from narrative choices — they're persistent mechanical systems attached to entities.

**BindSetting.documents** contains setting docs attached to this character. Mostly for the AI (personality profiles, combat styles), but you could surface them as "character lore" in your UI.

### Region Entity

Regions are the game's geography. Each region contains locations (specific places) and paths (connections to other regions). You get these from the `Regions` array in `state:GetStateFromGame`.

```typescript
{
  entity_id: number

  Region: {
    region_id: string             // e.g. "border_region"
    region_name: string           // Display name
    description: string           // What this region is like
    locations?: Array<{
      id: string                  // e.g. "outpost_gate"
      name: string                // "Border Outpost Gate"
      description: string
    }>
    paths?: Array<{
      src_location: string        // Origin location
      src_region: string          // Origin region
      discovered: boolean         // Has the player found this path?
      to_region: string           // Destination region
      to_location: string         // Destination location
      description: string
    }>
  }

  Metadata?: { name: string, desc: string }
  Log?: Log
  BindSetting?: BindSetting
  Interaction?: Interaction       // Region-level interactions (e.g. area exploration)
}
```

**Locations** are places within a region. A region called "Sunset Valley" might have locations like "Village Square", "Abandoned Mine", "River Crossing." Characters are always in a specific location within a region (see `LocationRef`).

**Paths** connect regions. They have a `discovered` flag — undiscovered paths shouldn't be shown on the map (unless you want "???" hints). The AI creates new regions and paths dynamically as the story progresses, so the map grows over time.

Great data for a map UI: regions as nodes, paths as edges, locations as sub-nodes, player position highlighted via `LocationRef`.

### Organization Entity

Organizations are factions, guilds, companies — any named group. From the `Organizations` array in `state:GetStateFromGame`.

```typescript
{
  entity_id: number

  Organization: {
    organization_id: string       // e.g. "merchants_guild"
    name: string
    description: string
    territories?: Array<{         // Regions/locations they control
      region_id: string
      location_id: string
    }>
  }

  StatusEffects?: StatusEffects   // Org-level statuses (e.g. "at war", "trade embargo")
  Log?: Log
  BindSetting?: BindSetting
  Interaction?: Interaction       // Org-level interactions (e.g. faction management)
}
```

Organizations link to creatures via `Creature.organization_id` and to places via `territories`. You can build a faction overview: name, description, member characters, controlled territories, lore docs.

---

## Putting It Together: What to Render Where

Now you know the data shapes. Here's how to think about mapping them to UI components.

### Character Panel

Usually the most prominent UI element. For the player:

- **Name and titles** — `Creature.name`, `Creature.titles`
- **Appearance** — `Creature.appearance.body` and `.clothing`
- **Emotion** — `Creature.emotion` (mood indicator, icon, or raw text)
- **Attributes** — Read `Registry.creature_attr_fields` for the list, display each from `Creature.attrs`. Show `field_display_name` as label.
- **Inventory** — `Inventory.items`. Equipped items highlighted. Stack counts for consumables. Details as tooltips.
- **Status effects** — `StatusEffects.status_effects`. `display_name` as badge, `remark` as tooltip.
- **Location** — Resolve `LocationRef.region_id` + `.location_id` against region data to show "Village Square, Sunset Valley" instead of raw IDs.
- **Current goal** — `Creature.goal` ("Current objective: Escape the border before dawn")
- **Custom components** — Read `CustomComponentRegistry` for schema, render `CustomComponents` data accordingly.

For NPCs, same structure but probably show less detail.

### World Overview

A sidebar or dashboard showing the big picture:

- **Game time** — `World.GameTime`. Format as you like.
- **Events / quest log** — `World.Events.events`. Each has title, summary, and full content. Great for a collapsible timeline.
- **Organizations** — List all orgs with descriptions. Cross-reference `Creature.organization_id` to show members.
- **Director notes** (optional, power users) — `DirectorNotes.stage_goal` and `flags`.

### Map

Build from Region data:

- Each `Region` is a node with `region_name` and `description`
- `Region.locations` are sub-nodes within each region
- `Region.paths` are edges between regions (only show `discovered: true` unless debug mode)
- Highlight player position by matching `PlayerEntity.LocationRef` to region + location
- NPCs can be placed on the map too — each has a `LocationRef`

The map grows dynamically. Don't hardcode map layouts — build from data every refresh.

### Interaction Panel

When the player is near an entity with interaction options:

- Read the entity's `Interaction.options` for entity-specific mechanics
- Also check `World.BaseInteraction` — if `creature_options` has entries, every NPC inherits those; if `region_options` has entries, every region inherits those
- Show each option's `title` and `usage` (player-facing description)
- The `memo` field contains dynamic state (shop stock, cooldowns, etc.)

These are for structured mechanical systems (shops, crafting, skill panels), not narrative choices. Narrative choices come from CreativeWriting's output.

---

## Data Refresh Strategy

When do you re-fetch, and how much?

**On initial load**: Call `state:GetStateFromGame` once. Parse the full `StateData` to build all your caches — creature maps, region maps, organization maps, registry lookups, game time, events, everything.

**After each turn** (after `GameTemplate:UpdateGameStateAndDocs` succeeds):

The surgical approach — call `ecs.system:Query.getPlayerEntity` + `ecs.system:Query.getNPCEntities` for creature data, and `state:GetStateFromGame` only when you need updated regions/orgs/events. Faster but might miss some changes for a turn.

The simple approach — call `state:GetStateFromGame` every time and rebuild everything. Simpler code, slightly more data, but never stale. For most games this is fine.

**After loading a save** (after `save:LoadGameSave`): Always call `state:GetStateFromGame` for a full refresh. Everything might have changed.

Our INK game uses a hybrid: `state:GetStateFromGame` to rebuild entity maps (regions, organizations, world data) and separately `ecs.system:Query.getPlayerEntity` + `ecs.system:Query.getNPCEntities` for creature data, in parallel. The important thing is that after a state update, the UI reflects the new reality before the player makes their next choice.

---

## Registry-Driven Rendering

One of the most important patterns: your UI should be data-driven, not hardcoded. The game designer decides what attributes exist, what custom components exist, and what interactions are available. Your job is to render whatever they defined.

### Attributes

Don't do this:
```
// Bad — hardcoded attribute names
STR: {player.Creature.attrs.strength}
DEX: {player.Creature.attrs.dexterity}
```

Do this:
```
// Good — reads from Registry.creature_attr_fields
for each field in attrFields:
  render: {field.field_display_name || field.field_name}: {player.Creature.attrs[field.field_name]}
```

### Custom Components

Same idea, bigger scale. `CustomComponentRegistry` tells you what custom data exists and its shape. Each entity's `CustomComponents` carries actual instances.

```
// 1. Read the registry to know what components exist
registry = World.CustomComponentRegistry.custom_components
// → [{ component_key: "cyberware_state", component_name: "Cyberware System", type_schema: {...} }]

// 2. Read an entity's actual data
playerComponents = player.CustomComponents.custom_components
cyberware = playerComponents.find(c => c.component_key == "cyberware_state")
// → { component_key: "cyberware_state", data: { slots: [...], power_level: 85 } }

// 3. Render based on the schema
// type_schema tells you the data shape; data tells you the values
```

---

## ID Resolution

Throughout the data, entities reference each other by ID strings. A creature's `organization_id` points to an org; `LocationRef.region_id` points to a region; an event's `related_entities` lists creature/region/org IDs.

The practical approach: build lookup maps from `state:GetStateFromGame` on initial load and keep them updated.

```
creaturesMap:     creature_id → { name }
regionsMap:       region_id → { name }
locationsMap:     location_id → { name, description }
organizationsMap: organization_id → { name }
```

Then resolve IDs anywhere in your UI: instead of showing raw `loc_outpost_gate`, show "Border Outpost Gate".

---

## Practical Tips

**Status effects are the most volatile data.** They change every turn and the AI loves to add, update, and remove them. If something looks stale, check status effects first.

**Emotion is richer than you'd expect.** The AI writes things like "torn between loyalty and survival instinct." If you're building a mood indicator with icons, consider falling back to raw text for anything that doesn't match your categories.

**Inventory items have stable IDs.** The `id` field on an item is unique and stable across turns (unless removed). You can use it as a key for list rendering.

**Regions grow over time.** The AI creates new regions, locations, and paths as the story progresses. Your map UI should handle an expanding world gracefully — don't assume a fixed number of regions.

**BindSetting documents are mostly for the AI**, but they can be gold for your UI. A character's "PersonalityProfile" doc or a region's "LocalCustoms" doc can be surfaced as lore entries.

**BaseInteraction is easy to forget.** When checking if an entity has interactions, don't just look at its `Interaction.options`. Also check `World.BaseInteraction` — if `creature_options` has entries, every NPC inherits those. Total interaction options for an entity = its own options + base options for its type.

**GameWikiEntry is your encyclopedia.** Array of `{ title, content }` pairs — perfect for a searchable knowledge base. These are authored by the game designer and don't change during gameplay.

And that's the full picture. Four entity types, a handful of query services, a data-driven component system. Read the data, build some lookup maps, and render whatever UI fits your game. The engine keeps the data consistent; you bring the presentation. Have fun with it.
