/**
 * Build Runner
 *
 * Runs a build for a VFS node via BuildAwareVfs.  By going through
 * BuildAwareVfs the compiled output is automatically written to L1
 * (OPFS) so a subsequent sandbox open will hit the cache instead of
 * recompiling.
 *
 * This module is **stateless** — it does not hold build status.
 * Transient UI state (building / error) is managed locally in the
 * calling component (EntrypointSection).  Persistent build status
 * is derived from OpfsBuildCacheStorage (OPFS).
 *
 * Hash concepts used here:
 *
 *   contentHash   — Lightweight hash of VFS working directory content,
 *                   computed via isomorphic-git walk (no tar.gz).
 *                   Fed into `computeBuildCacheKey()` for L1 OPFS cache key.
 *
 *   buildCacheKey — content-addressable key for the resulting build archive,
 *                   stored on backend / R2.
 */

import { createBuildAwareVfs, getOpfsBuildCacheStorage, detectProject } from '@pubwiki/bundler';
import type { ProjectBuildResult } from '@pubwiki/bundler';
import { computeBuildCacheKey, computeConfigKey } from '@pubwiki/api';
import { computeVfsFileHashes, computeVfsContentHash } from './vfs-content-hash';
import { getNodeVfs } from '$lib/vfs';
import { ImportMapManager } from '../../components/monaco/import-map';

/** Result returned by `runBuild()`. */
export interface BuildRunResult {
	success: boolean;
	buildCacheKey: string;
	contentHash: string;
	error?: string;
}

/**
 * Run a build for a VFS node.
 *
 * Creates a temporary BuildAwareVfs (with L0→L1→L3 cache), reads the
 * entry files (triggering compilation + L1 write-through), and returns
 * the result.  The OPFS cache is populated automatically by
 * BuildAwareVfs, so no explicit store write is needed.
 *
 * @param params.onProgress — optional callback for progress messages
 */
export async function runBuild(params: {
	vfsNodeId: string;
	projectId: string;
	onProgress?: (message: string) => void;
}): Promise<BuildRunResult> {
	const { vfsNodeId, projectId, onProgress } = params;

	// 1. Resolve VFS
	const nodeVfs = await getNodeVfs(projectId, vfsNodeId);

	// 2. Detect project config
	const projectConfig = await detectProject('/tsconfig.json', nodeVfs);
	if (!projectConfig?.isBuildable || projectConfig.entryFiles.length === 0) {
		return {
			success: false,
			buildCacheKey: '',
			contentHash: '',
			error: 'No buildable project detected (missing tsconfig.json or entry files)',
		};
	}

	// 3. Compute content hash (git-native fast path), per-file hashes, buildCacheKey, and configKey
	const [contentHash, fileHashes] = await Promise.all([
		computeVfsContentHash(projectId, vfsNodeId),
		computeVfsFileHashes(projectId, vfsNodeId),
	]);
	const [buildCacheKey, configKey] = await Promise.all([
		computeBuildCacheKey({
			filesHash: contentHash,
			entryFiles: projectConfig.entryFiles,
		}),
		computeConfigKey({
			entryFiles: projectConfig.entryFiles,
		}),
	]);

	// 3b. Smart cache resolution — may hit even when buildCacheKey differs
	//     (non-dependency files changed but all deps are identical).
	const buildCacheStorage = getOpfsBuildCacheStorage();
	const cached = await buildCacheStorage.resolve(buildCacheKey, fileHashes);
	if (cached) {
		return { success: true, buildCacheKey, contentHash };
	}

	// 4. Create BuildAwareVfs — compilation goes through L0→L1→L3 cache,
	//    so results are automatically persisted to OPFS.
	let capturedBuildResult: ProjectBuildResult | null = null as ProjectBuildResult | null;

	const buildAwareVfs = createBuildAwareVfs({
		sourceVfs: nodeVfs,
		projectConfig,
		buildCacheStorage,
		buildCacheKey,
		filesHash: contentHash,
		fileHashes,
		configKey,
		onBuildProgress: (event) => {
			if ((event.type === 'progress' || event.type === 'start') && event.message) {
				onProgress?.(event.message);
			}
			if (event.type === 'complete' && event.result) {
				capturedBuildResult = event.result;
			}
		},
	});

	try {
		// 5. Trigger compilation by reading the first entry file.
		//    BuildAwareVfs builds all entries at once on L3 miss,
		//    populating L0 and writing through to L1.
		const firstEntry = projectConfig.entryFiles[0];
		const entryPath = firstEntry.startsWith('/') ? firstEntry : `/${firstEntry}`;
		await buildAwareVfs.readFile(entryPath);

		// If L1 was hit (no compilation needed), capturedBuildResult is null.
		// That's fine — the cache is valid and OPFS has the outputs.

		// Check for build errors
		if (capturedBuildResult && !capturedBuildResult.success) {
			const errorMsg = [...capturedBuildResult.outputs.values()]
				.flatMap(o => o.errors)
				.map(e => e.message)
				.join('\n') || 'Build failed';
			return { success: false, buildCacheKey, contentHash, error: errorMsg };
		}

		// 6. Write resolved package versions back to importmap.json.
		//    The import map serves as a lightweight lockfile for CDN-resolved packages.
		//    Only populated when an L3 (local compile) build occurred.
		//    After writing, we recompute hashes so the returned buildCacheKey reflects
		//    the actual VFS state. The smart cache (resolve() dep matching) will reuse
		//    the existing build output under the new key on next lookup.
		const resolvedVersions = buildAwareVfs.getResolvedPackageVersions();
		let finalBuildCacheKey = buildCacheKey;
		let finalContentHash = contentHash;

		if (resolvedVersions.size > 0) {
			try {
				const importMapManager = new ImportMapManager(nodeVfs);
				await importMapManager.mergeResolvedPackages(resolvedVersions);

				// Recompute hashes since importmap.json was modified.
				const [newContentHash, newFileHashes] = await Promise.all([
					computeVfsContentHash(projectId, vfsNodeId),
					computeVfsFileHashes(projectId, vfsNodeId),
				]);
				finalContentHash = newContentHash;
				finalBuildCacheKey = await computeBuildCacheKey({
					filesHash: finalContentHash,
					entryFiles: projectConfig.entryFiles,
				});

				// The build output was stored under the original buildCacheKey.
				// Create an alias so finalBuildCacheKey also resolves to the same
				// compiled output. alias() directly links the two keys without
				// dep-matching, which handles the chicken-and-egg situation where
				// importmap.json (a build dep) was updated after the build ran,
				// making its hash — and therefore the cache key — differ.
				const aliasOk = await buildCacheStorage.alias(buildCacheKey, finalBuildCacheKey, newFileHashes);
				if (!aliasOk) {
					// Source key not in cache (shouldn't happen) — fall back to original key.
					finalBuildCacheKey = buildCacheKey;
					finalContentHash = contentHash;
				}
			} catch (err) {
				console.warn('[buildRunner] Failed to write back import map:', err);
			}
		}

		return { success: true, buildCacheKey: finalBuildCacheKey, contentHash: finalContentHash };
	} finally {
		await buildAwareVfs.dispose();
	}
}


