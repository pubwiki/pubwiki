# @pubwiki/sandbox-client

Client SDK for sandbox applications to access main site services.

## Overview

This package provides a type-safe client SDK for sandbox iframe applications to:
- Access the HMR (Hot Module Replacement) service for live reloading
- Access custom services registered by Loader nodes
- Discover available services dynamically

## Installation

```bash
pnpm add @pubwiki/sandbox-client
```

## Usage

```typescript
import { initSandboxClient } from '@pubwiki/sandbox-client'

// Initialize the client (waits for port injection from bootstrap)
const client = await initSandboxClient()

// Access built-in HMR service
client.hmr.onUpdate((update) => {
  console.log('File changed:', update.path)
})

// Access custom services from Loader nodes
const echo = client.getService<IEchoService>('echo')
if (echo) {
  const result = await echo.echo('Hello')
  console.log(result) // "Echo: Hello"
}

// List all available services
const services = await client.listServices()
console.log('Available services:', services)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Sandbox (User Iframe)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                @pubwiki/sandbox-client                │   │
│  │                                                       │   │
│  │  initSandboxClient() → SandboxClient                  │   │
│  │    - getService<T>(id): T                             │   │
│  │    - listServices(): string[]                         │   │
│  │    - hmr: IHmrService                                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│                              │ capnweb RPC                  │
│                              ▼                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              sandbox-bootstrap.ts                     │   │
│  │     (receives port from main site)                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
└──────────────────────────────┼──────────────────────────────┘
                               │ MessagePort
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                      Main Site                               │
│              (MainRpcHost with custom services)              │
└──────────────────────────────────────────────────────────────┘
```

## API Reference

### `initSandboxClient(options?)`

Initialize the sandbox client. This waits for the RPC port to be injected by the sandbox bootstrap.

```typescript
const client = await initSandboxClient({
  timeout: 5000 // Optional: timeout in ms (default: 5000)
})
```

### `SandboxClient`

#### Properties

- `hmr`: `RpcStub<IHmrService>` - Access to the HMR service

#### Methods

- `getService<T>(id: string): RpcStub<T> | undefined` - Get a custom service by ID
- `listServices(): Promise<string[]>` - List all available custom services
- `hasService(id: string): Promise<boolean>` - Check if a service is available

## License

MIT
