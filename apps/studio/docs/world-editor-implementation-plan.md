# WorldEditor Implementation Plan

This document describes the migration path from the original avg-game-template editor (React + Zustand) to the new World Editor in PubWiki Studio (Svelte 5 + TripleStore).

## 1. Tab Structure

The World Editor uses a horizontal tab bar within its content area. Tabs are divided into two groups:

### World Building
| Tab | Description |
|-----|-------------|
| **Dashboard** | Statistics overview, validation errors, quick links |
| **World** | Global settings — game time, attribute registry, custom component schemas, director notes, flags, logs, documents |
| **Characters** | CRUD for creatures (PCs and NPCs) with nested sub-editors |
| **Regions** | CRUD for regions with locations and paths |
| **Organizations** | CRUD for organizations with territories |

### Story
| Tab | Description |
|-----|-------------|
| **Story** | Initial story (background + opening text), narrator perspective |
| **Wiki** | Wiki / encyclopedia entries |

The Dashboard tab is the default landing tab.

## 2. Component Architecture

```
WorldEditor.svelte                  (root — tab navigation + content area)
  EditorTabs.svelte                 (horizontal tab bar with group separators)
  DashboardPanel.svelte             (stats + validation)
  WorldPanel.svelte                 (world-level settings bento grid)
  CharactersPanel.svelte            (card grid + detail editing)
  RegionsPanel.svelte               (card grid + detail editing)
  OrganizationsPanel.svelte         (card grid + detail editing)
  StoryPanel.svelte                 (split-pane text editor)
  WikiPanel.svelte                  (table of wiki entries)

Shared (reusable across panels):
  EntityCardGrid.svelte             (sortable card grid with toolbar, add/delete)
  BentoGrid.svelte                  (responsive auto-fill grid of bento cards)
  BentoCard.svelte                  (clickable card tile with icon + label + preview)
  EditModal.svelte                  (portal overlay modal, 3 size variants)
  CollapsibleSection.svelte         (expand/collapse wrapper)
  FormGroup.svelte                  (label + input + optional hint/error)
  FormGrid.svelte                   (responsive 2-3 column grid for form groups)
  StringArrayEditor.svelte          (add/remove/reorder list of strings)
  KeyValueEditor.svelte             (dynamic key-value pairs)
  AttributesEditor.svelte           (custom component values editor)
  LogViewer.svelte                  (timestamped log entries, add/view)
  DocumentsEditor.svelte            (SettingDocument CRUD within bind_setting)
  StatusEffectsEditor.svelte        (CRUD for status effects)
  ValidationPanel.svelte            (error/warning display panel)
  SearchFilter.svelte               (text search box for filtering lists)
  SortDropdown.svelte               (sort order: original / A-Z / Z-A)
```

### Character Sub-Editors (nested inside CharactersPanel)

```
CharacterDetailGrid.svelte          (bento grid of character sections)
  InventoryEditor.svelte            (CRUD for inventory items)
  RelationshipsEditor.svelte        (CRUD for relationships with target picker)
  AppearanceEditor.svelte           (body / clothing / features text fields)
  CreatureComponentEditor.svelte    (core fields: name, gender, race, age, etc.)
```

## 3. State Management — Zustand to Svelte 5

The original project used 4 Zustand stores. The migration approach:

### 3.1 Core Data — TripleStore-backed reactive state

The `@pubwiki/world-editor` package already provides `TripleTranslator` (write) and `StateDataView` (read). We use them directly — no intermediate state management layer.

```typescript
// WorldEditor.svelte
import { TripleStore } from '@pubwiki/rdfstore';
import { TripleTranslator, StateDataView } from '@pubwiki/world-editor';

const store = new TripleStore();
const translator = new TripleTranslator();
const view = new StateDataView();

// Reactive materialized view
let stateData: StateData = $state(view.materialize(store));

// Subscribe to store changes → auto-update stateData
view.onChange = (newState) => { stateData = newState; };
view.subscribe(store);
```

**Write path**: UI mutations call `TripleTranslator` methods, which insert/delete triples in the store. `StateDataView` reacts to store changes and re-materializes `stateData`.

```typescript
// Example: update a creature
function updateCreature(creature: CreatureSnapshot) {
  translator.writeCreature(store, creature);
  // stateData updates automatically via view.onChange
}
```

**Read path**: All panels receive `stateData` as a prop (or via context). It's a plain reactive object derived from the store — panels just read from it.

### 3.2 Editor UI State — `$state` + `persist()`

Replaces `editorUIStore`. Per-panel selection state:

```typescript
// WorldEditor.svelte — local UI state
let activeTab = $state('dashboard');
let creaturesSelectedId: string | null = $state(null);
let regionsSelectedId: string | null = $state(null);
let orgsSelectedId: string | null = $state(null);
```

For UI state that should survive page reloads (e.g., which tab was open), use the `persist()` utility from `@pubwiki/ui`:

```typescript
import { persist } from '@pubwiki/ui/utils';
const persistedTab = persist('world-editor-active-tab', 'dashboard');
let activeTab = $derived(persistedTab.value);
```

### 3.3 Undo/Redo — TripleStore checkpoints

TripleStore provides `checkpoint()` which snapshots the current state. Undo/redo walks the checkpoint history — no manual clone/diff needed.

```typescript
// Before a user action
store.checkpoint();

// Undo
store.undo();
// stateData auto-updates via view subscription

// Redo
store.redo();
```

### 3.4 Theme/File/Lorebook stores

- **themeStore** — Not needed. Studio uses Tailwind with the system/Studio theme.
- **fileStore** — Not needed. File management is handled by the Studio's VFS layer.
- **lorebookStore** — Not applicable in the current scope.

## 4. Data Flow

```
  User interaction → TripleTranslator.write(store, entity)
                         ↓
                    TripleStore (insert/delete triples)
                         ↓
                    StateDataView.onChange(newStateData)
                         ↓
                    stateData ($state) — UI re-renders
```

1. `WorldEditor` owns a `TripleStore` instance, a `TripleTranslator`, and a `StateDataView`.
2. All mutations go through `TripleTranslator` methods (e.g., `writeCreature`, `writeWorld`).
3. `StateDataView` subscribes to TripleStore changes and produces a new `StateData`.
4. Panels read from the reactive `stateData` and call translator methods to write.
5. Undo/redo uses `TripleStore.checkpoint()` / undo / redo.

## 5. CRUD Pattern — Standardized Entity Life Cycle

All entity editors (Characters, Regions, Organizations) follow the same pattern. Extract as a reusable composition:

```typescript
// Entity CRUD helper (used per panel)
function createEntityCrud<T>(
  getList: () => T[],
  setList: (items: T[]) => void,
  factory: () => T,
  getId: (item: T) => string,
) {
  return {
    add() {
      const item = factory();
      setList([...getList(), item]);
      return item;
    },
    update(id: string, patch: Partial<T>) {
      setList(getList().map(item =>
        getId(item) === id ? { ...item, ...patch } : item
      ));
    },
    remove(id: string) {
      setList(getList().filter(item => getId(item) !== id));
    },
    find(id: string) {
      return getList().find(item => getId(item) === id);
    },
  };
}
```

## 6. Editing Flow

The editing pattern per entity type follows three levels:

```
Level 1: Card Grid
  - EntityCardGrid displays all entities as cards
  - Cards show name, type badge, brief info
  - Click card → select it (highlight)
  - Toolbar: Add / Delete / Sort / Search

Level 2: Detail Bento Grid
  - Selected entity's data shown as bento cards
  - Each card represents a component/section (e.g., "Appearance", "Inventory")
  - Cards show a compact preview of data
  - Click card → open edit modal for that section

Level 3: Edit Modal
  - Full form for editing a specific entity section
  - Three size variants: normal (640px), wide (900px), full (1200px)
  - Close via Escape key, overlay click, or close button
  - Changes apply immediately to stateData (no separate save)
```

Characters example:
```
CharactersPanel
  EntityCardGrid (creature cards)
    ↓ select
  CharacterDetailGrid (bento cards: Profile, Appearance, Inventory, ...)
    ↓ click "Inventory"
  EditModal (size: wide)
    InventoryEditor (CRUD for items)
```

## 7. Reusable Component Opportunities

Components extracted from the original that become shared building blocks:

| Component | Reused In | Original Equivalent |
|-----------|-----------|---------------------|
| `EntityCardGrid` | Characters, Regions, Organizations | `EntityCardGrid.tsx` |
| `BentoGrid` + `BentoCard` | World, Character detail, Region detail | Inline bento layout |
| `EditModal` | All detail editors | `BentoEditModal.tsx` |
| `FormGroup` + `FormGrid` | All forms | Inline CSS classes |
| `StringArrayEditor` | Region points, any string list | `StringArrayEditor` in CommonEditors |
| `KeyValueEditor` | Metadata, custom components | `KeyValuePairEditor` in CommonEditors |
| `DocumentsEditor` | All entities with bind_setting | Inline in each editor |
| `StatusEffectsEditor` | All entities with status_effects | Inline in each editor |
| `LogViewer` | All entities with log | Inline in each editor |
| `ValidationPanel` | Dashboard, any form | `ValidationPanel` in CommonEditors |
| `SearchFilter` | Card grids, lists | Inline search inputs |
| `SortDropdown` | Card grids | Inline sort select |
| `CollapsibleSection` | Complex forms | CSS class .collapsible-section |

## 8. Optimizations vs. Original

### 8.1 TripleStore as single source of truth

The original used `structuredClone` for every mutation (React immutability) and a manual history array for undo/redo. With TripleStore:
- Mutations are triple insert/delete operations (incremental, not whole-object clones).
- Undo/redo is built into `checkpoint()` (no manual history management).
- The materialized `StateData` is a derived view, always consistent with the store.

### 8.2 No per-field onChange callbacks

The original passed `onChange` callbacks down 5+ levels. In Svelte 5, components can bind directly to reactive state or use the `bind:` directive. This significantly reduces boilerplate.

### 8.3 Composition over prop drilling

Use Svelte's `setContext` / `getContext` for deeply shared state (the CRUD helpers, stateData reference) rather than threading props through every component.

### 8.4 Component-level code splitting

Each panel (Characters, Regions, etc.) is a separate Svelte component. Svelte's compiler ensures only the relevant DOM updates when data changes, unlike React's diffing across the entire tree.

### 8.5 No emoji — SVG icon system

The original used emoji characters heavily as tab/card icons. We replace them with inline SVG icons (Lucide icon set, consistent with the rest of Studio). This improves cross-platform consistency and accessibility.

## 9. Implementation Phases

### Phase A: Shell + Tabs (first PR)
1. Build `EditorTabs.svelte` with tab navigation.
2. Build `WorldEditor.svelte` root with TripleStore + StateDataView wiring.
3. Implement `DashboardPanel` with basic stats from the data.
4. Stub out all other panels with placeholders.

### Phase B: Shared Components
1. Build `EntityCardGrid`, `BentoGrid`, `BentoCard`, `EditModal`.
2. Build `FormGroup`, `FormGrid`, `CollapsibleSection`.
3. Build `StringArrayEditor`, `KeyValueEditor`.
4. Build `DocumentsEditor`, `StatusEffectsEditor`, `LogViewer`.
5. Build `ValidationPanel`, `SearchFilter`, `SortDropdown`.

### Phase C: Entity Editors
1. `WorldPanel` — bento grid with all world-level sections.
2. `CharactersPanel` — card grid + detail grid + sub-editors.
3. `RegionsPanel` — card grid + detail + location/path editors.
4. `OrganizationsPanel` — card grid + detail + territory editor.

### Phase D: Story & Wiki
1. `StoryPanel` — background + opening text editors.
2. `WikiPanel` — table of wiki entries with CRUD.

### Phase E: Polish
1. Keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo, Ctrl+S save).
2. Dirty state detection + unsaved changes warning.
3. Validation error display in dashboard + inline.
4. i18n for all labels and messages.

## 10. File Organization

```
apps/studio/src/components/world-editor/
  WorldEditor.svelte              ← root component
  EditorTabs.svelte               ← tab navigation
  index.ts                        ← barrel exports

  panels/
    DashboardPanel.svelte
    WorldPanel.svelte
    CharactersPanel.svelte
    RegionsPanel.svelte
    OrganizationsPanel.svelte
    StoryPanel.svelte
    WikiPanel.svelte

  shared/
    EntityCardGrid.svelte
    BentoGrid.svelte
    BentoCard.svelte
    EditModal.svelte
    CollapsibleSection.svelte
    FormGroup.svelte
    FormGrid.svelte
    StringArrayEditor.svelte
    KeyValueEditor.svelte
    DocumentsEditor.svelte
    StatusEffectsEditor.svelte
    LogViewer.svelte
    ValidationPanel.svelte
    SearchFilter.svelte
    SortDropdown.svelte

  characters/
    CharacterDetailGrid.svelte
    InventoryEditor.svelte
    RelationshipsEditor.svelte
    AppearanceEditor.svelte
    CreatureComponentEditor.svelte

  state/
    crud.ts                       ← createEntityCrud helper
    context.ts                    ← setContext/getContext wrappers
```

## 11. Dependencies

| Package | Purpose |
|---------|---------|
| `@pubwiki/world-editor` | Types, defaults, validation, RDF (Phase 3) |
| `@pubwiki/ui` | `persist()`, `Toast`, shared utilities |
| `@pubwiki/rdfstore` | Phase 3 — TripleStore integration |
| `lucide-svelte` | Icon set (if available), otherwise inline SVGs |

## 12. Data Persistence

StateData is serialized to/from JSON via `StateDataView.materialize()` (load) and `TripleTranslator.writeAll()` (save). The WorldEditor exposes:

- `exportStateData(): StateData` — materialize current TripleStore contents
- `importStateData(data: StateData)` — clear store and write all entities

The parent page (`[id]/+page.svelte`) is responsible for save/load orchestration, just as it does for the flow graph data today.
