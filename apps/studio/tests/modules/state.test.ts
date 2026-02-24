/**
 * RDF State Module Tests
 * 
 * Tests for the State JS module that provides RDF storage capabilities to Lua.
 * These tests verify the integration between the Lua runtime and RDF store.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadRunner, createLuaInstance, type LuaInstance } from '@pubwiki/lua'
import { RDFStore } from '@pubwiki/rdfstore'
import { MemoryLevel } from 'memory-level'
import { DataFactory } from 'n3'
import { createStateModule } from '$lib/loader/modules/rdf'
import { createJsonModule } from '$lib/loader/modules/json'

const { namedNode, literal } = DataFactory

// Counter for generating unique database names
let dbCounter = 0

// Helper function: create a new in-memory RDFStore
async function createMemoryStore(): Promise<RDFStore> {
  const level = new MemoryLevel()
  const checkpointDbName = `test-checkpoint-db-${Date.now()}-${dbCounter++}`
  return RDFStore.create({
    quadstoreLevel: level,
    checkpointDbName
  })
}

// Helper function: query by strings (for test assertions)
async function queryByStrings(
  store: RDFStore, 
  pattern: { subject?: string; predicate?: string; object?: string; graph?: string }
): Promise<{ subject: string; predicate: string; object: string; graph: string }[]> {
  const quads = await store.query({
    subject: pattern.subject ? namedNode(pattern.subject) : undefined,
    predicate: pattern.predicate ? namedNode(pattern.predicate) : undefined,
    object: pattern.object ? literal(pattern.object) : undefined,
    graph: pattern.graph ? namedNode(pattern.graph) : undefined,
  })
  return quads.map(q => ({
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    graph: q.graph.value,
  }))
}

describe('State Module (RDF)', () => {
  let store: RDFStore
  let instance: LuaInstance

  beforeAll(async () => {
    // Load WASM module
    await loadRunner()
    console.log('WASM module loaded successfully')
  })

  beforeEach(async () => {
    store = await createMemoryStore()
    instance = createLuaInstance()
    
    // Register the State module
    instance.registerJsModule('State', createStateModule(store), { mode: 'global' })
    
    // Register the json module  
    instance.registerJsModule('json', createJsonModule(), { mode: 'global' })
  })

  afterEach(async () => {
    instance.destroy()
    if (store.isOpen) {
      await store.close()
    }
  })

  describe('State:insert', () => {
    it('should insert a quad', async () => {
      await instance.run(`
        State:insert('book:1984', 'title', '1984')
      `)
      
      const results = await queryByStrings(store, { predicate: 'title' })
      expect(results).toHaveLength(1)
      expect(results[0].subject).toBe('book:1984')
      expect(results[0].object).toBe('1984')
    })

    it('should insert multiple quads', async () => {
      await instance.run(`
        State:insert('book:1984', 'title', '1984')
        State:insert('book:1984', 'author', 'George Orwell')
        State:insert('book:1984', 'year', 1949)
      `)

      const results = await queryByStrings(store, { subject: 'book:1984' })
      expect(results).toHaveLength(3)
    })

    it('should insert with graph parameter', async () => {
      await instance.run(`
        State:insert('book:1984', 'title', '1984', 'graph:books')
      `)
      
      const results = await queryByStrings(store, { graph: 'graph:books' })
      expect(results).toHaveLength(1)
    })
  })

  describe('State:match', () => {
    it('should query by subject', async () => {
      await instance.run(`
        State:insert('book:1984', 'title', '1984')
        State:insert('book:1984', 'author', 'George Orwell')
        State:insert('book:brave', 'title', 'Brave New World')
      `)

      const result = await instance.run(`
        local results = State:match({subject = 'book:1984'})
        return #results
      `)

      expect(result.result).toBe(2)
    })

    it('should query by predicate', async () => {
      await instance.run(`
        State:insert('book:1984', 'title', '1984')
        State:insert('book:brave', 'title', 'Brave New World')
      `)

      const result = await instance.run(`
        local results = State:match({predicate = 'title'})
        return #results
      `)

      expect(result.result).toBe(2)
    })

    it('should query by object', async () => {
      await instance.run(`
        State:insert('book:1984', 'genre', 'dystopian')
        State:insert('book:brave', 'genre', 'dystopian')
        State:insert('book:lotr', 'genre', 'fantasy')
      `)

      const result = await instance.run(`
        local results = State:match({object = 'dystopian'})
        return #results
      `)

      expect(result.result).toBe(2)
    })
  })

  describe('State:delete', () => {
    it('should delete a specific quad', async () => {
      await instance.run(`
        State:insert('user:alice', 'age', 25)
        State:delete('user:alice', 'age', 25)
      `)

      const results = await queryByStrings(store, { subject: 'user:alice' })
      expect(results).toHaveLength(0)
    })

    it('should delete all quads with subject+predicate', async () => {
      await instance.run(`
        State:insert('user:alice', 'hobby', 'reading')
        State:insert('user:alice', 'hobby', 'coding')
        State:delete('user:alice', 'hobby')
      `)

      const results = await queryByStrings(store, { subject: 'user:alice' })
      expect(results).toHaveLength(0)
    })
  })

  describe('State:batchInsert', () => {
    it('should insert multiple quads at once', async () => {
      await instance.run(`
        local books = {
          {subject = 'book:1', predicate = 'title', object = 'Book 1'},
          {subject = 'book:2', predicate = 'title', object = 'Book 2'},
          {subject = 'book:3', predicate = 'title', object = 'Book 3'},
        }
        State:batchInsert(books)
      `)

      const results = await queryByStrings(store, { predicate: 'title' })
      expect(results).toHaveLength(3)
    })

    it('should support graph in batch insert', async () => {
      await instance.run(`
        local books = {
          {subject = 'book:1', predicate = 'title', object = 'Book 1', graph = 'graph:test'},
          {subject = 'book:2', predicate = 'title', object = 'Book 2', graph = 'graph:test'},
        }
        State:batchInsert(books)
      `)

      const results = await queryByStrings(store, { graph: 'graph:test' })
      expect(results).toHaveLength(2)
    })
  })

  describe('State:set', () => {
    it('should replace existing value', async () => {
      await instance.run(`
        State:insert('user:alice', 'age', 25)
        State:set('user:alice', 'age', 30)
      `)

      const results = await queryByStrings(store, { subject: 'user:alice', predicate: 'age' })
      expect(results).toHaveLength(1)
      expect(results[0].object).toBe('30')
    })

    it('should work like insert when no previous value', async () => {
      await instance.run(`
        State:set('user:alice', 'city', 'Tokyo')
      `)

      const results = await queryByStrings(store, { subject: 'user:alice', predicate: 'city' })
      expect(results).toHaveLength(1)
      expect(results[0].object).toBe('Tokyo')
    })

    it('should preserve table/object type when set and get', async () => {
      const result = await instance.run(`
        local o = {test = 123, v = "456"}
        local typeBefore = type(o)
        State:set("a", ":b", o)
        local r = State:get("a", ":b")
        local typeAfter = type(r)
        return {
          typeBefore = typeBefore,
          typeAfter = typeAfter,
          originalValue = o,
          retrievedValue = r
        }
      `)

      expect(result.error).toBeNull()
      expect(result.result.typeBefore).toBe('table')
      expect(result.result.typeAfter).toBe('table')
      expect(result.result.retrievedValue.test).toBe(123)
      expect(result.result.retrievedValue.v).toBe('456')
    })

    it('should delete value when object is nil', async () => {
      await instance.run(`
        State:insert('user:bob', 'email', 'bob@example.com')
      `)

      const beforeResults = await queryByStrings(store, { subject: 'user:bob', predicate: 'email' })
      expect(beforeResults).toHaveLength(1)

      await instance.run(`
        State:set('user:bob', 'email', nil)
      `)

      const afterResults = await queryByStrings(store, { subject: 'user:bob', predicate: 'email' })
      expect(afterResults).toHaveLength(0)
    })

    it('should delete all values for predicate when object is nil', async () => {
      await instance.run(`
        State:insert('user:carol', 'tag', 'developer')
        State:insert('user:carol', 'tag', 'designer')
        State:insert('user:carol', 'tag', 'manager')
      `)

      const beforeResults = await queryByStrings(store, { subject: 'user:carol', predicate: 'tag' })
      expect(beforeResults).toHaveLength(3)

      await instance.run(`
        State:set('user:carol', 'tag', nil)
      `)

      const afterResults = await queryByStrings(store, { subject: 'user:carol', predicate: 'tag' })
      expect(afterResults).toHaveLength(0)
    })

    it('should return nil from get after set with nil', async () => {
      await instance.run(`
        State:set('user:dave', 'status', 'active')
      `)

      const result1 = await instance.run(`
        return State:get('user:dave', 'status')
      `)
      expect(result1.result).toBe('active')

      await instance.run(`
        State:set('user:dave', 'status', nil)
      `)

      const result2 = await instance.run(`
        return State:get('user:dave', 'status')
      `)
      expect(result2.result).toBeNull()
    })
  })

  describe('State:get', () => {
    it('should get a single value', async () => {
      await instance.run(`
        State:insert('user:alice', 'name', 'Alice')
      `)

      const result = await instance.run(`
        local name = State:get('user:alice', 'name')
        return name
      `)

      expect(result.result).toBe('Alice')
    })

    it('should return nil for non-existent property', async () => {
      const result = await instance.run(`
        local value = State:get('user:alice', 'nonexistent')
        if value == nil then
          return 'is nil'
        else
          return 'not nil'
        end
      `)

      expect(result.result).toBe('is nil')
    })

    it('should work with default values', async () => {
      const result = await instance.run(`
        local city = State:get('user:alice', 'city') or 'Unknown'
        return city
      `)

      expect(result.result).toBe('Unknown')
    })
  })

  describe('Version Control', () => {
    it('should create checkpoint and return id', async () => {
      await instance.run(`
        State:insert('user:alice', 'name', 'Alice')
      `)

      const result = await instance.run(`
        return State:checkpoint()
      `)

      expect(typeof result.result).toBe('string')
      expect(result.result.length).toBeGreaterThan(0)
    })
  })

  describe('Complex scenarios', () => {
    it('should handle book catalog example', async () => {
      const result = await instance.run(`
        -- Insert books
        State:batchInsert({
          {subject = 'book:1984', predicate = 'title', object = '1984'},
          {subject = 'book:1984', predicate = 'author', object = 'George Orwell'},
          {subject = 'book:1984', predicate = 'year', object = 1949},
          {subject = 'book:1984', predicate = 'genre', object = 'dystopian'},
          {subject = 'book:brave', predicate = 'title', object = 'Brave New World'},
          {subject = 'book:brave', predicate = 'author', object = 'Aldous Huxley'},
          {subject = 'book:brave', predicate = 'year', object = 1932},
          {subject = 'book:brave', predicate = 'genre', object = 'dystopian'},
        })
        
        -- Query dystopian books
        local dystopian = State:match({predicate = 'genre', object = 'dystopian'})
        local count = #dystopian
        
        -- Get titles
        local titles = {}
        for i, triple in ipairs(dystopian) do
          local title = State:get(triple.subject, 'title')
          table.insert(titles, title)
        end
        
        return string.format('Found %d dystopian books: %s', count, table.concat(titles, ', '))
      `)

      expect(result.result).toContain('Found 2 dystopian books')
      expect(result.result).toContain('1984')
      expect(result.result).toContain('Brave New World')
    })
  })
})

describe('RDF state persistence', () => {
  let store: RDFStore
  let instance: LuaInstance

  beforeAll(async () => {
    await loadRunner()
  })

  beforeEach(async () => {
    store = await createMemoryStore()
    instance = createLuaInstance()
    instance.registerJsModule('State', createStateModule(store), { mode: 'global' })
  })

  afterEach(async () => {
    instance.destroy()
    if (store.isOpen) {
      await store.close()
    }
  })

  it('should preserve RDF data in instance', async () => {
    await instance.run(`
      State:insert("http://example.org/person1", "http://xmlns.com/foaf/0.1/name", "Alice")
      State:insert("http://example.org/person1", "http://xmlns.com/foaf/0.1/age", 30)
    `)

    const result = await instance.run(`
      local results = State:match({ subject = "http://example.org/person1" })
      return #results
    `)
    expect(result.result).toBe(2)
  })
})
