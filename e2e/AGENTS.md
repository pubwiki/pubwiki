# E2E Test Agent Instructions

End-to-end tests for PubWiki using Playwright. Tests cover Hub (marketplace), Studio (editor), and cross-application integration flows.

## Directory Structure

```
e2e/
├── fixtures/              # Test infrastructure
│   ├── global-setup.ts    # Spawns backend + frontend servers, creates temp DB
│   ├── auth.setup.ts      # Registers test user, saves auth state to .auth/user.json
│   ├── test.ts            # Custom Playwright fixture (API URL rewriting)
│   ├── constants.ts       # Dynamic port discovery from .e2e-ports.json
│   ├── api-client.ts      # registerUser(), loginUser() fetch helpers
│   ├── pack-artifact.ts   # Artifact packaging utility
│   └── pages/             # Page Object Models
│       ├── hub-page.ts
│       ├── studio-page.ts
│       └── player-page.ts
├── hub/                   # Hub marketplace tests
├── studio/                # Studio editor tests
├── integration/           # Cross-app integration tests
└── blobs/                 # Test data (ZIP archives, artifact sources, images)
```

## Test Projects

Configured in `playwright.config.ts` with dependency chain:

| Project | Dir | Depends On | Purpose |
|---------|-----|-----------|---------|
| `setup` | `fixtures/` | — | Auth setup, creates `.auth/user.json` |
| `hub` | `hub/` | `setup` | Hub browsing, search, user profile |
| `studio` | `studio/` | `setup` | Canvas rendering, node editing |
| `integration` | `integration/` | `setup` | Multi-app flows (publish, import) |

## Running Tests

```bash
cd e2e
npx playwright test                           # All tests
npx playwright test --project=hub             # Hub only
npx playwright test --project=studio          # Studio only
npx playwright test --project=integration     # Integration only
npx playwright test --project=integration integration/publish-flow.spec.ts  # Single file
```

## Key Patterns

### Imports and Fixtures

Always import from the custom fixture, not from `@playwright/test` directly:

```typescript
import { test, expect } from '../fixtures/test.js';
import { getHubUrl, getStudioUrl } from '../fixtures/constants.js';
```

### Page Objects

Use page objects for cross-test consistency:

```typescript
import { HubPage } from '../fixtures/pages/hub-page.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';
import { PlayerPage } from '../fixtures/pages/player-page.js';

const hub = new HubPage(page);
const studio = new StudioPage(page);
```

### Multi-Step Integration Tests

Long flows use `test.step()` for structured logging and `test.setTimeout()` for extended timeouts:

```typescript
test('full publish flow', async ({ page }) => {
  test.setTimeout(300_000);

  await test.step('Step 1: register', async () => {
    // ...
  });

  await test.step('Step 2: import project', async () => {
    // ...
  });
});
```

### Dynamic Ports

Servers are started on dynamic ports by `global-setup.ts`. Port info is written to `.e2e-ports.json` and read by `constants.ts`:

```typescript
import { getApiBaseUrl, getHubUrl, getStudioUrl } from '../fixtures/constants.js';
```

### API URL Rewriting

The custom fixture in `test.ts` intercepts API requests to rewrite non-localhost origins to the local test server. This is automatic — no manual setup needed.

## Important Conventions

- **Auth state is shared**: All projects (except `setup`) reuse `.auth/user.json` via `storageState`
- **Integration tests may use fresh sessions**: `test.use({ storageState: { cookies: [], origins: [] } })` to start unauthenticated
- **Test data in `blobs/`**: Pre-built artifacts, ZIP archives, and images for import tests. The `blobs/artifacts/` directory contains full source trees for artifact builds
- **No hardcoded ports**: Always use `getHubUrl()` / `getStudioUrl()` / `getApiBaseUrl()`
- **Timeouts**: Default is from Playwright config; integration tests override with `test.setTimeout()`
- **Iframes**: Player tests navigate nested iframe chains (Player → `__sandbox.html` → `index.html`). Use `page.frameLocator()` for inner content
