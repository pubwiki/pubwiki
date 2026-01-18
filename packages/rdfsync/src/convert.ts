/**
 * RDF.js Quad 转换工具
 * 
 * 将 @rdfjs/types Quad 转换为简化版 Quad
 */

import type { Quad as RdfQuad, Term, Literal } from '@rdfjs/types'
import type { Quad, Operation } from './types.js'

/**
 * 序列化 RDF.js Term 为字符串
 */
function serializeTerm(term: Term): string {
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

/**
 * 将 RDF.js Operation 转换为简化版 Operation
 */
export function fromRdfOperation(rdfOp: {
  type: 'insert' | 'delete'
  quad: RdfQuad
} | {
  type: 'batch-insert' | 'batch-delete'
  quads: RdfQuad[]
}): Operation {
  switch (rdfOp.type) {
    case 'insert':
    case 'delete':
      return { type: rdfOp.type, quad: fromRdfQuad(rdfOp.quad) }
    case 'batch-insert':
    case 'batch-delete':
      return { type: rdfOp.type, quads: rdfOp.quads.map(fromRdfQuad) }
  }
}
