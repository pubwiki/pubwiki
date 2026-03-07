/**
 * Build Output Serializer
 *
 * Loads cached build outputs from OPFS and packages them into a
 * tar.gz archive for upload to the backend.
 */

import { OpfsBuildCacheStorage } from '@pubwiki/bundler';
import { createTar, gzipCompress } from './tar';

/**
 * Data needed by publish to upload a build alongside the artifact.
 */
export interface BuildDataForPublish {
	buildCacheKey: string;
	/** Per-file SHA-256 hashes (from OPFS metadata). */
	fileHashes: Record<string, string>;
	/** Pre-packaged tar.gz archive of the build output. */
	archive: Uint8Array;
}

/**
 * Load build data from OPFS and package it for publish.
 *
 * Reads the build manifest and compiled files directly from
 * OpfsBuildCacheStorage, then packages them into a tar.gz archive.
 *
 * @param buildCacheKey — the OPFS cache key
 * @returns packaged build data, or null if the cache entry is missing
 */
export async function loadBuildDataForPublish(
	buildCacheKey: string
): Promise<BuildDataForPublish | null> {
	const storage = new OpfsBuildCacheStorage();
	const handle = await storage.get(buildCacheKey);
	if (!handle) return null;

	const { manifest, metadata } = handle;
	const fileHashes = metadata.fileHashes ?? {};

	// Reconstruct tar entries from OPFS files
	const tarFiles: { path: string; content: Uint8Array }[] = [];

	// Manifest goes first
	tarFiles.push({
		path: 'manifest.json',
		content: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
	});

	// Read compiled output files referenced by the manifest
	for (const entry of Object.values(manifest.entries)) {
		const jsContent = await storage.readFile(buildCacheKey, entry.jsPath);
		if (jsContent) {
			tarFiles.push({ path: entry.jsPath, content: jsContent });
		}
		if (entry.cssPath) {
			const cssContent = await storage.readFile(buildCacheKey, entry.cssPath);
			if (cssContent) {
				tarFiles.push({ path: entry.cssPath, content: cssContent });
			}
		}
	}

	const tarData = createTar(tarFiles);
	const archive = await gzipCompress(tarData);

	return { buildCacheKey, fileHashes, archive };
}
