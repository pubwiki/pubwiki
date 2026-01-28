/**
 * Import/Export functionality for RDF quads
 * 
 * Supports multiple compact formats:
 * - JSON Lines (JSONL): One quad per line as JSON
 * - N-Quads: Standard RDF serialization format (N-Triples extension)
 * - Compact JSON: Minified JSON array
 */

import { DataFactory } from 'n3'
import type { Quad, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph, NamedNode, Literal, BlankNode, DefaultGraph } from '@rdfjs/types'
// termKey not currently used after compact json simplification
// import { termKey, type GraphTerm } from '../utils/term.js'

const { namedNode, literal, blankNode, defaultGraph, quad } = DataFactory

/** Serializable term types - subset of RDF.js terms we actually use */
type SerializableTerm = NamedNode | Literal | BlankNode | DefaultGraph


// ============ Format Types ============

export type SerializationFormat = 'jsonl' | 'nquads' | 'json' | 'compact-json'

export interface ExportOptions {
  /** Output format */
  format: SerializationFormat
  /** Include metadata header (for jsonl/json) */
  includeMetadata?: boolean
  /** Pretty print (only for json format) */
  pretty?: boolean
}

export interface ImportOptions {
  /** Input format (auto-detected if not specified) */
  format?: SerializationFormat
  /** Skip invalid entries instead of throwing */
  skipInvalid?: boolean
}

export interface ExportMetadata {
  version: string
  format: SerializationFormat
  quadCount: number
  exportedAt: string
}

// ============ Term Serialization ============

/**
 * Serialize a Term to JSON-friendly format
 */
function termToJson(term: SerializableTerm): unknown {
  switch (term.termType) {
    case 'NamedNode':
      return { type: 'uri', value: term.value }
    case 'BlankNode':
      return { type: 'bnode', value: term.value }
    case 'Literal':
      if (term.language) {
        return { type: 'literal', value: term.value, language: term.language }
      }
      return { type: 'literal', value: term.value, datatype: term.datatype.value }
    case 'DefaultGraph':
      return { type: 'defaultGraph' }
    default:
      return { type: 'unknown', value: String(term) }
  }
}

/**
 * Parse JSON to Term (for object position)
 */
function jsonToObject(json: unknown): Quad_Object {
  if (typeof json === 'object' && json !== null && 'type' in json) {
    const obj = json as { type: string; value: string; language?: string; datatype?: string }
    switch (obj.type) {
      case 'uri':
        return namedNode(obj.value)
      case 'bnode':
        return blankNode(obj.value)
      case 'literal':
        if (obj.language) {
          return literal(obj.value, obj.language)
        }
        return literal(obj.value, obj.datatype ? namedNode(obj.datatype) : undefined)
    }
  }
  // Legacy format: plain string
  if (typeof json === 'string') {
    // Check if it looks like a URI
    if (json.startsWith('http://') || json.startsWith('https://') || json.match(/^[a-z]+:/)) {
      return namedNode(json)
    }
    return literal(json)
  }
  // Numbers and booleans as typed literals
  if (typeof json === 'number') {
    return literal(String(json), namedNode('http://www.w3.org/2001/XMLSchema#decimal'))
  }
  if (typeof json === 'boolean') {
    return literal(String(json), namedNode('http://www.w3.org/2001/XMLSchema#boolean'))
  }
  // Complex objects as JSON literals
  return literal(JSON.stringify(json), namedNode('http://www.w3.org/2001/XMLSchema#json'))
}

/**
 * Parse JSON to graph term
 */
function jsonToGraph(json: unknown): Quad_Graph {
  if (json === undefined || json === null) {
    return defaultGraph()
  }
  if (typeof json === 'object' && 'type' in json) {
    const obj = json as { type: string; value?: string }
    if (obj.type === 'defaultGraph') return defaultGraph()
    if (obj.type === 'uri' && obj.value) return namedNode(obj.value)
    if (obj.type === 'bnode' && obj.value) return blankNode(obj.value)
  }
  if (typeof json === 'string') {
    return namedNode(json)
  }
  return defaultGraph()
}

// ============ JSON Lines Format ============

/**
 * Export quads to JSON Lines format (one JSON object per line)
 * Very compact and streamable
 */
export function exportToJsonl(quads: Quad[], includeMetadata = false): string {
  const lines: string[] = []
  
  if (includeMetadata) {
    const meta: ExportMetadata = {
      version: '1.0',
      format: 'jsonl',
      quadCount: quads.length,
      exportedAt: new Date().toISOString(),
    }
    lines.push(`#meta:${JSON.stringify(meta)}`)
  }
  
  for (const q of quads) {
    // Serialize with proper RDF.js type information
    // Only include graph if not default graph
    const arr = [
      termToJson(q.subject as SerializableTerm),
      termToJson(q.predicate as SerializableTerm),
      termToJson(q.object as SerializableTerm)
    ]
    if (q.graph.termType !== 'DefaultGraph') {
      arr.push(termToJson(q.graph as SerializableTerm))
    }
    lines.push(JSON.stringify(arr))
  }
  
  return lines.join('\n')
}

/**
 * Parse subject from JSON (must be NamedNode or BlankNode)
 */
function jsonToSubject(json: unknown): Quad_Subject {
  if (typeof json === 'object' && json !== null && 'type' in json) {
    const obj = json as { type: string; value: string }
    if (obj.type === 'uri') return namedNode(obj.value)
    if (obj.type === 'bnode') return blankNode(obj.value)
  }
  // Legacy: plain string
  if (typeof json === 'string') {
    return namedNode(json)
  }
  throw new Error(`Invalid subject: ${JSON.stringify(json)}`)
}

/**
 * Parse predicate from JSON (must be NamedNode)
 */
function jsonToPredicate(json: unknown): Quad_Predicate {
  if (typeof json === 'object' && json !== null && 'type' in json) {
    const obj = json as { type: string; value: string }
    if (obj.type === 'uri') return namedNode(obj.value)
  }
  // Legacy: plain string
  if (typeof json === 'string') {
    return namedNode(json)
  }
  throw new Error(`Invalid predicate: ${JSON.stringify(json)}`)
}

/**
 * Import quads from JSON Lines format
 */
export function importFromJsonl(data: string, skipInvalid = false): Quad[] {
  const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'))
  const quads: Quad[] = []
  
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (Array.isArray(parsed) && parsed.length >= 3) {
        quads.push(quad(
          jsonToSubject(parsed[0]),
          jsonToPredicate(parsed[1]),
          jsonToObject(parsed[2]),
          parsed[3] !== undefined ? jsonToGraph(parsed[3]) : defaultGraph()
        ))
      } else if (typeof parsed === 'object' && parsed.subject && parsed.predicate) {
        quads.push(quad(
          jsonToSubject(parsed.subject),
          jsonToPredicate(parsed.predicate),
          jsonToObject(parsed.object),
          parsed.graph !== undefined ? jsonToGraph(parsed.graph) : defaultGraph()
        ))
      } else if (!skipInvalid) {
        throw new Error(`Invalid quad format: ${line}`)
      }
    } catch (e) {
      if (!skipInvalid) throw e
    }
  }
  
  return quads
}

// ============ N-Quads Format ============

/**
 * Escape a string for N-Quads format
 */
function escapeNQuads(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Unescape an N-Quads string
 */
function unescapeNQuads(str: string): string {
  return str
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * Convert an object term to N-Quads representation
 */
function objectToNQuads(obj: Quad_Object): string {
  switch (obj.termType) {
    case 'NamedNode':
      return `<${obj.value}>`
    case 'BlankNode':
      return `_:${obj.value}`
    case 'Literal':
      if (obj.language) {
        return `"${escapeNQuads(obj.value)}"@${obj.language}`
      }
      if (obj.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
        return `"${escapeNQuads(obj.value)}"^^<${obj.datatype.value}>`
      }
      return `"${escapeNQuads(obj.value)}"`
  }
  return `"${escapeNQuads(String(obj))}"`
}

/**
 * Export quads to N-Quads format
 */
export function exportToNQuads(quads: Quad[]): string {
  const lines: string[] = []
  
  for (const q of quads) {
    const subject = q.subject.termType === 'BlankNode' 
      ? `_:${q.subject.value}` 
      : `<${q.subject.value}>`
    const predicate = `<${q.predicate.value}>`
    const object = objectToNQuads(q.object)
    
    // Include graph if not default graph
    if (q.graph.termType !== 'DefaultGraph') {
      const graph = q.graph.termType === 'BlankNode'
        ? `_:${q.graph.value}`
        : `<${q.graph.value}>`
      lines.push(`${subject} ${predicate} ${object} ${graph} .`)
    } else {
      lines.push(`${subject} ${predicate} ${object} .`)
    }
  }
  
  return lines.join('\n')
}

/**
 * Import quads from N-Quads format (also accepts N-Triples)
 */
export function importFromNQuads(data: string, skipInvalid = false): Quad[] {
  const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'))
  const quads: Quad[] = []
  
  for (const line of lines) {
    try {
      const parsed = parseNQuadsLine(line.trim())
      if (parsed) {
        quads.push(parsed)
      } else if (!skipInvalid) {
        throw new Error(`Invalid N-Quads line: ${line}`)
      }
    } catch (e) {
      if (!skipInvalid) throw e
    }
  }
  
  return quads
}

/**
 * Parse a single N-Quads line into a Quad
 */
function parseNQuadsLine(line: string): Quad | null {
  // Must end with .
  if (!line.endsWith('.')) return null
  line = line.slice(0, -1).trim()
  
  let pos = 0
  
  // Parse subject (URI or blank node)
  const subject = parseNQuadsTerm(line, pos)
  if (!subject || (subject.term.termType !== 'NamedNode' && subject.term.termType !== 'BlankNode')) {
    return null
  }
  pos = subject.end
  
  // Skip whitespace
  while (pos < line.length && /\s/.test(line[pos])) pos++
  
  // Parse predicate (URI only)
  const predicate = parseNQuadsTerm(line, pos)
  if (!predicate || predicate.term.termType !== 'NamedNode') {
    return null
  }
  pos = predicate.end
  
  // Skip whitespace
  while (pos < line.length && /\s/.test(line[pos])) pos++
  
  // Parse object (URI, blank node, or literal)
  const object = parseNQuadsTerm(line, pos)
  if (!object) {
    return null
  }
  pos = object.end
  
  // Skip whitespace
  while (pos < line.length && /\s/.test(line[pos])) pos++
  
  // Parse optional graph (URI or blank node)
  let graph: Quad_Graph = defaultGraph()
  if (pos < line.length) {
    const graphTerm = parseNQuadsTerm(line, pos)
    if (graphTerm && (graphTerm.term.termType === 'NamedNode' || graphTerm.term.termType === 'BlankNode')) {
      graph = graphTerm.term
    }
  }
  
  return quad(
    subject.term as Quad_Subject,
    predicate.term as Quad_Predicate,
    object.term as Quad_Object,
    graph
  )
}

/**
 * Parse a term from an N-Quads string starting at position
 */
function parseNQuadsTerm(str: string, start: number): { term: Quad_Subject | Quad_Object | Quad_Graph; end: number } | null {
  const ch = str[start]
  
  // URI: <...>
  if (ch === '<') {
    const end = str.indexOf('>', start + 1)
    if (end === -1) return null
    return { term: namedNode(str.slice(start + 1, end)), end: end + 1 }
  }
  
  // Blank node: _:...
  if (str.slice(start, start + 2) === '_:') {
    let end = start + 2
    while (end < str.length && /\S/.test(str[end])) end++
    return { term: blankNode(str.slice(start + 2, end)), end }
  }
  
  // Literal: "..."
  if (ch === '"') {
    let end = start + 1
    // Find closing quote, handling escapes
    while (end < str.length) {
      if (str[end] === '\\' && end + 1 < str.length) {
        end += 2 // Skip escaped char
      } else if (str[end] === '"') {
        break
      } else {
        end++
      }
    }
    if (end >= str.length) return null
    
    const value = unescapeNQuads(str.slice(start + 1, end))
    end++ // Skip closing quote
    
    // Check for datatype ^^<uri>
    if (str.slice(end, end + 2) === '^^') {
      end += 2
      if (str[end] === '<') {
        const dtEnd = str.indexOf('>', end + 1)
        if (dtEnd !== -1) {
          const datatype = str.slice(end + 1, dtEnd)
          return { term: literal(value, namedNode(datatype)), end: dtEnd + 1 }
        }
      }
    }
    
    // Check for language tag @lang
    if (str[end] === '@') {
      end++
      let langEnd = end
      while (langEnd < str.length && /[a-zA-Z0-9-]/.test(str[langEnd])) langEnd++
      return { term: literal(value, str.slice(end, langEnd)), end: langEnd }
    }
    
    return { term: literal(value), end }
  }
  
  return null
}

// ============ Compact JSON Format ============

/**
 * Export to compact JSON format
 * Groups quads by subject, then by predicate
 * Uses URI strings directly as keys for readability
 * Format: { "subject-uri": { "predicate-uri": value-or-array } }
 */
export function exportToCompactJson(quads: Quad[], pretty = false): string {
  // Group by subject
  const bySubject = new Map<string, Map<string, unknown[]>>()
  
  for (const q of quads) {
    // Use subject value directly as key
    const subjectKey = q.subject.termType === 'BlankNode' 
      ? `_:${q.subject.value}` 
      : q.subject.value
    
    if (!bySubject.has(subjectKey)) {
      bySubject.set(subjectKey, new Map())
    }
    const predicates = bySubject.get(subjectKey)!
    
    const predicateKey = q.predicate.value
    if (!predicates.has(predicateKey)) {
      predicates.set(predicateKey, [])
    }
    predicates.get(predicateKey)!.push(termToJson(q.object as SerializableTerm))
  }
  
  // Convert to compact structure
  const compact: Record<string, Record<string, unknown | unknown[]>> = {}
  for (const [subject, predicates] of bySubject) {
    compact[subject] = {}
    for (const [predicate, objects] of predicates) {
      // If single object, don't use array
      compact[subject][predicate] = objects.length === 1 ? objects[0] : objects
    }
  }
  
  return pretty ? JSON.stringify(compact, null, 2) : JSON.stringify(compact)
}

/**
 * Import from compact JSON format
 * Supports both legacy termKey format and new URI format
 */
export function importFromCompactJson(data: string): Quad[] {
  const parsed = JSON.parse(data)
  const quads: Quad[] = []
  
  // Check if it's the grouped format
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [subjectKey, predicates] of Object.entries(parsed)) {
      if (typeof predicates === 'object' && predicates !== null) {
        // Parse subject - support both URI strings and blank nodes
        const subject = subjectKey.startsWith('_:')
          ? blankNode(subjectKey.slice(2))
          : namedNode(subjectKey)
        
        for (const [predicateKey, objects] of Object.entries(predicates as Record<string, unknown>)) {
          const predicate = namedNode(predicateKey)
          const objectArray = Array.isArray(objects) ? objects : [objects]
          for (const object of objectArray) {
            quads.push(quad(
              subject, 
              predicate, 
              jsonToObject(object),
              defaultGraph()
            ))
          }
        }
      }
    }
  }
  
  return quads
}

// ============ Standard JSON Array Format ============

/**
 * Serialized quad format for JSON export
 */
interface SerializedQuad {
  subject: unknown
  predicate: unknown
  object: unknown
  graph?: unknown
}

/**
 * Export to standard JSON array format
 */
export function exportToJson(quads: Quad[], options: { pretty?: boolean; includeMetadata?: boolean } = {}): string {
  // Serialize quads with proper Term information
  const serialized: SerializedQuad[] = quads.map(q => {
    const result: SerializedQuad = {
      subject: termToJson(q.subject as SerializableTerm),
      predicate: termToJson(q.predicate as SerializableTerm),
      object: termToJson(q.object as SerializableTerm),
    }
    // Only include graph if not default graph
    if (q.graph.termType !== 'DefaultGraph') {
      result.graph = termToJson(q.graph as SerializableTerm)
    }
    return result
  })
  
  if (options.includeMetadata) {
    const data = {
      meta: {
        version: '1.0',
        format: 'json',
        quadCount: quads.length,
        exportedAt: new Date().toISOString(),
      },
      quads: serialized,
    }
    return options.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  }
  
  return options.pretty ? JSON.stringify(serialized, null, 2) : JSON.stringify(serialized)
}

/**
 * Import from standard JSON format
 */
export function importFromJson(data: string, skipInvalid = false): Quad[] {
  const parsed = JSON.parse(data)
  
  // Check if it's wrapped with metadata
  const items = Array.isArray(parsed) ? parsed : (parsed.quads || parsed.triples)
  
  if (!Array.isArray(items)) {
    throw new Error('Invalid JSON format: expected array of quads')
  }
  
  const result: Quad[] = []
  for (const item of items) {
    try {
      if (typeof item === 'object' && item.subject && item.predicate) {
        result.push(quad(
          jsonToSubject(item.subject),
          jsonToPredicate(item.predicate),
          jsonToObject(item.object),
          item.graph !== undefined ? jsonToGraph(item.graph) : defaultGraph()
        ))
      } else if (!skipInvalid) {
        throw new Error(`Invalid quad: ${JSON.stringify(item)}`)
      }
    } catch (e) {
      if (!skipInvalid) throw e
    }
  }
  
  return result
}

// ============ Unified Export/Import ============

/**
 * Detect format from data content
 */
export function detectFormat(data: string): SerializationFormat {
  const trimmed = data.trim()
  
  // N-Quads/N-Triples: lines start with <
  if (trimmed.startsWith('<') && trimmed.includes('> <')) {
    return 'nquads'
  }
  
  // JSON array or object
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        // Check if it's array of arrays (jsonl style) or objects
        if (parsed.length > 0 && Array.isArray(parsed[0])) {
          return 'jsonl'
        }
        return 'json'
      }
      // Object: check if it has quads/triples key (json with meta) or is compact format
      if ('quads' in parsed || 'triples' in parsed) {
        return 'json'
      }
      return 'compact-json'
    } catch {
      // Not valid JSON
    }
  }
  
  // JSON Lines: multiple lines, each is JSON
  if (trimmed.includes('\n')) {
    const firstLine = trimmed.split('\n')[0].trim()
    if (firstLine.startsWith('[') || firstLine.startsWith('{') || firstLine.startsWith('#meta:')) {
      return 'jsonl'
    }
  }
  
  return 'json' // default
}

/**
 * Export quads to specified format
 */
export function exportQuads(quads: Quad[], options: ExportOptions): string {
  switch (options.format) {
    case 'jsonl':
      return exportToJsonl(quads, options.includeMetadata)
    case 'nquads':
      return exportToNQuads(quads)
    case 'compact-json':
      return exportToCompactJson(quads, options.pretty)
    case 'json':
    default:
      return exportToJson(quads, { pretty: options.pretty, includeMetadata: options.includeMetadata })
  }
}

/**
 * Import quads from data with format auto-detection
 */
export function importQuads(data: string, options: ImportOptions = {}): Quad[] {
  const format = options.format || detectFormat(data)
  const skipInvalid = options.skipInvalid ?? false
  
  switch (format) {
    case 'jsonl':
      return importFromJsonl(data, skipInvalid)
    case 'nquads':
      return importFromNQuads(data, skipInvalid)
    case 'compact-json':
      return importFromCompactJson(data)
    case 'json':
    default:
      return importFromJson(data, skipInvalid)
  }
}
