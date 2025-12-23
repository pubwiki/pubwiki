# Lua Runner (Rust + mlua -> WASM)

Build a WebAssembly module using mlua (vendored Lua 5.4) with async RDF and file system support.

## Features

- **Lua 5.4 Runtime**: Full-featured Lua VM via mlua
- **Async Executor**: Event-driven async runtime using async-executor
- **RDF Integration**: Async triple store operations via FFI
- **File System**: Async file I/O operations
- **Module Loading**: Support for MediaWiki, HTTP, and in-memory modules
- **Callback Management**: Centralized Promise-based callback system
- **No Polling**: Waker-based async execution

## Prerequisites

- Rust toolchain (`rustup`)
- Emscripten SDK (emsdk) installed and activated
- Rust target `wasm32-unknown-emscripten`

## Build

```sh
# Activate emsdk in your shell first
# Example: source ~/emsdk/emsdk_env.sh

# Add WASM target
rustup target add wasm32-unknown-emscripten

# Build release
cargo build --release --target wasm32-unknown-emscripten
```

Artifacts will be under:
- `target/wasm32-unknown-emscripten/release/lua_runner_wasm.wasm`
- `target/wasm32-unknown-emscripten/release/lua_runner_wasm.js`

These are copied to `../pubwiki-lua/wasm/` by the build script.

## Architecture

### Module Structure

```
src/
├── main.rs         # Entry point, async executor, execution manager
├── callback.rs     # Shared callback management (CallbackManager)
├── rdf.rs          # RDF triple store API (State.*)
├── fs.rs           # File system API (fs.*)
├── print.rs        # Print output collection
├── require.rs      # Module loading (require())
└── tests.rs        # Test suite
```

### Async Execution Flow

```rust
// 1. JavaScript calls lua_run_async()
let execution_id = lua_run_async(code_ptr, context_id);

// 2. Spawn async task in executor
EXECUTOR.spawn(async move {
    run_lua_code_async(execution_id, code, context_id).await
}).detach();

// 3. Lua code calls State.insert() (async)
lua.create_async_function(|lua, (subject, predicate, object)| async move {
    let (callback_id, rx) = register_rdf_callback();
    
    // Call JavaScript via FFI
    js_rdf_insert_async(context_id, subject_ptr, predicate_ptr, object_ptr, callback_id);
    
    // Wait for Promise resolution
    match rx.recv().await {
        Ok(PromiseResult::Success { .. }) => Ok(()),
        Ok(PromiseResult::Error { message }) => Err(LuaError::external(message))
    }
})

// 4. JavaScript resolves Promise
module._lua_rdf_promise_resolve(callbackId, dataPtr, dataLen)

// 5. Waker triggers executor tick
module._lua_executor_tick()

// 6. Execution completes, callback to JavaScript
js_lua_execution_callback(execution_id, result_json_ptr)
```

### Callback Management

Centralized callback system shared between RDF and file system:

```rust
pub struct CallbackManager {
    next_id: AtomicU32,
    callbacks: Mutex<HashMap<u32, Sender<PromiseResult>>>
}

// Register callback, get channel
pub fn register_callback() -> (u32, Receiver<PromiseResult>) {
    let (tx, rx) = async_channel::bounded(1);
    let id = MANAGER.register(tx);
    (id, rx)
}

// Resolve callback from JavaScript
pub fn resolve_callback(id: u32, result: PromiseResult) {
    MANAGER.resolve(id, result);
}
```

## Exported C ABI

### Async Execution

- `lua_run_async(code_ptr: *const c_char, context_id: u32) -> u32`
  - Returns execution ID
  - Spawns async task in executor
  
- `lua_executor_tick() -> i32`
  - Drives async executor
  - Returns 1 if task was executed, 0 otherwise
  
- `lua_has_pending_tasks() -> i32`
  - Returns 1 if pending tasks exist

### RDF Promise Callbacks

- `lua_rdf_promise_resolve(callback_id: u32, data_ptr: *const u8, data_len: usize)`
- `lua_rdf_promise_reject(callback_id: u32, error_ptr: *const c_char)`

### File System Promise Callbacks

- `lua_fs_promise_resolve(callback_id: u32, data_ptr: *const u8, data_len: usize)`
- `lua_fs_promise_reject(callback_id: u32, error_ptr: *const c_char)`

## JavaScript FFI Imports

The WASM module imports these functions from JavaScript:

### RDF Operations

- `js_rdf_insert_async(context_id, subject_ptr, predicate_ptr, object_ptr, callback_id)`
- `js_rdf_delete_async(context_id, subject_ptr, predicate_ptr, object_ptr, callback_id)`
- `js_rdf_query_async(context_id, pattern_ptr, callback_id)`
- `js_rdf_batch_insert_async(context_id, triples_ptr, callback_id)`

### File System Operations

- `js_fs_exists(path_ptr, callback_id)` (asynchronous)
- `js_fs_read_async(path_ptr, callback_id)`
- `js_fs_write_async(path_ptr, content_ptr, callback_id)`
- `js_fs_unlink_async(path_ptr, callback_id)`
- `js_fs_mkdir_async(path_ptr, callback_id)`
- `js_fs_rmdir_async(path_ptr, callback_id)`

### Execution Callback

- `js_lua_execution_callback(execution_id, result_json_ptr)`

## Testing

```sh
cargo test --target wasm32-unknown-emscripten
```

## License

MIT