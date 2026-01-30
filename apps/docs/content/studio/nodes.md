---
title: Node Types
description: Complete reference for all node types in Studio
order: 2
---

# Node Types

Studio provides six core node types, each designed for a specific purpose.

## Prompt Node

The Prompt node contains your AI instructions.

### Features

- Rich text editing
- `#hashtag` syntax for referencing other nodes
- System prompt configuration
- LLM provider selection

### Example

```
You are a detective in 1920s Chicago.
The player has just discovered a mysterious letter.

Current inventory: #inventory
Previous conversation: #history
```

## Input Node

Input nodes capture user responses and choices.

### Types

- Text input
- Choice selection
- File upload

### Properties

- Placeholder text
- Validation rules
- Default values

## Generated Node

Generated nodes display AI-generated content.

### Features

- Streaming output
- Markdown rendering
- Code highlighting

## VFS Node

Virtual File System nodes manage game assets.

### Use Cases

- Character portraits
- Background images
- Sound effects
- Game data files

## Sandbox Node

Sandbox nodes provide a live preview environment.

### Features

- Real-time preview
- Interactive testing
- Debug console

## Loader Node

Loader nodes execute custom scripts.

### Supported Languages

- Lua (via wasmoon)
- TypeScript (via QuickJS)

### Example

```lua
-- Calculate damage
local base_damage = 10
local modifier = player.strength * 0.5
return base_damage + modifier
```

## Node Connections

Nodes connect through typed ports:

| Source | Target | Description |
|--------|--------|-------------|
| Prompt | Generated | Sends prompt to AI |
| Input | Prompt | Includes user input |
| Loader | Any | Provides computed data |
| VFS | Sandbox | Loads assets |
