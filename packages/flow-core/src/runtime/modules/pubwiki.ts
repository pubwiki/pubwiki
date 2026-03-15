/**
 * PubWiki Module
 * 
 * Player-facing module exposing publish, checkpoint upload, and article upload.
 * Extracted from Studio's pubwiki module — operates on RuntimeGraph instead of
 * xyflow Node/Edge, and uses injected ConfirmationHandler instead of Svelte dialogs.
 */

import type { RuntimeGraph, ConfirmationHandler, ArtifactContext, JsModuleDefinition } from '../types';
import { findConnectedStateNode } from '../graph/artifact-loader';
import type { CreateSaveOptions, CreateSaveResult, SaveRDFStore } from '../save/gamesave';
import type { createApiClient } from '@pubwiki/api/client';
import type { ReaderContentBlock } from '@pubwiki/api';

// ============================================================================
// RDF Store interface (subset needed by this module)
// ============================================================================

/**
 * Minimal RDF store interface consumed by the pubwiki module.
 * Extends SaveRDFStore so the same object can be passed to createSaveCheckpoint.
 */
export interface PubWikiRDFStore extends SaveRDFStore {
	getCheckpoint(id: string): Promise<{ id: string; title: string; description?: string } | null>;
	loadCheckpoint(id: string): Promise<void>;
	checkpoint(opts: { title: string }): Promise<{ id: string; title: string }>;
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
	/** Create a cloud save checkpoint */
	createSaveCheckpoint: (
		store: PubWikiRDFStore,
		options: CreateSaveOptions,
	) => Promise<CreateSaveResult>;
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

			const initialValues = {
				name: metadata.name || '',
				slug: metadata.slug || '',
				description: metadata.description || '',
				version: metadata.version || '1.0.0',
				isListed: metadata.isListed ?? true,
				isPrivate: metadata.isPrivate ?? false,
				homepage: metadata.homepage || '',
			};

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
				const checkpoint = await store.getCheckpoint(data.checkpointId);
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

				await store.loadCheckpoint(data.checkpointId);

				const result = await config.createSaveCheckpoint(store, {
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
					const cp = await store.getCheckpoint(cpId);
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
				const uploadedIds: string[] = [];

				for (const cp of toUpload) {
					await store.loadCheckpoint(cp.id);

					const result = await config.createSaveCheckpoint(store, {
						stateNodeId,
						artifactId: artifactCtx.artifactId!,
						artifactCommit: artifactCtx.artifactCommit!,
						title: cp.title,
						description: cp.description,
						isListed,
					});

					if (!result.success) {
						return {
							success: false,
							checkpointIds: uploadedIds,
							error: `Failed to upload checkpoint "${cp.title}": ${result.error}`,
						};
					}

					uploadedIds.push(cp.id);
				}

				return { success: true, checkpointIds: uploadedIds };
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
				const finalContent: ReaderContentBlock[] = [];

				for (const block of editedContent) {
					if (block.type === 'text') {
						finalContent.push(block);
						continue;
					}

					const textId = block.type === 'game_ref' ? block.textId : '';
					const originalInput = gameRefMap.get(textId);
					const checkpointId = originalInput?.checkpointId ?? null;

					if (checkpointId) {
						const checkpoint = await store.getCheckpoint(checkpointId);
						if (checkpoint) {
							await store.loadCheckpoint(checkpointId);
						} else {
							await store.checkpoint({ title: `Article fallback save (${textId})` });
						}
					} else {
						await store.checkpoint({ title: 'Article auto-save' });
					}

					const saveResult = await config.createSaveCheckpoint(store, {
						stateNodeId,
						artifactId: artifactCtx.artifactId!,
						artifactCommit: artifactCtx.artifactCommit!,
						title: `Article save (${textId})`,
					});

					if (!saveResult.success || !saveResult.save) {
						return { success: false, error: saveResult.error || 'Failed to upload checkpoint.' };
					}

					finalContent.push({
						type: 'game_ref',
						textId,
						saveCommit: saveResult.save.commit,
					});
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
