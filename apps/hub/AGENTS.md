# Hub Application - Developer Guide

## Overview

The Hub (`apps/hub`) is the public-facing frontend of PubWiki, serving as a community portal where users can browse, discover, and interact with artifacts (games, stories, simulations). It is a SvelteKit application deployed to Cloudflare Pages/Workers.

**Production Domain**: `hub.pub.wiki`

## Tech Stack

- **Framework**: SvelteKit with Svelte 5 (runes mode: `$state`, `$derived`, `$effect`)
- **Styling**: TailwindCSS + Flowbite Svelte components
- **Deployment**: Cloudflare Workers (via `@sveltejs/adapter-cloudflare`)
- **i18n**: Paraglide.js (`en` and `zh` locales)
- **Testing**: Vitest with Playwright browser testing
- **Build**: Vite

## Project Structure

```
src/
├── lib/
│   ├── api.ts              # Singleton API client (uses @pubwiki/api)
│   ├── config.ts           # Environment config (API_BASE_URL)
│   ├── persist.svelte.ts   # localStorage persistence utility
│   ├── types.ts            # Frontend-specific types
│   ├── components/         # Reusable UI components
│   │   ├── ArtifactCard.svelte
│   │   ├── ArticleCard.svelte
│   │   ├── LineageGraph.svelte   # XYFlow-based lineage visualization
│   │   ├── NodeCard.svelte
│   │   ├── FileTree/             # File tree component
│   │   └── ItemTree/             # Generic tree component
│   ├── stores/             # Svelte 5 reactive stores
│   │   ├── artifacts.svelte.ts   # Artifact browsing & caching
│   │   ├── articles.svelte.ts    # Article fetching & caching
│   │   ├── projects.svelte.ts    # Project listing
│   │   └── settings.svelte.ts    # User preferences (API keys, etc.)
│   └── paraglide/          # Generated i18n messages
├── routes/
│   ├── +layout.ts          # SSR disabled (csr=true, ssr=false)
│   └── (app)/              # Main app routes
│       ├── +layout.svelte  # App shell with header/footer
│       ├── +page.svelte    # Home: artifact grid
│       ├── artifact/[id]/  # Artifact detail page
│       ├── read/[uuid]/    # Article reader
│       ├── community/      # Community/projects
│       ├── me/             # User dashboard
│       ├── login/          # Authentication
│       └── register/
└── hooks.ts                # Paraglide URL rerouting
```

## Key Patterns

### API Client Usage

Always use the singleton client from `$lib/api`:

```typescript
import { apiClient } from '$lib/api';

// Type-safe API calls
const { data, error } = await apiClient.GET('/artifacts/{artifactId}', {
  params: { path: { artifactId } }
});
```

### Store Pattern (Svelte 5)

Stores use Svelte 5 class-based reactivity with context:

```typescript
// Creating and providing
import { createArtifactStore } from '$lib/stores/artifacts.svelte';
const store = createArtifactStore(); // Call in +layout.svelte

// Consuming
import { useArtifactStore } from '$lib/stores/artifacts.svelte';
const artifactStore = useArtifactStore();
```

### i18n Messages

Use Paraglide for translations:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
</script>

<h1>{m.home_title()}</h1>
<p>{m.common_error({ message: errorMsg })}</p>
```

Message files: `messages/en.json`, `messages/zh.json`

After editing messages, run: `pnpm i18n`

## Development Commands

```bash
pnpm dev          # Start dev server (default: http://localhost:5173)
pnpm build        # Build for production
pnpm preview      # Preview production build
pnpm check        # TypeScript type checking
pnpm lint         # ESLint + Prettier check
pnpm test         # Run unit tests
pnpm i18n         # Compile i18n messages
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_API_BASE_URL` | Backend API URL | `http://localhost:8787/api` |
| `PUBLIC_STUDIO_URL` | Studio app URL | `http://localhost:5174` |
| `VITE_AUTH_DOMAIN` | Cookie domain (prod) | `.pub.wiki` |

## Key Dependencies

- `@pubwiki/api` - Type-safe API client (workspace package)
- `@pubwiki/reader` - Article reader component
- `@pubwiki/ui` - Shared UI components (auth stores, etc.)
- `@xyflow/svelte` - Graph visualization for lineage
- `flowbite-svelte` - UI component library
- `svelte-lexical` - Rich text editor

## Testing

Tests use Vitest with Playwright for browser testing:

```typescript
// Example: src/routes/(app)/page.svelte.spec.ts
import { render } from 'vitest-browser-svelte';
import { expect, it } from 'vitest';
import Page from './+page.svelte';

it('should render h1', async () => {
  render(Page);
  const heading = page.getByRole('heading', { level: 1 });
  await expect.element(heading).toBeInTheDocument();
});
```

## Important Notes

1. **SSR Disabled**: This app runs entirely client-side (`ssr = false` in layout.ts)
2. **Auth**: Uses `@pubwiki/ui` auth store with cookie-based authentication
3. **Cloudflare Deployment**: Uses Wrangler for deployment (`wrangler.jsonc`)
4. **Never modify backend**: Frontend changes only; backend is source of truth

## Common Tasks

### Adding a New Page

1. Create route in `src/routes/(app)/[route-name]/+page.svelte`
2. Add navigation link in `+layout.svelte` if needed
3. Add i18n messages to `messages/*.json`
4. Run `pnpm i18n` to compile messages

### Adding a New Component

1. Create in `src/lib/components/`
2. Use Svelte 5 runes (`$state`, `$derived`, `$props`)
3. Keep components focused and reusable

### Adding a New Store

1. Create in `src/lib/stores/[name].svelte.ts`
2. Export `create[Name]Store()` and `use[Name]Store()` functions
3. Use class-based pattern with `$state` for reactivity
4. Initialize in appropriate layout component
