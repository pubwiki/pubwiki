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
- `useField(subject, predicate)` — returns a specific triple value
- `usePub()` — returns a type-safe proxy for calling backend services as `pub.namespace.ServiceName(inputs)`
- `useGameStore()` — returns the raw game state manager
- `useTripleQuery(pattern)` — low-level triple query hook

## Service Calls via usePub()

Service type definitions are auto-generated at `/lib/game-sdk/generated/services.d.ts`. Read this file to discover available services and their input/output types.

**CRITICAL: Before writing any code that calls a backend service via `usePub()`, you MUST first use `get_service_definition` to check the service's exact input parameter types.** Do not guess parameter names or types.

### Usage Example

```tsx
import { useCreatures, usePlayer, usePub } from '@pubwiki/game-sdk'

function CreatureList() {
  const creatures = useCreatures()
  const pub = usePub()

  async function handleAttack(targetId: string) {
    // pub.namespace.ServiceName(inputs) — call a backend Lua service
    await pub.combat.Attack({ target_id: targetId })
  }

  return (
    <ul>
      {creatures.map(c => (
        <li key={c.subject} onClick={() => handleAttack(c.subject)}>
          {c.name}
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
