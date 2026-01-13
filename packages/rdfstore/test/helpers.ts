/**
 * Test helpers for creating RDF.js terms
 */

import { DataFactory } from 'n3'
import type { Triple } from '../src/types.js'

export const { namedNode, literal, blankNode } = DataFactory

/**
 * Create a triple with string shortcuts
 * Subject and predicate are treated as NamedNodes
 * Object is treated based on type:
 *   - string starting with http:/https:/bnode: -> NamedNode/BlankNode
 *   - other strings -> Literal
 */
export function triple(
  subject: string,
  predicate: string,
  object: string | number | boolean
): Triple {
  const s = subject.startsWith('_:') 
    ? blankNode(subject.slice(2)) 
    : namedNode(subject)
  
  const p = namedNode(predicate)
  
  let o
  if (typeof object === 'string') {
    if (object.startsWith('http://') || object.startsWith('https://')) {
      o = namedNode(object)
    } else if (object.startsWith('_:')) {
      o = blankNode(object.slice(2))
    } else {
      o = literal(object)
    }
  } else if (typeof object === 'number') {
    o = literal(String(object), namedNode('http://www.w3.org/2001/XMLSchema#decimal'))
  } else if (typeof object === 'boolean') {
    o = literal(String(object), namedNode('http://www.w3.org/2001/XMLSchema#boolean'))
  } else {
    o = literal(String(object))
  }
  
  return { subject: s, predicate: p, object: o }
}

/**
 * Create a triple with a Literal object (for text content)
 */
export function tripleWithLiteral(
  subject: string,
  predicate: string,
  value: string,
  language?: string,
  datatype?: string
): Triple {
  const s = namedNode(subject)
  const p = namedNode(predicate)
  const o = language 
    ? literal(value, language)
    : datatype 
      ? literal(value, namedNode(datatype))
      : literal(value)
  
  return { subject: s, predicate: p, object: o }
}
