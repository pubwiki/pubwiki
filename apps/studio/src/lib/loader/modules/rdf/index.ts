/**
 * RDF State Module for Lua
 * 
 * Provides the State API for Lua scripts, allowing RDF triple/quad storage
 * with version control capabilities.
 * 
 * Replaces the Rust-side rdf.rs implementation.
 */

import type { RDFStore, Ref, QuadPattern } from '@pubwiki/rdfstore'
import { LuaTable } from '@pubwiki/lua'
import { DataFactory } from 'n3'

const { namedNode, literal, defaultGraph } = DataFactory

// ============================================================================
// XSD Datatype Constants
// ============================================================================

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer'
const XSD_DOUBLE = 'http://www.w3.org/2001/XMLSchema#double'
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean'
const PUBWIKI_LUAVALUE = 'https://pub.wiki/datatype#luavalue'

// ============================================================================
// Type Conversion: Lua ↔ RDF
// ============================================================================

/**
 * Convert a Lua value to RDF representation
 * @returns [stringValue, datatype]
 */
function luaValueToRdf(value: unknown): [string, string] {
  if (typeof value === 'string') {
    return [value, XSD_STRING]
  }
  
  if (typeof value === 'number') {
    // Check if integer
    if (Number.isInteger(value)) {
      return [String(value), XSD_INTEGER]
    }
    return [String(value), XSD_DOUBLE]
  }
  
  if (typeof value === 'boolean') {
    return [value ? 'true' : 'false', XSD_BOOLEAN]
  }
  
  if (value === null || value === undefined) {
    throw new Error('Cannot insert nil/null value into RDF store')
  }
  
  // Object/Array → JSON stringify
  return [JSON.stringify(value), PUBWIKI_LUAVALUE]
}

/**
 * Convert RDF value back to Lua value based on datatype
 */
function rdfToLuaValue(value: string, datatype: string): unknown {
  switch (datatype) {
    case XSD_STRING:
      return value
    
    case XSD_INTEGER: {
      const n = parseInt(value, 10)
      if (isNaN(n)) throw new Error(`Invalid integer '${value}'`)
      return n
    }
    
    case XSD_DOUBLE: {
      const n = parseFloat(value)
      if (isNaN(n)) throw new Error(`Invalid double '${value}'`)
      return n
    }
    
    case XSD_BOOLEAN:
      return value === 'true'
    
    case PUBWIKI_LUAVALUE: {
      // Parse JSON and wrap in LuaTable for deep conversion to Lua table
      const parsed = JSON.parse(value)
      return parsed
    }
    
    default:
      // Unknown datatype, return as string
      return value
  }
}

// ============================================================================
// State Module Factory
// ============================================================================

/**
 * Create the State module definition for Lua
 * 
 * Methods accept `_self` as first parameter to support Lua's colon syntax:
 * `State:insert(s, p, o)` → `State.insert(State, s, p, o)`
 * 
 * @example
 * ```typescript
 * instance.registerJsModule('State', createStateModule(store), { mode: 'global' })
 * ```
 * 
 * Then in Lua:
 * ```lua
 * State:insert("entity:1", "name", "Alice")
 * local name = State:get("entity:1", "name")
 * State:set("entity:1", "age", 30)
 * ```
 */
export function createStateModule(store: RDFStore) {
  return {
    /**
     * Insert a quad into the store
     * @param _self - Lua self reference (ignored)
     * @param subject - Subject IRI
     * @param predicate - Predicate IRI
     * @param object - Object value (any Lua-compatible type)
     * @param graph - Optional graph IRI
     * @returns New ref after the operation
     */
    async insert(
      _self: unknown,
      subject: string,
      predicate: string,
      object: unknown,
      graph?: string
    ): Promise<Ref> {
      const [objectStr, datatype] = luaValueToRdf(object)
      
      const objectTerm = literal(objectStr, namedNode(datatype))
      const graphTerm = graph ? namedNode(graph) : defaultGraph()
      
      return store.insert(
        namedNode(subject),
        namedNode(predicate),
        objectTerm,
        graphTerm
      )
    },

    /**
     * Delete quads matching the pattern
     * @param _self - Lua self reference (ignored)
     * @param subject - Subject IRI
     * @param predicate - Predicate IRI
     * @param object - Optional object value to match
     * @param graph - Optional graph IRI
     * @returns New ref after the operation
     */
    async delete(
      _self: unknown,
      subject: string,
      predicate: string,
      object?: unknown,
      graph?: string
    ): Promise<Ref> {
      let objectTerm = undefined
      if (object !== undefined && object !== null) {
        const [objectStr, datatype] = luaValueToRdf(object)
        objectTerm = literal(objectStr, namedNode(datatype))
      }
      
      const graphTerm = graph ? namedNode(graph) : undefined
      
      return store.delete(
        namedNode(subject),
        namedNode(predicate),
        objectTerm,
        graphTerm
      )
    },

    /**
     * Query quads matching a pattern
     * @param _self - Lua self reference (ignored)
     * @param pattern - Pattern object with optional subject, predicate, object, graph
     * @returns Array of matching quads wrapped for Lua table conversion
     */
    async match(_self: unknown, pattern: {
      subject?: string
      predicate?: string
      object?: unknown
      graph?: string
    }): Promise<LuaTable<Array<{
      subject: string
      predicate: string
      object: unknown
      graph?: string
    }>>> {
      const queryPattern: QuadPattern = {}
      
      if (pattern.subject) {
        queryPattern.subject = namedNode(pattern.subject)
      }
      if (pattern.predicate) {
        queryPattern.predicate = namedNode(pattern.predicate)
      }
      if (pattern.object !== undefined && pattern.object !== null) {
        const [objectStr, datatype] = luaValueToRdf(pattern.object)
        queryPattern.object = literal(objectStr, namedNode(datatype))
      }
      if (pattern.graph) {
        queryPattern.graph = namedNode(pattern.graph)
      }
      
      const quads = await store.query(queryPattern)
      
      // Convert to Lua-friendly format
      const mapped = quads.map(q => {
        const objectValue = q.object.termType === 'Literal'
          ? rdfToLuaValue(q.object.value, q.object.datatype?.value || XSD_STRING)
          : q.object.value
        
        const quadResult: {
          subject: string
          predicate: string
          object: unknown
          graph?: string
        } = {
          subject: q.subject.value,
          predicate: q.predicate.value,
          object: objectValue
        }
        
        if (q.graph.termType !== 'DefaultGraph') {
          quadResult.graph = q.graph.value
        }
          
        return quadResult
      })
      
      return new LuaTable(mapped)
    },

    /**
     * Get a single value for subject-predicate pair
     * @param _self - Lua self reference (ignored)
     * @param subject - Subject IRI
     * @param predicate - Predicate IRI
     * @param graph - Optional graph IRI
     * @returns The object value, or nil if not found
     */
    async get(
      _self: unknown,
      subject: string,
      predicate: string,
      graph?: string
    ): Promise<unknown> {
      const queryPattern: QuadPattern = {
        subject: namedNode(subject),
        predicate: namedNode(predicate)
      }
      
      if (graph) {
        queryPattern.graph = namedNode(graph)
      }
      
      const quads = await store.query(queryPattern)
      
      if (quads.length === 0) {
        return undefined  // nil in Lua
      }
      
      const first = quads[0]
      if (first.object.termType === 'Literal') {
        return new LuaTable(rdfToLuaValue(first.object.value, first.object.datatype?.value || XSD_STRING))
      }
      return first.object.value
    },

    /**
     * Set a value for subject-predicate pair (delete existing, then insert)
     * If object is nil/undefined, only performs delete
     * @param _self - Lua self reference (ignored)
     * @param subject - Subject IRI
     * @param predicate - Predicate IRI
     * @param object - Object value (nil to just delete)
     * @param graph - Optional graph IRI
     * @returns New ref after the operation
     */
    async set(
      _self: unknown,
      subject: string,
      predicate: string,
      object: unknown,
      graph?: string
    ): Promise<Ref> {
      const graphTerm = graph ? namedNode(graph) : undefined
      
      // First delete all matching quads
      await store.delete(
        namedNode(subject),
        namedNode(predicate),
        undefined,  // match all objects
        graphTerm
      )
      
      // If object is nil/undefined, just return current ref (delete-only semantics)
      if (object === undefined || object === null) {
        return store.currentRef
      }
        
      // Insert new quad
      const [objectStr, datatype] = luaValueToRdf(object)
      const objectTerm = literal(objectStr, namedNode(datatype))
      
      return store.insert(
        namedNode(subject),
        namedNode(predicate),
        objectTerm,
        graphTerm ?? defaultGraph()
      )
    },

    /**
     * Batch insert multiple quads
     * @param _self - Lua self reference (ignored)
     * @param quads - Array of quad objects
     * @returns New ref after the operation
     */
    async batchInsert(_self: unknown, quads: Array<{
      subject: string
      predicate: string
      object: unknown
      graph?: string
    }>): Promise<Ref> {
      if (quads.length === 0) {
        return store.currentRef
      }
      
      const n3Quads = quads.map(q => {
        const [objectStr, datatype] = luaValueToRdf(q.object)
        const objectTerm = literal(objectStr, namedNode(datatype))
        const graphTerm = q.graph ? namedNode(q.graph) : defaultGraph()
        
        return DataFactory.quad(
          namedNode(q.subject),
          namedNode(q.predicate),
          objectTerm,
          graphTerm
        )
      })
      
      return store.batchInsert(n3Quads)
    },

    /**
     * Get current version reference
     * @param _self - Lua self reference (ignored)
     * @returns Current ref
     */
    currentRef(_self?: unknown): Ref {
      return store.currentRef
    },

    /**
     * Checkout to a specific version
     * @param _self - Lua self reference (ignored)
     * @param ref - Version reference to checkout to
     */
    async checkout(_self: unknown, ref: Ref): Promise<void> {
      await store.checkout(ref)
    },

    /**
     * Create a checkpoint at current version
     * @param _self - Lua self reference (ignored)
     * @param title - Optional checkpoint title
     * @param description - Optional checkpoint description
     * @returns Checkpoint info
     */
    async checkpoint(_self: unknown, title?: string, description?: string): Promise<{ id: string; ref: Ref }> {
      const checkpoint = await store.checkpoint({
        title: title || 'Checkpoint',
        description: description || ''
      })
      
      return {
        id: checkpoint.id,
        ref: checkpoint.ref
      }
    },

    /**
     * List all checkpoints, sorted by timestamp descending
     * @param _self - Lua self reference (ignored)
     * @returns Array of checkpoint info wrapped for Lua table conversion
     */
    async listCheckpoints(_self?: unknown): Promise<LuaTable<Array<{
      id: string
      ref: Ref
      title: string
      description?: string
      timestamp: number
      quadCount: number
    }>>> {
      const checkpoints = await store.listCheckpoints()
      return new LuaTable(checkpoints.map(cp => ({
        id: cp.id,
        ref: cp.ref,
        title: cp.title,
        description: cp.description,
        timestamp: cp.timestamp,
        quadCount: cp.quadCount
      })))
    },

    /**
     * Execute a SPARQL query
     * Returns an async iterator that yields binding results
     * @param _self - Lua self reference (ignored)
     * @param sparql - SPARQL query string
     * @returns Async iterator of bindings
     */
    async *query(_self: unknown, sparql: string): AsyncIterableIterator<Record<string, unknown>> {
      for await (const binding of store.sparqlQuery(sparql)) {
        yield binding
      }
    }
  }
}

// Export type conversion utilities for potential reuse
export { luaValueToRdf, rdfToLuaValue }
export { XSD_STRING, XSD_INTEGER, XSD_DOUBLE, XSD_BOOLEAN, PUBWIKI_LUAVALUE }
