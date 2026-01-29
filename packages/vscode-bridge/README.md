# @vfs/browser-client

Browser-side adapter library that bridges [@pubwiki/vfs](https://github.com/pubwiki/vfs) to VS Code via WebSocket RPC.

## Installation

```bash
npm install @vfs/browser-client
```

## Usage

### 1. Create a VFS with a Provider

Use `@pubwiki/vfs` to create a virtual file system with any provider:

```typescript
import { Vfs } from '@pubwiki/vfs';
import { InMemoryProvider } from '@pubwiki/vfs/providers';
import { VfsBrowserClient } from '@vfs/browser-client';

// Create a VFS instance with your preferred provider
const provider = new InMemoryProvider();
const vfs = new Vfs(provider);

// Initialize some files
await vfs.createFolder('/documents');
await vfs.createFile('/documents/hello.txt', 'Hello World!');
```

### 2. Connect to VS Code

```typescript
// Create the browser client with your VFS
const client = new VfsBrowserClient(vfs);

// Parse callback URL from VS Code
const callbackUrl = 'https://your-app.com/connect?vscode_ws=ws://localhost:8080&token=abc123';
const options = VfsBrowserClient.parseCallbackUrl(callbackUrl);

// Connect to VS Code
try {
  await client.connect(options);
  console.log('Connected to VS Code!');
} catch (error) {
  console.error('Connection failed:', error);
}
```

### 3. Handle Connection Events

```typescript
const client = new VfsBrowserClient(vfs);

// Handle disconnect
client.onDisconnect(() => {
  console.log('Disconnected from VS Code');
});

// Handle reconnect
client.onReconnect(() => {
  console.log('Reconnected to VS Code');
});

await client.connect({
  websocketUrl: 'ws://localhost:8080',
  maxRetries: 5,      // Auto-reconnect up to 5 times
  retryDelay: 1000    // Start with 1s delay (exponential backoff)
});
```

### 4. File Change Notifications

File changes are automatically propagated to VS Code. When files are created, updated, or deleted through the VFS, VS Code's file explorer will refresh automatically:

```typescript
// These changes will be reflected in VS Code immediately
await vfs.createFile('/new-file.txt', 'content');
await vfs.updateFile('/new-file.txt', 'updated content');
await vfs.deleteFile('/new-file.txt');
```

## API Reference

### `VfsBrowserClient`

Main client class for connecting to VS Code.

#### Constructor

```typescript
import { Vfs, VfsProvider } from '@pubwiki/vfs';

constructor(vfs: Vfs<VfsProvider>)
```

#### Methods

- **`connect(options: VfsConnectionOptions): Promise<void>`**  
  Connect to VS Code's WebSocket server.

- **`disconnect(): void`**  
  Disconnect from VS Code.

- **`isConnected(): boolean`**  
  Check if currently connected.

- **`onDisconnect(callback: () => void): void`**  
  Set callback for disconnect events.

- **`onReconnect(callback: () => void): void`**  
  Set callback for reconnect events.

- **`static parseCallbackUrl(callbackUrl: string): VfsConnectionOptions`**  
  Parse VS Code's callback URL to extract connection options.

### `VfsConnectionOptions`

```typescript
interface VfsConnectionOptions {
  websocketUrl: string;      // WebSocket URL to connect to
  token?: string;            // Optional authentication token
  timeout?: number;          // Connection timeout in ms (default: 10000)
  maxRetries?: number;       // Max reconnection attempts (0 = no retry, -1 = infinite)
  retryDelay?: number;       // Initial retry delay in ms (default: 1000)
}
```

### `IVirtualFileSystem`

RPC interface exposed to VS Code. This is implemented internally by `VfsAdapter`.

| Method | Description |
|--------|-------------|
| `stat(path)` | Get file/directory metadata |
| `readFile(path)` | Read file contents |
| `writeFile(path, content)` | Write file contents |
| `readDirectory(path)` | List directory contents |
| `createDirectory(path)` | Create a directory |
| `delete(path, recursive)` | Delete file or directory |
| `rename(oldPath, newPath)` | Rename/move file or directory |
| `onFileChange(callback)` | Register file change callback |

## Connection Flow

1. User clicks "Connect to Virtual File System" in VS Code
2. VS Code starts WebSocket server and generates callback URL
3. User opens callback URL in browser
4. Browser parses URL and creates `VfsBrowserClient` with a `Vfs` instance
5. Browser calls `connect()` to establish WebSocket connection
6. VS Code registers file change callback via RPC
7. User can edit files in VS Code, changes saved to browser's VFS
8. File changes in browser are automatically notified to VS Code

## Architecture

```
┌─────────────────┐       WebSocket        ┌──────────────────┐
│     VS Code     │ ◄────────────────────► │     Browser      │
│                 │                        │                  │
│   RPC Client    │      capnweb RPC       │   RPC Server     │
│                 │                        │   (VfsAdapter)   │
│  FileSystem     │   File Operations      │                  │
│   Provider      │ ◄────────────────────► │  @pubwiki/vfs    │
│                 │                        │   + Provider     │
│                 │   File Change Events   │                  │
│                 │ ◄──────────────────────│                  │
└─────────────────┘                        └──────────────────┘
```

## Re-exported Types

For convenience, common types from `@pubwiki/vfs` are re-exported:

```typescript
import { Vfs, VfsProvider, FileType, FileStat } from '@vfs/browser-client';
```

## License

MIT
