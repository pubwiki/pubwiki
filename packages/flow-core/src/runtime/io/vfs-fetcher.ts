/**
 * VFS Content Fetcher
 *
 * Downloads node VFS archives from the API and populates a local VFS.
 * Used by Player (and potentially other consumers) whose VFS starts empty
 * and needs to be populated from the backend archive endpoint.
 */

import type { Vfs } from '@pubwiki/vfs';
import { extractTarGz } from './tar';

/**
 * Fetch a node's VFS archive from the API and write all files into the given VFS.
 *
 * @param apiBaseUrl - API base URL (e.g. https://host/api)
 * @param commit - Node version commit hash (used as archive key)
 * @param vfs - Target VFS to populate
 */
export async function fetchAndPopulateVfs(
	apiBaseUrl: string,
	commit: string,
	vfs: Vfs,
): Promise<void> {
	const response = await fetch(
		`${apiBaseUrl}/nodes/commits/${encodeURIComponent(commit)}/archive`,
		{ credentials: 'include' },
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch VFS archive for commit ${commit}: ${response.status}`);
	}

	const archiveBuffer = await response.arrayBuffer();
	const entries = await extractTarGz(archiveBuffer);

	for (const entry of entries) {
		const path = entry.path.startsWith('/') ? entry.path : `/${entry.path}`;
		await vfs.createFile(path, entry.content.buffer as ArrayBuffer);
	}
}
