/**
 * Built-in Skill Content — Migrated from copilotPrompt.ts
 *
 * Per §4.2 + §3.8 of the migration plan:
 *   - builtin_statedata_schema: Updated to match actual TypeScript types (snake_case fields)
 *   - builtin_workflow: JS code examples → JSON operation examples
 *   - builtin_setting_docs: Verbatim (no tool references)
 *   - builtin_game_creation: JS/TS code examples → JSON operation examples
 */

/**
 * Built-in Skill: StateData Schema
 * Complete type definitions and field descriptions for all StateData components.
 * Updated to match the actual TypeScript types in packages/world-editor/src/types/state-data.ts.
 */
export const BUILTIN_STATEDATA_SCHEMA =
`# StateData Complete Type Definitions

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

---

## Key Sub-Types

**CustomComponentDef** — Registered in World.custom_component_registry:
\\\`{ component_key, component_name, is_array, type_schema?, data_registry?: Array<{item_id, data}> }\\\`

**SettingDocument** — Bound in each entity's bind_setting.documents:
\\\`{ name, content, static_priority?, disable?, condition? }\\\`
- World/Creature/Region/Organization can all bind setting documents
- Must provide at least one of \\\`static_priority\\\` (always recalled) or \\\`condition\\\` (conditionally recalled)
`

/**
 * Built-in Skill: Workflow
 * How to handle user requests — workflow, best practices, and file processing.
 * This is the "entry point" skill that references the other 3 skills.
 * §3.8: JS code examples → JSON operation examples.
 */
export const BUILTIN_WORKFLOW =
`# User Request Handling Workflow

## Processing Flow

1. **Understand state** — \\\`get_state_overview()\\\` + \\\`list_memories()\\\`
2. **Process files** (if any) — Small files (<10KB) use \\\`get_workspace_file_content\\\`, large files use \\\`use_workspace_file_agent\\\`
3. **Read Skills** — Setting documents → \\\`builtin_setting_docs\\\`, data structure → \\\`builtin_statedata_schema\\\`, game ideas → \\\`builtin_game_creation\\\`
4. **Make a plan** — List steps, record with \\\`save_memory\\\`, wait for user confirmation (use \\\`query_user\\\` form for multiple items)
5. **Execute step by step** — Report to user after each step, wait for feedback
6. **Validate** — \\\`check_state_error()\\\`
7. **Record** — \\\`save_memory("Task Complete: XXX", "...")\\\`

---

## Common Operations

### Create a Character
\\\`\\\`\\\`json
// update_state operations:
{
  "operations": [
    {
      "op": "upsert_creature",
      "creature_id": "unique_id",
      "data": {
        "creature": { "name": "New Character", "titles": [], "attrs": {}, "known_infos": [] },
        "is_player": true
      }
    }
  ]
}
// Note: is_player: true for player characters, omit the field for NPCs
\\\`\\\`\\\`

### Add a Setting Document
\\\`\\\`\\\`json
// World-building document bound to World:
{
  "operations": [
    {
      "op": "update_world",
      "data": {
        "bind_setting": {
          "documents": [
            { "name": "World Background", "content": "...", "static_priority": 100 }
          ]
        }
      }
    }
  ]
}
// Character document bound to character:
{
  "operations": [
    {
      "op": "upsert_creature",
      "creature_id": "protagonist_id",
      "data": {
        "bind_setting": {
          "documents": [
            { "name": "Biography", "content": "...", "condition": "When this character is mentioned" }
          ]
        }
      }
    }
  ]
}
\\\`\\\`\\\`

---

## Important Notes
- **IDs must be unique**, use meaningful IDs (e.g., \\\`"protagonist_lin_feng"\\\`)
- **References must be valid** — organization_id must correspond to an existing organization
- **Read before modifying** — Use \\\`get_state_content\\\` to check current values
- **File processing** — Large files (>10KB) use \\\`use_workspace_file_agent(filename, instruction)\\\` to extract information
`

/**
 * Built-in Skill: Setting Documents
 * How to write setting documents — templates, formatting, and priority system.
 * §3.8: No change needed — no tool references.
 */
export const BUILTIN_SETTING_DOCS =
`# Setting Document Writing Guide

## Setting Document Storage Locations

Setting documents are now bound to each entity's \\\`bind_setting.documents\\\`:

| Entity | Storage Location | Purpose | Example name |
|--------|-----------------|---------|-------------|
| World | \\\`World.bind_setting.documents\\\` | World-building, rules, system documents | "World Background", "Affinity System Rules" |
| Creature | \\\`Creatures[].bind_setting.documents\\\` | Character settings | "Biography", "High-Affinity Strategy File" |
| Region | \\\`Regions[].bind_setting.documents\\\` | Region settings | "Region Overview", "Secret Realm Unlock Conditions" |
| Organization | \\\`Organizations[].bind_setting.documents\\\` | Organization settings | "Organization Introduction", "Internal Rules" |

---

## WorldSetting Template

\\\\\\\`\\\\\\\`\\\\\\\`markdown
# {World Name}

## Basic Setting
- **Era**:
- **Geography**:
- **Society**:

## Core Rules
(Ability systems, social laws, physical rules, etc.)

## World History
(Key historical events)

## Unique Elements
(What distinguishes this world from others)

## Current Situation
(State of the world when the story takes place)
\\\\\\\`\\\\\\\`\\\\\\\`

---

## CreatureSetting Template

\\\\\\\`\\\\\\\`\\\\\\\`markdown
# {Character Name}

## Basic Information
- **Age**:
- **Identity**:
- **Affiliation**:

## Personality
(Core personality traits, behavioral patterns)

## Past
(Growth experience, key turning points)

## Relationships
(Relationships with other characters)

## Secrets
(Things unknown to others)

## Motivations
(Current goals and deep desires)
\\\\\\\`\\\\\\\`\\\\\\\`

---

## OrganizationSetting Template

\\\\\\\`\\\\\\\`\\\\\\\`markdown
# {Organization Name}

## Basic Information
- **Type**: (Sect/Company/Government, etc.)
- **Scale**:
- **Headquarters**:

## Core Philosophy
(Organization's purpose)

## Key Figures
(Leaders, core members)
\\\\\\\`\\\\\\\`\\\\\\\`

---

## Priority (static_priority)

- Generally only basic settings need a priority value
- Once a static_priority is provided, the document will always be recalled
- Not recommended to overuse — overuse may lead to excessively large context
- Without a priority field, the RAG system handles recall automatically, with priority determined by relevance

Examples:
- World: "World Basic Setting" — Needs priority, e.g., 100, this document is needed every time to set the world's tone
- World: "Combat Writing Guide" — No priority needed (only needed during combat scenes)
- Player Character: "Basic Setting" — Needs priority, e.g., 100, this document is needed every time
- NPC: "Basic Setting" — No priority needed (only needed when the NPC is present)
- Player Character: "Growth Phase One" — No priority needed (only needed when the player reaches a certain phase)

## Condition Field (condition)

When no priority is set, you can use the \\\`condition\\\` field to describe recall conditions:
- For example: \\\`"When describing combat scenes"\\\`, \\\`"When NPC Zhang San appears"\\\`
- This is a natural language description; the LLM will automatically determine whether this document is needed

---

## Writing Tips

### Recommended
- **Specific details** > abstract descriptions: "She taps the table with her index finger while thinking" > "She is very smart"
- **Include conflicts**: Characters have inner struggles, the world has unresolved problems
- **Cross-reference**: Mention relationships with other characters in character settings
- **Leave room**: Don't write everything down; leave creative space for the AI

### Avoid
- Overly exhaustive encyclopedia-style descriptions (AI will ignore documents that are too long)
- Pure data listings without emotional nuance
- Descriptions that contradict the actual game state

## Minimum Playable Setting

1. World binds one "World Background" setting document
2. Player character binds one "Biography" setting document

Advanced expansion: NPC character binds settings → Region binds settings → Organization binds settings
`

/**
 * Built-in Skill: Game Creation
 * How to implement a game idea — quickstart, CustomComponent design, collaborative workflow.
 * §3.8: JS/TS code examples → JSON operation examples.
 */
export const BUILTIN_GAME_CREATION =
`# How to Implement a Game Idea

## Core Principle: Design First, Then Implement

> **Never start implementing immediately upon receiving a request!** Use \\\`query_user\\\` form to collect design elements, confirm, then begin.

Confirmation Checklist:
- [ ] **World-building** — Background and tone? (Fantasy/Wuxia/Cyberpunk/Modern, etc.)
- [ ] **Protagonist** — Name, identity, personality?
- [ ] **Gameplay & Mechanics** — Attribute system, custom components, status effects?
- [ ] **Opening** — What scene does the story start from?

Workflow: Ask → Think → Propose → Confirm → Implement Step by Step

---

## Creating a Basic Game

### 1. Design Attribute Fields (Recommended First Step)

| Genre | Recommended creature_attr_fields |
|-------|---------------------------------|
| Narrative (default) | empathy, perception, willpower, composure, eloquence |
| Fantasy/DND | str, dex, con, int, wis, cha |
| Cultivation/Xianxia | constitution, spiritual_power, comprehension, talent, willpower, luck |
| Cyberpunk | body, reflex, tech, cool, intelligence, empathy |

### 2. Creation Order
1. Set creature_attr_fields → 2. Create world-building + World setting documents → 3. Create protagonist (is_player: true) → 4. Add NPCs → 5. Finally write GameInitialStory

> Opening story should be crafted after the world-building and characters are all ready.

---

## CustomComponent System

> **Use CustomComponent to build any gameplay mechanic.**

### Selection Guide

| Scenario | CustomComponent | StatusEffect | Relationship |
|----------|----------------|--------------|-------------|
| Persistent core data (cultivation level, party, money) | ✓ | | |
| Temporary effects (buffs, poison, weather) | | ✓ | |
| Interpersonal relations, affinity | | | ✓ |

### Design Flow
1. Understand requirements → 2. Decompose into ECS components and present the plan → 3. After confirmation, implement in order: Register Def → Mount data → Write setting documents → Validate

### Registration + Mounting Example
\\\`\\\`\\\`json
// 1. Register definition in World.custom_component_registry via update_world:
{
  "operations": [{
    "op": "update_world",
    "data": {
      "custom_component_registry": [
        {
          "component_key": "pokemon_party", "component_name": "Pokemon Party", "is_array": true,
          "type_schema": { "type": "object", "properties": { "name": {"type":"string"}, "type": {"type":"string"}, "level": {"type":"integer"} } }
        }
      ]
    }
  }]
}

// 2. Mount data on character via upsert_creature:
{
  "operations": [{
    "op": "upsert_creature",
    "creature_id": "player_ash",
    "data": {
      "custom_components": [
        { "component_key": "pokemon_party", "data": [{ "name": "Pikachu", "type": "electric", "level": 5 }] }
      ]
    }
  }]
}
\\\`\\\`\\\`

### Gameplay Examples

- **Pokemon**: CustomComponent(\\\`pokemon_party\\\`, \\\`pokedex\\\`) + StatusEffect (status conditions) + inventory (Poke Balls) + SettingDocument (type effectiveness rules)
- **Cultivation/Xianxia**: CustomComponent(\\\`cultivation_state\\\`) + StatusEffect (seclusion, qi deviation) + SettingDocument (realm hierarchy)
- **Cthulhu**: CustomComponent(\\\`mental_state\\\`: {san, phobias}) + SettingDocument (SAN value rules)

---

## Comprehensive Example

> Demonstrating the integration of CustomComponent + inventory + relationships + status_effects + SettingDocument.

\\\`\\\`\\\`json
// Character entity example (via upsert_creature):
{
  "op": "upsert_creature",
  "creature_id": "player_alex",
  "data": {
    "creature": {
      "name": "Alex", "titles": ["Investigator"],
      "attrs": { "str": 8, "con": 10, "cha": 10, "wis": 12, "int": 12, "dex": 10 },
      "appearance": { "body": "Messy black hair...", "clothing": "Dark blue jacket..." },
      "known_infos": ["Suspicious activity at the old factory in east city", "The client's name is Victor"],
      "goal": "Investigate the anomalous events at the old factory in east city"
    },
    "is_player": true,
    "custom_components": [
      { "component_key": "life", "data": { "unity_coin": 5000, "fame": 25 } }
    ],
    "status_effects": [
      { "instance_id": "house_rent", "display_name": "Rent Obligation", "remark": "Monthly rent payment required", "data": { "overdue_amount": 0 } }
    ],
    "inventory": [
      { "id": "mag_lev_v8", "count": 1, "name": "Maglev Car", "description": "High-speed levitation vehicle", "details": [] }
    ],
    "relationships": [
      { "target_id": "kuiyu", "name": "Roommate", "value": 60 }
    ]
  }
}
\\\`\\\`\\\`

**SettingDocument condition-driven dynamic recall (core design pattern)**:
\\\`\\\`\\\`json
// NPC growth phase documents, automatically switching based on values
// via upsert_creature:
{
  "op": "upsert_creature",
  "creature_id": "npc_example",
  "data": {
    "bind_setting": {
      "documents": [
        { "name": "Growth Phase One", "condition": "Recall when lust < 50", "content": "Extremely timid..." },
        { "name": "Growth Phase Two", "condition": "Recall when 50 <= lust < 100", "content": "Speaks fluently..." }
      ]
    }
  }
}
\\\`\\\`\\\`

> **Core concept**: CustomComponent/StatusEffect/Relationship store numerical values, SettingDocument's condition uses those values for dynamic recall, allowing AI to automatically choose the appropriate narrative style.

---

## Important Notes
- **Discuss before implementing** — Data structures are costly to modify once created
- **Setting documents are the soul** — CustomComponent is just a data carrier; setting documents let the AI "understand" gameplay
- **StatusEffect's display_name** is for UI display, **remark** helps AI understand the meaning
`

/** Helper to get built-in skill content by ID */
export function getBuiltinSkillContent(skillId: string): string | null {
  switch (skillId) {
    case 'builtin_statedata_schema': return BUILTIN_STATEDATA_SCHEMA
    case 'builtin_game_creation': return BUILTIN_GAME_CREATION
    case 'builtin_workflow': return BUILTIN_WORKFLOW
    case 'builtin_setting_docs': return BUILTIN_SETTING_DOCS
  }
  return null
}

/** List of all built-in skills with metadata */
export const BUILTIN_SKILLS = [
  {
    id: 'builtin_statedata_schema',
    title: 'StateData Complete Type Definitions',
    description: 'StateData Complete Type Definitions and Field Descriptions',
    isBuiltIn: true as const,
  },
  {
    id: 'builtin_workflow',
    title: 'User Request Handling Workflow',
    description: 'User Request Handling Workflow (references other Skills, read first when receiving a request)',
    isBuiltIn: true as const,
  },
  {
    id: 'builtin_setting_docs',
    title: 'Setting Document Writing Guide',
    description: 'Setting Document Writing Methods and Templates',
    isBuiltIn: true as const,
  },
  {
    id: 'builtin_game_creation',
    title: 'Game Creation Guide',
    description: 'How to Implement a Game Idea (including CustomComponent system usage)',
    isBuiltIn: true as const,
  },
] as const
