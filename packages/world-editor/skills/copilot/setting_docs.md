---
title: Setting Document Writing Guide
description: Setting Document Writing Methods and Templates
---

# Setting Document Writing Guide

## Setting Document Storage Locations

Setting documents are now bound to each entity's `bind_setting.documents`:

| Entity | Storage Location | Purpose | Example name |
|--------|-----------------|---------|-------------|
| World | `World.bind_setting.documents` | World-building, rules, system documents | "World Background", "Affinity System Rules" |
| Creature | `Creatures[].bind_setting.documents` | Character settings | "Biography", "High-Affinity Strategy File" |
| Region | `Regions[].bind_setting.documents` | Region settings | "Region Overview", "Secret Realm Unlock Conditions" |
| Organization | `Organizations[].bind_setting.documents` | Organization settings | "Organization Introduction", "Internal Rules" |

---

## WorldSetting Template

~~~markdown
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
~~~

---

## CreatureSetting Template

~~~markdown
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
~~~

---

## OrganizationSetting Template

~~~markdown
# {Organization Name}

## Basic Information
- **Type**: (Sect/Company/Government, etc.)
- **Scale**:
- **Headquarters**:

## Core Philosophy
(Organization's purpose)

## Key Figures
(Leaders, core members)
~~~

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

When no priority is set, you can use the `condition` field to describe recall conditions:
- For example: `"When describing combat scenes"`, `"When NPC Zhang San appears"`
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
