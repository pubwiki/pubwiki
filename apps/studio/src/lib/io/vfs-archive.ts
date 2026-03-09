/**
 * VFS Archive Utilities
 *
 * Packages all files from a VFS node into a deterministic tar.gz archive
 * and computes a content-addressable filesHash (SHA-256 of the archive).
 *
 * Used by:
 *   - publish.ts  — upload VFS content and reference by filesHash
 *
 * NOTE: For local build cache key derivation (build-runner, sandbox),
 * use computeVfsContentHash() from vfs-content-hash.ts instead.
 * It avoids tar.gz overhead by using isomorphic-git walk.
 */

import { computeSha256Hex } from '@pubwiki/api';
import { createTar, gzipCompress, type TarEntry } from '@pubwiki/flow-core';
import { getNodeVfs } from '$lib/vfs';

// ============================================================================
// VFS → tar.gz packaging
// ============================================================================

/** File metadata embedded in the node descriptor on publish. */
export interface VfsFileInfo {
	path: string;
	size: number;
	mimeType?: string;
}

/**
 * Collect all files from a VFS node (recursively).
 */
async function collectVfsFiles(
	projectId: string,
	nodeId: string
): Promise<TarEntry[]> {
	const vfs = await getNodeVfs(projectId, nodeId);
	const files: TarEntry[] = [];

	async function walk(dirPath: string): Promise<void> {
		const items = await vfs.listFolder(dirPath);
		for (const item of items) {
			if ('folderPath' in item) {
				// File
				const file = await vfs.readFile(item.path);
				if (file.content) {
					const content = typeof file.content === 'string'
						? new TextEncoder().encode(file.content)
						: new Uint8Array(file.content);
					// Strip leading slash for tar paths
					const tarPath = item.path.startsWith('/') ? item.path.slice(1) : item.path;
					files.push({ path: tarPath, content });
				}
			} else {
				// Folder — recurse
				await walk(item.path);
			}
		}
	}

	try {
		await walk('/');
	} catch {
		// VFS might be empty or not yet initialised
	}

	return files;
}

/**
 * Package all VFS files into a deterministic tar.gz archive.
 *
 * Returns the gzipped archive plus metadata for the node descriptor.
 */
export async function packageVfsAsTarGz(
	projectId: string,
	nodeId: string
): Promise<{ archive: Uint8Array; totalFiles: number; totalSize: number; files: VfsFileInfo[] }> {
	const entries = await collectVfsFiles(projectId, nodeId);

	let totalSize = 0;
	const fileInfos: VfsFileInfo[] = [];

	for (const entry of entries) {
		totalSize += entry.content.byteLength;
		fileInfos.push({
			path: entry.path,
			size: entry.content.byteLength,
			mimeType: guessMimeType(entry.path),
		});
	}

	const tar = createTar(entries);
	const archive = await gzipCompress(tar);

	return { archive, totalFiles: entries.length, totalSize, files: fileInfos };
}

/**
 * Compute a deterministic SHA-256 hash of a VFS node's content.
 *
 * This packages all VFS files as a tar.gz (deterministic header) and
 * returns `computeSha256Hex(archive)`.  The result is suitable for use
 * as the `filesHash` parameter in `computeBuildCacheKey()` and as the
 * R2 object key for stored archives.
 */
export async function computeVfsFilesHash(
	projectId: string,
	nodeId: string
): Promise<{ filesHash: string; archive: Uint8Array; totalFiles: number; totalSize: number; files: VfsFileInfo[] }> {
	const result = await packageVfsAsTarGz(projectId, nodeId);
	const filesHash = await computeSha256Hex(result.archive.buffer as ArrayBuffer);
	return { filesHash, ...result };
}

// ============================================================================
// MIME helpers
// ============================================================================

const MIME_TYPES: Record<string, string> = {
	txt: 'text/plain',
	md: 'text/markdown',
	json: 'application/json',
	js: 'text/javascript',
	ts: 'text/typescript',
	html: 'text/html',
	css: 'text/css',
	xml: 'application/xml',
	yaml: 'text/yaml',
	yml: 'text/yaml',
	lua: 'text/x-lua',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	webp: 'image/webp',
	pdf: 'application/pdf',
	zip: 'application/zip',
	tar: 'application/x-tar',
	gz: 'application/gzip',
};

/** Guess MIME type from file extension. */
export function guessMimeType(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return MIME_TYPES[ext] ?? 'application/octet-stream';
}
