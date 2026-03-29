/**
 * PubWiki Module
 * 
 * Player-facing module exposing publish, checkpoint upload, and article upload.
 * Extracted from Studio's pubwiki module — operates on RuntimeGraph instead of
 * xyflow Node/Edge, and uses injected ConfirmationHandler instead of Svelte dialogs.
 */

import type { RuntimeGraph, ConfirmationHandler, ArtifactContext, JsModuleDefinition } from '../types';
import { findConnectedStateNode } from '../graph/artifact-loader';
import type { CreateSaveOptions, CreateSaveResult, CreateSaveBatchOptions, CreateSaveBatchResult, SaveRDFStore } from '../save/gamesave';
import type { Triple, CheckpointInfo, SerializedCheckpointEntry } from '@pubwiki/rdfstore';
import type { createApiClient } from '@pubwiki/api/client';
import type { ReaderContentBlock } from '@pubwiki/api';

// ============================================================================
// RDF Store interface (subset needed by this module)
// ============================================================================

/**
 * Minimal TripleStore interface consumed by the pubwiki module.
 * Extends SaveRDFStore so the same object can be passed to createSaveCheckpoint.
 */
export interface PubWikiRDFStore extends SaveRDFStore {
	getCheckpoint(id: string): CheckpointInfo | undefined;
	exportCheckpoints(ids: string[], options?: { mode?: 'full' | 'delta' }): SerializedCheckpointEntry[];
	checkpoint(opts: { title: string }): CheckpointInfo;
}

/** Extract triples from a checkpoint via exportCheckpoints (full mode). */
function getCheckpointTriples(store: PubWikiRDFStore, id: string): Triple[] | null {
	const entries = store.exportCheckpoints([id], { mode: 'full' });
	if (entries.length === 0) return null;
	const entry = entries[0];
	if (entry.type !== 'keyframe') return null;
	return entry.triples;
}

// ============================================================================
// Module Configuration
// ============================================================================

/**
 * Configuration for creating the PubWiki module.
 */
export interface PubWikiModuleConfig {
	/** Reference to the current RuntimeGraph (read at call time) */
	getGraph: () => RuntimeGraph;
	/** Current project ID */
	projectId: string;
	/** Loader node ID (used for graph queries) */
	loaderNodeId: string;
	/** Typed API client from @pubwiki/api */
	apiClient: ReturnType<typeof createApiClient>;
	/** Get current authenticated user ID */
	getCurrentUserId: () => string | null;
	/** UI confirmation handler */
	confirmation: ConfirmationHandler;
	/** Get artifact context (published state) */
	getArtifactContext: (projectId: string) => Promise<ArtifactContext>;
	/** Get RDF store for a state node */
	getRDFStore: (nodeId: string) => Promise<PubWikiRDFStore>;
	/** Create a cloud save from the store's current active triples */
	createSaveCheckpoint: (
		store: PubWikiRDFStore,
		options: CreateSaveOptions,
	) => Promise<CreateSaveResult>;
	/** Create a cloud save from explicit triples (without touching active state) */
	createSaveFromTriples: (
		triples: Triple[],
		options: CreateSaveOptions,
	) => Promise<CreateSaveResult>;
	/** Upload a batch of checkpoint entries (keyframe + deltas) via batch API */
	createSaveBatch: (
		entries: SerializedCheckpointEntry[],
		options: CreateSaveBatchOptions,
	) => Promise<CreateSaveBatchResult>;
	/** Publish the current project (app-specific logic) */
	publishArtifact?: (metadata: PublishInput) => Promise<PubWikiResult>;
}

// ============================================================================
// Input/Output Types
// ============================================================================

interface PublishInput {
	name: string;
	slug: string;
	description?: string;
	version?: string;
	isListed?: boolean;
	isPrivate?: boolean;
	tags?: string[];
	homepage?: string;
	thumbnailUrl?: string;
}

interface UploadCheckpointInput {
	checkpointId: string;
	isListed?: boolean;
}

interface UploadCheckpointsInput {
	checkpointIds: string[];
	defaultIsListed?: boolean;
}

/**
 * Content block as provided from Lua/TS script.
 */
type InputContentBlock =
	| { type: 'text'; id: string; text: string }
	| { type: 'game_ref'; textId: string; checkpointId?: string };

interface UploadArticleInput {
	articleId?: string;
	title?: string;
	content: InputContentBlock[];
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}

interface PubWikiResult {
	success: boolean;
	artifactId?: string;
	articleId?: string;
	checkpointId?: string;
	checkpointIds?: string[];
	error?: string;
}

// ============================================================================
// Module Factory
// ============================================================================

/**
 * Create a PubWiki JS module definition.
 * 
 * The returned object is registered with the Lua/TS backend via `registerJsModule('pubwiki', ...)`.
 */
export function createPubWikiModule(config: PubWikiModuleConfig): JsModuleDefinition {
	return {
		// ──────────────────────────────────────────────────────────
		// publish
		// ──────────────────────────────────────────────────────────
		async publish(metadata: PublishInput): Promise<PubWikiResult> {
			if (!config.publishArtifact) {
				return { success: false, error: 'Publish is not available in this context.' };
			}

			const initialValues: Record<string, unknown> = {
				name: metadata.name || '',
				slug: metadata.slug || '',
				description: metadata.description || '',
				version: metadata.version || '1.0.0',
				isListed: metadata.isListed ?? true,
				isPrivate: metadata.isPrivate ?? false,
				homepage: metadata.homepage || '',
			};
			if (metadata.thumbnailUrl) {
				initialValues.thumbnailUrl = metadata.thumbnailUrl;
			}

			const edited = await config.confirmation.confirm('publish', initialValues);
			if (edited === null) {
				return { success: false, error: 'User cancelled the operation' };
			}

			return config.publishArtifact({ ...metadata, ...edited } as unknown as PublishInput);
		},

		// ──────────────────────────────────────────────────────────
		// uploadCheckpoint
		// ──────────────────────────────────────────────────────────
		async uploadCheckpoint(data: UploadCheckpointInput): Promise<PubWikiResult> {
			const graph = config.getGraph();
			const stateNodeId = findConnectedStateNode(graph, config.loaderNodeId);

			if (!stateNodeId) {
				return { success: false, error: 'No State node connected to this Loader.' };
			}

			const artifactCtx = await config.getArtifactContext(config.projectId);
			if (!artifactCtx.isPublished || !artifactCtx.artifactId || !artifactCtx.artifactCommit) {
				return { success: false, error: 'Project must be published before uploading checkpoints.' };
			}

			const userId = config.getCurrentUserId();
			if (!userId) {
				return { success: false, error: 'Please log in to upload checkpoints.' };
			}

			const stateNode = graph.nodes.get(stateNodeId);
			if (!stateNode) {
				return { success: false, error: 'Cannot get STATE node version information.' };
			}

			try {
				const store = await config.getRDFStore(stateNodeId);
				const checkpoint = store.getCheckpoint(data.checkpointId);
				if (!checkpoint) {
					return { success: false, error: `Checkpoint "${data.checkpointId}" not found.` };
				}

				const initialValues = {
					name: checkpoint.title,
					description: checkpoint.description || '',
					isListed: data.isListed ?? false,
				};

				const edited = await config.confirmation.confirm('uploadCheckpoint', initialValues);
				if (edited === null) {
					return { success: false, error: 'User cancelled the operation' };
				}

				// Read checkpoint triples directly without modifying active store state
				const triples = getCheckpointTriples(store, data.checkpointId);
				if (!triples) {
					return { success: false, error: `Checkpoint data "${data.checkpointId}" not found.` };
				}

				const result = await config.createSaveFromTriples(triples, {
					stateNodeId,
					artifactId: artifactCtx.artifactId,
					artifactCommit: artifactCtx.artifactCommit,
					title: (edited.name ?? checkpoint.title) as string,
					description: (edited.description as string) || undefined,
					isListed: (edited.isListed as boolean) ?? false,
				});

				if (!result.success) {
					return { success: false, error: result.error || 'Failed to upload checkpoint.' };
				}

				return { success: true, checkpointId: result.save?.commit };
			} catch (err) {
				return { success: false, error: err instanceof Error ? err.message : String(err) };
			}
		},

		// ──────────────────────────────────────────────────────────
		// uploadCheckpoints (batch)
		// ──────────────────────────────────────────────────────────
		async uploadCheckpoints(data: UploadCheckpointsInput): Promise<PubWikiResult> {
			const graph = config.getGraph();
			const stateNodeId = findConnectedStateNode(graph, config.loaderNodeId);

			if (!stateNodeId) {
				return { success: false, error: 'No State node connected to this Loader.' };
			}

			if (!data.checkpointIds || data.checkpointIds.length === 0) {
				return { success: false, error: 'No checkpoint IDs provided.' };
			}

			const artifactCtx = await config.getArtifactContext(config.projectId);
			if (!artifactCtx.isPublished || !artifactCtx.artifactId || !artifactCtx.artifactCommit) {
				return { success: false, error: 'Project must be published before uploading checkpoints.' };
			}

			const userId = config.getCurrentUserId();
			if (!userId) {
				return { success: false, error: 'Please log in to upload checkpoints.' };
			}

			const stateNode = graph.nodes.get(stateNodeId);
			if (!stateNode) {
				return { success: false, error: 'Cannot get STATE node version information.' };
			}

			try {
				const store = await config.getRDFStore(stateNodeId);

				const toUpload: { id: string; title: string; description?: string }[] = [];
				for (const cpId of data.checkpointIds) {
					const cp = store.getCheckpoint(cpId);
					if (!cp) {
						return { success: false, error: `Checkpoint "${cpId}" not found.` };
					}
					toUpload.push({ id: cp.id, title: cp.title, description: cp.description });
				}

				const initialValues = {
					count: toUpload.length,
					names: toUpload.map(c => c.title).join(', '),
					isListed: data.defaultIsListed ?? false,
				};

				const edited = await config.confirmation.confirm('uploadCheckpoints', initialValues);
				if (edited === null) {
					return { success: false, error: 'User cancelled the operation' };
				}

				const isListed = (edited.isListed as boolean) ?? false;

				// Use delta-mode export + batch API for efficient upload
				const entries = store.exportCheckpoints(
					toUpload.map(c => c.id),
					{ mode: 'delta' },
				);

				const batchResult = await config.createSaveBatch(entries, {
					stateNodeId,
					artifactId: artifactCtx.artifactId!,
					artifactCommit: artifactCtx.artifactCommit!,
					isListed,
				});

				if (!batchResult.success) {
					return { success: false, error: batchResult.error || 'Failed to upload checkpoints.' };
				}

				return { success: true, checkpointIds: toUpload.map(c => c.id) };
			} catch (err) {
				return { success: false, error: err instanceof Error ? err.message : String(err) };
			}
		},

		// ──────────────────────────────────────────────────────────
		// uploadArticle
		// ──────────────────────────────────────────────────────────
		async uploadArticle(data: UploadArticleInput): Promise<PubWikiResult> {
			const graph = config.getGraph();
			const stateNodeId = findConnectedStateNode(graph, config.loaderNodeId);

			if (!stateNodeId) {
				return { success: false, error: 'No State node connected to this Loader.' };
			}

			const artifactCtx = await config.getArtifactContext(config.projectId);
			if (!artifactCtx.isPublished || !artifactCtx.artifactId || !artifactCtx.artifactCommit) {
				return { success: false, error: 'Project must be published before uploading articles.' };
			}

			const userId = config.getCurrentUserId();
			if (!userId) {
				return { success: false, error: 'Please log in to upload articles.' };
			}

			const stateNode = graph.nodes.get(stateNodeId);
			if (!stateNode) {
				return { success: false, error: 'Cannot get STATE node version information.' };
			}

			// Build preview content — game_ref blocks use placeholder saveCommit
			const previewContent: ReaderContentBlock[] = [];
			const gameRefMap = new Map<string, InputContentBlock & { type: 'game_ref' }>();

			for (const block of data.content) {
				if (block.type === 'text') {
					previewContent.push({ type: 'text', id: block.id, text: block.text });
				} else {
					const placeholder = block.checkpointId ?? '__pending__';
					previewContent.push({ type: 'game_ref', textId: block.textId, saveCommit: placeholder });
					gameRefMap.set(block.textId, block);
				}
			}

			const initialValues = {
				title: data.title ?? '',
				visibility: data.visibility ?? 'PUBLIC',
				content: previewContent,
			};

			const edited = await config.confirmation.confirm('uploadArticle', initialValues);
			if (edited === null) {
				return { success: false, error: 'User cancelled the operation' };
			}

			try {
				const store = await config.getRDFStore(stateNodeId);
				const editedContent = (edited.content as ReaderContentBlock[]) ?? previewContent;

				// Collect game_ref blocks and their checkpoint IDs
				const gameRefBlocks: Array<{ index: number; textId: string; checkpointId: string }> = [];
				for (let i = 0; i < editedContent.length; i++) {
					const block = editedContent[i];
					if (block.type !== 'game_ref') continue;

					const textId = block.textId;
					const originalInput = gameRefMap.get(textId);
					let checkpointId = originalInput?.checkpointId ?? null;

					if (!checkpointId) {
						// No checkpoint specified — create one from current active state
						const cp = store.checkpoint({ title: `Article save (${textId})` });
						checkpointId = cp.id;
					} else {
						// Verify checkpoint exists
						const cp = store.getCheckpoint(checkpointId);
						if (!cp) {
							// Checkpoint not found, fall back to creating from current active state
							const newCp = store.checkpoint({ title: `Article save (${textId})` });
							checkpointId = newCp.id;
						}
					}

					gameRefBlocks.push({ index: i, textId, checkpointId });
				}

				// Build final content, uploading saves via batch API if there are game_refs
				const finalContent: ReaderContentBlock[] = [...editedContent];

				if (gameRefBlocks.length > 0) {
					// Export all checkpoints with delta encoding
					const checkpointIds = gameRefBlocks.map(b => b.checkpointId);
					const entries = store.exportCheckpoints(checkpointIds, { mode: 'delta' });

					// Upload batch
					const batchResult = await config.createSaveBatch(entries, {
						stateNodeId,
						artifactId: artifactCtx.artifactId!,
						artifactCommit: artifactCtx.artifactCommit!,
					});

					if (!batchResult.success || !batchResult.saves) {
						return { success: false, error: batchResult.error || 'Failed to upload checkpoints.' };
					}

					// Map returned saves back to content blocks
					for (let i = 0; i < gameRefBlocks.length; i++) {
						const { index, textId } = gameRefBlocks[i];
						const save = batchResult.saves[i];
						finalContent[index] = {
							type: 'game_ref',
							textId,
							saveCommit: save.commit,
						};
					}
				}

				const articleId = data.articleId ?? crypto.randomUUID();
				const editedTitle = edited.title as string;
				const editedVisibility = (edited.visibility as string) ?? 'PUBLIC';

				const isListed = editedVisibility === 'PUBLIC';
				const isPrivate = editedVisibility === 'PRIVATE';

				const { error } = await config.apiClient.PUT('/articles/{articleId}', {
					params: { path: { articleId } },
					body: {
						title: editedTitle,
						artifactId: artifactCtx.artifactId,
						artifactCommit: artifactCtx.artifactCommit,
						content: finalContent,
						isListed,
						isPrivate,
					},
				});

				if (error) {
					return {
						success: false,
						error: `Failed to create article: ${JSON.stringify(error)}`,
					};
				}

				return { success: true, articleId };
			} catch (err) {
				return { success: false, error: err instanceof Error ? err.message : String(err) };
			}
		},
	};
}
