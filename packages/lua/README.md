# pubwiki-lua

A TypeScript library that wraps an Emscripten-compiled Lua 5.4 runtime with async RDF triple store integration, file system support, and JavaScript interop.

## Features

- **Lua 5.4 Runtime**: Full-featured Lua VM compiled to WebAssembly
- **Async RDF State API**: Built-in triple store for semantic data management with full async support
- **Async File System API**: Pluggable async filesystem for file I/O operations
- **JavaScript Interop**: Pass JS objects/functions to Lua via JsProxy, register JS modules
- **Persistent Instances**: Create long-lived Lua instances that preserve state between runs
- **Relative Path Require**: Support `./` and `../` relative path imports in Lua modules
- **Pluggable Storage**: Integrate with any async RDF store (Quadstore, N3.js, custom backends)
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Event-Driven**: Waker-based async runtime with no polling

## Installation

```sh
npm install @pubwiki/lua
```

### WASM File Handling

The package includes WebAssembly files that need to be accessible at runtime. Here are the recommended ways to handle them:

#### Option 1: Vite (Recommended)

Vite can handle both the glue JS and WASM files automatically:

```ts
import { loadRunner } from '@pubwiki/lua'
import glueUrl from '@pubwiki/lua/wasm/lua_runner_glue.js?url'

await loadRunner(glueUrl)
```

**Important**: Make sure both `lua_runner_glue.js` and `lua_runner_wasm.wasm` are in the same directory. Vite will:
- Copy both files to the output directory during build
- Resolve the `.wasm` file relative to the `.js` file automatically

If the WASM file is in a different location, pass it explicitly:

```ts
import glueUrl from '@pubwiki/lua/wasm/lua_runner_glue.js?url'
import wasmUrl from '@pubwiki/lua/wasm/lua_runner_wasm.wasm?url'

await loadRunner(glueUrl, wasmUrl)
```

#### Option 2: Webpack 5+

```ts
import { loadRunner } from '@pubwiki/lua'

const glueUrl = new URL('@pubwiki/lua/wasm/lua_runner_glue.js', import.meta.url).href
const wasmUrl = new URL('@pubwiki/lua/wasm/lua_runner_wasm.wasm', import.meta.url).href

await loadRunner(glueUrl, wasmUrl)
```

#### Option 3: Copy to Public Directory

Copy both WASM files to your public/static directory during build:

```bash
# Copy files during build
cp node_modules/@pubwiki/lua/wasm/* public/wasm/
```

```ts
import { loadRunner } from '@pubwiki/lua'

await loadRunner('/wasm/lua_runner_glue.js', '/wasm/lua_runner_wasm.wasm')
```

#### Option 4: CDN

```ts
import { loadRunner } from '@pubwiki/lua'

await loadRunner(
  'https://unpkg.com/@pubwiki/lua/wasm/lua_runner_glue.js',
  'https://unpkg.com/@pubwiki/lua/wasm/lua_runner_wasm.wasm'
)
```

## Quick Start

```ts
import { loadRunner, createLuaInstance } from '@pubwiki/lua'
import glueUrl from '@pubwiki/lua/wasm/lua_runner_glue.js?url'
import { QuadstoreRDFStore } from './your-rdf-store'

// Initialize the Lua runtime
await loadRunner(glueUrl)

// Create an async RDF store instance
const store = await QuadstoreRDFStore.create()

// Create a persistent Lua instance
const lua = createLuaInstance({ rdfStore: store })

// Run Lua code with RDF state access
const result = await lua.run(`
  -- Insert RDF triples (async operations)
  State:insert('user:alice', 'name', 'Alice')
  State:insert('user:alice', 'age', 30)
  State:insert('user:alice', 'city', 'Tokyo')
  
  -- Query triples (async)
  local user_data = State:match({subject = 'user:alice'})
  
  print('Alice has ' .. #user_data .. ' properties')
  for i, triple in ipairs(user_data) do
    print(triple.predicate .. ': ' .. tostring(triple.object))
  end
  
  return { count = #user_data, status = 'ok' }
`)

// Access structured result
console.log(result.result)  // { count: 3, status: 'ok' }
console.log(result.output)  // "Alice has 3 properties\nname: Alice\n..."
console.log(result.error)   // null

// Cleanup
lua.destroy()
```

## API Reference

### createLuaInstance(options): LuaInstance

Create a persistent Lua instance that preserves state between runs.

```typescript
interface LuaInstanceOptions {
  rdfStore?: RDFStore           // RDF storage implementation
  vfs?: Vfs<VfsProvider>        // Virtual file system
  workingDirectory?: string     // Working directory for require (default: "/")
}

interface LuaInstance {
  readonly id: number
  run(code: string, args?: Record<string, unknown>): Promise<LuaExecutionResult>
  registerJsModule(name: string, module: JsModuleDefinition): void
  destroy(): void
}
```

**Example**:
```typescript
const lua = createLuaInstance({ rdfStore: store })

// State persists between runs
await lua.run('counter = 0')
await lua.run('counter = counter + 1')
const result = await lua.run('return counter')
console.log(result.result)  // 2

lua.destroy()
```

### runLua(code, options): Promise&lt;LuaExecutionResult&gt;

Execute Lua code in a one-shot instance (no state persistence).

```typescript
interface RunLuaOptions {
  rdfStore?: RDFStore
  vfs?: Vfs<VfsProvider>
  workingDirectory?: string
}

const result = await runLua(`
  State:insert('book:1984', 'title', '1984')
  return { success = true }
`, { rdfStore: store })
```

### LuaExecutionResult

```typescript
interface LuaExecutionResult {
  result: any           // Lua return value (parsed to JavaScript)
  output: string        // Combined output from print() and io.write()
  error: string | null  // Error message if execution failed
}
```

## Passing JavaScript Arguments to Lua

You can pass JavaScript values to Lua code via the `args` parameter. These are exposed as **JsProxy** userdata objects in Lua.

### Basic Types

```typescript
const result = await lua.run(`
  return name .. " is " .. tostring(age) .. " years old"
`, { name: 'Alice', age: 25 })
// result.result = "Alice is 25 years old"
```

### Objects and Arrays

```typescript
// Access nested objects
const result = await lua.run(`
  return user.address.city
`, { user: { address: { city: 'Tokyo' } } })

// Iterate arrays (1-based indexing, Lua style)
const result = await lua.run(`
  local sum = 0
  for i = 1, #numbers do
    sum = sum + numbers[i]
  end
  return sum
`, { numbers: [1, 2, 3, 4, 5] })
// result.result = 15
```

### Calling JavaScript Functions

```typescript
// Sync functions
const result = await lua.run(`
  return add(10, 20)
`, { add: (a: number, b: number) => a + b })

// Async functions (automatically awaited)
const result = await lua.run(`
  local data = fetchData()
  return data.message
`, { 
  fetchData: async () => {
    const res = await fetch('/api/data')
    return res.json()
  }
})
```

### Modifying JsProxy Objects

Changes to JsProxy objects are reflected in the original JavaScript objects:

```typescript
const obj = { count: 0 }
await lua.run(`
  data.count = 42
  data.newField = "added"
`, { data: obj })

console.log(obj.count)     // 42
console.log(obj.newField)  // "added"
```

### JsProxy Helper Methods

```lua
-- Type checking
local t = obj:typeof()       -- "object", "function", "number", etc.
local isArr = arr:isArray()  -- true if JS Array

-- Serialization
local jsonStr = obj:toJSON() -- JSON string

-- null/undefined checks
local isNull = obj:isNull()
local isUndef = obj:isUndefined()

-- Iteration (pairs works on objects)
for k, v in pairs(obj) do
  print(k, v)
end

-- ipairs works on arrays (1-based)
for i, v in ipairs(arr) do
  print(i, v)
end
```

## JavaScript Module Registration

Register JavaScript modules that Lua can `require`:

```typescript
const lua = createLuaInstance({ rdfStore: store })

// Register a module
lua.registerJsModule('myAPI', {
  add: (a: number, b: number) => a + b,
  fetchUser: async (id: number) => {
    const res = await fetch(`/api/users/${id}`)
    return res.json()
  },
  // Async generators become Lua iterators
  streamData: async function* () {
    yield { name: 'item1' }
    yield { name: 'item2' }
  }
})

// Use in Lua
const result = await lua.run(`
  local api = require("myAPI")
  
  -- Call sync function
  local sum = api.add(1, 2)
  
  -- Call async function (automatically awaited)
  local user = api.fetchUser(123)
  
  -- Iterate async generator
  for item in api.streamData() do
    print(item.name)
  end
  
  return sum
`)
```

## Iterating in Lua with Callbacks

Since JavaScript functions can be passed to Lua, you can iterate Lua data using callbacks:

```typescript
const lua = createLuaInstance({ rdfStore: store })

// Iterate ipairs via callback
const items: any[] = []
await lua.run(`
  for index, value in ipairs({10, 20, 30, 40, 50}) do
    callback(index, value)
  end
`, { callback: (index: number, value: number) => items.push({ index, value }) })

// Iterate pairs via callback
const pairs: any[] = []
await lua.run(`
  for key, value in pairs({ name = "Alice", age = 25 }) do
    callback(key, value)
  end
`, { callback: (key: string, value: any) => pairs.push({ key, value }) })

// Early termination using callback return value
const limited: number[] = []
await lua.run(`
  for i, v in ipairs({1, 2, 3, 4, 5, 6, 7, 8, 9, 10}) do
    local shouldContinue = callback(v)
    if not shouldContinue then break end
  end
`, { callback: (value: number) => {
  limited.push(value)
  return value < 5  -- continue while value < 5
}})
// limited = [1, 2, 3, 4, 5]
```

## RDF State API

The Lua `State` object provides methods for working with RDF triples. **All operations are asynchronous** but appear synchronous in Lua code.

> **Note**: Use `:` (colon) for method calls, e.g., `State:insert(...)`.

### State:insert(subject, predicate, object)

Insert a single triple into the store.

```lua
State:insert('book:1984', 'title', '1984')
State:insert('book:1984', 'author', 'George Orwell')
State:insert('book:1984', 'year', 1949)
```

### State:delete(subject, predicate, object?)

Delete triples matching the pattern. If `object` is omitted, deletes all triples with matching subject and predicate.

```lua
-- Delete a specific triple
State:delete('book:1984', 'year', 1949)

-- Delete all triples with subject + predicate
State:delete('book:1984', 'genre')
```

### State:match(pattern)

Query triples matching a pattern. Omit fields to match any value.

```lua
-- Find all properties of a subject
local book_data = State:match({subject = 'book:1984'})

-- Find all subjects with a predicate
local books = State:match({predicate = 'title'})

-- Find by predicate and object
local dystopian = State:match({
  predicate = 'genre',
  object = 'dystopian'
})

for i, triple in ipairs(dystopian) do
  print(triple.subject, triple.predicate, triple.object)
end
```

### State:batchInsert(triples)

Insert multiple triples at once for better performance.

```lua
State:batchInsert({
  {subject = 'product:p1', predicate = 'name', object = 'Laptop'},
  {subject = 'product:p1', predicate = 'price', object = 999},
  {subject = 'product:p2', predicate = 'name', object = 'Mouse'},
})
```

### State:set(subject, predicate, object)

Replace all values for a subject+predicate pair. Equivalent to delete then insert.

```lua
State:insert('user:alice', 'age', 25)
State:set('user:alice', 'age', 26)  -- Replaces 25 with 26
```

### State:get(subject, predicate)

Get a single value for a subject+predicate pair. Returns `nil` if not found.

```lua
local name = State:get('user:alice', 'name')
local city = State:get('user:alice', 'city') or 'Unknown'
```

## JSON Module

Built-in JSON encoding/decoding:

```lua
-- Encode Lua values to JSON
local jsonStr = json.encode({name = "Alice", age = 25})
-- '{"name":"Alice","age":25}'

-- Encode JsProxy objects
local jsonStr = json.encode(jsObject)

-- Decode JSON to Lua tables
local data = json.decode('{"items": [1, 2, 3]}')
print(data.items[1])  -- 1
```

## File System API

The Lua `fs` object provides file system operations. Requires a VFS instance.

```typescript
import { createVfs, MemoryVfsProvider } from '@pubwiki/vfs'

const vfs = createVfs(new MemoryVfsProvider())
const lua = createLuaInstance({ vfs })
```

### fs.stat(path)

Get file or directory status. Returns `(stat, error)`.

```lua
local stat, err = fs.stat('/myfile.txt')
if err then
  print('Error: ' .. err)
else
  print('Size: ' .. stat.size)
  print('Is directory: ' .. tostring(stat.isDirectory))
end
```

### fs.readdir(path)

List directory contents. Returns `(entries, error)`.

```lua
local entries, err = fs.readdir('/mydir')
for _, entry in ipairs(entries) do
  print(entry.name, entry.isDirectory and '[DIR]' or entry.size)
end
```

### Working Directory

Relative paths are resolved from the working directory:

```typescript
const lua = createLuaInstance({ 
  vfs, 
  workingDirectory: '/project/src' 
})

await lua.run(`
  local stat, err = fs.stat('./config.json')  -- /project/src/config.json
`)
```

## RDFStore Interface

To use pubwiki-lua with RDF features, provide an RDFStore implementation:

```typescript
interface RDFStore {
  insert(subject: string, predicate: string, object: any): Promise<void>
  delete(subject: string, predicate: string, object?: any): Promise<void>
  query(pattern: TriplePattern): Promise<Triple[]>
  batchInsert?(triples: Triple[]): Promise<void>
}

interface Triple {
  subject: string
  predicate: string
  object: any
}

interface TriplePattern {
  subject?: string | null
  predicate?: string | null
  object?: any | null
}
```

### Example: In-Memory Store

```typescript
class MemoryRDFStore implements RDFStore {
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
      if (pattern.object !== undefined && 
          JSON.stringify(t.object) !== JSON.stringify(pattern.object)) return false
      return true
    })
  }

  async batchInsert(triples: Triple[]): Promise<void> {
    this.triples.push(...triples)
  }
}
```

## Building Locally

```sh
pnpm install
pnpm run build
```

## License

MIT
