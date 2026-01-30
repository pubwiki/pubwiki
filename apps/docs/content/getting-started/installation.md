---
title: Installation
description: Set up your Pub.Wiki development environment
order: 1
---

# Installation

This guide covers setting up Pub.Wiki for local development.

## Using the Web App

The easiest way to use Pub.Wiki is through our web application:

1. Go to [studio.pub.wiki](https://studio.pub.wiki)
2. Sign in with your account
3. Start creating!

No installation required.

## Local Development

For contributors who want to run Pub.Wiki locally:

### Prerequisites

- Node.js 20+
- pnpm 9+
- Rust (for Lua WASM compilation)

### Clone the Repository

```bash
git clone https://github.com/pubwiki/pubwiki.git
cd pubwiki
```

### Install Dependencies

```bash
pnpm install
```

### Start Development Server

```bash
# Start Studio
pnpm --filter pubwiki-studio dev

# Start Hub
pnpm --filter pubwiki-hub dev
```

## Next Steps

Once you have Pub.Wiki running, check out [First Project](/getting-started/first-project) to create your first AI interactive story.
