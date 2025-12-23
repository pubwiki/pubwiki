# pubwiki-lua

A TypeScript library that wraps an Emscripten-compiled Lua 5.4 runtime with async RDF triple store integration and file system support.

## Features

- **Lua 5.4 Runtime**: Full-featured Lua VM compiled to WebAssembly
- **Async RDF State API**: Built-in triple store for semantic data management with full async support
- **Async File System API**: Pluggable async filesystem for file I/O operations (see [FILESYSTEM_API.md](../FILESYSTEM_API.md))
- **Relative Path Require**: Support `./` and `../` relative path imports in Lua modules
- **Pluggable Storage**: Integrate with any async RDF store (Quadstore, N3.js, custom backends)
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Event-Driven**: Waker-based async runtime with no polling

## Installation

```sh
npm install @pubwiki/pubwiki-lua
```

### WASM File Handling

The package includes WebAssembly files that need to be accessible at runtime. Here are the recommended ways to handle them:

#### Option 1: Vite (Recommended)

Vite can handle both the glue JS and WASM files automatically:

```ts
import { loadRunner } from '@pubwiki/pubwiki-lua'
import glueUrl from '@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js?url'

await loadRunner(glueUrl)
```

**Important**: Make sure both `lua_runner_glue.js` and `lua_runner_wasm.wasm` are in the same directory. Vite will:
- Copy both files to the output directory during build
- Resolve the `.wasm` file relative to the `.js` file automatically

If the WASM file is in a different location, pass it explicitly:

```ts
import glueUrl from '@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js?url'
import wasmUrl from '@pubwiki/pubwiki-lua/wasm/lua_runner_wasm.wasm?url'

await loadRunner(glueUrl, wasmUrl)
```

#### Option 2: Webpack 5+

```ts
import { loadRunner } from '@pubwiki/pubwiki-lua'

const glueUrl = new URL('@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js', import.meta.url).href
const wasmUrl = new URL('@pubwiki/pubwiki-lua/wasm/lua_runner_wasm.wasm', import.meta.url).href

await loadRunner(glueUrl, wasmUrl)
```

#### Option 3: Copy to Public Directory

Copy both WASM files to your public/static directory during build:

```bash
# Copy files during build
cp node_modules/@pubwiki/pubwiki-lua/wasm/* public/wasm/
```

```ts
import { loadRunner } from '@pubwiki/pubwiki-lua'

await loadRunner('/wasm/lua_runner_glue.js', '/wasm/lua_runner_wasm.wasm')
```

#### Option 4: CDN

```ts
import { loadRunner } from '@pubwiki/pubwiki-lua'

await loadRunner(
  'https://unpkg.com/@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js',
  'https://unpkg.com/@pubwiki/pubwiki-lua/wasm/lua_runner_wasm.wasm'
)
```

## Quick Start

```ts
import { loadRunner, runLua } from '@pubwiki/pubwiki-lua'
import glueUrl from '@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js?url'
import { QuadstoreRDFStore } from './your-rdf-store'

// Initialize the Lua runtime with explicit WASM path
await loadRunner(glueUrl)

// Create an async RDF store instance
const store = await QuadstoreRDFStore.create()

// Run Lua code with RDF state access
const result = await runLua(`
  -- Insert RDF triples (async operations)
  State.insert('user:alice', 'name', 'Alice')
  State.insert('user:alice', 'age', 30)
  State.insert('user:alice', 'city', 'Tokyo')
  
  -- Query triples (async)
  local user_data = State.query({subject = 'user:alice'})
  
  print('Alice has ' .. #user_data .. ' properties')
  for i, triple in ipairs(user_data) do
    print(triple.predicate .. ': ' .. tostring(triple.object))
  end
  
  return { count = #user_data, status = 'ok' }
`, store)

// Access structured result
console.log(result.result)  // { count: 3, status: 'ok' }
console.log(result.output)  // "Alice has 3 properties\nname: Alice\n..."
console.log(result.error)   // null
```

## API Reference

### runLua(code: string, store: RDFStore): Promise<LuaExecutionResult>

Execute Lua code with the given RDF store.

**Returns**: `LuaExecutionResult` object containing:
- `result: any` - Lua return value (parsed to JavaScript)
- `output: string` - Combined output from `print()` and `io.write()`
- `error: string | null` - Error message if execution failed

```typescript
const result = await runLua(`
  print('Processing...')
  State.insert('book:1984', 'title', '1984')
  return { success: true }
`, store)

console.log(result.result)  // { success: true }
console.log(result.output)  // "Processing..."
console.log(result.error)   // null
```

## RDF State API

The Lua `State` object provides methods for working with RDF triples. **All operations are asynchronous** but appear synchronous in Lua code.

### State.insert(subject, predicate, object)

Insert a single triple into the store (async).

```lua
State.insert('book:1984', 'title', '1984')
State.insert('book:1984', 'author', 'George Orwell')
State.insert('book:1984', 'year', 1949)
State.insert('book:1984', 'genre', 'dystopian')
```

### State.delete(subject, predicate, object?)

Delete triples matching the pattern (async). If `object` is omitted, deletes all triples with matching subject and predicate.

```lua
-- Delete a specific triple
State.delete('book:1984', 'year', 1949)

-- Delete all triples with subject + predicate
State.delete('book:1984', 'genre')
```

### State.query(pattern)

Query triples matching a pattern (async). Omit fields to match any value.

```lua
-- Find all books (any subject with 'title' predicate)
local books = State.query({predicate = 'title'})

-- Find all properties of a specific book
local book_data = State.query({subject = 'book:1984'})

-- Find books of a specific genre
local dystopian = State.query({
  predicate = 'genre',
  object = 'dystopian'
})

-- Get book titles from results
for i, triple in ipairs(dystopian) do
  local titles = State.query({
    subject = triple.subject,
    predicate = 'title'
  })
  if #titles > 0 then
    print(titles[1].object)
  end
end
```

### State.batchInsert(triples)

Insert multiple triples at once for better performance (async).

```lua
local products = {
  {subject = 'product:p1', predicate = 'name', object = 'Laptop'},
  {subject = 'product:p1', predicate = 'price', object = 999},
  {subject = 'product:p2', predicate = 'name', object = 'Mouse'},
  {subject = 'product:p2', predicate = 'price', object = 29},
}

State.batchInsert(products)
```

### State.set(subject, predicate, object)

Replace all values for a subject+predicate pair (async). Equivalent to delete then insert.

```lua
-- Initial value
State.insert('user:alice', 'age', 25)

-- Update (deletes old value, inserts new)
State.set('user:alice', 'age', 26)
```

### State.get(subject, predicate)

Get a single value for a subject+predicate pair (async). Returns the object value or `nil`.

```lua
local name = State.get('user:alice', 'name')
if name then
  print('Name: ' .. name)
else
  print('Name not found')
end

-- With default value
local city = State.get('user:alice', 'city') or 'Unknown'
```

## RDFStore Interface

To use pubwiki-lua, you need to provide an **async RDFStore** implementation.

### Interface

```typescript
export interface RDFStore {
  insert(subject: string, predicate: string, object: any): Promise<void>
  delete(subject: string, predicate: string, object?: any): Promise<void>
  query(pattern: TriplePattern): Promise<Triple[]>
  batchInsert?(triples: Triple[]): Promise<void>
}

export interface Triple {
  subject: string
  predicate: string
  object: any
}

export interface TriplePattern {
  subject?: string | null
  predicate?: string | null
  object?: any | null
}
```

### Example: Quadstore Backend

```typescript
import { Quadstore } from 'quadstore'
import { BrowserLevel } from 'browser-level'
import { DataFactory } from 'n3'
import type { RDFStore, Triple, TriplePattern } from 'pubwiki-lua'

export class QuadstoreRDFStore implements RDFStore {
  private store: Quadstore
  
  static async create(): Promise<QuadstoreRDFStore> {
    const backend = new BrowserLevel('my-rdf-db')
    const store = new Quadstore({ backend, dataFactory: DataFactory })
    await store.open()
    return new QuadstoreRDFStore(store)
  }
  
  private constructor(store: Quadstore) {
    this.store = store
  }
  
  async insert(subject: string, predicate: string, object: any): Promise<void> {
    const quad = this.tripleToQuad({ subject, predicate, object })
    await this.store.put(quad)
  }
  
  async delete(subject: string, predicate: string, object?: any): Promise<void> {
    const pattern = this.createPattern(subject, predicate, object)
    await this.store.deleteMatches(pattern.subject, pattern.predicate, pattern.object, pattern.graph)
  }
  
  async query(pattern: TriplePattern): Promise<Triple[]> {
    const stream = this.store.match(
      pattern.subject ? this.toTerm(pattern.subject) : null,
      pattern.predicate ? this.toTerm(pattern.predicate) : null,
      pattern.object !== undefined ? this.toTerm(pattern.object) : null
    )
    
    const results: Triple[] = []
    for await (const quad of stream) {
      results.push(this.quadToTriple(quad))
    }
    return results
  }
  
  async batchInsert(triples: Triple[]): Promise<void> {
    const quads = triples.map(t => this.tripleToQuad(t))
    await this.store.multiPut(quads)
  }
  
  // Helper methods...
}
```

### Example: In-Memory Store (for testing)

```typescript
export class MemoryRDFStore implements RDFStore {
  private triples: Triple[] = []

  async insert(subject: string, predicate: string, object: any): Promise<void> {
    this.triples.push({ subject, predicate, object })
  }

  async delete(subject: string, predicate: string, object?: any): Promise<void> {
    this.triples = this.triples.filter(t => {
      if (t.subject !== subject || t.predicate !== predicate) return true
      if (object === undefined) return false
      return JSON.stringify(t.object) !== JSON.stringify(object)
    })
  }

  async query(pattern: TriplePattern): Promise<Triple[]> {
    return this.triples.filter(t => {
      if (pattern.subject && t.subject !== pattern.subject) return false
      if (pattern.predicate && t.predicate !== pattern.predicate) return false
      if (pattern.object !== undefined && JSON.stringify(t.object) !== JSON.stringify(pattern.object)) return false
      return true
    })
  }

  async batchInsert(triples: Triple[]): Promise<void> {
    this.triples.push(...triples)
  }
}
```

## Module Loading (require)

Load Lua modules from the virtual file system with support for relative paths.

### Relative Path Require

Modules can use relative paths (`./` and `../`) to require other modules relative to the current file's location:

```lua
-- File: /utils/math/calc.lua
-- Load sibling module
local advanced = require("./advanced")  -- loads /utils/math/advanced.lua

-- File: /lib/core.lua
-- Load from parent directory
local helper = require("../utils/helper")  -- loads /utils/helper.lua
```

This enables modular project structures:

```
/project
├── main.lua              -- require("./utils/helper")
├── utils/
│   ├── helper.lua        -- require("./math/calc")
│   └── math/
│       ├── calc.lua      -- require("./advanced")
│       └── advanced.lua
└── lib/
    └── core.lua          -- require("../utils/helper")
```

**Note**: Relative paths are resolved based on the source file's directory. When running code directly (not from a file), the working directory is used as the base.

### File System Modules

Load modules from the virtual file system:

```lua
-- Absolute path (traditional Lua style with dots)
local mylib = require("utils.helper")  -- loads /utils/helper.lua

-- Absolute path with slashes
local mylib = require("/utils/helper")  -- loads /utils/helper.lua
```

## Advanced Configuration

### Bundler-Specific Configuration

#### Vite Configuration

Vite handles WASM files automatically with the `?url` suffix. No additional configuration needed:

```ts
import glueUrl from '@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js?url'
await loadRunner(glueUrl)
```

#### Webpack Configuration

For Webpack 5+, use `new URL()` with `import.meta.url`:

```ts
await loadRunner(
  new URL('@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js', import.meta.url).href
)
```

For older Webpack versions, you may need to configure `file-loader`:

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      }
    ]
  }
}
```

#### Next.js Configuration

```js
// next.config.js
module.exports = {
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    }
    return config
  }
}
```

Then use:

```ts
await loadRunner('/wasm/lua_runner_glue.js')
```

And copy WASM files to your `public/wasm/` directory.

### Custom WASM Path

If you need to host WASM files on a CDN or custom location:

```ts
import { loadRunner } from 'pubwiki-lua'

await loadRunner('/cdn/path/to/lua_runner_glue.js')
```

### File System Integration

Register a file system implementation for `fs.*` API access in Lua:

```ts
import { setFileSystem, type FileSystem } from 'pubwiki-lua'

class OPFSFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    // Read from OPFS
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    // Write to OPFS
  }
  
  exists(path: string): boolean {
    // Sync check
  }
  
  // ... implement other methods
}

const fs = new OPFSFileSystem()
await fs.initialize()
setFileSystem(fs)

// Now Lua can use fs.read(), fs.write(), etc.
await runLua(`
  fs.write('/config.json', '{"version": 1}')
  local data = fs.read('/config.json')
  print(data)
`, store)
```

See [FILESYSTEM_API.md](../FILESYSTEM_API.md) for complete file system API documentation.

## Architecture

### Async-First Design

All I/O operations (RDF, file system) are fully asynchronous:

- **No sync adapters**: Direct async RDFStore interface
- **Event-driven**: Async operations trigger executor automatically via wakers
- **No polling**: Waker-based async runtime
- **Promise-based**: JavaScript Promises bridge to Rust async/await

### Execution Flow

```
JavaScript           WASM Bridge              Rust
──────────          ────────────             ──────

runLua() ──────▶ _lua_run_async() ──▶ Spawn async task
                                            │
                                            ▼
                                      Lua VM executes
                                            │
                    ┌───────────────────────┼──────────────────┐
                    │                       │                  │
                    ▼                       ▼                  ▼
            State.insert()           State.query()       fs.read()
                    │                       │                  │
                    ▼                       ▼                  ▼
        js_rdf_insert_async()   js_rdf_query_async()  js_fs_read_async()
                    │                       │                  │
                    ▼                       ▼                  ▼
            store.insert()            store.query()    fileSystem.readFile()
                    │                       │                  │
                    └───────────────────────┴──────────────────┘
                                            │
                                            ▼
                              _lua_*_promise_resolve()
                                            │
                                            ▼
                              _lua_executor_tick() (waker)
                                            │
                                            ▼
                                    Resume Lua execution
                                            │
                                            ▼
                          js_lua_execution_callback()
                                            │
runLua() resolves ◀─────────────────────────┘
with LuaExecutionResult
```

### Why Async?

1. **Browser Compatibility**: IndexedDB and OPFS are inherently async
2. **Non-Blocking**: Large operations don't freeze the UI
3. **Performance**: True async I/O without blocking the event loop
4. **Consistency**: Same API for all storage backends

Despite being async in JavaScript/Rust, Lua code **looks synchronous**:

```lua
-- This looks synchronous but is async under the hood
State.insert('user:1', 'name', 'Alice')
local users = State.query({predicate = 'name'})
print(users[1].object)  -- "Alice"
```

## Building Locally

```sh
pnpm install
pnpm run build
```

The build emits ESM JavaScript and type declarations into `dist/`.

## TypeScript API

```ts
// Core functions
export function loadRunner(customGluePath?: string, customWasmPath?: string): Promise<void>
export function runLua(code: string, store: RDFStore): Promise<LuaExecutionResult>

// File system
export function setFileSystem(fs: FileSystem | null): void

// Module management
export function uploadFileModule(name: string, content: string): void
export function clearModuleCache(): void

// Types
export interface RDFStore {
  insert(subject: string, predicate: string, object: any): Promise<void>
  delete(subject: string, predicate: string, object?: any): Promise<void>
  query(pattern: TriplePattern): Promise<Triple[]>
  batchInsert?(triples: Triple[]): Promise<void>
}

export interface LuaExecutionResult {
  result: any           // Lua return value (parsed to JavaScript)
  output: string        // Combined output from print() and io.write()
  error: string | null  // Error message if execution failed
}

export interface FileSystem {
  readFile(path: string): Promise<string | Uint8Array>
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  deleteFile(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  rmdir(path: string): Promise<void>
}
```

export interface Triple {
  subject: string
  predicate: string
  object: any
}

export interface TriplePattern {
  subject?: string | null
  predicate?: string | null
  object?: any | null
}
```

## License

MIT

