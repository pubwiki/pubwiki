/**
 * Import/Export functionality for RDF triples
 * 
 * Supports multiple compact formats:
 * - JSON Lines (JSONL): One triple per line as JSON
 * - N-Triples: Standard RDF serialization format
 * - Compact JSON: Minified JSON array
 */

import { DataFactory } from 'n3'
import type { Triple, Operation, ObjectNode } from '../types.js'
import { termKey } from '../utils/term.js'

const { namedNode, literal, blankNode } = DataFactory

// ============ Format Types ============

export type SerializationFormat = 'jsonl' | 'ntriples' | 'json' | 'compact-json'

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
  tripleCount: number
  exportedAt: string
}

// ============ Term Serialization ============

/**
 * Serialize a Term to JSON-friendly format
 */
function termToJson(term: Triple['subject'] | Triple['predicate'] | Triple['object']): unknown {
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
    default:
      return { type: 'unknown', value: String(term) }
  }
}

/**
 * Parse JSON to Term
 */
function jsonToTerm(json: unknown): ObjectNode {
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

// ============ JSON Lines Format ============

/**
 * Export triples to JSON Lines format (one JSON object per line)
 * Very compact and streamable
 */
export function exportToJsonl(triples: Triple[], includeMetadata = false): string {
  const lines: string[] = []
  
  if (includeMetadata) {
    const meta: ExportMetadata = {
      version: '1.0',
      format: 'jsonl',
      tripleCount: triples.length,
      exportedAt: new Date().toISOString(),
    }
    lines.push(`#meta:${JSON.stringify(meta)}`)
  }
  
  for (const triple of triples) {
    // Serialize with proper RDF.js type information
    lines.push(JSON.stringify([
      termToJson(triple.subject),
      termToJson(triple.predicate),
      termToJson(triple.object)
    ]))
  }
  
  return lines.join('\n')
}

/**
 * Parse subject from JSON (must be NamedNode or BlankNode)
 */
function jsonToSubject(json: unknown): Triple['subject'] {
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
function jsonToPredicate(json: unknown): Triple['predicate'] {
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
 * Import triples from JSON Lines format
 */
export function importFromJsonl(data: string, skipInvalid = false): Triple[] {
  const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'))
  const triples: Triple[] = []
  
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (Array.isArray(parsed) && parsed.length >= 3) {
        triples.push({
          subject: jsonToSubject(parsed[0]),
          predicate: jsonToPredicate(parsed[1]),
          object: jsonToTerm(parsed[2]),
        })
      } else if (typeof parsed === 'object' && parsed.subject && parsed.predicate) {
        triples.push({
          subject: jsonToSubject(parsed.subject),
          predicate: jsonToPredicate(parsed.predicate),
          object: jsonToTerm(parsed.object),
        })
      } else if (!skipInvalid) {
        throw new Error(`Invalid triple format: ${line}`)
      }
    } catch (e) {
      if (!skipInvalid) throw e
    }
  }
  
  return triples
}

// ============ N-Triples Format ============

/**
 * Escape a string for N-Triples format
 */
function escapeNTriples(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Unescape an N-Triples string
 */
function unescapeNTriples(str: string): string {
  return str
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * Convert an ObjectNode to N-Triples representation
 */
function objectToNTriples(obj: ObjectNode): string {
  switch (obj.termType) {
    case 'NamedNode':
      return `<${obj.value}>`
    case 'BlankNode':
      return `_:${obj.value}`
    case 'Literal':
      if (obj.language) {
        return `"${escapeNTriples(obj.value)}"@${obj.language}`
      }
      if (obj.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
        return `"${escapeNTriples(obj.value)}"^^<${obj.datatype.value}>`
      }
      return `"${escapeNTriples(obj.value)}"`
  }
}

/**
 * Parse N-Triples object value
 */
function parseNTriplesObject(str: string): ObjectNode {
  str = str.trim()
  
  // URI
  if (str.startsWith('<') && str.endsWith('>')) {
    return namedNode(str.slice(1, -1))
  }
  
  // Blank node
  if (str.startsWith('_:')) {
    return blankNode(str.slice(2))
  }
  
  // Typed literal
  const typedMatch = str.match(/^"(.*)"\^\^<(.*)>$/)
  if (typedMatch) {
    const [, value, datatype] = typedMatch
    return literal(unescapeNTriples(value), namedNode(datatype))
  }
  
  // Language-tagged literal
  const langMatch = str.match(/^"(.*)"@([a-z-]+)$/i)
  if (langMatch) {
    return literal(unescapeNTriples(langMatch[1]), langMatch[2])
  }
  
  // Plain literal
  const literalMatch = str.match(/^"(.*)"$/)
  if (literalMatch) {
    return literal(unescapeNTriples(literalMatch[1]))
  }
  
  // Fallback: treat as literal
  return literal(str)
}

/**
 * Export triples to N-Triples format
 */
export function exportToNTriples(triples: Triple[]): string {
  const lines: string[] = []
  
  for (const triple of triples) {
    const subject = triple.subject.termType === 'BlankNode' 
      ? `_:${triple.subject.value}` 
      : `<${triple.subject.value}>`
    const predicate = `<${triple.predicate.value}>`
    const object = objectToNTriples(triple.object)
    lines.push(`${subject} ${predicate} ${object} .`)
  }
  
  return lines.join('\n')
}

/**
 * Import triples from N-Triples format
 */
export function importFromNTriples(data: string, skipInvalid = false): Triple[] {
  const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'))
  const triples: Triple[] = []
  
  // N-Triples regex: <subject>|_:bnode <predicate> object .
  const regex = /^(?:<([^>]+)>|_:(\S+))\s+<([^>]+)>\s+(.+)\s+\.$/
  
  for (const line of lines) {
    try {
      const match = line.trim().match(regex)
      if (match) {
        const [, subjectUri, subjectBnode, predicateUri, objectStr] = match
        triples.push({
          subject: subjectUri ? namedNode(subjectUri) : blankNode(subjectBnode),
          predicate: namedNode(predicateUri),
          object: parseNTriplesObject(objectStr),
        })
      } else if (!skipInvalid) {
        throw new Error(`Invalid N-Triples line: ${line}`)
      }
    } catch (e) {
      if (!skipInvalid) throw e
    }
  }
  
  return triples
}

// ============ Compact JSON Format ============

/**
 * Export to compact JSON format
 * Uses short keys and arrays for maximum compression
 */
export function exportToCompactJson(triples: Triple[], pretty = false): string {
  // Group by subject for better compression
  const bySubject = new Map<string, Map<string, unknown[]>>()
  
  for (const triple of triples) {
    const subjectKey = termKey(triple.subject)
    if (!bySubject.has(subjectKey)) {
      bySubject.set(subjectKey, new Map())
    }
    const predicates = bySubject.get(subjectKey)!
    const predicateKey = termKey(triple.predicate)
    if (!predicates.has(predicateKey)) {
      predicates.set(predicateKey, [])
    }
    predicates.get(predicateKey)!.push(termToJson(triple.object))
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
 */
export function importFromCompactJson(data: string): Triple[] {
  const parsed = JSON.parse(data)
  const triples: Triple[] = []
  
  // Check if it's the grouped format
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [subject, predicates] of Object.entries(parsed)) {
      if (typeof predicates === 'object' && predicates !== null) {
        for (const [predicate, objects] of Object.entries(predicates as Record<string, unknown>)) {
          const objectArray = Array.isArray(objects) ? objects : [objects]
          for (const object of objectArray) {
            // Parse the termKey-style keys back to nodes
            triples.push({ 
              subject: parseTermKey(subject) as Triple['subject'], 
              predicate: parseTermKey(predicate) as Triple['predicate'], 
              object: jsonToTerm(object)
            })
          }
        }
      }
    }
  }
  
  return triples
}

/**
 * Parse a termKey back to a Term
 */
function parseTermKey(key: string): ObjectNode {
  if (key.startsWith('N:')) {
    return namedNode(key.slice(2))
  }
  if (key.startsWith('B:')) {
    return blankNode(key.slice(2))
  }
  if (key.startsWith('L:')) {
    const rest = key.slice(2)
    const langMatch = rest.match(/^(.*)@([a-z-]+)$/i)
    if (langMatch) {
      return literal(langMatch[1], langMatch[2])
    }
    const typeMatch = rest.match(/^(.*)\^\^(.*)$/)
    if (typeMatch) {
      return literal(typeMatch[1], namedNode(typeMatch[2]))
    }
    return literal(rest)
  }
  // Fallback for legacy format
  return namedNode(key)
}

// ============ Standard JSON Array Format ============

/**
 * Serialized triple format for JSON export
 */
interface SerializedTriple {
  subject: unknown
  predicate: unknown
  object: unknown
}

/**
 * Export to standard JSON array format
 */
export function exportToJson(triples: Triple[], options: { pretty?: boolean; includeMetadata?: boolean } = {}): string {
  // Serialize triples with proper Term information
  const serialized: SerializedTriple[] = triples.map(t => ({
    subject: termToJson(t.subject),
    predicate: termToJson(t.predicate),
    object: termToJson(t.object),
  }))
  
  if (options.includeMetadata) {
    const data = {
      meta: {
        version: '1.0',
        format: 'json',
        tripleCount: triples.length,
        exportedAt: new Date().toISOString(),
      },
      triples: serialized,
    }
    return options.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  }
  
  return options.pretty ? JSON.stringify(serialized, null, 2) : JSON.stringify(serialized)
}

/**
 * Import from standard JSON format
 */
export function importFromJson(data: string, skipInvalid = false): Triple[] {
  const parsed = JSON.parse(data)
  
  // Check if it's wrapped with metadata
  const triples = Array.isArray(parsed) ? parsed : parsed.triples
  
  if (!Array.isArray(triples)) {
    throw new Error('Invalid JSON format: expected array of triples')
  }
  
  const result: Triple[] = []
  for (const item of triples) {
    try {
      if (typeof item === 'object' && item.subject && item.predicate) {
        result.push({
          subject: jsonToSubject(item.subject),
          predicate: jsonToPredicate(item.predicate),
          object: jsonToTerm(item.object),
        })
      } else if (!skipInvalid) {
        throw new Error(`Invalid triple: ${JSON.stringify(item)}`)
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
  
  // N-Triples: lines start with <
  if (trimmed.startsWith('<') && trimmed.includes('> <')) {
    return 'ntriples'
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
      // Object: check if it has triples key (json with meta) or is compact format
      if ('triples' in parsed) {
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
 * Export triples to specified format
 */
export function exportTriples(triples: Triple[], options: ExportOptions): string {
  switch (options.format) {
    case 'jsonl':
      return exportToJsonl(triples, options.includeMetadata)
    case 'ntriples':
      return exportToNTriples(triples)
    case 'compact-json':
      return exportToCompactJson(triples, options.pretty)
    case 'json':
    default:
      return exportToJson(triples, { pretty: options.pretty, includeMetadata: options.includeMetadata })
  }
}

/**
 * Import triples from data with format auto-detection
 */
export function importTriples(data: string, options: ImportOptions = {}): Triple[] {
  const format = options.format || detectFormat(data)
  const skipInvalid = options.skipInvalid ?? false
  
  switch (format) {
    case 'jsonl':
      return importFromJsonl(data, skipInvalid)
    case 'ntriples':
      return importFromNTriples(data, skipInvalid)
    case 'compact-json':
      return importFromCompactJson(data)
    case 'json':
    default:
      return importFromJson(data, skipInvalid)
  }
}

// ============ Operations Export/Import ============

/**
 * Export operations log to JSON Lines format
 */
export function exportOperations(operations: Operation[]): string {
  return operations.map(op => JSON.stringify(op)).join('\n')
}

/**
 * Import operations from JSON Lines format
 */
export function importOperations(data: string): Operation[] {
  return data
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Operation)
}
