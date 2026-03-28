---
title: Game Creation Guide
description: How to Implement a Game Idea (including CustomComponent system usage)
---

# How to Implement a Game Idea

## Core Principle: Design First, Then Implement

> **Never start implementing immediately upon receiving a request!** Use `query_user` form to collect design elements, confirm, then begin.

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
```json
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
```

### Gameplay Examples

- **Pokemon**: CustomComponent(`pokemon_party`, `pokedex`) + StatusEffect (status conditions) + inventory (Poke Balls) + SettingDocument (type effectiveness rules)
- **Cultivation/Xianxia**: CustomComponent(`cultivation_state`) + StatusEffect (seclusion, qi deviation) + SettingDocument (realm hierarchy)
- **Cthulhu**: CustomComponent(`mental_state`: {san, phobias}) + SettingDocument (SAN value rules)

---

## Comprehensive Example

> Demonstrating the integration of CustomComponent + inventory + relationships + status_effects + SettingDocument.

```json
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
```

**SettingDocument condition-driven dynamic recall (core design pattern)**:
```json
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
```

> **Core concept**: CustomComponent/StatusEffect/Relationship store numerical values, SettingDocument's condition uses those values for dynamic recall, allowing AI to automatically choose the appropriate narrative style.

---

## Important Notes
- **Discuss before implementing** — Data structures are costly to modify once created
- **Setting documents are the soul** — CustomComponent is just a data carrier; setting documents let the AI "understand" gameplay
- **StatusEffect's display_name** is for UI display, **remark** helps AI understand the meaning
