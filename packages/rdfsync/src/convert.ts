/**
 * RDF.js Quad 转换工具
 * 
 * 将 @rdfjs/types Quad 转换为简化版 Quad，以及反向转换
 */

import type { Quad as RdfQuad, Term, Literal, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph } from '@rdfjs/types'
import type { Quad } from './types.js'
import { DataFactory } from 'n3'

const { namedNode, blankNode, literal, defaultGraph, quad: createQuad } = DataFactory

/**
 * 序列化 RDF.js Term 为字符串
 */
export function serializeTerm(term: Term): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`
    case 'BlankNode':
      return `_:${term.value}`
    case 'Literal':
      return term.value
    case 'DefaultGraph':
      return ''
    default:
      return term.value
  }
}

/**
 * 将 RDF.js Quad 转换为简化版 Quad
 */
export function fromRdfQuad(rdfQuad: RdfQuad): Quad {
  const obj = rdfQuad.object
  const result: Quad = {
    subject: serializeTerm(rdfQuad.subject),
    predicate: serializeTerm(rdfQuad.predicate),
    object: serializeTerm(obj),
    graph: rdfQuad.graph ? serializeTerm(rdfQuad.graph) : '',
  }
  
  if (obj.termType === 'Literal') {
    const literal = obj as Literal
    if (literal.datatype) {
      result.objectDatatype = literal.datatype.value
    }
    if (literal.language) {
      result.objectLanguage = literal.language
    }
  }
  
  return result
}

// ============ 反向转换: 简化版 -> RDF.js ============

/**
 * 反序列化字符串为 Subject (NamedNode | BlankNode)
 */
export function deserializeSubject(s: string): Quad_Subject {
  if (s.startsWith('_:')) {
    return blankNode(s.slice(2))
  }
  // 移除尖括号
  if (s.startsWith('<') && s.endsWith('>')) {
    return namedNode(s.slice(1, -1))
  }
  return namedNode(s)
}

/**
 * 反序列化字符串为 Predicate (NamedNode)
 */
export function deserializePredicate(p: string): Quad_Predicate {
  if (p.startsWith('<') && p.endsWith('>')) {
    return namedNode(p.slice(1, -1))
  }
  return namedNode(p)
}

/**
 * 反序列化为 Object (NamedNode | BlankNode | Literal)
 */
export function deserializeObject(o: string, datatype?: string, language?: string): Quad_Object {
  // BlankNode
  if (o.startsWith('_:')) {
    return blankNode(o.slice(2))
  }
  // NamedNode
  if (o.startsWith('<') && o.endsWith('>')) {
    return namedNode(o.slice(1, -1))
  }
  // Literal with language
  if (language) {
    return literal(o, language)
  }
  // Literal with datatype
  if (datatype) {
    return literal(o, namedNode(datatype))
  }
  // Plain literal
  return literal(o)
}

/**
 * 反序列化字符串为 Graph (NamedNode | BlankNode | DefaultGraph)
 */
export function deserializeGraph(g: string | undefined): Quad_Graph {
  if (!g || g === '') {
    return defaultGraph()
  }
  if (g.startsWith('_:')) {
    return blankNode(g.slice(2))
  }
  if (g.startsWith('<') && g.endsWith('>')) {
    return namedNode(g.slice(1, -1))
  }
  return namedNode(g)
}

/**
 * 将简化版 Quad 转换为 RDF.js Quad
 */
export function toRdfQuad(quad: Quad): RdfQuad {
  return createQuad(
    deserializeSubject(quad.subject),
    deserializePredicate(quad.predicate),
    deserializeObject(quad.object, quad.objectDatatype, quad.objectLanguage),
    deserializeGraph(quad.graph)
  )
}

