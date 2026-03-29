---
title: Game SDK & UI Guide
description: Architecture overview of @pubwiki/game-sdk (connection) and @pubwiki/game-ui (hooks + components)
---

# Game SDK & UI Guide

## Architecture

Two packages, two responsibilities:

| Package | Role | Key Exports |
|---------|------|-------------|
| `@pubwiki/game-sdk` | Connection & RPC layer | `GameProvider`, `usePub()` |
| `@pubwiki/game-ui` | Game data hooks + UI components | `usePlayer()`, `useCreatures()`, `PlayerPanel`, `Creature.*` |

```tsx
// main.tsx — wrap with GameProvider for connection
import { GameProvider } from '@pubwiki/game-sdk'
<GameProvider><App /></GameProvider>

// App.tsx — use hooks and components from game-ui
import { usePlayer, PlayerPanel, Creature } from '@pubwiki/game-ui'
```

## Service Calls via usePub()

`usePub()` returns a type-safe proxy for calling backend Lua services:

```tsx
import { usePub } from '@pubwiki/game-sdk'

const pub = usePub()
const result = await pub.combat.Attack({ target_id: 'orc_1' })
```

Service type definitions are auto-generated at `/lib/game-sdk/generated/services.d.ts`.

**CRITICAL: Before writing any code that calls a backend service via `usePub()`, you MUST first use `get_service_definition` to check the service's exact input parameter types.**

## Reactive Hooks (from @pubwiki/game-ui)

Hooks subscribe to backend `watch:*` services and push structured entity snapshots in real-time:

```tsx
import { usePlayer, useCreatures, useRegions, useOrganizations, useWorld } from '@pubwiki/game-ui'

const { player, ready } = usePlayer()           // CreatureEntity | null
const { npcs, added, deleted } = useCreatures()  // CreatureEntity[]
const { regions } = useRegions()                  // RegionEntity[]
const { organizations } = useOrganizations()      // OrganizationEntity[]
const { world } = useWorld()                      // WorldSnapshot
```

All hooks return:
- **Fully resolved data** — inventory items, status effects, custom components included
- **Ready state** — `ready: boolean` for loading UI
- **Change metadata** — `added`, `deleted`, `modified` arrays of entity IDs

## Data Types

Hooks return ECS entity snapshots matching the backend's component structure:

```typescript
// CreatureEntity has:
entity.Creature         // { creature_id, name, gender, race, emotion, attrs, ... }
entity.IsPlayer         // present if this is the player
entity.LocationRef      // { region_id, location_id }
entity.Inventory        // { items: InventoryItem[] }
entity.StatusEffects    // { status_effects: StatusEffect[] }
entity.CustomComponents // { custom_components: CustomComponentInstance[] }
entity.Interaction      // { options: InteractionOption[] }
entity.Log              // { entries: LogEntry[] }
entity.BindSetting      // { documents: SettingDocument[] }
```

## UI Components

**For detailed component usage, render props, and data-slot references, read the `game_ui_components` skill:**
Use `get_skill_content("game_ui_components")` to see the full component guide.

## Important Notes

- **The backend is already complete and stable.** Do NOT suggest creating or modifying backend services — just call them via `usePub()`.
- Always use `list_backend_services` and `get_service_definition` before calling any service.
- Use `get_state_overview` / `get_state_content` to understand the game's data model.
- Access data via hooks from `@pubwiki/game-ui`, not raw triples from `@pubwiki/game-sdk`.
