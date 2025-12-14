# @pubwiki/sandbox-host

Host-side sandbox communication layer for the @pubwiki ecosystem.

## Overview

This package provides the main site implementation for sandbox communication. It manages RPC services to sandbox iframe and its Service Worker.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Main Site (Host)                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │   SandboxConnection                                       │  │
│  │   - Manages iframe lifecycle                              │  │
│  │   - Creates RPC channels                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │   RPC Hosts                                               │  │
│  │   ┌─────────────────┐ ┌─────────────────────────────────┐ │  │
│  │   │ VFS RPC Host    │ │ Main RPC Host                   │ │  │
│  │   │ (Service Worker)│ │ (HMR + Custom Services)         │ │  │
│  │   └─────────────────┘ └─────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │   Service Implementations                                 │  │
│  │   VfsServiceImpl | HmrServiceImpl | Custom Services       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                       MessageChannel RPC
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      Sandbox Site (iframe)                      │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
pnpm add @pubwiki/sandbox-host
```

## Usage

### Basic Setup

```typescript
import { createSandboxConnection } from '@pubwiki/sandbox-host'

// Create connection with required dependencies
const connection = createSandboxConnection({
  // Iframe element
  iframe: document.getElementById('sandbox-iframe'),
  
  // Workspace configuration
  workspaceId: 'my-workspace',
  basePath: '/public/demo/',
  projectConfig: {
    tsconfigPath: '/public/demo/tsconfig.json',
    projectRoot: '/public/demo',
    entryFiles: ['/public/demo/app.tsx'],
    isBuildable: true
  },
  
  // Target origin of sandbox site
  targetOrigin: 'https://sandbox.example.com',
  
  // Dependency injection
  vfsManagerFactory: myVfsFactory,
  bundlerService: myBundlerService
})

// Initialize with entry file
await connection.initialize('/app.tsx')

// Later: trigger manual reload
connection.reload()

// Cleanup
connection.disconnect()
```

### Adding Custom Services

```typescript
import { createSandboxConnection, type MainRpcHostConfig } from '@pubwiki/sandbox-host'
import { RpcTarget } from 'capnweb'

// Create a custom service
class MyCustomService extends RpcTarget {
  async doSomething(): Promise<string> {
    return 'Hello from custom service!'
  }
}

// Register custom services
const customServices = new Map([
  ['myService', (config: MainRpcHostConfig) => new MyCustomService()]
])

const connection = createSandboxConnection({
  // ... other config
  customServices
})
```

## API

### `createSandboxConnection(config)`

Creates a sandbox connection manager.

**Parameters:**
- `config.iframe` - The iframe element containing the sandbox
- `config.workspaceId` - Workspace ID for file access
- `config.basePath` - Base path within the workspace
- `config.projectConfig` - Project configuration for bundling
- `config.targetOrigin` - Target origin of the sandbox site
- `config.vfsManagerFactory` - VFS Manager factory (dependency injection)
- `config.bundlerService` - Bundler service (dependency injection)
- `config.customServices` - Optional custom services map

**Returns:** `SandboxConnection`

### `SandboxConnection`

- `id` - Unique connection ID
- `isConnected` - Check if connection is established
- `initialize(entryFile)` - Initialize connection and send RPC ports
- `reload()` - Trigger manual reload via HMR
- `disconnect()` - Cleanup all resources

### Service Classes

#### `HmrServiceImpl`

Provides Hot Module Replacement notifications.

```typescript
import { HmrServiceImpl } from '@pubwiki/sandbox-host'

const hmr = new HmrServiceImpl()
hmr.notifyUpdate({ type: 'update', path: '/app.tsx', timestamp: Date.now() })
```

#### `VfsServiceImpl`

Provides virtual file system access with bundler integration.

```typescript
import { VfsServiceImpl } from '@pubwiki/sandbox-host'

const vfs = new VfsServiceImpl({
  workspaceId: 'my-workspace',
  basePath: '/public/demo/',
  projectConfig,
  hmrService,
  vfsManagerFactory,
  bundlerService
})
```

## Dependencies

- `@pubwiki/sandbox-service` - RPC interface definitions
- `@pubwiki/vfs` - Virtual file system (peer dependency)
- `@pubwiki/bundler` - Bundler service (peer dependency)
- `capnweb` - RPC implementation

## License

MIT
