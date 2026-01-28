/**
 * Tests for serialization (import/export) functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryLevel } from 'memory-level'
import {
  exportQuads,
  importQuads,
  detectFormat,
  exportToJsonl,
  importFromJsonl,
  exportToNQuads,
  importFromNQuads,
  exportToCompactJson,
  importFromCompactJson,
  exportToJson,
  importFromJson,
} from '../src/serialization/index.js'
import { RDFStore } from '../src/store.js'
import type { LevelInstance } from '../src/types.js'
import type { Quad } from '@rdfjs/types'
import { quad, namedNode, literal, blankNode } from './helpers.js'

describe('JSON Lines Format', () => {
  const testQuads: Quad[] = [
    quad('ex:s1', 'ex:p1', 'value1'),
    quad('ex:s2', 'ex:p2', 42),
    quad('ex:s3', 'ex:p3', true),
  ]

  describe('exportToJsonl', () => {
    it('should export quads to JSON Lines format', () => {
      const result = exportToJsonl(testQuads)
      const lines = result.split('\n')
      
      expect(lines).toHaveLength(3)
      const line0 = JSON.parse(lines[0])
      expect(line0[0]).toEqual({ type: 'uri', value: 'ex:s1' })
      expect(line0[1]).toEqual({ type: 'uri', value: 'ex:p1' })
      expect(line0[2].type).toBe('literal')
      expect(line0[2].value).toBe('value1')
      
      const line1 = JSON.parse(lines[1])
      expect(line1[0]).toEqual({ type: 'uri', value: 'ex:s2' })
      expect(line1[2].value).toBe('42')
      
      const line2 = JSON.parse(lines[2])
      expect(line2[0]).toEqual({ type: 'uri', value: 'ex:s3' })
      expect(line2[2].value).toBe('true')
    })

    it('should include metadata when requested', () => {
      const result = exportToJsonl(testQuads, true)
      const lines = result.split('\n')
      
      expect(lines[0].startsWith('#meta:')).toBe(true)
      const meta = JSON.parse(lines[0].slice(6))
      expect(meta.format).toBe('jsonl')
      expect(meta.quadCount).toBe(3)
    })

    it('should handle empty array', () => {
      const result = exportToJsonl([])
      expect(result).toBe('')
    })
  })

  describe('importFromJsonl', () => {
    it('should import from array format', () => {
      const data = '[{"type":"uri","value":"ex:s1"}, {"type":"uri","value":"ex:p1"}, {"type":"literal","value":"v1"}]\n[{"type":"uri","value":"ex:s2"}, {"type":"uri","value":"ex:p2"}, {"type":"literal","value":"42","datatype":"http://www.w3.org/2001/XMLSchema#integer"}]'
      const result = importFromJsonl(data)
      
      expect(result).toHaveLength(2)
      expect(result[0].subject.value).toBe('ex:s1')
      expect(result[0].predicate.value).toBe('ex:p1')
      expect(result[0].object.value).toBe('v1')
      expect(result[1].subject.value).toBe('ex:s2')
      expect(result[1].predicate.value).toBe('ex:p2')
      expect(result[1].object.value).toBe('42')
    })

    it('should import from object format', () => {
      const data = '{"subject": {"type":"uri","value":"ex:s1"}, "predicate": {"type":"uri","value":"ex:p1"}, "object": {"type":"literal","value":"v1"}}'
      const result = importFromJsonl(data)
      
      expect(result).toHaveLength(1)
      expect(result[0].subject.value).toBe('ex:s1')
      expect(result[0].predicate.value).toBe('ex:p1')
      expect(result[0].object.value).toBe('v1')
    })

    it('should skip metadata lines', () => {
      const data = '#meta:{"version":"1.0"}\n[{"type":"uri","value":"ex:s1"}, {"type":"uri","value":"ex:p1"}, {"type":"literal","value":"v1"}]'
      const result = importFromJsonl(data)
      
      expect(result).toHaveLength(1)
    })

    it('should skip invalid lines when skipInvalid is true', () => {
      const data = '[{"type":"uri","value":"ex:s1"}, {"type":"uri","value":"ex:p1"}, {"type":"literal","value":"v1"}]\ninvalid json\n[{"type":"uri","value":"ex:s2"}, {"type":"uri","value":"ex:p2"}, {"type":"literal","value":"v2"}]'
      const result = importFromJsonl(data, true)
      
      expect(result).toHaveLength(2)
    })

    it('should throw on invalid lines by default', () => {
      const data = '[{"type":"uri","value":"ex:s1"}, {"type":"uri","value":"ex:p1"}, {"type":"literal","value":"v1"}]\ninvalid json'
      expect(() => importFromJsonl(data)).toThrow()
    })
  })

  describe('roundtrip', () => {
    it('should roundtrip quads through JSON Lines', () => {
      const exported = exportToJsonl(testQuads)
      const imported = importFromJsonl(exported)
      
      expect(imported).toHaveLength(testQuads.length)
      for (let i = 0; i < testQuads.length; i++) {
        expect(imported[i].subject.value).toBe(testQuads[i].subject.value)
        expect(imported[i].predicate.value).toBe(testQuads[i].predicate.value)
        expect(imported[i].object.value).toBe(testQuads[i].object.value)
      }
    })
  })
})

describe('N-Quads Format', () => {
  const testQuads: Quad[] = [
    quad('http://example.org/s1', 'http://example.org/p1', 'value1'),
    quad('http://example.org/s2', 'http://example.org/count', 42),
    quad('http://example.org/s3', 'http://example.org/active', true),
  ]

  describe('exportToNQuads', () => {
    it('should export to N-Quads format', () => {
      const result = exportToNQuads(testQuads)
      const lines = result.split('\n')
      
      expect(lines).toHaveLength(3)
      expect(lines[0]).toContain('<http://example.org/s1>')
      expect(lines[0]).toContain('<http://example.org/p1>')
      expect(lines[0]).toContain('"value1"')
      expect(lines[0].endsWith(' .')).toBe(true)
    })

    it('should handle numeric values with datatype', () => {
      const result = exportToNQuads([quad('ex:s', 'ex:p', 42)])
      expect(result).toContain('XMLSchema#')
    })

    it('should handle boolean values with datatype', () => {
      const result = exportToNQuads([quad('ex:s', 'ex:p', true)])
      expect(result).toContain('XMLSchema#boolean')
    })

    it('should handle URI objects', () => {
      const result = exportToNQuads([quad('ex:s', 'ex:p', 'http://example.org/value')])
      expect(result).toContain('<http://example.org/value>')
    })

    it('should escape special characters', () => {
      const result = exportToNQuads([quad('ex:s', 'ex:p', 'line1\nline2')])
      expect(result).toContain('\\n')
    })
  })

  describe('importFromNQuads', () => {
    it('should import from N-Quads format', () => {
      const data = '<http://example.org/s1> <http://example.org/p1> "value1" .'
      const result = importFromNQuads(data)
      
      expect(result).toHaveLength(1)
      expect(result[0].subject.value).toBe('http://example.org/s1')
      expect(result[0].predicate.value).toBe('http://example.org/p1')
      expect(result[0].object.value).toBe('value1')
    })

    it('should parse typed literals', () => {
      const data = '<ex:s> <ex:p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .'
      const result = importFromNQuads(data)
      
      expect(result[0].object.value).toBe('42')
      expect(result[0].object.termType).toBe('Literal')
    })

    it('should parse boolean literals', () => {
      const data = '<ex:s> <ex:p> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .'
      const result = importFromNQuads(data)
      
      expect(result[0].object.value).toBe('true')
      expect(result[0].object.termType).toBe('Literal')
    })

    it('should skip comments', () => {
      const data = '# This is a comment\n<ex:s> <ex:p> "value" .'
      const result = importFromNQuads(data)
      
      expect(result).toHaveLength(1)
    })

    it('should handle multiple lines', () => {
      const data = '<ex:s1> <ex:p1> "v1" .\n<ex:s2> <ex:p2> "v2" .'
      const result = importFromNQuads(data)
      
      expect(result).toHaveLength(2)
    })
  })

  describe('roundtrip', () => {
    it('should roundtrip quads through N-Quads', () => {
      const exported = exportToNQuads(testQuads)
      const imported = importFromNQuads(exported)
      
      expect(imported).toHaveLength(testQuads.length)
      for (let i = 0; i < testQuads.length; i++) {
        expect(imported[i].subject.value).toBe(testQuads[i].subject.value)
        expect(imported[i].predicate.value).toBe(testQuads[i].predicate.value)
        expect(imported[i].object.value).toBe(testQuads[i].object.value)
      }
    })
  })
})

describe('Compact JSON Format', () => {
  const testQuads: Quad[] = [
    quad('ex:s1', 'ex:name', 'Alice'),
    quad('ex:s1', 'ex:age', 30),
    quad('ex:s2', 'ex:name', 'Bob'),
  ]

  describe('exportToCompactJson', () => {
    it('should group by subject and predicate', () => {
      const result = exportToCompactJson(testQuads)
      const parsed = JSON.parse(result)
      
      // Keys are direct URI strings
      expect(parsed['ex:s1']['ex:name'].value).toBe('Alice')
      expect(parsed['ex:s1']['ex:age'].value).toBe('30')
      expect(parsed['ex:s2']['ex:name'].value).toBe('Bob')
    })

    it('should use arrays for multiple objects', () => {
      const quads: Quad[] = [
        quad('ex:s1', 'ex:tag', 'a'),
        quad('ex:s1', 'ex:tag', 'b'),
        quad('ex:s1', 'ex:tag', 'c'),
      ]
      const result = exportToCompactJson(quads)
      const parsed = JSON.parse(result)
      
      expect(Array.isArray(parsed['ex:s1']['ex:tag'])).toBe(true)
      expect(parsed['ex:s1']['ex:tag']).toHaveLength(3)
    })

    it('should support pretty printing', () => {
      const result = exportToCompactJson(testQuads, true)
      expect(result).toContain('\n')
    })
  })

  describe('importFromCompactJson', () => {
    it('should expand grouped format', () => {
      const data = '{"ex:s1": {"ex:name": "Alice", "ex:age": 30}}'
      const result = importFromCompactJson(data)
      
      expect(result).toHaveLength(2)
      expect(result.find(t => t.predicate.value === 'ex:name')?.object.value).toBe('Alice')
      expect(result.find(t => t.predicate.value === 'ex:age')?.object.value).toBe('30')
    })

    it('should handle arrays', () => {
      const data = '{"ex:s1": {"ex:tag": ["a", "b", "c"]}}'
      const result = importFromCompactJson(data)
      
      expect(result).toHaveLength(3)
    })
  })

  describe('roundtrip', () => {
    it('should roundtrip through compact JSON', () => {
      const exported = exportToCompactJson(testQuads)
      const imported = importFromCompactJson(exported)
      
      expect(imported).toHaveLength(testQuads.length)
      
      // Check all quads are present (order may differ)
      for (const t of testQuads) {
        const found = imported.find(
          i => i.subject.value === t.subject.value && 
               i.predicate.value === t.predicate.value &&
               i.object.value === t.object.value
        )
        expect(found).toBeDefined()
      }
    })
  })
})

describe('Standard JSON Format', () => {
  const testQuads: Quad[] = [
    quad('ex:s1', 'ex:p1', 'v1'),
    quad('ex:s2', 'ex:p2', 42),
  ]

  describe('exportToJson', () => {
    it('should export as JSON array', () => {
      const result = exportToJson(testQuads)
      const parsed = JSON.parse(result)
      
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(2)
    })

    it('should include metadata when requested', () => {
      const result = exportToJson(testQuads, { includeMetadata: true })
      const parsed = JSON.parse(result)
      
      expect(parsed.meta).toBeDefined()
      expect(parsed.quads).toBeDefined()
      expect(parsed.meta.quadCount).toBe(2)
    })

    it('should pretty print when requested', () => {
      const result = exportToJson(testQuads, { pretty: true })
      expect(result).toContain('\n')
    })
  })

  describe('importFromJson', () => {
    it('should import from array format', () => {
      const data = exportToJson(testQuads)
      const result = importFromJson(data)
      
      expect(result).toHaveLength(2)
      expect(result[0].subject.value).toBe(testQuads[0].subject.value)
    })

    it('should import from format with metadata', () => {
      const data = exportToJson(testQuads, { includeMetadata: true })
      const result = importFromJson(data)
      
      expect(result).toHaveLength(2)
    })

    it('should skip invalid triples when requested', () => {
      const validTriple = { 
        subject: { type: 'uri', value: 'ex:s1' }, 
        predicate: { type: 'uri', value: 'ex:p1' }, 
        object: { type: 'literal', value: 'v1' } 
      }
      const data = JSON.stringify([
        validTriple,
        { invalid: true },
      ])
      const result = importFromJson(data, true)
      
      expect(result).toHaveLength(1)
    })
  })
})

describe('Format Detection', () => {
  it('should detect N-Quads format', () => {
    const data = '<http://example.org/s> <http://example.org/p> "value" .'
    expect(detectFormat(data)).toBe('nquads')
  })

  it('should detect JSON array format', () => {
    const data = '[{"subject":{"type":"uri","value":"ex:s"},"predicate":{"type":"uri","value":"ex:p"},"object":{"type":"literal","value":"v"}}]'
    expect(detectFormat(data)).toBe('json')
  })

  it('should detect compact JSON format', () => {
    const data = '{"ex:s":{"ex:p":"value"}}'
    expect(detectFormat(data)).toBe('compact-json')
  })

  it('should detect JSON with metadata', () => {
    const data = '{"triples":[{"subject":{"type":"uri","value":"ex:s"},"predicate":{"type":"uri","value":"ex:p"},"object":{"type":"literal","value":"v"}}]}'
    expect(detectFormat(data)).toBe('json')
  })

  it('should detect JSON Lines format', () => {
    const data = '#meta:{"version":"1.0"}\n[{"type":"uri","value":"ex:s"},{"type":"uri","value":"ex:p"},{"type":"literal","value":"v"}]'
    expect(detectFormat(data)).toBe('jsonl')
  })
})

describe('Unified Export/Import', () => {
  const testQuads: Quad[] = [
    quad('ex:s1', 'ex:p1', 'v1'),
    quad('ex:s2', 'ex:p2', 42),
  ]

  it('should export and import with auto-detection', () => {
    for (const format of ['jsonl', 'json', 'compact-json'] as const) {
      const exported = exportQuads(testQuads, { format })
      const imported = importQuads(exported)
      
      expect(imported).toHaveLength(testQuads.length)
    }
  })

  it('should respect explicit format option on import', () => {
    const data = exportQuads(testQuads, { format: 'jsonl' })
    const imported = importQuads(data, { format: 'jsonl' })
    
    expect(imported).toHaveLength(2)
  })
})

describe('RDFStore Import/Export Integration', () => {
  let store: RDFStore
  let dbCounter = 0

  beforeEach(async () => {
    const level: LevelInstance = new MemoryLevel({ valueEncoding: 'utf8' })
    dbCounter++
    store = await RDFStore.create({
      quadstoreLevel: level,
      checkpointDbName: `test-serialization-db-${dbCounter}-${Date.now()}`
    })
  })

  afterEach(async () => {
    if (store?.isOpen) {
      await store.close()
    }
  })

  it('should export data from store', async () => {
    await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
    await store.insert(namedNode('ex:s2'), namedNode('ex:p2'), literal('42'))
    
    const exported = await store.exportData({ format: 'jsonl' })
    const lines = exported.split('\n').filter(l => l.trim())
    
    expect(lines).toHaveLength(2)
  })

  it('should import data into store', async () => {
    const data = '[{"type":"uri","value":"ex:s1"},{"type":"uri","value":"ex:p1"},{"type":"literal","value":"v1"}]\n[{"type":"uri","value":"ex:s2"},{"type":"uri","value":"ex:p2"},{"type":"literal","value":"42"}]'
    
    await store.importData(data, { format: 'jsonl' })
    
    const results = await store.query({})
    expect(results).toHaveLength(2)
  })

  it('should replace data with import', async () => {
    await store.insert(namedNode('ex:old'), namedNode('ex:p'), literal('old-value'))
    
    const data = '[{"type":"uri","value":"ex:new"},{"type":"uri","value":"ex:p"},{"type":"literal","value":"new-value"}]'
    await store.replaceWithImport(data, { format: 'jsonl' })
    
    const results = await store.query({})
    expect(results).toHaveLength(1)
    expect(results[0].subject.value).toBe('ex:new')
  })

  it('should export to different formats', async () => {
    await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
    
    const jsonl = await store.exportData({ format: 'jsonl' })
    const json = await store.exportData({ format: 'json' })
    const compact = await store.exportData({ format: 'compact-json' })
    
    // JSONL and JSON use the term JSON serialization
    expect(jsonl).toContain('"value":"ex:s1"')
    expect(json).toContain('"subject"')
    // Compact JSON uses URI strings as keys
    expect(compact).toContain('ex:s1')
  })

  it('should support pretty printing', async () => {
    await store.insert(namedNode('ex:s1'), namedNode('ex:p1'), literal('v1'))
    
    const pretty = await store.exportData({ format: 'json', pretty: true })
    
    expect(pretty).toContain('\n')
  })
})
