# @pubwiki/bundler

Frontend bundler library using esbuild-wasm with Virtual File System support.

## Features

- 🚀 **esbuild-wasm** - Fast TypeScript/JSX compilation in the browser
- 📁 **VFS Integration** - Works with `@pubwiki/vfs` virtual file system
- 🔄 **Web Worker** - Non-blocking bundling in a separate thread
- 📦 **NPM Support** - Automatic CDN resolution for npm packages (esm.sh, unpkg, jsdelivr)
- 🔗 **Dependency Tracking** - Automatic file watching and cache invalidation
- ⚡ **Incremental Builds** - Fast rebuilds with intelligent caching
- 🔍 **Project Detection** - Auto-detect project structure from tsconfig.json

## Installation

```bash
pnpm add @pubwiki/bundler
```

## Usage

### Basic Setup

```typescript
import { createBundler } from '@pubwiki/bundler'
import { Vfs } from '@pubwiki/vfs'

// Create VFS instance with your provider
const vfs = new Vfs(myProvider)
await vfs.initialize()

// Create bundler with worker URL
const bundler = await createBundler({
  vfs,
  workerUrl: new URL('./worker/index.js', import.meta.url)
})

// Build a project
const result = await bundler.build({
  tsconfigPath: '/project/tsconfig.json',
  options: {
    minify: true,
    sourcemap: 'inline',
    target: 'es2020'
  }
})

if (result.success) {
  // Access compiled outputs
  for (const [path, output] of result.outputs) {
    console.log(`Built: ${path}`, output.code)
  }
}
```

### Direct Entry Build

Build specific entry files without tsconfig.json:

```typescript
const result = await bundler.buildEntries({
  projectRoot: '/project',
  entryFiles: ['/project/src/main.tsx', '/project/src/worker.ts'],
  options: {
    minify: false,
    target: 'esnext'
  }
})
```

### File Watching

```typescript
// Setup automatic rebuilds on file changes
const unwatch = bundler.watch({
  tsconfigPath: '/project/tsconfig.json',
  onRebuild: (result) => {
    console.log('Rebuild complete:', result.success)
  },
  onFileChange: (path) => {
    console.log('File changed:', path)
  }
})

// Stop watching
unwatch()
```

### Build Progress Events

```typescript
// Subscribe to build progress
const unsubscribe = bundler.onBuildProgress((event) => {
  switch (event.type) {
    case 'start':
      console.log('Build starting:', event.path)
      break
    case 'complete':
      console.log('Build complete:', event.result?.success)
      break
    case 'error':
      console.error('Build error:', event.error)
      break
  }
})

// Unsubscribe
unsubscribe()
```

### Cache Management

```typescript
// Invalidate a specific file
await bundler.invalidate('/project/src/app.tsx')

// Invalidate all cached data
await bundler.invalidateAll()

// Get dependency graph
const depGraph = await bundler.getDependencyGraph()

// Get last build output
const lastBuild = await bundler.getLastBuildOutput('/project')
```

### Project Detection Utilities

```typescript
import { 
  detectProject, 
  findTsConfig, 
  getEntryFilesFromTsConfig 
} from '@pubwiki/bundler'

// Find tsconfig.json from a file path
const tsconfigPath = await findTsConfig('/project/src/app.tsx', vfsProxy)

// Detect full project configuration
const project = await detectProject('/project/src/app.tsx', vfsProxy)
if (project) {
  console.log('Project root:', project.projectRoot)
  console.log('Entry files:', project.entryFiles)
  console.log('Is buildable:', project.isBuildable)
}

// Get entry files from tsconfig
const entries = await getEntryFilesFromTsConfig('/project/tsconfig.json', vfsProxy)
```

### Custom VFS Proxy

If you're not using `@pubwiki/vfs`, you can provide a custom VFS proxy:

```typescript
import { createBundler, type IVFSProxy } from '@pubwiki/bundler'

const customVfsProxy: IVFSProxy = {
  readFile: async (path) => { /* return file content or null */ },
  fileExists: async (path) => { /* return boolean */ },
  listDir: async (path) => { /* return string[] of names */ },
  getMimeType: (path) => { /* return MIME type string */ },
  watchFiles: (paths, callback) => { /* return unsubscribe function */ }
}

const bundler = await createBundler({ 
  vfsProxy: customVfsProxy,
  workerUrl: new URL('./worker/index.js', import.meta.url)
})
```

## API Reference

### Factory Function

#### `createBundler(options): Promise<BundlerService>`

Create and initialize a new bundler instance.

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `vfs` | `Vfs` | VFS instance from `@pubwiki/vfs` |
| `vfsProxy` | `IVFSProxy` | Custom VFS proxy (alternative to `vfs`) |
| `workerUrl` | `string \| URL` | **Required.** URL to the bundler worker |
| `wasmUrl` | `string` | Custom esbuild WASM URL |

### BundlerService

#### Methods

| Method | Description |
|--------|-------------|
| `build(request)` | Build a project from tsconfig.json |
| `buildEntries(request)` | Build specific entry files directly |
| `watch(options)` | Setup file watching for auto-rebuilds |
| `invalidate(path)` | Invalidate cache for a specific file |
| `invalidateAll()` | Clear all caches and stop watching |
| `getDependencyGraph()` | Get the dependency graph |
| `getLastBuildOutput(projectRoot)` | Get cached build result |
| `onBuildProgress(callback)` | Subscribe to build progress events |
| `isReady()` | Check if service is initialized |
| `terminate()` | Cleanup and terminate the worker |

### Types

```typescript
interface BundleOptions {
  minify?: boolean
  sourcemap?: boolean | 'inline' | 'external'
  target?: string
  format?: 'esm' | 'cjs' | 'iife'
  external?: string[]
  define?: Record<string, string>
  jsx?: 'transform' | 'preserve' | 'automatic'
  jsxImportSource?: string
  treeShaking?: boolean
}

interface BundleRequest {
  tsconfigPath: string
  options?: BundleOptions
}

interface DirectBuildRequest {
  projectRoot: string
  entryFiles: string[]
  options?: BundleOptions
}

interface ProjectBuildResult {
  success: boolean
  outputs: Map<string, FileBuildResult>
  dependencies: string[]
}

interface FileBuildResult {
  success: boolean
  code?: string
  css?: string
  map?: string
  errors: BuildError[]
  warnings?: BuildWarning[]
  dependencies?: string[]
}

interface BuildError {
  file: string
  line: number
  column: number
  message: string
  snippet?: string
}

interface WatchOptions {
  tsconfigPath: string
  onRebuild?: (result: ProjectBuildResult) => void
  onFileChange?: (path: string) => void
}

interface BuildProgressEvent {
  type: 'start' | 'complete' | 'error'
  path: string
  message?: string
  result?: ProjectBuildResult
  error?: Error
}

interface IVFSProxy {
  readFile(path: string): Promise<string | null>
  fileExists(path: string): Promise<boolean>
  listDir(path: string): Promise<string[]>
  getMimeType(path: string): string
  watchFiles(paths: string[], callback: (path: string) => void): () => void
}

interface ProjectConfig {
  tsconfigPath: string
  projectRoot: string | null
  entryFiles: string[]
  isBuildable: boolean
  tsconfigContent: TsConfigContent | null
}
```

### Utility Functions

```typescript
// Path utilities
normalizePath(basePath: string, relativePath: string): string
normalizeAbsolutePath(path: string): string
joinPath(...segments: string[]): string
getDirectory(filePath: string): string
getParentDirectory(dirPath: string): string | null
getFilename(path: string): string
getExtension(path: string): string
isAbsolutePath(path: string): boolean
stripJsonComments(json: string): string

// MIME type
getMimeType(path: string): string

// Error pages
createBuildErrorPage(path: string, errors: BuildError[]): string
createSimpleErrorPage(message: string): string

// Project detection
findTsConfig(filePath: string, vfsProxy: IVFSProxy): Promise<string | null>
detectProject(filePath: string, vfsProxy: IVFSProxy): Promise<ProjectConfig | null>
getEntryFilesFromTsConfig(tsconfigPath: string, vfsProxy: IVFSProxy): Promise<string[]>
isEntryFile(filePath: string, projectConfig: ProjectConfig): boolean
getDefaultEntryFile(projectConfig: ProjectConfig): string | null
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Thread                               │
│  ┌────────────────────┐      Comlink       ┌─────────────────┐  │
│  │   BundlerService   │◄──────────────────►│  BundlerWorker  │  │
│  │                    │                     │                 │  │
│  │  - build()         │  (VFS Proxy)       │ - ESBuildEngine │  │
│  │  - buildEntries()  │─────────────────►  │ - DepResolver   │  │
│  │  - watch()         │                     │ - BundleCache   │  │
│  │  - invalidate()    │                     │                 │  │
│  └────────────────────┘                     └─────────────────┘  │
│            │                                                     │
│            │ @pubwiki/vfs                                        │
│            ▼                                                     │
│  ┌────────────────────┐                                          │
│  │       Vfs          │                                          │
│  │   (VfsProvider)    │                                          │
│  └────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Worker Components

- **ESBuildEngine**: Core esbuild-wasm integration for TypeScript/JSX compilation
- **DependencyResolver**: Resolves imports (relative, absolute, npm packages, HTTP URLs)
- **BundleCache**: IndexedDB + memory cache for transform results and HTTP content

### NPM Package Resolution

NPM packages are resolved through CDN with fallback chain:
1. esm.sh (with `?bundle` for tree-shaking)
2. unpkg
3. jsdelivr

React and other singleton libraries are marked as external to prevent duplication.

## License

MIT
