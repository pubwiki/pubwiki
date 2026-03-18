/**
 * TripleStore for Player
 *
 * Per-node TripleStore instances backed by IndexedDB.
 * Same pattern as Studio but isolated to Player's origin.
 */

import { createTripleStore, IndexedDBBackend, type TripleStore } from '@pubwiki/rdfstore';

const storeRegistry = new Map<string, TripleStore>();

/**
 * Get or create a TripleStore for a given State node.
 */
export async function getNodeRDFStore(nodeId: string): Promise<TripleStore> {
	let store = storeRegistry.get(nodeId);
	if (!store || !store.isOpen) {
		const dbName = `player-state-${nodeId}`;
		store = createTripleStore({ backend: new IndexedDBBackend(dbName) });
		storeRegistry.set(nodeId, store);
	}
	return store;
}

/**
 * Close and remove a TripleStore for a given State node.
 */
export async function closeNodeRDFStore(nodeId: string): Promise<void> {
	const store = storeRegistry.get(nodeId);
	if (store) {
		store.close();
		storeRegistry.delete(nodeId);
	}
}

/**
 * Close all open stores.
 */
export async function closeAllRDFStores(): Promise<void> {
	for (const [nodeId, store] of storeRegistry) {
		store.close();
		storeRegistry.delete(nodeId);
	}
}

export type { TripleStore };
export type { TripleStore as RDFStore } from '@pubwiki/rdfstore';
