/**
 * Game Save — Cloud Checkpoint Management
 * 
 * Pure functions for creating, restoring, listing, and deleting cloud saves.
 * Extracted from Studio's checkpoint.ts — API_BASE_URL is injected, not hardcoded.
 * 
 * Save commit is globally unique: computeNodeCommit(saveId, parent, contentHash, 'SAVE').
 */

import { computeContentHash, computeNodeCommit } from '@pubwiki/api';
import type { SaveDetail } from '@pubwiki/api';

// Re-export for consumers
export type { SaveDetail };

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal RDF store interface needed for save/restore.
 */
export interface SaveRDFStore {
	getAllQuads(): Promise<RdfQuad[]>;
	clear(): Promise<void>;
	batchInsert(quads: RdfQuad[]): Promise<void>;
}

/**
 * Opaque RDF quad type. Concrete shape is defined by @pubwiki/rdfstore.
 */
export type RdfQuad = unknown;

/**
 * Serialization helpers — injected by app layer from @pubwiki/rdfstore.
 */
export interface QuadSerializers {
	fromRdfQuad(quad: RdfQuad): unknown;
	toRdfQuad(serialized: unknown): RdfQuad;
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
 * Create a save checkpoint by uploading RDF quads to the backend.
 * 
 * @param store - Local RDF store
 * @param options - Save metadata
 * @param apiBaseUrl - Backend API base URL (injected)
 * @param serializers - Quad serialisation helpers (injected from @pubwiki/rdfstore)
 */
export async function createSaveCheckpoint(
	store: SaveRDFStore,
	options: CreateSaveOptions,
	apiBaseUrl: string,
	serializers: QuadSerializers,
): Promise<CreateSaveResult> {
	try {
		const saveId = options.saveId ?? crypto.randomUUID();

		// 1. Export quads
		const rdfQuads = await store.getAllQuads();

		// 2. Serialize to binary
		const quadsJson = JSON.stringify(rdfQuads.map(q => serializers.fromRdfQuad(q)));
		const quadsData = new TextEncoder().encode(quadsJson);

		// 3. Compute quadsHash
		const hashBuffer = await crypto.subtle.digest('SHA-256', quadsData);
		const quadsHash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// 4. Build SAVE content
		const saveContent = {
			type: 'SAVE' as const,
			stateNodeId: options.stateNodeId,
			artifactId: options.artifactId,
			artifactCommit: options.artifactCommit,
			quadsHash,
			title: options.title ?? null,
			description: options.description ?? null,
		};

		// 5. Compute hashes
		const contentHash = await computeContentHash(saveContent);
		const commit = await computeNodeCommit(
			saveId,
			options.parent ?? null,
			contentHash,
			'SAVE',
		);

		// 6. Upload
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
				title: options.title,
				description: options.description,
				isListed: options.isListed ?? false,
			}),
		);
		formData.append(
			'data',
			new Blob([quadsData], { type: 'application/octet-stream' }),
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

// ============================================================================
// Restore Save
// ============================================================================

/**
 * Restore save data from the backend into a local RDF store.
 */
export async function restoreFromSave(
	store: SaveRDFStore,
	commit: string,
	apiBaseUrl: string,
	serializers: QuadSerializers,
): Promise<boolean> {
	try {
		const response = await fetch(`${apiBaseUrl}/saves/${encodeURIComponent(commit)}/data`, {
			credentials: 'include',
		});
		if (!response.ok) return false;

		const quadsJson = await response.text();
		const apiQuads: unknown[] = JSON.parse(quadsJson);
		const rdfQuads = apiQuads.map(q => serializers.toRdfQuad(q));

		await store.clear();
		await store.batchInsert(rdfQuads);
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
