# Pub.Wiki Documentation

This is the documentation website for Pub.Wiki, built with SvelteKit and mdsvex.

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

## Adding Documentation

Add your Markdown files to the `content/` directory:

```
content/
├── index.md              # Home page
├── getting-started/
│   ├── index.md          # Getting Started overview
│   ├── installation.md   # Installation guide
│   └── first-project.md  # First project tutorial
├── studio/
│   ├── overview.md       # Studio overview
│   ├── nodes.md          # Node reference
│   └── version-control.md
└── api/
    └── index.md          # API reference
```

## Frontmatter

Each Markdown file should include frontmatter:

```yaml
---
title: Page Title
description: SEO description
order: 1  # Optional, for sidebar ordering
---
```

## Using Svelte Components

You can import and use Svelte components in your Markdown:

```markdown
<script>
  import Callout from '$lib/components/Callout.svelte';
</script>

<Callout type="info">
  This is an informational callout.
</Callout>
```

## Callout Types

- `info` - Blue, for general information
- `warning` - Yellow, for warnings
- `error` - Red, for errors
- `tip` - Green, for tips and best practices

## Building

```bash
pnpm build
```

The static site will be generated in the `build/` directory.
