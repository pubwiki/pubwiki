# @pubwiki/sandbox-service

RPC interface definitions for sandbox-main site communication using [capnweb](https://github.com/cloudflare/capnweb).

## Overview

This package provides type-safe RPC interfaces for communication between:
- **Main site** (implements services)
- **Sandbox Service Worker** (consumes VFS service for resource proxying)
- **Bundler Worker** (consumes VFS service for file loading)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Main Site                             │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ VfsServiceImpl  │  │BundlerServiceImpl│  │WikiRAGService│ │
│  │ (implements     │  │ (implements      │  │ (implements  │ │
│  │  IVfsService)   │  │  IBundlerService)│  │ IWikiRAGSvc) │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
│           │                    │                   │         │
│           └────────────────────┼───────────────────┘         │
│                                │                             │
│                    capnweb RPC over MessagePort              │
│                                │                             │
└────────────────────────────────┼─────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      Sandbox Site                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Service Worker (精简版)                      ││
│  │                                                          ││
│  │  Uses RpcStub<IVfsService> to proxy static resources    ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
pnpm add @pubwiki/sandbox-service
```

## Usage

### Implementing a Service (Main Site)

```typescript
import { IVfsService, FileInfo, FileExistsResult } from '@pubwiki/sandbox-service'
import { vfsManagerFactory } from '@/lib/vfs/vfs-manager-factory'

export class VfsServiceImpl extends IVfsService {
  constructor(
    private workspaceId: string,
    private basePath: string
  ) {
    super()
  }
  
  async readFile(path: string): Promise<FileInfo> {
    const vfs = await vfsManagerFactory.getManager(this.workspaceId)
    const fullPath = `${this.basePath}/${path}`
    const file = await vfs.readFile(fullPath)
    
    return {
      path,
      content: file.content as ArrayBuffer,
      mimeType: this.getMimeType(path),
      size: (file.content as ArrayBuffer).byteLength
    }
  }
  
  async fileExists(path: string): Promise<FileExistsResult> {
    const vfs = await vfsManagerFactory.getManager(this.workspaceId)
    const fullPath = `${this.basePath}/${path}`
    const exists = await vfs.exists(fullPath)
    return { exists }
  }
  
  // ... implement other methods
}
```

### Setting up RPC Server (Main Site)

```typescript
import { newMessagePortRpcSession } from '@pubwiki/sandbox-service'
import { VfsServiceImpl } from './vfs-service-impl'

export function setupSandboxRpcServer(
  messagePort: MessagePort,
  workspaceId: string,
  basePath: string
): Disposable {
  const vfsService = new VfsServiceImpl(workspaceId, basePath)
  return newMessagePortRpcSession(messagePort, vfsService)
}
```

### Using the Service (Sandbox Service Worker)

```typescript
import { 
  newMessagePortRpcSession, 
  RpcStub,
  type IVfsService 
} from '@pubwiki/sandbox-service'

let vfs: RpcStub<IVfsService> | null = null

// Setup RPC connection when MessagePort is received
self.addEventListener('message', (event) => {
  if (event.data.type === 'SETUP_PORT' && event.ports[0]) {
    vfs = newMessagePortRpcSession<IVfsService>(event.ports[0])
  }
})

// Use the service
async function handleFetch(path: string): Promise<Response> {
  if (!vfs) {
    return new Response('Not initialized', { status: 503 })
  }
  
  const file = await vfs.readFile(path)
  return new Response(file.content, {
    headers: { 'Content-Type': file.mimeType }
  })
}
```

## Exported Interfaces

### IVfsService
Virtual File System service for file operations:
- `readFile(path)` - Read file content
- `fileExists(path)` - Check file existence
- `listDir(path)` - List directory contents
- `getMimeType(path)` - Get MIME type for file
- `readFiles(paths)` - Batch file read
- `filesExist(paths)` - Batch existence check

### IBundlerService
Code bundling/compilation service:
- `initialize()` - Initialize esbuild-wasm
- `build(request)` - Bundle entry file
- `getPackageTypes(pkg)` - Get TypeScript definitions
- `invalidate(request)` - Invalidate cache
- `invalidateAll()` - Clear all cache
- `getDependencyGraph()` - Get dependency graph
- `resolvePackage(name)` - Resolve npm package

### IWikiRAGService
WikiRAG knowledge base service:
- `chat(message, history)` - Chat with LLM
- `chatStream(message, history)` - Streaming chat
- `query(query)` - Query knowledge base
- `getEntityOverview(id)` - Get entity details
- `listEntities()` - List all entities
- `executeLua(code)` - Execute Lua script

## Types

All shared types are exported from the package:

```typescript
// VFS types
import type { FileInfo, FileExistsResult, DirectoryEntry } from '@pubwiki/sandbox-service'

// Bundle types
import type { BundleRequest, BundleResult, DTSResult } from '@pubwiki/sandbox-service'

// Common types
import type { SandboxError, ConsoleMessage, LogLevel } from '@pubwiki/sandbox-service'
```

## License

MIT
