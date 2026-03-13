# PubWiki

An AI-powered UGC (User-Generated Content) platform featuring a visual flow-graph editor (**Studio**) for creating interactive AI-powered content, and a marketplace (**Hub**) for publishing and discovering community artifacts.

> [!WARNING]
> **This project is in early development and is NOT production-ready.** APIs, database schemas, and features may change at any time without notice. Use at your own risk. We make no guarantees about stability, backward compatibility, or data persistence at this stage.

## Architecture

PubWiki is a TypeScript monorepo managed with [pnpm](https://pnpm.io/).

| Directory | Description |
|-----------|-------------|
| `apps/hub` | SvelteKit frontend — user-facing marketplace |
| `apps/studio` | SvelteKit frontend — flow-graph content editor |
| `apps/player` | SvelteKit frontend — artifact player |
| `packages/api` | OpenAPI types, Zod schemas, typed API client |
| `packages/db` | Drizzle ORM schema and service layer |
| `packages/ui` | Shared Svelte UI components |
| `packages/flow-core` | Node graph logic |
| `packages/vfs` | Virtual filesystem abstractions |
| `services/hub` | Cloudflare Workers backend (Hono) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)
- [Rust toolchain](https://rustup.rs/) (for native packages, if applicable)

## Getting Started

```bash
# Install dependencies
pnpm install

# Generate API types (required before first build)
cd packages/api && pnpm generate

# Start the backend dev server
cd services/hub && pnpm dev

# Start a frontend dev server (in a separate terminal)
cd apps/hub && pnpm dev      # Hub
cd apps/studio && pnpm dev   # Studio
```

## Testing

```bash
# Unit tests (backend, uses Cloudflare Workers pool)
cd services/hub && pnpm test:unit

# E2E tests
cd services/hub && pnpm test:e2e
```

## Linting

```bash
npx eslint <package_dir>
```

## License

This project is licensed under the [Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)](LICENSE.md).

This means you can use, copy, modify, and redistribute the software for any purpose **except** competing use. After two years from each version's release date, that version automatically becomes available under the [Apache License 2.0](http://www.apache.org/licenses/LICENSE-2.0).

See [LICENSE.md](LICENSE.md) for the full license text and [fsl.software](https://fsl.software/) for more information about FSL.
