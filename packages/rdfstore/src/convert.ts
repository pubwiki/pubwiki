/**
 * Conversion utilities between @rdfjs/types Quad and SerializedQuad (N3 string format)
 * 
 * SerializedQuad uses N3 format strings for all fields, while @rdfjs/types Quad
 * uses structured Term objects.
 */

import type * as RDF from '@rdfjs/types'
import { DataFactory as DF } from 'n3'

// ============================================================================
// SerializedQuad Type (N3 string format for serialization)
// ============================================================================

/**
 * Quad type using N3 string format for all fields.
 * This is a serialization format used for JSON storage/transfer.
 * Unlike RDF.js Quad which uses structured Term objects, this uses
 * plain strings in N3 notation.
 */
export interface SerializedQuad {
  subject: string
  predicate: string
  object: string
  graph?: string
}

// ============================================================================
// Term Serialization (to N3 string format)
// ============================================================================

/**
 * Serialize a term to N3 string format
 */
function termToN3(term: RDF.Term): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`
    case 'BlankNode':
      return `_:${term.value}`
    case 'Literal': {
      const lit = term as RDF.Literal
      let result = JSON.stringify(lit.value) // This handles escaping
      if (lit.language) {
        result += `@${lit.language}`
      } else if (lit.datatype && lit.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
        result += `^^<${lit.datatype.value}>`
      }
      return result
    }
    case 'DefaultGraph':
      return ''
    default:
      throw new Error(`Unknown term type: ${(term as RDF.Term).termType}`)
  }
}

// ============================================================================
// Term Parsing (from N3 string format)
// ============================================================================

/**
 * Parse an N3 string to a term
 */
function n3ToTerm(n3: string): RDF.NamedNode | RDF.BlankNode | RDF.Literal {
  if (n3.startsWith('<') && n3.endsWith('>')) {
    // NamedNode
    return DF.namedNode(n3.slice(1, -1))
  } else if (n3.startsWith('_:')) {
    // BlankNode
    return DF.blankNode(n3.slice(2))
  } else if (n3.startsWith('"')) {
    // Literal - need to parse value, language tag, and datatype
    return parseLiteral(n3)
  } else {
    throw new Error(`Invalid N3 term: ${n3}`)
  }
}

/**
 * Parse a literal from N3 string format
 */
function parseLiteral(n3: string): RDF.Literal {
  // Find the closing quote (handling escapes)
  let i = 1
  let value = ''
  while (i < n3.length) {
    if (n3[i] === '\\' && i + 1 < n3.length) {
      // Handle escape sequences
      const nextChar = n3[i + 1]
      switch (nextChar) {
        case 'n': value += '\n'; break
        case 'r': value += '\r'; break
        case 't': value += '\t'; break
        case '\\': value += '\\'; break
        case '"': value += '"'; break
        default: value += nextChar
      }
      i += 2
    } else if (n3[i] === '"') {
      // End of value
      i++
      break
    } else {
      value += n3[i]
      i++
    }
  }

  // Check for language tag or datatype
  const rest = n3.slice(i)
  if (rest.startsWith('@')) {
    // Language tag
    const lang = rest.slice(1)
    return DF.literal(value, lang)
  } else if (rest.startsWith('^^<') && rest.endsWith('>')) {
    // Datatype
    const datatype = rest.slice(3, -1)
    return DF.literal(value, DF.namedNode(datatype))
  } else {
    // Plain string literal
    return DF.literal(value)
  }
}

/**
 * Parse graph string to term
 */
function n3ToGraphTerm(n3: string): RDF.DefaultGraph | RDF.NamedNode | RDF.BlankNode {
  if (!n3 || n3 === '') {
    return DF.defaultGraph()
  }
  return n3ToTerm(n3) as RDF.NamedNode | RDF.BlankNode
}

// ============================================================================
// Quad Conversion Functions
// ============================================================================

/**
 * Convert an @rdfjs/types Quad to SerializedQuad (N3 string format)
 */
export function fromRdfQuad(quad: RDF.Quad): SerializedQuad {
  return {
    subject: termToN3(quad.subject),
    predicate: termToN3(quad.predicate),
    object: termToN3(quad.object),
    graph: termToN3(quad.graph),
  }
}

/**
 * Convert a SerializedQuad (N3 string format) to @rdfjs/types Quad
 */
export function toRdfQuad(serializedQuad: SerializedQuad): RDF.Quad {
  return DF.quad(
    n3ToTerm(serializedQuad.subject) as RDF.Quad['subject'],
    n3ToTerm(serializedQuad.predicate) as RDF.NamedNode,
    n3ToTerm(serializedQuad.object) as RDF.Quad['object'],
    n3ToGraphTerm(serializedQuad.graph ?? ''),
  )
}
