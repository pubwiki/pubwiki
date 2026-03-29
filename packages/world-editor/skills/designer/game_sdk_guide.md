---
title: Game SDK API Guide
description: How to use @pubwiki/game-sdk hooks and APIs for game state access and backend service calls
---

# Game SDK API Guide

## Overview

`@pubwiki/game-sdk` provides reactive state management and data hooks for the game world.

## Key Exports

- `GameProvider` — React context provider, wraps the entire app in `/src/main.tsx`
- `useCreatures()` — returns all creatures in the world
- `usePlayer()` — returns the player creature
- `useRegions()` — returns all regions
- `useOrganizations()` — returns all organizations
- `useField(subject, predicate)` — returns a specific triple value
- `usePub()` — returns a type-safe proxy for calling backend services as `pub.namespace.ServiceName(inputs)`
- `useGameStore()` — returns the raw game state manager
- `useTripleQuery(pattern)` — low-level triple query hook

## RDF Vocabulary Constants

The SDK exports predicate constants so you never need to hardcode predicate strings:

```tsx
import { PW_PRED, PWC_PRED, PWR_PRED, GRAPH, extractId } from '@pubwiki/game-sdk'

// PW_PRED.name      → "pw:name"
// PWC_PRED.is_player → "pwc:isPlayer"
// PWC_PRED.gender    → "pwc:gender"
// GRAPH.creature     → "graph:creature"
```

### Available constant groups

| Export | Namespace | Used By |
|--------|-----------|---------|
| `PW_PRED` | `pw:` | All entities (name, description, type, order) |
| `PW_WORLD` | `pw:` | World entity (gameTime, directorNotes, events, interaction) |
| `PWC_PRED` | `pwc:` | Creatures (gender, race, personality, attrs, isPlayer, ...) |
| `PWR_PRED` | `pwr:` | Regions (locations, paths, metadataName, metadataDesc) |
| `PWO_PRED` | `pwo:` | Organizations (territories) |
| `PWS_PRED` | `pws:` | Setting documents (content, priority, condition, disable) |
| `PWI_PRED` | `pwi:` | Inventory items (id, count, equipped, details) |
| `PW_STATUS` | `pw:` | Status effects (displayName, remark, data) |
| `PW_STORY` | `pw:` | Story entries (content, timestamp, checkpointId) |
| `SUBJECT` | — | Subject prefixes ("creature:", "region:", "org:", ...) |
| `GRAPH` | — | Named graphs ("graph:creature", "graph:region", ...) |

### Helper functions

- `extractId(subject)` — Extract pure ID from a subject URI: `"creature:npc_01"` → `"npc_01"`
- `subjectPrefix(subject)` — Extract prefix: `"creature:npc_01"` → `"creature:"`

## Hook Return Formats

### useCreatures() / useRegions() / useOrganizations()

Returns an array of entity objects. Each object has:
- `id` — pure entity ID (e.g. `"npc_01"`, not `"creature:npc_01"`)
- Predicate keys with their values (e.g. `"pw:name"`, `"pwc:gender"`)
- JSON-serialized fields are **auto-parsed** (attrs, titles, locations, etc.)

```tsx
const creatures = useCreatures()
// [
//   {
//     id: "npc_01",
//     "pw:name": "Hero",
//     "pwc:gender": "Male",
//     "pwc:isPlayer": true,
//     "pwc:attrs": { hp: 100, mp: 50 },     // auto-parsed from JSON
//     "pwc:titles": ["Warrior", "Knight"],    // auto-parsed from JSON
//   }
// ]
```

### usePlayer()

Returns the player entity object (same format as above) or `undefined`.

```tsx
const player = usePlayer()
if (player) {
  console.log(player.id)                      // "hero_01"
  console.log(player[PW_PRED.name])           // "Hero"
  console.log(player[PWC_PRED.attrs])         // { hp: 100 } (auto-parsed)
}
```

### useField(subject, predicate)

Returns a single field value. JSON fields are auto-parsed.

```tsx
// Use the full subject URI for useField
const name = useField("creature:hero_01", PW_PRED.name)    // "Hero"
const attrs = useField("creature:hero_01", PWC_PRED.attrs) // { hp: 100 }
```

## Service Calls via usePub()

Service type definitions are auto-generated at `/lib/game-sdk/generated/services.d.ts`. Read this file to discover available services and their input/output types.

**CRITICAL: Before writing any code that calls a backend service via `usePub()`, you MUST first use `get_service_definition` to check the service's exact input parameter types.** Do not guess parameter names or types.

### Usage Example

```tsx
import { useCreatures, usePlayer, usePub, PW_PRED, PWC_PRED } from '@pubwiki/game-sdk'

function CreatureList() {
  const creatures = useCreatures()
  const pub = usePub()

  async function handleAttack(targetId: string) {
    await pub.combat.Attack({ target_id: targetId })
  }

  return (
    <ul>
      {creatures.map(c => (
        <li key={c.id} onClick={() => handleAttack(c.id)}>
          {String(c[PW_PRED.name])}
        </li>
      ))}
    </ul>
  )
}
```

## Game UI Components

`@pubwiki/game-ui` provides pre-built UI components for game interfaces.

```tsx
import { DialogBox } from '@pubwiki/game-ui'
```

Read files under `/lib/game-ui/` to discover available components and their props.

## Important Notes

- **The backend is already complete and stable.** All backend services are fully implemented. Do NOT suggest creating or modifying backend services — just call them via `usePub()`.
- Always use `list_backend_services` and `get_service_definition` before calling any service to ensure correct parameter types.
- Use `get_state_overview` / `get_state_content` to understand the game's data model when generating UI code.
- Always use vocabulary constants (`PW_PRED`, `PWC_PRED`, etc.) instead of hardcoding predicate strings.
