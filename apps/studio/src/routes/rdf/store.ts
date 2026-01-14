/**
 * RDFStore Wrapper for Studio
 *
 * Uses @pubwiki/rdfstore with BrowserLevel for IndexedDB persistence.
 * This allows State nodes to persist RDF triples with full version control.
 */

import { RDFStore } from '@pubwiki/rdfstore';
import { BrowserLevel } from 'browser-level';

// ============================================================================
// Store Registry (for managing multiple State nodes)
// ============================================================================

const storeRegistry = new Map<string, RDFStore>();
const levelRegistry = new Map<string, BrowserLevel<string, string>>();

/**
 * Get or create an RDFStore for a given State node
 * @param nodeId - Unique identifier for the State node
 */
export async function getNodeRDFStore(nodeId: string): Promise<RDFStore> {
  let store = storeRegistry.get(nodeId);
  if (!store || !store.isOpen) {
    const dbName = `pubwiki-state-${nodeId}`;
    const level = new BrowserLevel<string, string>(dbName);
    store = await RDFStore.create(level);
    storeRegistry.set(nodeId, store);
    levelRegistry.set(nodeId, level);
  }
  return store;
}

/**
 * Close and remove an RDFStore for a given State node
 * @param nodeId - Unique identifier for the State node
 */
export async function closeNodeRDFStore(nodeId: string): Promise<void> {
  const store = storeRegistry.get(nodeId);
  if (store) {
    await store.close();
    storeRegistry.delete(nodeId);
    levelRegistry.delete(nodeId);
  }
}

/**
 * Close all open RDF stores (cleanup on page unload)
 */
export async function closeAllRDFStores(): Promise<void> {
  for (const [nodeId, store] of storeRegistry) {
    await store.close();
    storeRegistry.delete(nodeId);
    levelRegistry.delete(nodeId);
  }
}

// Re-export RDFStore type for convenience
export { RDFStore };
