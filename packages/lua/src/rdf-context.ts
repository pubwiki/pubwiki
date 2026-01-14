/**
 * RDF Context Management
 * 
 * Manages RDFStore contexts for concurrent Lua execution.
 * Each context gets a unique ID for isolation.
 */

import type { RDFStore } from '@pubwiki/rdfstore'

// Re-export types from @pubwiki/rdfstore
export type { 
  RDFStore, 
  Ref, 
  QuadPattern, 
  Quad,
  Quad_Subject,
  Quad_Predicate,
  Quad_Object,
  Quad_Graph,
} from '@pubwiki/rdfstore'

// Store contexts: contextId -> RDFStore
const storeContexts = new Map<number, RDFStore>()
let nextContextId = 1

/**
 * Create a new RDFStore context
 * @returns context ID
 */
export function createRDFStoreContext(store: RDFStore): number {
  const contextId = nextContextId++
  storeContexts.set(contextId, store)
  return contextId
}

/**
 * Create a context with a specific ID (for unified VFS/RDF context)
 */
export function createRDFStoreContextWithId(contextId: number, store: RDFStore): void {
  storeContexts.set(contextId, store)
  if (contextId >= nextContextId) {
    nextContextId = contextId + 1
  }
}

/**
 * Get RDFStore for a given context
 */
export function getRDFStore(contextId: number): RDFStore | null {
  return storeContexts.get(contextId) || null
}

/**
 * Clear a RDFStore context
 */
export function clearRDFStoreContext(contextId: number): void {
  storeContexts.delete(contextId)
}

/**
 * Get all active context IDs
 */
export function getActiveContextIds(): number[] {
  return Array.from(storeContexts.keys())
}
