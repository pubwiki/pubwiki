/**
 * TripleStore for Player
 *
 * Uses flow-core StoreManager with IndexedDBBackend.
 */

import { StoreManager } from '@pubwiki/flow-core';
import { IndexedDBBackend } from '@pubwiki/rdfstore';
import type { TripleStore } from '@pubwiki/rdfstore';

const manager = new StoreManager(
	(nodeId) => new IndexedDBBackend(`player-state-${nodeId}`)
);

export function getNodeRDFStore(nodeId: string): Promise<TripleStore> {
	return manager.get(nodeId);
}

export function closeNodeRDFStore(nodeId: string): Promise<void> {
	return manager.close(nodeId);
}

export function closeAllRDFStores(): Promise<void> {
	return manager.closeAll();
}

export type { TripleStore };
export type { TripleStore as RDFStore } from '@pubwiki/rdfstore';
