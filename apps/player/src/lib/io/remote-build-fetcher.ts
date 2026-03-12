/**
 * Remote Build Fetcher for Player
 *
 * L2 remote cache — fetches build cache metadata and archives from the API.
 */

import type { RemoteBuildFetcher, BuildCacheFile, BuildManifest } from '@pubwiki/bundler';
import { extractTarGz } from '@pubwiki/flow-core';

/**
 * Create a RemoteBuildFetcher backed by the PubWiki API.
 */
export function createRemoteBuildFetcher(apiBaseUrl: string): RemoteBuildFetcher {
	return {
		async getMetadata(cacheKey: string) {
			try {
				const url = `${apiBaseUrl}/build-cache/${encodeURIComponent(cacheKey)}`;
				console.log('[RemoteBuildFetcher] getMetadata:', url);
				const response = await fetch(url, { credentials: 'include' });
				console.log('[RemoteBuildFetcher] getMetadata response:', response.status);
				if (!response.ok) return null;
				return (await response.json()) as {
					releaseHash: string;
					fileHashes: Record<string, string>;
				};
			} catch (err) {
				console.warn('[RemoteBuildFetcher] getMetadata failed:', err);
				return null;
			}
		},

		async fetchArchive(cacheKey: string) {
			try {
				const url = `${apiBaseUrl}/build-cache/${encodeURIComponent(cacheKey)}/archive`;
				console.log('[RemoteBuildFetcher] fetchArchive:', url);
				const response = await fetch(url, { credentials: 'include' });
				console.log('[RemoteBuildFetcher] fetchArchive response:', response.status);
				if (!response.ok) return null;

				const archiveBuffer = await response.arrayBuffer();
				const tarFiles = await extractTarGz(archiveBuffer);

				const manifestFile = tarFiles.find(f => f.path === 'manifest.json');
				if (!manifestFile) {
					console.warn('[RemoteBuildFetcher] Build manifest missing in archive');
					return null;
				}

				const manifest: BuildManifest = JSON.parse(
					new TextDecoder().decode(manifestFile.content),
				);
				const files: BuildCacheFile[] = tarFiles
					.filter(f => f.path !== 'manifest.json')
					.map(f => ({ path: f.path, content: f.content }));

				return { manifest, files };
			} catch (err) {
				console.warn('[RemoteBuildFetcher] fetchArchive failed:', err);
				return null;
			}
		},
	};
}
