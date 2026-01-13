/**
 * RDF Term utilities
 */

import type { NamedNode, Literal, BlankNode, Quad, DefaultGraph } from '@rdfjs/types'

/** RDF term types (excluding DefaultGraph) */
export type Term = NamedNode | Literal | BlankNode

/** RDF term types including graph terms */
export type GraphTerm = Term | DefaultGraph

/**
 * Generate unique key for a Term (for set operations)
 */
export function termKey(term: GraphTerm): string {
  switch (term.termType) {
    case 'NamedNode': return `N:${term.value}`
    case 'BlankNode': return `B:${term.value}`
    case 'DefaultGraph': return 'D:'
    case 'Literal':
      return term.language 
        ? `L:${term.value}@${term.language}`
        : `L:${term.value}^^${term.datatype.value}`
  }
}

/**
 * Generate unique key for a Quad
 */
export function quadKey(q: Quad): string {
  return `${termKey(q.subject as Term)}\0${termKey(q.predicate as Term)}\0${termKey(q.object as Term)}\0${termKey(q.graph as GraphTerm)}`
}

/**
 * Generate (subject, predicate) key for grouping
 */
export function spKey(q: Quad): string {
  return `${termKey(q.subject as Term)}\0${termKey(q.predicate as Term)}`
}

/**
 * Generate (subject, predicate, graph) key for grouping
 */
export function spgKey(q: Quad): string {
  return `${termKey(q.subject as Term)}\0${termKey(q.predicate as Term)}\0${termKey(q.graph as GraphTerm)}`
}

/**
 * Check if two Terms are equal
 */
export function termEquals(a: Term, b: Term): boolean {
  if (a.termType !== b.termType) return false
  if (a.value !== b.value) return false
  
  if (a.termType === 'Literal' && b.termType === 'Literal') {
    if (a.language !== b.language) return false
    if (a.datatype.value !== b.datatype.value) return false
  }
  
  return true
}
