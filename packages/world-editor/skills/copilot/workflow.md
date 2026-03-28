---
title: User Request Handling Workflow
description: User Request Handling Workflow (references other Skills, read first when receiving a request)
---

# User Request Handling Workflow

## Processing Flow

1. **Understand state** — `get_state_overview()` + `list_memories()`
2. **Process files** (if any) — Small files (<10KB) use `get_workspace_file_content`, large files use `use_workspace_file_agent`
3. **Read Skills** — Setting documents → `setting_docs`, data structure → `statedata_schema`, game ideas → `game_creation`
4. **Make a plan** — List steps, record with `save_memory`, wait for user confirmation (use `query_user` form for multiple items)
5. **Execute step by step** — Report to user after each step, wait for feedback
6. **Validate** — `check_state_error()`
7. **Record** — `save_memory("Task Complete: XXX", "...")`

---

## Common Operations

### Create a Character
```json
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
```

### Add a Setting Document
```json
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
```

---

## Important Notes
- **IDs must be unique**, use meaningful IDs (e.g., `"protagonist_lin_feng"`)
- **References must be valid** — organization_id must correspond to an existing organization
- **Read before modifying** — Use `get_state_content` to check current values
- **File processing** — Large files (>10KB) use `use_workspace_file_agent(filename, instruction)` to extract information
