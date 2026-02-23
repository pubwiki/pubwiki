# Hub Backend Service - Agent Context

This document provides context for AI agents working on the Hub backend service.

## Overview

Hub is the main backend API service for PubWiki, deployed as a Cloudflare Worker. It handles artifacts, projects, users, discussions, saves, articles, and more.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Framework | [Hono](https://hono.dev/) (lightweight web framework) |
| Database | Cloudflare D1 (SQLite) via [Drizzle ORM](https://orm.drizzle.team/) |
| Object Storage | Cloudflare R2 |
| Authentication | [Better-Auth](https://better-auth.com/) |
| Validation | [Zod](https://zod.dev/) |
| Testing | Vitest + @cloudflare/vitest-pool-workers |

## Project Structure

```
services/hub/
├── src/
│   ├── index.ts          # Main app entry, route registration
│   ├── types.ts          # Env bindings (D1, R2, secrets)
│   ├── utils.ts          # Utility functions
│   ├── routes/           # Route handlers (artifacts, projects, users, etc.)
│   ├── middleware/       # Auth middleware, resource access middleware
│   └── lib/              # Shared utilities
│       ├── auth.ts           # Better-Auth setup
│       ├── access-control.ts # Resource access control helpers
│       ├── audit.ts          # Audit logging
│       ├── service-error.ts  # Error response helpers
│       ├── validate.ts       # Request validation helpers
│       └── with-batch.ts     # BatchContext helpers
├── test/
│   ├── setup.ts          # Test setup (DB migrations)
│   ├── api/              # API route tests
│   ├── services/         # Service layer tests
│   ├── lib/              # Library tests
│   ├── middleware/       # Middleware tests
│   └── e2e/              # End-to-end tests
├── vitest.config.ts      # Unit test config (Workers pool)
└── vitest.e2e.config.ts  # E2E test config
```

## Related Workspace Packages

### @pubwiki/db

Database layer package providing:

- **Schema**: Drizzle schema definitions in `packages/db/src/schema/`
- **Services**: Business logic services (ArtifactService, ProjectService, etc.) in `packages/db/src/services/`
- **BatchContext**: Transaction-like batching for D1 with optimistic locking
- **Access Control**: AclService, DiscoveryService, AccessTokenService

Key exports:
```typescript
import { createDb, BatchContext, OptimisticLockError } from '@pubwiki/db';
import { ArtifactService, ProjectService, ... } from '@pubwiki/db';
import { artifacts, projects, ... } from '@pubwiki/db/schema';
```

### @pubwiki/api

API types and validation package providing:

- **OpenAPI Types**: Generated from `openapi.yaml` in `packages/api/src/generated/openapi.ts`
- **Validation Schemas**: Zod schemas in `packages/api/src/validate/schemas.ts`
- **Client**: OpenAPI-fetch based client in `packages/api/src/client.ts`
- **Utils**: Hash computation, etc. in `packages/api/src/utils.ts`

Key exports:
```typescript
import type { ArtifactDetail, ProjectDetail, ApiError, ... } from '@pubwiki/api';
import { CreateArtifactBody, ListProjectsQueryParams, ... } from '@pubwiki/api/validate';
import { computeSha256Hex } from '@pubwiki/api';
```

## Testing

### Test Commands

```bash
# Run all tests (unit + e2e)
pnpm test:all

# Run unit tests only (uses Cloudflare Workers pool)
pnpm test:unit

# Run e2e tests only (uses wrangler unstable_dev)
pnpm test:e2e

# Watch mode
pnpm test
```

### Test Structure

1. **Unit Tests** (`test/api/`, `test/services/`, etc.)
   - Run in Cloudflare Workers pool via `@cloudflare/vitest-pool-workers`
   - Use isolated D1 database per test file
   - DB migrations applied automatically via `test/setup.ts`

2. **E2E Tests** (`test/e2e/`)
   - Run against real worker via `wrangler unstable_dev`
   - Serial execution (no parallel) to avoid D1 conflicts
   - Longer timeouts (60s)

### Writing Tests

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, BatchContext } from '@pubwiki/db';

describe('MyService', () => {
  let db: ReturnType<typeof createDb>;

  beforeAll(() => {
    db = createDb(env.DB);
  });

  it('should do something', async () => {
    const ctx = new BatchContext(db);
    // ... test logic
    await ctx.commit();
  });
});
```

## Code Conventions

### Error Handling

Use helpers from `lib/service-error.ts`:

```typescript
import { serviceErrorResponse, badRequest, forbidden, notFound, commitWithConflictHandling } from '../lib/service-error';

// Service layer errors
if (!result.success) {
  return serviceErrorResponse(c, result.error);
}

// Direct error responses
return badRequest(c, 'Invalid input');
return forbidden(c, 'Access denied');
return notFound(c, 'Resource not found');

// Commit with conflict handling
const conflictResponse = await commitWithConflictHandling(c, ctx, 'Resource modified concurrently');
if (conflictResponse) return conflictResponse;
```

### Access Control

Use `resourceAccessMiddleware` and access control helpers:

```typescript
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { checkResourceAccess, checkResourceWriteAccess } from '../lib/access-control';

// In route definition
route.get('/:id', resourceAccessMiddleware, async (c) => {
  // Check read access
  const accessError = await checkResourceAccess(c, { type: 'artifact', id });
  if (accessError) return accessError;
  
  // Or use context directly
  const { canRead, canWrite, canManage } = c.get('resourceAccess');
  if (!await canRead({ type: 'artifact', id })) {
    return forbidden(c);
  }
});
```

### Request Validation

Use Zod schemas from `@pubwiki/api/validate`:

```typescript
import { validateQuery, validateBody, validateFormDataJson, isValidationError } from '../lib/validate';
import { ListArtifactsQueryParams, CreateProjectBody } from '@pubwiki/api/validate';

// Query params
const validated = validateQuery(c, ListArtifactsQueryParams, c.req.query());
if (isValidationError(validated)) return validated;

// JSON body
const validated = await validateBody(c, CreateProjectBody);
if (isValidationError(validated)) return validated;

// Form data JSON field
const metadata = validateFormDataJson(c, formData, 'metadata', MetadataSchema);
if (isValidationError(metadata)) return metadata;
```

### Database Operations

Use `BatchContext` for transactional operations:

```typescript
import { createDb, BatchContext, ArtifactService } from '@pubwiki/db';

route.post('/', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const service = new ArtifactService(ctx);
  
  const result = await service.createArtifact({ ... });
  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }
  
  // Commit all batched operations
  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Conflict message');
  if (conflictResponse) return conflictResponse;
  
  return c.json(result.data);
});
```

### Audit Logging

Log write operations using `lib/audit.ts`:

```typescript
import { createAuditLogger } from '../lib/audit';

// After successful write operation
const audit = createAuditLogger({ 
  userId: user.id, 
  ip: c.req.header('CF-Connecting-IP') 
});
audit.create('artifact', artifactId);
audit.update('project', projectId, { fields: ['name', 'description'] });
audit.delete('article', articleId);
```

### Response Types

Always use typed responses from `@pubwiki/api`:

```typescript
import type { CreateArtifactResponse, ApiError } from '@pubwiki/api';

return c.json<CreateArtifactResponse>({
  message: 'Created',
  artifact: data,
}, 201);
```

## Environment Variables

Defined in `src/types.ts`:

| Variable | Type | Description |
|----------|------|-------------|
| `DB` | D1Database | Cloudflare D1 database binding |
| `R2_BUCKET` | R2Bucket | Cloudflare R2 storage binding |
| `BETTER_AUTH_SECRET` | string | Auth secret for JWT signing |
| `BETTER_AUTH_URL` | string | Auth service URL |
| `BETTER_AUTH_TRUSTED_ORIGINS` | string? | Comma-separated allowed origins |

## Common Tasks

### Adding a New Route

1. Create route file in `src/routes/new-route.ts`
2. Register in `src/index.ts`
3. Add API types to `@pubwiki/api` (if needed)
4. Add validation schemas to `@pubwiki/api/validate`
5. Add tests in `test/api/new-route.test.ts`

### Adding a New Service

1. Create service in `packages/db/src/services/new-service.ts`
2. Export from `packages/db/src/services/index.ts`
3. Add tests in `services/hub/test/services/new-service.test.ts`

### Database Migrations

1. Modify schema in `packages/db/src/schema/`
2. Generate migration: `cd packages/db && pnpm generate`
3. Apply locally: `cd services/hub && pnpm migrate:local`
4. Apply remotely: `cd services/hub && pnpm migrate:remote`

## Troubleshooting

### Test Database Issues

Reset local test database:
```bash
pnpm prune-db:local
```

### Type Errors After Schema Changes

Regenerate types:
```bash
cd packages/api && pnpm generate
cd services/hub && pnpm cf-typegen
```
