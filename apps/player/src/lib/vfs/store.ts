/**
 * VFS Store for Player
 *
 * Provides scoped VFS instances with automatic storage backend detection.
 * Priority: OPFS > IndexedDB > Memory.
 * Caches instances by (artifactId, nodeId) to avoid duplicate handles.
 */

import { createVfs, type Vfs, type VfsProvider } from '@pubwiki/vfs';
import { detectStorageBackend, type StorageBackend } from './detect';
import { OpfsProvider } from './opfs-provider';
import { IdbVfsProvider } from './idb-provider';
import { MemoryVfsProvider } from './memory-provider';

const vfsCache = new Map<string, Vfs>();

/**
 * Get or create a VFS instance for a node.
 * Automatically selects the best available storage backend.
 */
export async function getNodeVfs(artifactId: string, nodeId: string): Promise<Vfs> {
	const key = `${artifactId}/${nodeId}`;
	let vfs = vfsCache.get(key);
	if (vfs) return vfs;

	const backend = await detectStorageBackend();
	const provider = createProvider(backend, artifactId, nodeId);
	if (provider.initialize) await provider.initialize();
	vfs = createVfs(provider);
	vfsCache.set(key, vfs);
	return vfs;
}

function createProvider(backend: StorageBackend, scopeId: string, nodeId: string): VfsProvider {
	switch (backend) {
		case 'opfs':
			return new OpfsProvider(scopeId, nodeId);
		case 'indexeddb':
			return new IdbVfsProvider(scopeId, nodeId);
		case 'memory':
			return new MemoryVfsProvider();
	}
}

/**
 * Dispose a VFS instance and remove from cache.
 */
export function disposeNodeVfs(artifactId: string, nodeId: string): void {
	const key = `${artifactId}/${nodeId}`;
	const vfs = vfsCache.get(key);
	if (vfs) {
		vfs.dispose();
		vfsCache.delete(key);
	}
}

/**
 * Dispose all cached VFS instances.
 */
export function disposeAllVfs(): void {
	for (const vfs of vfsCache.values()) {
		vfs.dispose();
	}
	vfsCache.clear();
}
