# Front — CLAUDE.md

React + TypeScript frontend for avg-game-template. Communicates with the Lua game engine running in a WASM sandbox.

## Commands

```bash
pnpm dev       # Dev server at http://localhost:5175
pnpm build     # tsc -b && vite build
pnpm preview   # Preview production build
```

## Tech Stack

- **React 18** + **TypeScript 5.6** (strict mode)
- **Vite 6** — dev server with COOP/COEP headers required for WASM SharedArrayBuffer
- **Zustand 5** — game and UI state management
- **i18next 25** — localization (en / zh / ja), auto-detected from browser
- **Zod 4** — runtime schema validation for LLM outputs and state data
- **OpenAI SDK 6** — LLM API calls (OpenAI-compatible endpoints)
- **Lucide React** — icons
- **react-markdown** — markdown rendering in game UI
- Path alias: `@/` → `src/`

## App Modes

The app runs in one of two modes, determined by `AppInfo.publish_type`:

1. **Editor mode** (`EDITOR`) — StateDataEditor for editing game world data
2. **Game mode** (`NOVEL` | `INK` | `GALGAME` | `CUSTOM` | `TEST`) — runs the published game

## Directory Structure

```
src/
├── api/                 # Types, service wrappers, AI prompts
│   ├── types.ts         # All shared TypeScript interfaces (StateData, etc.)
│   ├── index.ts         # Main API surface
│   ├── api.ts           # Core API functions
│   ├── copilotService.ts / copilotPrompt.ts
│   ├── worldBuilderNextService.ts / worldBuilderNextPrompts.ts / worldBuilderStorage.ts
│   ├── worldBuilderNextTypes.ts
│   ├── sandboxExecutor.ts   # Calls into Lua sandbox
│   ├── stateValidation.ts
│   ├── localSaveStorage.ts  # IndexedDB local save management
│   ├── encodingUtils.ts     # Encoding utilities
│   └── imageUtils.ts        # Image utilities
├── components/          # Editor UI and shared components
│   ├── StateDataEditor.tsx      # Main state editor (modular, large)
│   ├── AICopilotPanel.tsx
│   ├── LocalSaveManager.tsx     # IndexedDB local save UI
│   ├── SaveManager.tsx          # Cloud save UI
│   ├── APIConfigModal.tsx       # LLM API configuration
│   ├── AlertDialog.tsx / Toast.tsx  # Shared UI primitives
│   ├── CreaturePanel.tsx / CreatureList.tsx
│   ├── GameSelector.tsx
│   ├── state-editor/            # Sub-editors: Creatures, Regions, World, etc.
│   ├── copilot/                 # AI copilot chat sub-components
│   └── world-builder/           # AI world-building wizard
├── games/
│   ├── ink/             # Ink narrative game (text adventure)
│   │   ├── stores/      # Zustand: gameStore, creatureStore, registryStore, modalStore, uiStore
│   │   └── components/  # InkFlow, Modals, WorldOverview, etc.
│   ├── galgame/         # Galgame visual novel (with sprite system)
│   │   ├── stores/      # Zustand: gameStore, creatureStore, registryStore, modalStore, uiStore, spriteStore
│   │   └── components/  # GalFlow, Modals, SpriteManager, etc.
│   ├── custom/          # Custom game template
│   ├── test/            # Test game
│   ├── components/      # Shared game modals (CreatureModal, EntryModal, InfoModal, etc.)
│   └── utils/gameServices.ts   # Typed wrappers over window.callService()
├── stores/              # App-level Zustand stores (editorUI)
├── utils/
│   ├── normalizeLuaData.ts  # Lua↔JS data conversion (empty {} ambiguity)
│   └── pngDataCodec.ts
├── i18n/                # i18next config + LanguageSelector
├── locales/             # en / zh / ja translation JSON files
│   └── {lang}/common.json, editor.json, copilot.json, game.json
├── styles/
│   ├── editor/          # Central editor CSS (layout, forms, modals, sidebar, tabs, etc.)
│   └── variables.css    # CSS custom properties
├── App.tsx
└── main.tsx
```

## Game Types

### Ink Game (`games/ink/`)

Text-based interactive fiction with:
- **Story turns** — AI-generated narrative with branching choices
- **Dice system** — off / visible / hidden modes (`DiceResult` type)
- **Narrative perspective** — second-person ("you") or third-person
- **Story segments** — `content` + `contentPart2` for pacing
- **Typewriter effect** — configurable speed (20–120 chars/sec)
- **Auto-scroll** — pauses when user scrolls up
- **Article publishing** — publish stories to external platform

### Galgame (`games/galgame/`)

Visual novel with sprite/portrait system:
- **GalDialogue** — speaker_creature_id, speaker_display_name, dialogue, depiction, expression
- **GalExpression** — normal, happy, angry, sad, surprised, shy, disgusted, dazed
- **SpriteStore** — manages character sprites/portraits
- **GalFlow** — VN-style dialogue box with click-to-advance, overlay choices
- **IndexedDB saves** — local save/load via `localSaveStorage.ts`

### Shared Game Infrastructure (`games/components/`, `games/utils/`)

- **Modals**: CreatureModal, EntryModal, InfoModal, LocationModal, OrganizationModal
- **RegistryContext**: shared React context for registry data
- **gameServices.ts**: typed wrappers for all Lua service calls

## Key Patterns

### Lua Integration

All Lua calls go through `window.callService(serviceName, input)`. Use the typed wrappers in `games/utils/gameServices.ts` rather than calling `window` directly.

```ts
// Good
import { gameServices } from '@/games/utils/gameServices'
await gameServices.updateGameStateAndDocs(input)

// Avoid
await window.callService('service:UpdateGameState', input)
```

Global helpers: `window.GetStateFromGame()`, `window.LoadStateToGame(data)`, `window.CreateGameSave()`, `window.LoadGameSave(id)`, `window.ListGameSaves()`.

### State Management (Zustand)

- One store per concern: `gameStore`, `creatureStore`, `registryStore`, `modalStore`, `uiStore` (+ `spriteStore` in galgame)
- Game logic lives in Lua; Zustand caches game state and manages UI/turn history
- Access stores via hooks: `useGameStore()`, `useCreatureStore()`, etc.
- App-level stores: `editorUIStore` (editor panel state)

### Data Normalization

Lua's `{}` is ambiguous (array or object). Use `normalizeLuaData()` after receiving state from Lua and `denormalizeLuaData()` before sending it back.

### Local Saves (IndexedDB)

`api/localSaveStorage.ts` provides IndexedDB-based local save/load alongside the Lua-side checkpoint system. Used primarily by the Galgame game type.

### Component CSS

CSS files are co-located with their component:
```
StateDataEditor.tsx
StateDataEditor.css
```
Central editor styles live in `styles/editor/index.css`. Global CSS variables in `styles/variables.css`.

### Localization

```ts
const { t } = useTranslation('editor')
t('someKey')
```

Translation files are in `locales/{lang}/{namespace}.json`. All three languages (en, zh, ja) must be updated together.

### LLM Outputs

Use `zod` schemas + `jsonrepair` to parse and validate LLM responses. Never trust raw LLM JSON without validation. Partial streaming is handled via `openai-partial-json-parser`.

## Important Notes

- The dev server **must** run with COOP/COEP headers for WASM to work. Do not remove them from `vite.config.ts`.
- `@pubwiki/wiki-rag-lab` is excluded from Vite's dep optimization — do not change this.
- `global` is aliased to `globalThis` for Node.js compatibility shims.
- LLM calls use the **OpenAI SDK** with configurable endpoints (not locked to OpenAI) — see `APIConfigModal.tsx`.
