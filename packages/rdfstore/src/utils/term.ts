/**
 * RDF Term utilities
 */

import type { NamedNode, Literal, BlankNode } from '@rdfjs/types'
import type { Triple } from '../types.js'

export type Term = NamedNode | Literal | BlankNode

/**
 * Generate unique key for a Term (for set operations)
 */
export function termKey(term: Term): string {
  switch (term.termType) {
    case 'NamedNode': return `N:${term.value}`
    case 'BlankNode': return `B:${term.value}`
    case 'Literal':
      return term.language 
        ? `L:${term.value}@${term.language}`
        : `L:${term.value}^^${term.datatype.value}`
  }
}

/**
 * Generate unique key for a Triple
 */
export function tripleKey(t: Triple): string {
  return `${termKey(t.subject)}\0${termKey(t.predicate)}\0${termKey(t.object)}`
}

/**
 * Generate (subject, predicate) key
 */
export function spKey(t: Triple): string {
  return `${termKey(t.subject)}\0${termKey(t.predicate)}`
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
