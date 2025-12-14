# @pubwiki/vfs

Virtual File System library with optional version control support.

## Features

- **Environment Agnostic**: No dependency on browser or Node.js specific APIs
- **Interface First**: Provides interfaces and utilities, not concrete Provider implementations
- **Version Control Ready**: Optional Git-style version control through `VersionedVfsProvider`
- **Event System**: Built-in `VFSEventBus` for file system event subscriptions
- **Type Safe**: Full TypeScript support with conditional types for version control methods

## Installation

```bash
pnpm add @pubwiki/vfs
```

## Usage

### Basic Usage (No Version Control)

```typescript
import { Vfs, VfsProvider, createVfs } from '@pubwiki/vfs'

// Implement a simple memory Provider
class MemoryProvider implements VfsProvider {
  // ... implement all methods
}

const provider = new MemoryProvider()
const vfs = createVfs(provider)  // Returns Vfs<MemoryProvider>

// Create file
const file = await vfs.createFile('/hello.txt', 'Hello World!')

// Read file
const content = await vfs.readFile('/hello.txt')

// Listen for file changes
vfs.events.on('file:updated', (event) => {
  console.log(`File updated: ${event.path}`)
})
```

### With Version Control

```typescript
import { createVfs, VersionedVfsProvider, VersionedVfs } from '@pubwiki/vfs'

// Implement a Git-enabled Provider
class GitProvider implements VersionedVfsProvider {
  // ... implement all methods
}

const provider = new GitProvider()
const vfs = createVfs(provider)  // Returns VersionedVfs with Git methods

// Create file and commit (type-safe: vfs has commit method)
await vfs.createFile('/config.json', '{}')
await vfs.commit('Initial commit')

// Get history
const history = await vfs.getHistory()

// Checkout to a version
await vfs.checkout(history[0].hash)

// Compare differences
const diffs = await vfs.diff(history[1].hash, history[0].hash)
```

## API Overview

### Types

- `VFSFile` - File object with metadata
- `VFSFolder` - Folder object with metadata
- `VFSFolderType` - Folder type enumeration
- `VFSItem` - Union type of file or folder
- `VFSStat` - File/folder status information
- `VFSOperation` - Operation record
- `VFSCommit` - Git-style commit record
- `VFSDiff` - Diff result

### Interfaces

- `VfsProvider` - Basic file system operations
- `VersionedVfsProvider` - Extended with Git-style version control

### Classes

- `Vfs<P>` - Base VFS class
- `VersionedVfs` - VFS with version control methods
- `VFSEventBus` - Event publish/subscribe system

### Functions

- `createVfs(provider)` - Factory function that returns correct VFS type based on provider
- `isVersionedProvider(provider)` - Type guard for checking version control support
- `isVFSFile(item)` - Type guard for file
- `isVFSFolder(item)` - Type guard for folder

### Path Utilities

- `normalizePath(path)` - Normalize path
- `joinPaths(...paths)` - Join path segments
- `getFileName(path)` - Extract file name from path
- `getFolderPath(path)` - Extract folder path
- `getParentPath(path)` - Get parent path
- `getFileExtension(path)` - Get file extension
- `getFileBaseName(path)` - Get file name without extension
- `isRootPath(path)` - Check if path is root
- `isSubPath(path, parentPath)` - Check if path is subpath of another
- `getRelativePath(path, basePath)` - Get relative path

## Events

The `VFSEventBus` supports the following events:

- `file:created` - File created
- `file:updated` - File updated
- `file:deleted` - File deleted
- `file:moved` - File moved
- `folder:created` - Folder created
- `folder:updated` - Folder updated
- `folder:deleted` - Folder deleted
- `folder:moved` - Folder moved

```typescript
// Subscribe to specific event
const unsubscribe = vfs.events.on('file:created', (event) => {
  console.log(`File created: ${event.path}`)
})

// Subscribe to all events
const unsubAll = vfs.events.onAny((event) => {
  console.log(`Event: ${event.type}`)
})

// Unsubscribe
unsubscribe()
```

## License

MIT
