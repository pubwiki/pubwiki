# @pubwiki/vfs

Virtual File System library with optional version control support.

## Features

- **Environment Agnostic**: No dependency on browser or Node.js specific APIs
- **Interface First**: Provides interfaces and utilities, not concrete Provider implementations
- **Version Control Ready**: Optional Git-style version control through `VersionedVfsProvider`
- **Mountable**: Support for mounting multiple VFS instances at different paths via `MountedVfsProvider`
- **Event System**: Built-in `VfsEventBus` for file system event subscriptions
- **Type Safe**: Full TypeScript support with conditional types for version control methods
- **Structured Paths**: `VfsPath` class for safe path manipulation based on segments

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

// Initialize VFS
await vfs.initialize()

// Create file
const file = await vfs.createFile('/hello.txt', 'Hello World!')

// Read file
const content = await vfs.readFile('/hello.txt')

// Update file
await vfs.updateFile('/hello.txt', 'Updated content')

// Create folder
await vfs.createFolder('/my-folder')

// List folder contents
const items = await vfs.listFolder('/my-folder')

// Move/Copy items
await vfs.moveItem('/hello.txt', '/my-folder/hello.txt')
await vfs.copyItem('/my-folder/hello.txt', '/backup.txt')

// Check existence and get stats
const exists = await vfs.exists('/backup.txt')
const stat = await vfs.stat('/backup.txt')

// Delete items
await vfs.deleteFile('/backup.txt')
await vfs.deleteFolder('/my-folder', true)  // recursive

// Listen for file changes
vfs.events.on('file:updated', (event) => {
  console.log(`File updated: ${event.path}`)
})

// Cleanup
await vfs.dispose()
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
await vfs.commit('Initial commit', { author: 'Alice', email: 'alice@example.com' })

// Get history
const history = await vfs.getHistory({ depth: 10 })

// Get HEAD commit and current branch
const head = await vfs.getHead()
const branch = await vfs.getCurrentBranch()

// Checkout to a version
await vfs.checkout(history[0].hash)

// Compare differences
const diffs = await vfs.diff(history[1].hash, history[0].hash)

// Revert to a previous commit (hard reset)
await vfs.revert(history[1].hash)

// Branch operations (if supported by provider)
await vfs.createBranch('feature-branch')
const branches = await vfs.listBranches()
await vfs.deleteBranch('feature-branch')

// Get working directory status
const status = await vfs.getStatus()
```

### Mounted VFS

```typescript
import { createVfs, MountedVfsProvider, Vfs } from '@pubwiki/vfs'

// Create individual VFS instances
const srcVfs = createVfs(new SomeProvider())
const configVfs = createVfs(new AnotherProvider())

// Create a mounted VFS that combines them
const mountedProvider = new MountedVfsProvider([
  ['/src', srcVfs],
  ['/config', configVfs],
])
const vfs = createVfs(mountedProvider)

// Access files through unified paths
await vfs.readFile('/src/app.ts')     // Reads from srcVfs
await vfs.readFile('/config/settings.json')  // Reads from configVfs

// Manage mount points
mountedProvider.mount('/data', dataVfs)
mountedProvider.unmount('/data')
const mountPoints = mountedProvider.getMountPoints()
const mounted = mountedProvider.getMountedVfs('/src')
```

### VfsPath for Safe Path Operations

```typescript
import { VfsPath } from '@pubwiki/vfs'

// Parse paths
const path = VfsPath.parse('/src/lib/utils.ts')

// Path properties
path.isRoot       // false
path.depth        // 3
path.name         // 'utils.ts'
path.extension    // 'ts'
path.baseName     // 'utils'
path.segments     // ['src', 'lib', 'utils.ts']

// Path operations (immutable - returns new VfsPath)
path.parent()           // '/src/lib'
path.append('index.ts') // '/src/lib/utils.ts/index.ts'
path.take(2)            // '/src/lib'
path.skip(1)            // '/lib/utils.ts'

// Path comparisons
path.equals(VfsPath.parse('/src/lib/utils.ts'))  // true
path.isUnder(VfsPath.parse('/src'))               // true
path.isUnder(VfsPath.parse('/src'), true)         // true (strict mode)

// Get relative path
const relative = path.relativeTo(VfsPath.parse('/src'))  // '/lib/utils.ts'

// Convert to string
path.toString()  // '/src/lib/utils.ts'
```

## API Overview

### Types

- `VfsFile` - File object with metadata (path, name, type, size, content, timestamps)
- `VfsFolder` - Folder object with metadata (path, name, parentPath, timestamps, children)
- `VfsItem` - Union type of file or folder
- `VfsStat` - File/folder status information (size, isFile, isDirectory, timestamps)
- `VfsOperation` - Operation record
- `VfsOperationType` - Operation type: `'create' | 'update' | 'delete' | 'move' | 'copy'`
- `VfsOperationTargetType` - Target type: `'file' | 'folder'`
- `VfsCommit` - Git-style commit record (hash, message, author, timestamp, changes)
- `VfsCommitChange` - Commit change item (type, path)
- `VfsDiff` - Diff result (type, path, isDirectory, oldContent, newContent)

### Interfaces

- `VfsProvider` - Basic file system operations (readFile, writeFile, mkdir, readdir, stat, etc.)
- `VersionedVfsProvider` - Extended with Git-style version control (commit, checkout, diff, revert, etc.)

### Classes

- `Vfs<P>` - Base VFS class with file/folder operations and event system
- `VersionedVfs` - VFS with version control methods (extends Vfs)
- `MountedVfsProvider` - Provider that mounts multiple Vfs instances at different paths
- `VfsEventBus` - Event publish/subscribe system
- `VfsPath` - Immutable path object based on segments for safe path manipulation

### Functions

- `createVfs(provider)` - Factory function that returns correct VFS type based on provider
- `isVersionedProvider(provider)` - Type guard for checking version control support
- `isVfsFile(item)` - Type guard for file
- `isVfsFolder(item)` - Type guard for folder

### Path Utilities

String-based path utilities (wrappers around `VfsPath`):

- `normalizePath(path)` - Normalize path
- `joinPaths(...paths)` - Join path segments
- `buildFilePath(folderPath, fileName)` - Build complete file path
- `getFileName(path)` - Extract file name from path
- `getFolderPath(path)` - Extract folder path
- `getParentPath(path)` - Get parent path
- `getFileExtension(path)` - Get file extension
- `getFileBaseName(path)` - Get file name without extension
- `isRootPath(path)` - Check if path is root
- `isSubPath(path, parentPath)` - Check if path is subpath of another (strict)
- `getRelativePath(path, basePath)` - Get relative path

## Events

The `VfsEventBus` supports the following events:

### File Events
- `file:created` - File created (includes `file` and `path`)
- `file:updated` - File updated (includes `file`, `path`, and optional `metadataOnly`)
- `file:deleted` - File deleted (includes `path`)
- `file:moved` - File moved (includes `fromPath`, `toPath`, and `file`)

### Folder Events
- `folder:created` - Folder created (includes `folder` and `path`)
- `folder:updated` - Folder updated (includes `path` and `updates`)
- `folder:deleted` - Folder deleted (includes `path` and `recursive`)
- `folder:moved` - Folder moved (includes `fromPath` and `toPath`)

### Version Control Events
- `version:commit` - Commit created (includes `commit`)
- `version:checkout` - Checked out to a ref (includes `ref`)
- `version:revert` - Reverted to a ref (includes `ref`)

```typescript
// Subscribe to specific event
const unsubscribe = vfs.events.on('file:created', (event) => {
  console.log(`File created: ${event.path}`)
  console.log(`File info:`, event.file)
})

// Subscribe once (auto-unsubscribes after first event)
vfs.events.once('file:deleted', (event) => {
  console.log(`File deleted: ${event.path}`)
})

// Subscribe to all file and folder events
const unsubAll = vfs.events.onAny((event) => {
  console.log(`Event: ${event.type}`)
})

// Manually unsubscribe
unsubscribe()

// Emit custom events (for provider implementations)
vfs.events.emit({
  type: 'file:updated',
  file: fileObject,
  path: '/path/to/file',
  timestamp: Date.now(),
})

// Clear all listeners
vfs.events.clear()
```

## License

MIT
