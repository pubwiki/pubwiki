---
title: Game SDK & UI Guide
description: Architecture overview of @pubwiki/game-sdk (connection) and @pubwiki/game-ui (hooks + components + story engine)
---

# Game SDK & UI Guide

## Architecture

Two packages, two responsibilities:

| Package | Role | Key Exports |
|---------|------|-------------|
| `@pubwiki/game-sdk` | Connection & RPC layer | `GameProvider`, `usePub()` |
| `@pubwiki/game-ui` | Data hooks + UI components + story engine | `GameDataProvider`, `useCreatures()`, `useNarrative()`, `Creature.*`, `StreamText` |

```tsx
// main.tsx
import { GameProvider } from '@pubwiki/game-sdk'
import { GameDataProvider } from '@pubwiki/game-ui'

<GameProvider>
  <GameDataProvider>
    <App />
  </GameDataProvider>
</GameProvider>
```

## Service Calls via usePub()

`usePub()` returns a type-safe proxy for calling backend Lua services:

```tsx
const pub = usePub()
const result = await pub.combat.Attack({ target_id: 'orc_1' })
```

**CRITICAL: Before calling any backend service, use `get_service_definition` to check exact input types.**

## Reactive Hooks (from @pubwiki/game-ui)

Hooks subscribe to backend `watch:*` services with **incremental updates**:
- Snapshot (first load): full entity list
- Changes: only affected entities (added/modified as entity data, deleted as IDs)
- Frontend hooks maintain a local Map cache and merge incrementally

All data is **normalized at the boundary** — Lua empty tables are coerced to arrays, missing fields get defaults. Downstream code can trust the data shape.

```tsx
import { usePlayer, useCreatures, useRegions, useOrganizations, useWorld } from '@pubwiki/game-ui'

const { player, ready } = usePlayer()
const { npcs, lastChange } = useCreatures()
const { regions } = useRegions()
const { organizations } = useOrganizations()
const { world } = useWorld()
```

### Hook Return Types

| Hook | Data | Change Info |
|------|------|-------------|
| `usePlayer()` | `player: CreatureEntity \| null` | `change: 'added' \| 'modified' \| 'deleted' \| null` |
| `useCreatures()` | `player`, `npcs: CreatureEntity[]` | `lastChange: { added?: CreatureEntity[], deleted?: string[], modified?: CreatureEntity[] }` |
| `useRegions()` | `regions: RegionEntity[]` | same pattern |
| `useOrganizations()` | `organizations: OrganizationEntity[]` | same pattern |
| `useWorld()` | `world: WorldSnapshot \| null` | `changedAspects: string[]` |

## GameDataProvider & Cross-Reference Resolution

`GameDataProvider` subscribes to all watch services and builds lookup Maps + resolver functions:

```tsx
const { creatures, regions, organizations, world, resolve } = useGameData()

resolve.regionName('forest')           // "Dark Forest"
resolve.locationName('forest', 'cave') // "Hidden Cave"
resolve.orgName('guild_01')            // "Merchant Guild"
resolve.creatureName('npc_01')         // "Alice"
resolve.attrDisplay('strength')        // { label: "力量", hint: "Physical power" }
resolve.componentDef('magic_affinity') // { component_key, component_name, type_schema, ... }
```

## Story Engine — useNarrative()

`useNarrative()` is a toolkit for the AI narrative loop. Each operation is independent — call only what you need:

```tsx
import { useNarrative, StreamText } from '@pubwiki/game-ui'

const n = useNarrative()

// Read stories (reactive, fetched on mount)
n.backgroundStory   // string | null
n.startStory         // string | null

// Generate (streams AI content)
const result = await n.generate({
  create_request: "Player explores the cave...",
  thinking_instruction: "Check director notes, plan pacing...",
  previous_content_overview: "Last turn summary...",
  output_content_schema: "{ novel_content: string }",
})

// Streaming state (updates in real-time during generation)
n.phase              // 'idle' | 'collecting' | 'reasoning' | 'generating' | 'updating' | 'saving'
n.stream.partialContent  // partial JSON content
n.stream.thinking        // AI thinking process
n.stream.reasoning       // AI reasoning

// Update game state (pass result from generate)
const update = await n.updateState({ new_event: "..." })

// Save/Load
const checkpointId = await n.save("Chapter 3", "Player entered the cave")
await n.load(checkpointId)
const saves = await n.listSaves()

// Story history
await n.addHistory("turn-1", { content: {...}, checkpoint_id: "..." })
const history = await n.getHistory()  // { turn_ids: string[], story: Record<string, {...}> }
```

### StreamText Component

Typewriter-effect renderer for streaming AI content:

```tsx
<StreamText
  content={n.stream.partialContent}
  field="novel_content"       // dot-path to text field
  speed={30}                  // ms per character
  instant={false}             // skip animation
/>
```

## Data Normalization

Backend data is normalized at the hook boundary via `normalize.ts`. Users who call services directly can also normalize:

```tsx
import { normalizeCreature, normalizeRegion } from '@pubwiki/game-ui'

const raw = await pub.ecs.system['Query.getCreatureById']({ creature_id: 'npc_01' })
const creature = normalizeCreature(raw.entity)  // safe to use
```

## Single-Entity Query Services

For fetching individual entities by ID:

```tsx
await pub.ecs.system['Query.getCreatureById']({ creature_id: 'npc_01' })
await pub.ecs.system['Query.getRegionById']({ region_id: 'forest' })
await pub.ecs.system['Query.getOrganizationById']({ organization_id: 'guild_01' })
await pub.ecs.system['Query.getWorldEntity']({})
```

## UI Components

**For detailed component usage, see the `game_ui_components` skill.**

## Important Notes

- **The backend is already complete and stable.** Do NOT modify backend services — just call them.
- Always use `list_backend_services` and `get_service_definition` before calling any service.
- Access data via hooks from `@pubwiki/game-ui`, not raw triples from `@pubwiki/game-sdk`.
- All data from hooks is normalized — arrays are guaranteed to be arrays, not Lua empty tables.
