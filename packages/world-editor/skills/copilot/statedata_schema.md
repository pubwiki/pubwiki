---
title: StateData Complete Type Definitions
description: StateData Complete Type Definitions and Field Descriptions
---

# StateData Complete Type Definitions

```typescript
StateData {
  World: WorldSnapshot                  // [Required] World singleton
  Creatures?: CreatureSnapshot[]        // Character list
  Regions?: RegionSnapshot[]            // Region list
  Organizations?: OrganizationSnapshot[]// Organization list
  StoryHistory?: StoryHistoryEntry[]    // Story history
  GameInitialStory?: { background: string, start_story: string }  // Top-level field, NOT inside World!
  GameWikiEntry?: Array<{ title: string, content: string }>
  AppInfo?: { publish_type?: string }
}

WorldSnapshot {
  entity_id: string,
  game_time?: { year, month, day, hour, minute },
  registry?: Array<{ field_name: string, hint: string, field_display_name?: string }>,
  custom_component_registry?: CustomComponentDef[],
  director_notes?: { notes: string[], flags: Record<string, {id,value,remark?}>, stage_goal?: string|null },
  log?: LogEntry[],
  bind_setting?: { documents: SettingDocument[] }
}

CreatureSnapshot {
  creature_id: string,                  // Unique ID (required)
  creature: {                           // Core creature data (required)
    name: string,                       // Name (required)
    organization_id?: string,
    titles?: string[],
    appearance?: { body?: string, clothing?: string },  // Appearance goes here, NOT description!
    gender?: string,
    race?: string,
    emotion?: string,                   // Current emotion (free text)
    attrs?: Record<string, number|string>,  // Dynamic attributes (key names defined by registry)
    known_infos?: string[],             // Important info known to the character
    goal?: string,                      // Current goal
    personality?: string,               // Personality description
  },
  is_player?: boolean,                  // true for player characters, omit for NPCs
  location?: { region_id?: string, point?: string },
  inventory?: Array<{ id: string, count: number, name: string, description?: string, details?: string[], equipped?: boolean }>,
  status_effects?: Array<{ instance_id: string, display_name?: string, remark?: string, data?: any }>,
  custom_components?: Array<{ component_key: string, data: any }>,
  interaction?: { options: Array<{ id: string, title: string, usage?: string, instruction: string, memo?: string }> },
  log?: LogEntry[],
  bind_setting?: { documents: SettingDocument[] }
}

RegionSnapshot {
  region_id: string,                    // Unique ID (required)
  region: {                             // Core region data (required)
    name: string,
    description?: string,
    locations?: Array<{ id: string, name: string, description: string }>,
    paths?: Array<{ src_location, src_region, discovered, to_region, to_location, description }>
  },
  metadata?: { name: string, desc: string },
  status_effects?: StatusEffect[],
  log?: LogEntry[],
  bind_setting?: { documents: SettingDocument[] }
}

OrganizationSnapshot {
  organization_id: string,              // Unique ID (required)
  organization: {                       // Core org data (required)
    name: string,
    description?: string,
    territories?: Array<{ region_id: string, location_id: string }>
  },
  status_effects?: StatusEffect[],
  log?: LogEntry[],
  bind_setting?: { documents: SettingDocument[] }
}
```

---

## Key Sub-Types

**CustomComponentDef** — Registered in World.custom_component_registry:
`{ component_key, component_name, is_array, type_schema?, data_registry?: Array<{item_id, data}> }`

**SettingDocument** — Bound in each entity's bind_setting.documents:
`{ name, content, static_priority?, disable?, condition? }`
- World/Creature/Region/Organization can all bind setting documents
- Must provide at least one of `static_priority` (always recalled) or `condition` (conditionally recalled)
