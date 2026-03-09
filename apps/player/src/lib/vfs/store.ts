/**
 * VFS Store for Player
 *
 * Provides scoped VFS instances using OPFS.
 * No git version control — Player is read-only.
 * Caches instances by (artifactId, nodeId) to avoid duplicate OPFS handles.
 */

import { createVfs, type Vfs } from '@pubwiki/vfs';
import { OpfsProvider } from './opfs-provider';

const vfsCache = new Map<string, Vfs>();

/**
 * Get or create a VFS instance for a node.
 *
 * @param artifactId - Artifact ID (used as OPFS scope)
 * @param nodeId - Node ID
 * @returns VFS instance scoped to OPFS/<artifactId>/<nodeId>/
 */
export async function getNodeVfs(artifactId: string, nodeId: string): Promise<Vfs> {
	const key = `${artifactId}/${nodeId}`;
	let vfs = vfsCache.get(key);
	if (vfs) return vfs;

	const provider = new OpfsProvider(artifactId, nodeId);
	await provider.initialize();
	vfs = createVfs(provider);
	vfsCache.set(key, vfs);
	return vfs;
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
