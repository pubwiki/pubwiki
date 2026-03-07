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
 */

import * as git from 'isomorphic-git';
import { WORKDIR } from 'isomorphic-git';
import { computeSha256Hex } from '@pubwiki/api';
import { getNodeVfs } from '$lib/vfs';

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
	const nodeVfs = await getNodeVfs(projectId, nodeId);

	const entries: [string, string][] = await git.walk({
		fs: nodeVfs.gitFs,
		dir: nodeVfs.gitDir,
		trees: [WORKDIR()],
		map: async (filepath: string, [entry]: Array<git.WalkerEntry | null>) => {
			// Skip root directory entry
			if (!entry || filepath === '.') return undefined;

			const type = await entry.type();
			// Only include blob (file) entries, skip trees (directories)
			if (type !== 'blob') return undefined;

			// entry.oid() uses git index stat cache when available:
			// if stat matches index → return cached oid (zero I/O)
			// if stat differs → read file content → SHA-1 hash
			const oid = await entry.oid();
			return [filepath, oid] as [string, string];
		},
	});

	// walk() returns entries in alphabetical order → deterministic
	// Hash the full [path, oid] list to produce a single content hash
	const payload = JSON.stringify(entries);
	return computeSha256Hex(new TextEncoder().encode(payload).buffer as ArrayBuffer);
}
