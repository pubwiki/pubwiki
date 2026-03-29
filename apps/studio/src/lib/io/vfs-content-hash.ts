/**
 * Lightweight VFS content hashing for local build cache key derivation (L1 OPFS).
 *
 * Two strategies:
 *
 * **Fast path** (HEAD exists, i.e. at least one commit):
 *   Uses HEAD commit hash + dirty file OIDs. The commit hash already encodes
 *   the full tree state of all committed files (this is what git was designed for),
 *   so we only need to additionally hash the uncommitted changes.
 *
 * **Slow path** (unborn branch, no commits yet):
 *   Falls back to full WORKDIR walk — all files are "dirty" anyway.
 *
 * `computeVfsFileHashes` (full per-file map) is kept separate for callers
 * that need individual file OIDs (e.g. incremental build cache resolution).
 */

import * as git from 'isomorphic-git';
import { WORKDIR } from 'isomorphic-git';
import { computeSha256Hex } from '@pubwiki/api';
import { getNodeVfs } from '$lib/vfs';
import { TEMPLATE_HASHES } from '$lib/simple-mode/template-hashes.generated';

/**
 * Compute per-file hashes for all files in a VFS node's working directory.
 *
 * Returns a map of { [filepath]: oid } where oid is the git blob SHA-1.
 *
 * Fast path (HEAD exists): reads committed tree OIDs directly from git objects
 * (zero file I/O for unchanged files), then overlays dirty file hashes.
 * Slow path (unborn branch): full WORKDIR walk.
 */
export async function computeVfsFileHashes(
	projectId: string,
	nodeId: string,
): Promise<Record<string, string>> {
	const nodeVfs = await getNodeVfs(projectId, nodeId);

	// Try fast path: committed tree + dirty overlay
	let headCommit: string;
	try {
		headCommit = await git.resolveRef({ fs: nodeVfs.gitFs, dir: nodeVfs.gitDir, ref: 'HEAD' });
	} catch {
		// Unborn branch — fall back to full WORKDIR walk
		return computeVfsFileHashesSlow(nodeVfs);
	}

	// Read committed tree — all file OIDs come from git objects, no file I/O
	const commitObj = await git.readCommit({ fs: nodeVfs.gitFs, dir: nodeVfs.gitDir, oid: headCommit });
	const fileMap = new Map<string, string>();

	await git.walk({
		fs: nodeVfs.gitFs,
		dir: nodeVfs.gitDir,
		trees: [git.TREE({ ref: commitObj.commit.tree })],
		map: async (filepath: string, [entry]: Array<git.WalkerEntry | null>) => {
			if (!entry || filepath === '.') return undefined;
			const type = await entry.type();
			if (type !== 'blob') return undefined;
			const oid = await entry.oid();
			const normalizedPath = filepath.startsWith('/') ? filepath : '/' + filepath;
			fileMap.set(normalizedPath, oid!);
			return undefined; // don't need return values, we accumulate in fileMap
		},
	});

	// Overlay dirty files
	const matrix = await git.statusMatrix({ fs: nodeVfs.gitFs, dir: nodeVfs.gitDir });
	for (const [filepath, head, workdir] of matrix) {
		if (head === 1 && workdir === 1) continue;

		const normalizedPath = filepath.startsWith('/') ? filepath : '/' + filepath;
		if (workdir === 0) {
			fileMap.delete(normalizedPath);
		} else {
			const content = await nodeVfs.gitFs.promises.readFile(
				nodeVfs.gitDir === '/' ? '/' + filepath : nodeVfs.gitDir + '/' + filepath,
			);
			const blob = typeof content === 'string'
				? new TextEncoder().encode(content)
				: content instanceof Uint8Array ? content : new Uint8Array(content);
			const { oid } = await git.hashBlob({ object: blob });
			fileMap.set(normalizedPath, oid);
		}
	}

	return Object.fromEntries(fileMap);
}

/** Slow path: full WORKDIR walk for unborn branches. */
async function computeVfsFileHashesSlow(
	nodeVfs: { gitFs: Parameters<typeof git.walk>[0]['fs']; gitDir: string },
): Promise<Record<string, string>> {
	const entries: [string, string][] = await git.walk({
		fs: nodeVfs.gitFs,
		dir: nodeVfs.gitDir,
		trees: [WORKDIR()],
		map: async (filepath: string, [entry]: Array<git.WalkerEntry | null>) => {
			if (!entry || filepath === '.') return undefined;
			const type = await entry.type();
			if (type !== 'blob') return undefined;
			const oid = await entry.oid();
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
 * Fast path: SHA-256(HEAD commit hash + sorted dirty file [path, oid] pairs).
 * The commit hash encodes the entire committed tree, so only dirty files need hashing.
 *
 * Slow path (unborn branch): full WORKDIR walk via computeVfsFileHashes.
 *
 * This is the **single source of truth** for content hashing. All callers
 * needing a content hash for build cache keys should use this function.
 */
export async function computeVfsContentHash(
	projectId: string,
	nodeId: string,
): Promise<string> {
	const nodeVfs = await getNodeVfs(projectId, nodeId);

	// Try fast path: HEAD commit + dirty files
	let headCommit: string;
	try {
		headCommit = await git.resolveRef({ fs: nodeVfs.gitFs, dir: nodeVfs.gitDir, ref: 'HEAD' });
	} catch {
		// No commits yet (unborn branch) — fall back to full walk
		const fileHashes = await computeVfsFileHashes(projectId, nodeId);
		return deriveFilesHash(fileHashes);
	}

	// statusMatrix returns [filepath, HEAD, WORKDIR, STAGE]
	const matrix = await git.statusMatrix({ fs: nodeVfs.gitFs, dir: nodeVfs.gitDir });
	const dirtyEntries: [string, string][] = [];

	for (const [filepath, head, workdir] of matrix) {
		if (head === 1 && workdir === 1) continue; // unchanged

		const normalizedPath = filepath.startsWith('/') ? filepath : '/' + filepath;
		if (workdir === 0) {
			dirtyEntries.push([normalizedPath, 'deleted']);
		} else {
			const content = await nodeVfs.gitFs.promises.readFile(
				nodeVfs.gitDir === '/' ? '/' + filepath : nodeVfs.gitDir + '/' + filepath,
			);
			const blob = typeof content === 'string'
				? new TextEncoder().encode(content)
				: content instanceof Uint8Array ? content : new Uint8Array(content);
			const { oid } = await git.hashBlob({ object: blob });
			dirtyEntries.push([normalizedPath, oid]);
		}
	}

	dirtyEntries.sort(([a], [b]) => a.localeCompare(b));
	// Include template hashes so that mounted library changes (game-sdk, game-ui)
	// invalidate the build cache even though mount content isn't in the git tree.
	const payload = JSON.stringify({ head: headCommit, dirty: dirtyEntries, templates: TEMPLATE_HASHES });
	return computeSha256Hex(new TextEncoder().encode(payload).buffer as ArrayBuffer);
}
