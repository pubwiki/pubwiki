/**
 * RDF Store for Player
 *
 * Per-node RDFStore instances backed by IndexedDB (via BrowserLevel + Dexie).
 * Same pattern as Studio but isolated to Player's origin.
 */

import { RDFStore } from '@pubwiki/rdfstore';
import { BrowserLevel } from 'browser-level';

const storeRegistry = new Map<string, RDFStore>();

/**
 * Get or create an RDFStore for a given State node.
 */
export async function getNodeRDFStore(nodeId: string): Promise<RDFStore> {
	let store = storeRegistry.get(nodeId);
	if (!store || !store.isOpen) {
		const dbName = `player-state-${nodeId}`;
		const quadstoreLevel = new BrowserLevel<string, string>(`${dbName}-quads`);
		store = await RDFStore.create({
			quadstoreLevel,
			checkpointDbName: `${dbName}-checkpoints`,
		});
		storeRegistry.set(nodeId, store);
	}
	return store;
}

/**
 * Close and remove an RDFStore for a given State node.
 */
export async function closeNodeRDFStore(nodeId: string): Promise<void> {
	const store = storeRegistry.get(nodeId);
	if (store) {
		await store.close();
		storeRegistry.delete(nodeId);
	}
}

/**
 * Close all open RDF stores.
 */
export async function closeAllRDFStores(): Promise<void> {
	for (const [nodeId, store] of storeRegistry) {
		await store.close();
		storeRegistry.delete(nodeId);
	}
}

export { RDFStore };
