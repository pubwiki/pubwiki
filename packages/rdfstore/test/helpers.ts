/**
 * Test helpers for creating RDF.js terms
 */

import { DataFactory } from 'n3'
import type { Quad, Quad_Graph } from '@rdfjs/types'

export const { namedNode, literal, blankNode, defaultGraph, quad: n3Quad } = DataFactory

/**
 * Create a quad with string shortcuts
 * Subject and predicate are treated as NamedNodes
 * Object is treated based on type:
 *   - string starting with http:/https:/bnode: -> NamedNode/BlankNode
 *   - other strings -> Literal
 * Graph defaults to DefaultGraph
 */
export function quad(
  subject: string,
  predicate: string,
  object: string | number | boolean,
  graph?: string
): Quad {
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
  
  let g: Quad_Graph = defaultGraph()
  if (graph) {
    if (graph.startsWith('_:')) {
      g = blankNode(graph.slice(2))
    } else {
      g = namedNode(graph)
    }
  }
  
  return n3Quad(s, p, o, g)
}

/**
 * Create a quad with a Literal object (for text content)
 */
export function quadWithLiteral(
  subject: string,
  predicate: string,
  value: string,
  language?: string,
  datatype?: string,
  graph?: string
): Quad {
  const s = namedNode(subject)
  const p = namedNode(predicate)
  const o = language 
    ? literal(value, language)
    : datatype 
      ? literal(value, namedNode(datatype))
      : literal(value)
  
  let g: Quad_Graph = defaultGraph()
  if (graph) {
    if (graph.startsWith('_:')) {
      g = blankNode(graph.slice(2))
    } else {
      g = namedNode(graph)
    }
  }
  
  return n3Quad(s, p, o, g)
}
