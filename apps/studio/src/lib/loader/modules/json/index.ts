/**
 * JSON Module for Lua
 * 
 * Provides json.encode() and json.decode() functions that can be registered
 * with a Lua instance via registerJsModule.
 * 
 * Replaces the Rust-side json.rs implementation.
 */

/**
 * JSON null singleton - used to represent null values in Lua
 * Since Lua's nil cannot be stored in tables, we use this special object
 */
const JSON_NULL = Object.freeze({
  __json_null__: true,
  toString: () => 'null'
})

/**
 * Custom replacer for JSON.stringify that handles JSON_NULL
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === JSON_NULL) {
    return null
  }
  return value
}

/**
 * Custom reviver for JSON.parse that can optionally convert null to JSON_NULL
 * Note: By default, null stays as null (becomes nil in Lua)
 */
function jsonReviver(_key: string, value: unknown): unknown {
  // null in JSON becomes null in JS, which becomes nil in Lua
  // This is the expected behavior for most cases
  return value
}

/**
 * Encode a Lua value to JSON string
 * 
 * @param value - The value to encode (can be any Lua-compatible type)
 * @returns JSON string
 * @throws Error if value cannot be serialized (e.g., functions)
 */
function encode(value: unknown): string {
  if (value === undefined) {
    return 'null'
  }
  
  try {
    return JSON.stringify(value, jsonReplacer)
  } catch (error) {
    throw new Error(`JSON encode error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Decode a JSON string to a Lua value
 * 
 * @param jsonStr - The JSON string to decode
 * @returns Parsed value
 * @throws Error if JSON is invalid
 */
function decode(jsonStr: string): unknown {
  try {
    return JSON.parse(jsonStr, jsonReviver)
  } catch (error) {
    throw new Error(`JSON decode error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Create the JSON module definition for Lua
 * 
 * @example
 * ```typescript
 * instance.registerJsModule('json', createJsonModule(), { mode: 'global' })
 * ```
 * 
 * Then in Lua:
 * ```lua
 * local str = json.encode({ name = "Alice", age = 30 })
 * local obj = json.decode('{"x": 1, "y": 2}')
 * ```
 */
export function createJsonModule() {
  return {
    encode,
    decode,
    null: JSON_NULL
  }
}

export { JSON_NULL }
