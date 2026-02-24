# PubWiki AI Agent Instructions

PubWiki is an AI-powered UGC platform with two main surfaces: **Studio** (flow-graph editor for creating AI-powered interactive content) and **Hub** (marketplace for publishing and discovering artifacts).

## Architecture Overview

```
apps/           # SvelteKit frontend applications
  hub/          # User-facing marketplace
  studio/       # Flow-graph content editor
packages/       # Shared TypeScript packages
  api/          # OpenAPI types, Zod schemas, API client
  db/           # Drizzle ORM schema + service layer
  ui/           # Shared Svelte components
  flow-core/    # Node graph logic
  vfs/          # Virtual filesystem abstractions
services/hub/   # Cloudflare Workers backend (Hono)
```

### Key Architectural Decisions

1. **API-first development**: [packages/api/openapi.yaml](packages/api/openapi.yaml) is the single source of truth. Run `cd packages/api && pnpm generate` after API changes.

2. **BatchContext for D1**: Cloudflare D1 has no transactions. Use `BatchContext` for write batching with optimistic locking. Service methods queue operations; route handlers call `commit()`.
   ```typescript
   const ctx = new BatchContext(createDb(c.env.DB));
   const service = new ArtifactService(ctx);
   await service.doOperation();
   await ctx.commit(); // May throw OptimisticLockError
   ```

3. **Layered backend**: Route handlers in `services/hub/src/routes/` orchestrate services from `@pubwiki/db`. Business logic lives in services, not routes.

## Critical Conventions

- **Backend is source of truth**: When working on frontend, do NOT modify backend code without explicit approval
- **All comments in English**
- **No backward compatibility**: Early-stage project - avoid compatibility cruft
- **When uncertain, ask**: Stop and clarify rather than guessing

## Development Commands

```bash
# Start frontend dev servers
cd apps/hub && pnpm dev           # Hub frontend
cd apps/studio && pnpm dev        # Studio frontend

# Backend
cd services/hub && pnpm dev       # Worker dev server

# Testing
cd services/hub && pnpm test:unit # Unit tests (Workers pool)
cd services/hub && pnpm test:e2e  # E2E tests

# Code quality
npx eslint <package_dir>          # Lint package
cd packages/api && pnpm generate  # Regenerate API types
cd packages/db && pnpm generate   # Generate DB migrations
```

## API Client Pattern

Frontend uses typed client from `@pubwiki/api/client`:
```typescript
import { createAuthClient, createApiClient } from '@pubwiki/api/client';

const authClient = createAuthClient(API_BASE_URL);
await authClient.signIn.email({ email, password });

const apiClient = createApiClient(`${API_BASE_URL}/api`);
const { data, error } = await apiClient.GET('/artifacts/{artifactId}/graph', {
  params: { path: { artifactId } }
});
```

## Backend Error Handling

Use helpers from `services/hub/src/lib/service-error.ts`:
```typescript
import { serviceErrorResponse, badRequest, forbidden, commitWithConflictHandling } from '../lib/service-error';

// Handle service errors
if (!result.success) return serviceErrorResponse(c, result.error);

// Handle optimistic lock conflicts
const conflict = await commitWithConflictHandling(c, ctx, 'Resource modified');
if (conflict) return conflict;
```

## Skills Reference

Detailed domain knowledge available in `.github/skills/`:
- `backend-architecture/` - System design and domain model
- `backend-api-usage/` - Frontend API integration patterns
- `code-modify-order/` - Backend/frontend modification rules

## Quick Reference

| Package | Purpose | Key Files |
|---------|---------|-----------|
| `@pubwiki/api` | API types + client | `openapi.yaml`, `src/client.ts` |
| `@pubwiki/db` | Schema + services | `src/schema/`, `src/services/` |
| `services/hub` | Backend routes | `src/routes/`, `src/middleware/` |
