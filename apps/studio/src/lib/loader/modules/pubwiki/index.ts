/**
 * PubWiki Module Factory
 * 
 * Creates a JS module definition for PubWiki API access in Lua/TypeScript backends.
 * The module exposes:
 * - pubwiki.publish(metadata) -> {success: bool, artifactId?: string, error?: string}
 * - pubwiki.uploadArticle(data) -> {success: bool, articleId?: string, error?: string}
 * - pubwiki.uploadCheckpoint(checkpointId, visibility?) -> {success: bool, checkpointId?: string, error?: string}
 * - pubwiki.uploadCheckpoints(checkpointIds[], defaultVisibility?) -> {success: bool, checkpointIds?: string[], error?: string}
 * 
 * Each method requests user confirmation before executing API calls.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types/flow';
import type { StateNodeData } from '$lib/types/node-data';
import type { JsModuleDefinition } from '$lib/loader';
import type { ReaderContent } from '@pubwiki/reader';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import { publishArtifact, type PublishMetadata } from '$lib/io/publish';
import { uploadCheckpointToCloud } from '$lib/gamesave/checkpoint';
import { ensureCloudSave } from '$lib/gamesave/state-sync';
import { getNodeRDFStore } from '$lib/rdf';
import { requestConfirmation } from '$lib/state/pubwiki-confirm.svelte';
import { HandleId } from '$lib/graph';
import { nodeStore } from '$lib/persistence';
import { StateContent } from '$lib/types';
import PublishForm from '$components/pubwiki/PublishForm.svelte';
import UploadArticleForm from '$components/pubwiki/UploadArticleForm.svelte';
import UploadCheckpointForm from '$components/pubwiki/UploadCheckpointForm.svelte';
import UploadCheckpointsForm from '$components/pubwiki/UploadCheckpointsForm.svelte';

// ============================================================================
// Types
// ============================================================================

/**
 * Context for PubWiki module operations
 */
export interface PubWikiModuleContext {
	/** Current project ID */
	projectId: string;
	/** Loader node ID (used to find connected Sandbox node) */
	loaderNodeId: string;
	/** Function to get current flow nodes */
	getNodes: () => Node<FlowNodeData>[];
	/** Function to get current flow edges */
	getEdges: () => Edge[];
	/** API base URL */
	apiBaseUrl: string;
}

/**
 * Publish metadata from Lua/TS script
 */
interface PublishInput {
	name: string;
	slug: string;
	description?: string;
	version?: string;
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
	tags?: string[];
	homepage?: string;
}

/**
 * Upload article data from Lua/TS script
 */
interface UploadArticleInput {
	articleId?: string;
	title: string;
	content: ReaderContent;
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}

/**
 * Upload checkpoint data from Lua/TS script
 * Uploads an existing local checkpoint to the cloud
 */
interface UploadCheckpointInput {
	/** Checkpoint ID of an existing local checkpoint */
	checkpointId: string;
	/** Visibility setting */
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}

/**
 * Batch upload checkpoints data from Lua/TS script
 * Uploads multiple existing local checkpoints to the cloud
 */
interface UploadCheckpointsInput {
	/** Array of checkpoint IDs to upload */
	checkpointIds: string[];
	/** Default visibility for all checkpoints */
	defaultVisibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}

/**
 * Result of PubWiki operations
 */
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
 * Create a JS module definition for PubWiki API access
 * 
 * @param context - Context containing project info and flow accessors
 * @returns JsModuleDefinition for registerJsModule
 */
export function createPubWikiModule(context: PubWikiModuleContext): JsModuleDefinition {
	return {
		/**
		 * Publish current project as an artifact
		 */
		async publish(metadata: PublishInput): Promise<PubWikiResult> {
			// Build initial values for confirmation dialog
			const initialValues = {
				name: metadata.name || '',
				slug: metadata.slug || '',
				description: metadata.description || '',
				version: metadata.version || '1.0.0',
				visibility: metadata.visibility || 'PUBLIC',
				homepage: metadata.homepage || ''
			};

			// Request user confirmation with editable form
			const editedValues = await requestConfirmation('publish', PublishForm, initialValues);

			if (editedValues === null) {
				return {
					success: false,
					error: 'User cancelled the operation'
				};
			}

			// Build final metadata from user-edited values
			const finalMetadata: PublishMetadata = {
				artifactId: crypto.randomUUID(),
				type: 'GAME', // Default type for Loader-based projects
				name: editedValues.name as string,
				slug: editedValues.slug as string,
				description: (editedValues.description as string) || '',
				version: (editedValues.version as string) || '1.0.0',
				visibility: (editedValues.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED') || 'PUBLIC',
				tags: metadata.tags || [],
				homepage: (editedValues.homepage as string) || undefined
			};

			try {
				// Get current flow state
				const nodes = context.getNodes();
				const edges = context.getEdges();

				// Use existing publishArtifact function
				const result = await publishArtifact(finalMetadata, nodes, edges);

				return {
					success: result.success,
					artifactId: result.artifactId,
					error: result.error
				};
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		},

		/**
		 * Upload an article
		 */
		async uploadArticle(data: UploadArticleInput): Promise<PubWikiResult> {
			// Find connected Sandbox node
			const sandboxNodeId = findConnectedSandboxNode(
				context.loaderNodeId,
				context.getNodes(),
				context.getEdges()
			);

			if (!sandboxNodeId) {
				return {
					success: false,
					error: 'No Sandbox node connected to this Loader. Please connect a Sandbox node via the service output.'
				};
			}

			// Find connected State node and get saveId
			const stateInfo = findConnectedStateNode(
				context.loaderNodeId,
				context.getNodes(),
				context.getEdges()
			);

			if (!stateInfo) {
				return {
					success: false,
					error: 'No State node connected to this Loader. Please connect a State node via the state input.'
				};
			}

			if (!stateInfo.saveId) {
				return {
					success: false,
					error: 'Connected State node has no cloud save configured. Please set up cloud save first.'
				};
			}

			// Build initial values for confirmation dialog
			const initialValues = {
				title: data.title || '',
				visibility: data.visibility || 'PUBLIC'
			};

			// Request user confirmation with editable form
			const editedValues = await requestConfirmation('uploadArticle', UploadArticleForm, initialValues);

			if (editedValues === null) {
				return {
					success: false,
					error: 'User cancelled the operation'
				};
			}

			// Build final data from user-edited values
			const articleId = data.articleId || crypto.randomUUID();
			const visibility = (editedValues.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED') || 'PUBLIC';

			try {
				const apiClient = createApiClient(context.apiBaseUrl);
				const { data: result, error } = await apiClient.PUT('/articles/{articleId}', {
					params: { path: { articleId } },
					body: {
						title: editedValues.title as string,
						sandboxNodeId,
						saveId: stateInfo.saveId,
						content: data.content,
						visibility
					}
				});

				if (error) {
					return {
						success: false,
						error: error.error || 'Failed to upload article'
					};
				}

				return {
					success: true,
					articleId: result.id || articleId
				};
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		},

		/**
		 * Upload an existing local checkpoint to cloud
		 */
		async uploadCheckpoint(data: UploadCheckpointInput): Promise<PubWikiResult> {
			// Find connected State node
			const stateInfo = findConnectedStateNode(
				context.loaderNodeId,
				context.getNodes(),
				context.getEdges()
			);

			if (!stateInfo) {
				return {
					success: false,
					error: 'No State node connected to this Loader. Please connect a State node via the state input.'
				};
			}

			try {
				// Get RDF store for the state node
				const store = await getNodeRDFStore(stateInfo.stateNodeId);

				// Get checkpoint info from local store
				const checkpoint = await store.getCheckpoint(data.checkpointId);
				if (!checkpoint) {
					return {
						success: false,
						error: `Checkpoint "${data.checkpointId}" not found in local store`
					};
				}

				// Build initial values for confirmation dialog
				const initialValues = {
					name: checkpoint.title,
					description: checkpoint.description || '',
					visibility: data.visibility || 'PRIVATE'
				};

				// Request user confirmation with editable form
				const editedValues = await requestConfirmation('uploadCheckpoint', UploadCheckpointForm, initialValues);

				if (editedValues === null) {
					return {
						success: false,
						error: 'User cancelled the operation'
					};
				}

				// Ensure cloud save exists (creates if needed)
				const { saveId: targetSaveId } = await ensureCloudSave(stateInfo.stateNodeId);

				const visibility = editedValues.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED';

				// Upload checkpoint to cloud
				const result = await uploadCheckpointToCloud(store, targetSaveId, {
					id: data.checkpointId,
					name: checkpoint.title,
					description: checkpoint.description,
					visibility
				});

				if (!result.success) {
					return {
						success: false,
						error: result.error || 'Failed to upload checkpoint'
					};
				}

				return {
					success: true,
					checkpointId: result.checkpointId
				};
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		},

		/**
		 * Upload multiple existing local checkpoints to cloud
		 */
		async uploadCheckpoints(data: UploadCheckpointsInput): Promise<PubWikiResult> {
			// Find connected State node
			const stateInfo = findConnectedStateNode(
				context.loaderNodeId,
				context.getNodes(),
				context.getEdges()
			);

			if (!stateInfo) {
				return {
					success: false,
					error: 'No State node connected to this Loader. Please connect a State node via the state input.'
				};
			}

			if (!data.checkpointIds || data.checkpointIds.length === 0) {
				return {
					success: false,
					error: 'No checkpoint IDs provided'
				};
			}

			try {
				// Get RDF store for the state node
				const store = await getNodeRDFStore(stateInfo.stateNodeId);

				// Validate all checkpoints exist and collect their info
				const checkpoints: Array<{ id: string; title: string; description?: string }> = [];
				for (const checkpointId of data.checkpointIds) {
					const checkpoint = await store.getCheckpoint(checkpointId);
					if (!checkpoint) {
						return {
							success: false,
							error: `Checkpoint "${checkpointId}" not found in local store`
						};
					}
					checkpoints.push({
						id: checkpoint.id,
						title: checkpoint.title,
						description: checkpoint.description
					});
				}

				// Build initial values for confirmation dialog
				const initialValues = {
					count: checkpoints.length,
					names: checkpoints.map(c => c.title).join(', '),
					visibility: data.defaultVisibility || 'PRIVATE'
				};

				// Request user confirmation with editable form
				const editedValues = await requestConfirmation('uploadCheckpoints', UploadCheckpointsForm, initialValues);

				if (editedValues === null) {
					return {
						success: false,
						error: 'User cancelled the operation'
					};
				}

				// Ensure cloud save exists (creates if needed)
				const { saveId: targetSaveId } = await ensureCloudSave(stateInfo.stateNodeId);

				const visibility = editedValues.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
				const uploadedIds: string[] = [];

				// Upload each checkpoint
				for (const checkpoint of checkpoints) {
					const result = await uploadCheckpointToCloud(store, targetSaveId, {
						id: checkpoint.id,
						name: checkpoint.title,
						description: checkpoint.description,
						visibility
					});

					if (!result.success) {
						return {
							success: false,
							checkpointIds: uploadedIds,
							error: `Failed to upload checkpoint "${checkpoint.title}": ${result.error}`
						};
					}

					uploadedIds.push(checkpoint.id);
				}

				return {
					success: true,
					checkpointIds: uploadedIds
				};
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
	};
}

/**
 * Create PubWiki module context from flow state getters
 */
export function createPubWikiContext(
	projectId: string,
	loaderNodeId: string,
	getNodes: () => Node<FlowNodeData>[],
	getEdges: () => Edge[]
): PubWikiModuleContext {
	return {
		projectId,
		loaderNodeId,
		getNodes,
		getEdges,
		apiBaseUrl: API_BASE_URL
	};
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the Sandbox node connected to a Loader node via the service output.
 * Loader's LOADER_OUTPUT connects to Sandbox's SERVICE_INPUT.
 */
function findConnectedSandboxNode(
	loaderNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): string | null {
	// Find edges where this Loader is the source and the sourceHandle is LOADER_OUTPUT
	const outgoingEdges = edges.filter(
		e => e.source === loaderNodeId && e.sourceHandle === HandleId.LOADER_OUTPUT
	);

	for (const edge of outgoingEdges) {
		// Check if target is a Sandbox node
		const targetNode = nodes.find(n => n.id === edge.target);
		if (!targetNode) continue;

		const targetData = nodeStore.get(targetNode.id);
		if (targetData?.type === 'SANDBOX') {
			return targetNode.id;
		}
	}

	return null;
}

/**
 * Find the State node connected to a Loader node via the state input.
 * State node connects to Loader's LOADER_STATE handle.
 * Returns the state node id and saveId if found.
 */
function findConnectedStateNode(
	loaderNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): { stateNodeId: string; saveId: string | null } | null {
	// Find edges where this Loader is the target and the targetHandle is LOADER_STATE
	const incomingEdges = edges.filter(
		e => e.target === loaderNodeId && e.targetHandle === HandleId.LOADER_STATE
	);

	for (const edge of incomingEdges) {
		// Check if source is a State node
		const sourceNode = nodes.find(n => n.id === edge.source);
		if (!sourceNode) continue;

		const sourceData = nodeStore.get(sourceNode.id) as StateNodeData | undefined;
		if (sourceData?.type === 'STATE') {
			const content = sourceData.content as StateContent;
			return {
				stateNodeId: sourceNode.id,
				saveId: content.saveId
			};
		}
	}

	return null;
}
