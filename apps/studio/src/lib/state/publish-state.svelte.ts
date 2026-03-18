/**
 * Publish State Service
 *
 * Centralized reactive state for publish/update dirty tracking.
 * Tracks whether a project has publishable changes by comparing the current
 * state against the last successful publish/update.
 *
 * Three dimensions of change:
 * 1. Graph changes — nodeStore.modificationCount vs baseline
 * 2. Metadata changes — form snapshot vs published baseline
 * 3. VFS file changes — tracked via external getter (from DraftSyncService)
 */

import { nodeStore } from '$lib/persistence/node-store.svelte';

// ============================================================================
// Types
// ============================================================================

export type MetadataSnapshot = {
	name: string;
	description: string;
	homepage: string;
	tagsInput: string;
	version: string;
	isPrivate: boolean;
	isUnlisted: boolean;
	thumbnailUrl: string;
	entrypointKey: string;
};

export interface PublishState {
	/** Whether the project is a draft (never published) */
	readonly isDraft: boolean;
	/** Last cloud commit hash */
	readonly lastCloudCommit: string | undefined;
	/** Whether graph has changed since last publish/update */
	readonly hasGraphChanges: boolean;
	/** Whether metadata has changed since last publish/update */
	readonly hasMetadataChanges: boolean;
	/** Whether VFS files have been modified since last publish/update */
	readonly hasVfsChanges: boolean;
	/** Combined: whether there are any changes worth publishing */
	readonly hasPublishableChanges: boolean;
}

// ============================================================================
// Factory
// ============================================================================

export function createPublishState() {
	let isDraft = $state(true);
	let lastCloudCommit = $state<string | undefined>(undefined);

	// Graph change tracking: compare nodeStore.modificationCount against baseline
	let graphBaseline = $state<number | null>(null);
	const hasGraphChanges = $derived(
		graphBaseline !== null
			? nodeStore.modificationCount > graphBaseline
			: true // Before first publish baseline is set, assume dirty
	);

	// Metadata change tracking: snapshot comparison
	let publishedMeta = $state<MetadataSnapshot | null>(null);
	let currentMeta = $state<MetadataSnapshot | null>(null);
	const hasMetadataChanges = $derived.by(() => {
		if (!publishedMeta || !currentMeta) return false;
		return (Object.keys(publishedMeta) as (keyof MetadataSnapshot)[])
			.some(k => currentMeta![k] !== publishedMeta![k]);
	});

	// VFS file change tracking: supplied by external getter (DraftSyncService)
	let vfsChangesGetter = $state<(() => boolean) | null>(null);
	const hasVfsChanges = $derived(vfsChangesGetter ? vfsChangesGetter() : false);

	const hasPublishableChanges = $derived.by(() => {
		const result = isDraft || hasGraphChanges || hasMetadataChanges || hasVfsChanges;
		console.log('[PublishState] hasPublishableChanges:', result, '{ isDraft:', isDraft, ', hasGraphChanges:', hasGraphChanges, ', hasMetadataChanges:', hasMetadataChanges, ', hasVfsChanges:', hasVfsChanges, '}');
		return result;
	});

	const state: PublishState = {
		get isDraft() { return isDraft; },
		get lastCloudCommit() { return lastCloudCommit; },
		get hasGraphChanges() { return hasGraphChanges; },
		get hasMetadataChanges() { return hasMetadataChanges; },
		get hasVfsChanges() { return hasVfsChanges; },
		get hasPublishableChanges() { return hasPublishableChanges; },
	};

	return {
		get state() { return state; },

		/** Initialize from persisted project data (call on load) */
		init(draft: boolean, commit: string | undefined) {
			isDraft = draft;
			lastCloudCommit = commit;
			if (!draft) {
				// Already published — set graph baseline to current count
				graphBaseline = nodeStore.modificationCount;
			}
		},

		/** Mark project as published with a new commit. Call after successful publish/update. */
		markPublished(commit: string) {
			isDraft = false;
			lastCloudCommit = commit;
			graphBaseline = nodeStore.modificationCount;
			// Sync metadata snapshot: current becomes the new baseline
			if (currentMeta) {
				publishedMeta = { ...currentMeta };
			}
		},

		/** Update the current metadata snapshot (call on every form field change). */
		updateCurrentMetadata(snapshot: MetadataSnapshot) {
			currentMeta = snapshot;
		},

		/** Set the metadata baseline from initial load (for already-published projects). */
		setMetadataBaseline(snapshot: MetadataSnapshot) {
			publishedMeta = { ...snapshot };
			currentMeta = { ...snapshot };
		},

		/** Update isDraft (e.g. from backend check) */
		setDraft(draft: boolean) {
			isDraft = draft;
			if (!draft && graphBaseline === null) {
				graphBaseline = nodeStore.modificationCount;
			}
		},

		/** Update lastCloudCommit */
		setLastCloudCommit(commit: string | undefined) {
			lastCloudCommit = commit;
		},

		/** Bind a getter for VFS changes (call once after DraftSyncService is available). */
		setVfsChangesGetter(getter: () => boolean) {
			vfsChangesGetter = getter;
		},
	};
}

export type PublishStateService = ReturnType<typeof createPublishState>;
