# Studio Agent Instructions

Studio is the flow-graph editor application for PubWiki, enabling users to create AI-powered interactive content through a visual node-based interface.

## Architecture Overview

```
src/
├── components/           # Svelte UI components
│   ├── nodes/           # Node type components (Input, Prompt, Generated, VFS, etc.)
│   ├── copilot/         # AI assistant panel
│   ├── editor/          # RefTag editor (Lexical-based)
│   ├── sidebar/         # Project management, properties
│   └── dialogs/         # Modal dialogs
├── lib/                 # Core logic and utilities
│   ├── copilot/         # Copilot orchestrator and tools
│   ├── errors/          # Error routing and handling
│   ├── graph/           # Layout, connection validation (re-exports from flow-core)
│   ├── io/              # Import/export (publish, ZIP)
│   ├── loader/          # Service loader backends
│   ├── persistence/     # IndexedDB storage (NodeStore, LayoutStore)
│   ├── state/           # Svelte context and flow events
│   ├── sync/            # Cloud sync (Draft-Latest workflow)
│   ├── types/           # Type definitions (extends @pubwiki/flow-core)
│   ├── validation/      # Node name validation
│   ├── version/         # Version control service
│   └── vfs/             # Virtual filesystem per-node
├── routes/
│   └── [id]/            # Project editor route (main page)
└── paraglide/           # i18n messages
```

## Key Concepts

### Node Types
Seven node types defined in `src/lib/types/node-data.ts`:
- **INPUT**: User-provided text content with generation settings
- **PROMPT**: Template text with RefTag references to other nodes
- **GENERATED**: LLM output from Input+Prompt execution
- **VFS**: Virtual filesystem backed by ZenFS (per-node storage)
- **SANDBOX**: Lua sandbox execution environment
- **LOADER**: Service bridge for external data fetching
- **STATE**: Persistent state storage across executions

### Three-Layer Architecture
1. **Business Data Layer** (`NodeStore`): Node content, version info - reactive via `SvelteMap`
2. **Rendering Layer** (`StudioContext`): SvelteFlow nodes/edges, UI state
3. **Layout Layer** (`LayoutStore`): Position data, auto-persisted

### Version Control
- Git-like content-addressed versioning (commit = hash of nodeId + parent + contentHash + type)
- Snapshot management via `VersionService`
- Preview controller for viewing historical versions
- Types in `src/lib/version/types.ts`, re-exports from `@pubwiki/flow-core`

### Persistence
- **IndexedDB** via Dexie for local storage
- Tables: `nodeData`, `layouts`, `edges`, `projects`, `snapshots`
- Auto-save with debouncing in `NodeStore` and `LayoutStore`
- VFS files in ZenFS (browser IndexedDB-based filesystem)

### Cloud Sync
- Draft-Latest workflow: saves to `draft-latest` tag with PRIVATE visibility
- Conflict detection and resolution
- VFS changes auto-committed before sync
- Implementation in `src/lib/sync/draft-sync.svelte.ts`

## Development Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm test         # Run unit tests
pnpm check        # Type checking
pnpm i18n         # Regenerate i18n messages
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@xyflow/svelte` | Flow graph rendering |
| `@pubwiki/flow-core` | Core node types, validation, version control |
| `@pubwiki/chat` | LLM chat interface for generation |
| `@pubwiki/vfs` | Virtual filesystem abstraction |
| `@zenfs/core` | Browser filesystem implementation |
| `dexie` | IndexedDB wrapper |
| `lexical` | Rich text editor for RefTags |

## Important Patterns

### StudioContext (Dependency Injection)
```typescript
// In +page.svelte - set context
setStudioContext(studioContext);

// In child components - get context
const ctx = getStudioContext();
ctx.updateNodeData(id, data => ({ ...data, ...updates }));
```

### NodeStore Access
```typescript
import { nodeStore } from '$lib/persistence';

// Get node data (reactive)
const data = nodeStore.get(nodeId);

// Update node
nodeStore.update(nodeId, data => ({ ...data, ...changes }));

// Watch modifications
$derived(nodeStore.modificationCount && nodeStore.getAll());
```

### Error Handling
```typescript
import { errorRouter, AppError } from '$lib/errors';

// Dispatch errors through router
errorRouter.dispatch(new AppError('SYNC_FAILED', 'Failed to sync', 'network', 'warning'));
```

### API Calls
```typescript
import { apiCall } from '$lib/api';
import { createApiClient } from '@pubwiki/api/client';

const client = createApiClient(API_BASE_URL);
const result = await client.GET('/artifacts/{artifactId}', { params: { path: { artifactId } } });
```

## File Highlights

| File | Purpose |
|------|---------|
| [src/routes/[id]/+page.svelte](src/routes/[id]/+page.svelte) | Main editor page (1600+ lines) |
| [src/lib/persistence/node-store.svelte.ts](src/lib/persistence/node-store.svelte.ts) | Global node data store |
| [src/lib/state/context.ts](src/lib/state/context.ts) | Svelte context definition |
| [src/lib/version/version-service.svelte.ts](src/lib/version/version-service.svelte.ts) | Version control operations |
| [src/lib/sync/draft-sync.svelte.ts](src/lib/sync/draft-sync.svelte.ts) | Cloud sync logic |
| [src/lib/copilot/orchestrator.ts](src/lib/copilot/orchestrator.ts) | AI copilot agent |
| [src/components/nodes/index.ts](src/components/nodes/index.ts) | Node component exports |

## Conventions

- **Svelte 5 runes**: Use `$state`, `$derived`, `$effect` for reactivity
- **File naming**: `.svelte.ts` for files with Svelte runes in pure TS
- **Type re-exports**: Most types come from `@pubwiki/flow-core`, wrapped for XYFlow compatibility
- **Comments in English**: All code comments must be in English
- **No backward compatibility**: Early-stage project - avoid compatibility cruft

## Testing

Unit tests use Vitest with fake-indexeddb:
```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
```

Test setup in `tests/setup.ts` configures fake IndexedDB and globals.

## Copilot System

The AI copilot (`src/lib/copilot/`) provides:
- **Graph Query**: Read-only graph inspection (`graph-query.ts`)
- **Graph Mutation**: Create/connect/delete nodes (`graph-mutation.ts`)
- **Orchestrator**: Main agent with tool-calling (`orchestrator.ts`)
- **Tools**: Function definitions for LLM (`tools.ts`)

System prompt in `src/lib/copilot/prompts/orchestrator.md`.
