/**
 * Lightweight VFS content hash using isomorphic-git walk.
 *
 * Unlike computeVfsFilesHash() (tar.gz-based), this avoids packaging
 * and leverages the git index stat cache for unchanged files.
 *
 * The resulting hash is used ONLY for local build cache key derivation
 * (L1 OPFS). It intentionally differs from the archive-based filesHash
 * used by publish.ts for R2 storage.
 *
 * How it works:
 *   1. `git.walk(WORKDIR())` traverses all files in the working directory
 *      (including uncommitted changes).
 *   2. For each file, `entry.oid()` returns the git blob SHA-1 hash.
 *      - If the file's stat matches the git index entry, the oid is
 *        returned directly from the index (zero I/O, fast path).
 *      - Otherwise, the file content is read and hashed (slow path).
 *   3. All `[filepath, oid]` pairs are JSON-serialized and SHA-256'd
 *      to produce the final content hash.
 *
 * Performance vs tar.gz:
 *   - No tar packing or gzip compression
 *   - Unchanged files (matching git index stat) require zero file I/O
 *   - Memory: only a small [path, oid] list (~KB) instead of full archive (~MB)
 *
 * **Hash stability**: The resulting hash depends on isomorphic-git's
 * blob OID algorithm (currently SHA-1 with git's `blob <size>\0` header).
 * If isomorphic-git ever changes to SHA-256 (git's planned transition),
 * all existing OPFS cache entries will miss. This is acceptable — it only
 * triggers a one-time rebuild, not data corruption.
 */

import * as git from 'isomorphic-git';
import { WORKDIR } from 'isomorphic-git';
import { computeSha256Hex } from '@pubwiki/api';
import { getNodeVfs } from '$lib/vfs';

/**
 * Compute per-file hashes for all files in a VFS node's working directory.
 *
 * Returns a map of { [filepath]: oid } where oid is the git blob SHA-1.
 * This is the primitive used by both `computeVfsContentHash` (aggregate)
 * and `BuildCacheStorage.resolve()` (per-dep comparison).
 */
export async function computeVfsFileHashes(
	projectId: string,
	nodeId: string,
): Promise<Record<string, string>> {
	const nodeVfs = await getNodeVfs(projectId, nodeId);

	const entries: [string, string][] = await git.walk({
		fs: nodeVfs.gitFs,
		dir: nodeVfs.gitDir,
		trees: [WORKDIR()],
		map: async (filepath: string, [entry]: Array<git.WalkerEntry | null>) => {
			if (!entry || filepath === '.') return undefined;

			const type = await entry.type();
			if (type !== 'blob') return undefined;

			const oid = await entry.oid();
			// Prefix with '/' to match esbuild's absolute VFS paths (e.g. '/src/App.tsx')
			const normalizedPath = filepath.startsWith('/') ? filepath : '/' + filepath;
			return [normalizedPath, oid] as [string, string];
		},
	});

	return Object.fromEntries(entries);
}

/**
 * Derive an aggregate content hash from per-file hashes.
 *
 * Deterministic: sorts entries alphabetically, JSON-serializes, SHA-256.
 * This produces the same result as the old computeVfsContentHash.
 */
export async function deriveFilesHash(fileHashes: Record<string, string>): Promise<string> {
	const sorted = Object.entries(fileHashes).sort(([a], [b]) => a.localeCompare(b));
	const payload = JSON.stringify(sorted);
	return computeSha256Hex(new TextEncoder().encode(payload).buffer as ArrayBuffer);
}

/**
 * Compute a lightweight content hash for a VFS node's working directory.
 *
 * Uses isomorphic-git's WORKDIR walker to enumerate all files and their
 * blob SHA-1 hashes, then aggregates into a single SHA-256 hash.
 *
 * @param projectId - The project ID
 * @param nodeId    - The VFS node ID
 * @returns SHA-256 hex string representing the content state
 */
export async function computeVfsContentHash(
	projectId: string,
	nodeId: string,
): Promise<string> {
	const fileHashes = await computeVfsFileHashes(projectId, nodeId);
	return deriveFilesHash(fileHashes);
}
