---
title: React Coding Conventions
description: React/TypeScript coding conventions and best practices for the game frontend
---

# React Coding Conventions

## Tech Stack

- **React 18** + **TypeScript**
- **Tailwind CSS** for styling (add `@import "tailwindcss"` in a CSS file to enable)
- Source files live in the Frontend VFS under `/src/`
- Entry point is `/src/main.tsx`

## File Structure

- Write all code in `/src/` directory only
- `/lib/` is read-only — it contains the platform libraries
- Organize components in `/src/components/`, hooks in `/src/hooks/`, types in `/src/types/`

## Coding Rules

1. Use functional components with hooks
2. Keep components small and focused
3. Use Tailwind CSS utility classes for styling
4. Use TypeScript types for props
5. Access game state through `@pubwiki/game-sdk` hooks — use `usePub()` for backend service calls
6. **Always include file extensions in imports** — write `import App from './App.tsx'`, NOT `import App from './App'`. The editor does not resolve extensionless imports.
7. Prefer small, incremental changes over large rewrites — use `write_frontend_file` with startLine/endLine for targeted edits

## Iterative Development (MANDATORY)

Every code change MUST follow this strict write → verify → fix cycle:

1. **Write code** — make your changes via `write_frontend_file`. You MUST add a `console.log('...')` statement that runs when the component/app loads successfully.
2. **Verify** — call `verify_frontend(expect: '...')` with the exact string you logged.
3. **Fix and repeat** — if verification fails, read the error messages carefully, fix the code, and go back to step 1.

**Never skip verification.** Do not assume your code works without calling `verify_frontend`.
