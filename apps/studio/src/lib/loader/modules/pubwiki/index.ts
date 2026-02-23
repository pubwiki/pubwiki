/**
 * PubWiki Module Factory
 * 
 * Creates a JS module definition for PubWiki API access in Lua/TypeScript backends.
 * The module exposes:
 * - pubwiki.publish(metadata) -> {success: bool, artifactId?: string, error?: string}
 * - pubwiki.uploadCheckpoint(data) -> {success: bool, checkpointId?: string, error?: string}
 * - pubwiki.uploadCheckpoints(data) -> {success: bool, checkpointIds?: string[], error?: string}
 * 
 * Cloud saves require:
 * - Project to be published (artifactId available)
 * - User to be authenticated (userId available)
 * - Artifact commit (fetched from backend)
 * - STATE node commit (from nodeStore)
 * 
 * Each method requests user confirmation before executing API calls.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types/flow';
import type { JsModuleDefinition } from '$lib/loader';
import type { ReaderContent } from '@pubwiki/reader';
import { API_BASE_URL } from '$lib/config';
import { HandleId } from '$lib/graph';
import { publishArtifact, type PublishMetadata } from '$lib/io/publish';
import { requestConfirmation } from '$lib/state/pubwiki-confirm.svelte';
import { getNodeRDFStore } from '$lib/rdf';
import { nodeStore } from '$lib/persistence';
import { 
	getArtifactContext, 
	clearArtifactContext,
	createSaveCheckpoint, 
	computeSaveCommit 
} from '$lib/gamesave';
import PublishForm from '$components/pubwiki/PublishForm.svelte';
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
	/** Function to get current user ID (returns null if not authenticated) */
	getCurrentUserId?: () => string | null;
}

/**
 * Publish metadata from Lua/TS script
 */
interface PublishInput {
	name: string;
	slug: string;
	description?: string;
	version?: string;
	/** Whether to list in public discovery */
	isListed?: boolean;
	/** Whether the artifact is private */
	isPrivate?: boolean;
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
	/** Whether to list in public discovery */
	isListed?: boolean;
}

/**
 * Upload checkpoint data from Lua/TS script
 * Uploads an existing local checkpoint to the cloud
 */
interface UploadCheckpointInput {
	/** Checkpoint ID of an existing local checkpoint */
	checkpointId: string;
	/** Whether to list in public discovery */
	isListed?: boolean;
}

/**
 * Batch upload checkpoints data from Lua/TS script
 * Uploads multiple existing local checkpoints to the cloud
 */
interface UploadCheckpointsInput {
	/** Array of checkpoint IDs to upload */
	checkpointIds: string[];
	/** Default isListed for all checkpoints */
	defaultIsListed?: boolean;
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
				isListed: metadata.isListed ?? true,
				isPrivate: metadata.isPrivate ?? false,
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
				name: editedValues.name as string,
				slug: editedValues.slug as string,
				description: (editedValues.description as string) || '',
				version: (editedValues.version as string) || '1.0.0',
				isListed: (editedValues.isListed as boolean) ?? true,
				isPrivate: (editedValues.isPrivate as boolean) ?? false,
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
		 * 
		 * Note: This feature is temporarily disabled pending the new save API architecture
		 * which requires sourceArtifactId and sourceArtifactCommit for referencing saves.
		 */
		async uploadArticle(_data: UploadArticleInput): Promise<PubWikiResult> {
			return {
				success: false,
				error: 'Article upload is temporarily disabled. The new save API requires the project to be published first.'
			};
		},

		/**
		 * Upload an existing local checkpoint to cloud
		 * 
		 * Requires:
		 * - Project to be published (has artifactId)
		 * - User to be authenticated
		 * - STATE node connected to Loader
		 */
		async uploadCheckpoint(data: UploadCheckpointInput): Promise<PubWikiResult> {
			// Find connected STATE node
			const nodes = context.getNodes();
			const edges = context.getEdges();
			const stateNodeId = findConnectedStateNode(context.loaderNodeId, nodes, edges);
			
			if (!stateNodeId) {
				return {
					success: false,
					error: 'No State node connected to this Loader. Please connect a State node via the state input.'
				};
			}
			
			// Get artifact context
			const artifactCtx = await getArtifactContext(context.projectId);
			if (!artifactCtx.isPublished || !artifactCtx.artifactId || !artifactCtx.artifactCommit) {
				return {
					success: false,
					error: 'Project must be published before uploading checkpoints to cloud.'
				};
			}
			
			// Get user ID
			const userId = context.getCurrentUserId?.();
			if (!userId) {
				return {
					success: false,
					error: 'Please log in to upload checkpoints to cloud.'
				};
			}
			
			// Get STATE node commit
			const stateNodeData = nodeStore.get(stateNodeId);
			const stateNodeCommit = stateNodeData?.commit;
			if (!stateNodeCommit) {
				return {
					success: false,
					error: 'Cannot get STATE node version information.'
				};
			}
			
			try {
				const store = await getNodeRDFStore(stateNodeId);
				const checkpoint = await store.getCheckpoint(data.checkpointId);
				
				if (!checkpoint) {
					return {
						success: false,
						error: `Checkpoint "${data.checkpointId}" not found in local store.`
					};
				}
				
				// Show confirmation dialog
				const initialValues = {
					name: checkpoint.title,
					description: checkpoint.description || '',
					isListed: data.isListed ?? false
				};
				
				const editedValues = await requestConfirmation('uploadCheckpoint', UploadCheckpointForm, initialValues);
				
				if (editedValues === null) {
					return {
						success: false,
						error: 'User cancelled the operation'
					};
				}
				
				// Compute save commit
				const commit = await computeSaveCommit(
					stateNodeId,
					stateNodeCommit,
					userId,
					artifactCtx.artifactId,
					artifactCtx.artifactCommit
				);
				
				// Compute content hash
				const quads = await store.getAllQuads();
				const quadsJson = JSON.stringify(quads);
				const contentHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quadsJson));
				const contentHashArray = Array.from(new Uint8Array(contentHashBuffer));
				const contentHash = contentHashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
				
				// Load checkpoint state temporarily to upload
				await store.loadCheckpoint(data.checkpointId);
				
				// Create cloud save
				const result = await createSaveCheckpoint(store, {
					stateNodeId,
					stateNodeCommit,
					commit,
					sourceArtifactId: artifactCtx.artifactId,
					sourceArtifactCommit: artifactCtx.artifactCommit,
					contentHash,
					title: editedValues.name as string,
					description: editedValues.description as string || undefined,
					isListed: (editedValues.isListed as boolean) ?? false
				});
				
				if (!result.success) {
					return {
						success: false,
						error: result.error || 'Failed to upload checkpoint to cloud.'
					};
				}
				
				return {
					success: true,
					checkpointId: result.save?.commit
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
		 * 
		 * Requires:
		 * - Project to be published (has artifactId)
		 * - User to be authenticated
		 * - STATE node connected to Loader
		 */
		async uploadCheckpoints(data: UploadCheckpointsInput): Promise<PubWikiResult> {
			// Find connected STATE node
			const nodes = context.getNodes();
			const edges = context.getEdges();
			const stateNodeId = findConnectedStateNode(context.loaderNodeId, nodes, edges);
			
			if (!stateNodeId) {
				return {
					success: false,
					error: 'No State node connected to this Loader. Please connect a State node via the state input.'
				};
			}
			
			if (!data.checkpointIds || data.checkpointIds.length === 0) {
				return {
					success: false,
					error: 'No checkpoint IDs provided.'
				};
			}
			
			// Get artifact context
			const artifactCtx = await getArtifactContext(context.projectId);
			if (!artifactCtx.isPublished || !artifactCtx.artifactId || !artifactCtx.artifactCommit) {
				return {
					success: false,
					error: 'Project must be published before uploading checkpoints to cloud.'
				};
			}
			
			// Get user ID
			const userId = context.getCurrentUserId?.();
			if (!userId) {
				return {
					success: false,
					error: 'Please log in to upload checkpoints to cloud.'
				};
			}
			
			// Get STATE node commit
			const stateNodeData = nodeStore.get(stateNodeId);
			const stateNodeCommit = stateNodeData?.commit;
			if (!stateNodeCommit) {
				return {
					success: false,
					error: 'Cannot get STATE node version information.'
				};
			}
			
			try {
				const store = await getNodeRDFStore(stateNodeId);
				
				// Validate all checkpoints exist
				const checkpointsToUpload: { id: string; title: string; description?: string }[] = [];
				for (const checkpointId of data.checkpointIds) {
					const checkpoint = await store.getCheckpoint(checkpointId);
					if (!checkpoint) {
						return {
							success: false,
							error: `Checkpoint "${checkpointId}" not found in local store.`
						};
					}
					checkpointsToUpload.push({
						id: checkpoint.id,
						title: checkpoint.title,
						description: checkpoint.description
					});
				}
				
				// Show confirmation dialog
				const initialValues = {
					count: checkpointsToUpload.length,
					names: checkpointsToUpload.map(c => c.title).join(', '),
					isListed: data.defaultIsListed ?? false
				};
				
				const editedValues = await requestConfirmation('uploadCheckpoints', UploadCheckpointsForm, initialValues);
				
				if (editedValues === null) {
					return {
						success: false,
						error: 'User cancelled the operation'
					};
				}
				
				const isListed = (editedValues.isListed as boolean) ?? false;
				const uploadedIds: string[] = [];
				
				// Upload each checkpoint
				for (const cp of checkpointsToUpload) {
					// Load checkpoint state
					await store.loadCheckpoint(cp.id);
					
					// Compute save commit
					const commit = await computeSaveCommit(
						stateNodeId,
						stateNodeCommit,
						userId,
						artifactCtx.artifactId!,
						artifactCtx.artifactCommit!
					);
					
					// Compute content hash
					const quads = await store.getAllQuads();
					const quadsJson = JSON.stringify(quads);
					const contentHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quadsJson));
					const contentHashArray = Array.from(new Uint8Array(contentHashBuffer));
					const contentHash = contentHashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
					
					// Create cloud save
					const result = await createSaveCheckpoint(store, {
						stateNodeId,
						stateNodeCommit,
						commit,
						sourceArtifactId: artifactCtx.artifactId!,
						sourceArtifactCommit: artifactCtx.artifactCommit!,
						contentHash,
						title: cp.title,
						description: cp.description,
						isListed
					});
					
					if (!result.success) {
						return {
							success: false,
							checkpointIds: uploadedIds,
							error: `Failed to upload checkpoint "${cp.title}": ${result.error}`
						};
					}
					
					uploadedIds.push(cp.id);
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
 * 
 * @param projectId - The project ID
 * @param loaderNodeId - The Loader node ID
 * @param getNodes - Function to get current flow nodes
 * @param getEdges - Function to get current flow edges
 * @param getCurrentUserId - Optional function to get current user ID (for cloud saves)
 */
export function createPubWikiContext(
	projectId: string,
	loaderNodeId: string,
	getNodes: () => Node<FlowNodeData>[],
	getEdges: () => Edge[],
	getCurrentUserId?: () => string | null
): PubWikiModuleContext {
	return {
		projectId,
		loaderNodeId,
		getNodes,
		getEdges,
		apiBaseUrl: API_BASE_URL,
		getCurrentUserId
	};
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the State node connected to a Loader node via the state handle
 * 
 * @param loaderNodeId - The Loader node ID
 * @param nodes - Current flow nodes
 * @param edges - Current flow edges
 * @returns State node ID or null if not found
 */
function findConnectedStateNode(
	loaderNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): string | null {
	const stateEdge = edges.find(
		e => e.target === loaderNodeId && e.targetHandle === HandleId.LOADER_STATE
	);
	
	if (!stateEdge) return null;
	
	const sourceNode = nodes.find(n => n.id === stateEdge.source);
	if (!sourceNode) return null;
	
	const sourceData = nodeStore.get(sourceNode.id);
	if (sourceData?.type === 'STATE') {
		return sourceNode.id;
	}
	
	return null;
}
