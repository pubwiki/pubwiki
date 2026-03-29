# Lua — CLAUDE.md

Lua 5.4 game logic running inside a WASM sandbox (`@pubwiki/lua`). Implements the ECS game engine, services, and content generation that the React frontend communicates with.

## Entry Point

`init.lua` — loads the module/app system and initializes the save system.

## Directory Structure

```
lua/
├── init.lua          # Root entry: bootstraps loader + save system
├── loader.lua        # Two-tier module/app loader
├── regex.lua         # UTF-8-aware regex wrapper
├── save.lua          # Save / checkpoint system
└── assets/
    └── avg-template@pubwiki/   # Turn-based game app (type: "app")
        ├── init.lua            # App entry, registers systems and services
        ├── components.lua      # ECS component definitions
        ├── systems.lua         # Game systems (combat, movement, items, …)
        ├── state.lua           # State read/write helpers + save/load
        ├── ecs_compat.lua      # ECS compatibility layer (RDF backend, replaces ecs@pubwiki)
        ├── generate.lua        # LLM-driven content generation
        ├── chat.lua            # Chat prompt setup & API config
        ├── rag.lua             # RAG context assembly
        ├── llm_collector.lua   # RAG document collector
        ├── overview.lua        # Game overview generation
        ├── publish.lua         # Publishing helpers
        ├── test.lua            # Unit tests
        ├── prompt_generate_content_with_change_recomands.lua         # LLM prompt: creative content generation (full)
        ├── prompt_generate_content_with_change_recomands_simple.lua  # LLM prompt: creative content generation (simple mode)
        ├── prompt_update_gamestate_and_setting.lua                  # LLM prompt: state change → service calls (full)
        ├── prompt_update_gamestate_and_setting_simple.lua           # LLM prompt: state change → service calls (simple mode)
        └── pkg.json            # Package manifest
```

## Package System

Each asset is declared by a `pkg.json`:

```json
{
  "name": "avg-template",
  "publisher": "pubwiki",
  "version": "1.0.0",
  "type": "app",          // "app" (runs on load) | "module" (library)
  "entry": "init.lua"
}
```

Package IDs follow the `name@publisher` convention. Apps are executed automatically by the loader; modules are loaded on demand.

## ECS Compatibility Layer (`ecs_compat.lua`)

The original `ecs@pubwiki` module has been removed. All ECS functionality (entity CRUD, component read/write, system registration, RAG services) is now provided by `ecs_compat.lua`, which uses the RDF backend (`pw:/pwc:/pwr:/pwo:` triples) directly instead of in-memory ECS primitives.

- Entity IDs are RDF subject strings (e.g. `creature:npc_01`, `region:forest`, `world:default`)
- All `ecs:*` services (`ecs:SpawnEntity`, `ecs:GetSnapshot`, `ecs:SetComponentData`, etc.) remain available with the same API
- System registration via `ecs:RegisterSystem` still exposes systems as `ecs.system:*` services
- Component data is read/written through RDF predicates rather than in-memory component stores

## Core Patterns

### Module Pattern

```lua
local Module = {}

function Module.doThing(arg)
  -- ...
end

return Module
```

### Service Registration

Services are the primary API surface between Lua and JavaScript. Defined via a builder chain:

```lua
Service:define():namespace("GameTemplate"):name("DoSomething")
    :desc("Description of the service")
    :inputs(Type.Object({
        fieldName = Type.String:desc("a field"),
    }))
    :outputs(Type.Object({
        result = Type.String,
    }))
    :impl(function(inputs)
        -- inputs.fieldName is validated
        return { result = "..." }
    end)
```

- Use `Service:define()` for stateful operations, `Service:definePure()` for read-only queries.
- Service names follow `namespace:PascalCase` convention (e.g. `ecs:SpawnEntity`, `save:CreateGameSave`).
- All inputs/outputs are typed via the `Type` system.
- The return value is serialized to JSON and sent back to JavaScript.

### Prompt Templates

Large LLM prompt strings live in dedicated `prompt_*.lua` files, each returning a multi-part string or table of prompt segments. These are consumed by `generate.lua` and `chat.lua` at runtime.

### Type System

Self-describing types used for service params and component schemas:

```lua
Type.String                      -- basic string
Type.Int / Type.Float / Type.Bool
Type.Optional(Type.String)       -- nullable
Type.Array(Type.Int)
Type.Object({ key = Type.String:desc("a field") })
```

### ECS Usage (via Services)

All ECS operations go through `Service.call`:

```lua
-- Spawn an entity
Service.call("ecs:SpawnEntity", {
    components = {
        { key = "Creature", data = { creature_id = "npc_01", name = "Alice" } },
        { key = "LocationRef", data = { region_id = "forest", location_id = "clearing" } },
    }
})

-- Read component data
local result = Service.call("ecs:GetComponentData", {
    entity_id = "creature:npc_01", component_key = "Creature"
})

-- Update component data (merge by default)
Service.call("ecs:SetComponentData", {
    entity_id = "creature:npc_01", component_key = "Creature",
    data = { emotion = "happy" }
})

-- Full world snapshot
local snapshot = Service.call("ecs:GetSnapshot", {})
```

Systems contain logic; components contain data. Keep them separate.

## JavaScript Bridge

These globals are called from the React frontend:

| Global | Direction | Purpose |
|--------|-----------|---------|
| `window.callService(name, input)` | JS → Lua | Dispatch any registered service |
| `window.GetStateFromGame()` | JS → Lua | Export canonical state as JSON |
| `window.LoadStateToGame(data)` | JS → Lua | Import state from JSON |
| `window.CreateGameSave()` | JS → Lua | Create a named save checkpoint |
| `window.LoadGameSave(id)` | JS → Lua | Restore a save checkpoint |

### 系统文档过滤（ecs_rag.lua — ecs:SystemServices）

支持 `service_names` 可选参数，按需获取指定服务的文档而非全量返回：

```lua
-- 只获取特定服务文档
Service.call("ecs:SystemServices", {
    service_names = {"ecs.system:Creature.modifyAttrs", "ecs.system:Modify.addLog"}
})
-- 不传则返回所有非 Query 服务（原有行为）
Service.call("ecs:SystemServices", {})
```

## Important Notes

- Prefer `regex.lua` utilities over raw Lua patterns for UTF-8 text — Lua patterns do not handle multi-byte characters correctly.
- When adding a new service, also add a typed wrapper in `front/src/games/utils/gameServices.ts`.
- App-level init code runs once at load time; keep it fast and side-effect-free apart from service/system registration.
- `systems.lua` (~147 KB) is the largest file — contains all game system logic (combat, movement, inventory, etc.).
