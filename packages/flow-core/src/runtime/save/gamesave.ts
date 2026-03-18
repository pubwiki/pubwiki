/**
 * Game Save — Cloud Checkpoint Management
 * 
 * Pure functions for creating, restoring, listing, and deleting cloud saves.
 * Uses Triple[] directly — no serialization adapters needed.
 * 
 * Save commit is globally unique: computeNodeCommit(saveId, parent, contentHash, 'SAVE').
 */

import { computeContentHash, computeNodeCommit } from '@pubwiki/api';
import type { SaveDetail } from '@pubwiki/api';
import type { Triple, SerializedCheckpointEntry } from '@pubwiki/rdfstore';

// Re-export for consumers
export type { SaveDetail, SerializedCheckpointEntry };

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal TripleStore interface needed for save/restore.
 */
export interface SaveRDFStore {
	getAll(): Triple[];
	clear(): void;
	batchInsert(triples: Triple[]): void;
}

/**
 * Options for creating a save checkpoint.
 */
export interface CreateSaveOptions {
	stateNodeId: string;
	parent?: string | null;
	artifactId: string;
	artifactCommit: string;
	saveId?: string;
	title?: string;
	description?: string;
	isListed?: boolean;
}

/**
 * Result of creating a save.
 */
export interface CreateSaveResult {
	success: boolean;
	save?: SaveDetail;
	error?: string;
}

// ============================================================================
// Create Save
// ============================================================================

/**
 * Create a save checkpoint from explicit triples (without reading from a store).
 */
export async function createSaveFromQuads(
	triples: Triple[],
	options: CreateSaveOptions,
	apiBaseUrl: string,
): Promise<CreateSaveResult> {
	try {
		const saveId = options.saveId ?? crypto.randomUUID();

		// 1. Serialize to binary
		const triplesJson = JSON.stringify(triples);
		const triplesData = new TextEncoder().encode(triplesJson);

		// 2. Compute quadsHash
		const hashBuffer = await crypto.subtle.digest('SHA-256', triplesData);
		const quadsHash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// 3. Build SAVE content
		const saveContent = {
			type: 'SAVE' as const,
			stateNodeId: options.stateNodeId,
			artifactId: options.artifactId,
			artifactCommit: options.artifactCommit,
			quadsHash,
			saveEncoding: 'keyframe' as const,
			parentCommit: null,
			title: options.title ?? null,
			description: options.description ?? null,
		};

		// 4. Compute hashes
		const contentHash = await computeContentHash(saveContent);
		const commit = await computeNodeCommit(
			saveId,
			options.parent ?? null,
			contentHash,
			'SAVE',
		);

		// 5. Upload
		const formData = new FormData();
		formData.append(
			'metadata',
			JSON.stringify({
				saveId,
				stateNodeId: options.stateNodeId,
				commit,
				parent: options.parent ?? null,
				artifactId: options.artifactId,
				artifactCommit: options.artifactCommit,
				contentHash,
				quadsHash,
				saveEncoding: 'keyframe',
				parentCommit: null,
				title: options.title,
				description: options.description,
				isListed: options.isListed ?? false,
			}),
		);
		formData.append(
			'data',
			new Blob([triplesData], { type: 'application/octet-stream' }),
		);

		const response = await fetch(`${apiBaseUrl}/saves`, {
			method: 'POST',
			body: formData,
			credentials: 'include',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			return {
				success: false,
				error: (errorData as { error?: string }).error || `Save failed: ${response.status}`,
			};
		}

		const save: SaveDetail = await response.json();
		return { success: true, save };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : 'Save failed',
		};
	}
}

/**
 * Create a save checkpoint by uploading triples to the backend.
 * Reads the current active triples from the store.
 */
export async function createSaveCheckpoint(
	store: SaveRDFStore,
	options: CreateSaveOptions,
	apiBaseUrl: string,
): Promise<CreateSaveResult> {
	const triples = store.getAll();
	return createSaveFromQuads(triples, options, apiBaseUrl);
}

// ============================================================================
// Batch Save (Delta Chain)
// ============================================================================

/**
 * Options for creating a batch of saves from exported checkpoint entries.
 */
export interface CreateSaveBatchOptions {
	stateNodeId: string;
	artifactId: string;
	artifactCommit: string;
	isListed?: boolean;
}

/**
 * Result of a batch save operation.
 */
export interface CreateSaveBatchResult {
	success: boolean;
	saves?: SaveDetail[];
	error?: string;
}

/**
 * Upload a batch of checkpoint entries (keyframe + deltas) in a single request.
 * Entries must come from `store.exportCheckpoints(ids, { mode: 'delta' })`:
 * - entries[0] is always a keyframe
 * - entries[1..n] are deltas relative to the previous entry
 *
 * The server derives parentCommit from array order, generates saveId/commit/contentHash.
 */
export async function createSaveBatch(
	entries: SerializedCheckpointEntry[],
	options: CreateSaveBatchOptions,
	apiBaseUrl: string,
): Promise<CreateSaveBatchResult> {
	try {
		if (entries.length === 0) {
			return { success: false, error: 'No entries to upload' };
		}
		if (entries[0].type !== 'keyframe') {
			return { success: false, error: 'First entry must be a keyframe' };
		}

		const formData = new FormData();

		// Build metadata entries and binary data parts
		const metadataEntries: Array<{
			saveEncoding: 'keyframe' | 'delta';
			quadsHash: string;
			title?: string;
			description?: string;
		}> = [];

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];

			// Serialize entry data
			let dataJson: string;
			if (entry.type === 'keyframe') {
				dataJson = JSON.stringify(entry.triples);
			} else {
				dataJson = JSON.stringify({ delta: entry.delta });
			}
			const dataBytes = new TextEncoder().encode(dataJson);

			// Compute quadsHash
			const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
			const quadsHash = Array.from(new Uint8Array(hashBuffer))
				.map(b => b.toString(16).padStart(2, '0'))
				.join('');

			metadataEntries.push({
				saveEncoding: entry.type,
				quadsHash,
			});

			formData.append(
				`data_${i}`,
				new Blob([dataBytes], { type: 'application/octet-stream' }),
			);
		}

		formData.append(
			'metadata',
			JSON.stringify({
				stateNodeId: options.stateNodeId,
				artifactId: options.artifactId,
				artifactCommit: options.artifactCommit,
				isListed: options.isListed ?? false,
				entries: metadataEntries,
			}),
		);

		const response = await fetch(`${apiBaseUrl}/saves/batch`, {
			method: 'POST',
			body: formData,
			credentials: 'include',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			return {
				success: false,
				error: (errorData as { error?: string }).error || `Batch save failed: ${response.status}`,
			};
		}

		const data: { saves: SaveDetail[] } = await response.json();
		return { success: true, saves: data.saves };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : 'Batch save failed',
		};
	}
}

// ============================================================================
// Restore Save
// ============================================================================

/**
 * Restore save data from the backend into a local store.
 */
export async function restoreFromSave(
	store: SaveRDFStore,
	commit: string,
	apiBaseUrl: string,
): Promise<boolean> {
	try {
		const response = await fetch(`${apiBaseUrl}/saves/${encodeURIComponent(commit)}/data`, {
			credentials: 'include',
		});
		if (!response.ok) return false;

		const triplesJson = await response.text();
		const triples: Triple[] = JSON.parse(triplesJson);

		store.clear();
		store.batchInsert(triples);
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// Query Saves
// ============================================================================

/**
 * Fetch saves for a STATE node.
 */
export async function fetchSaves(
	stateNodeId: string,
	apiBaseUrl: string,
): Promise<SaveDetail[]> {
	try {
		const url = new URL(`${apiBaseUrl}/api/saves`);
		url.searchParams.set('stateNodeId', stateNodeId);

		const response = await fetch(url.toString(), { credentials: 'include' });
		if (!response.ok) return [];

		const data = await response.json();
		return (data as { saves?: SaveDetail[] }).saves ?? [];
	} catch {
		return [];
	}
}

/**
 * Get save details by commit.
 */
export async function getSave(
	commit: string,
	apiBaseUrl: string,
): Promise<SaveDetail | null> {
	try {
		const response = await fetch(
			`${apiBaseUrl}/api/saves/${encodeURIComponent(commit)}`,
			{ credentials: 'include' },
		);
		if (!response.ok) return null;
		return (await response.json()) as SaveDetail;
	} catch {
		return null;
	}
}

/**
 * Delete a save by commit.
 */
export async function deleteSave(
	commit: string,
	apiBaseUrl: string,
): Promise<void> {
	const response = await fetch(
		`${apiBaseUrl}/api/saves/${encodeURIComponent(commit)}`,
		{ method: 'DELETE', credentials: 'include' },
	);
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new Error((data as { error?: string }).error || 'Delete failed');
	}
}
