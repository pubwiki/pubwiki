/**
 * Publish Utilities for Studio
 *
 * Functions to publish workspace nodes as an artifact to the backend.
 * 
 * After version control refactoring:
 * - Node IDs are globally unique UUIDs, preserved on publish
 * - No Fork-on-Write: editing creates new commits, not new nodes
 * - parent commit tracks version lineage
 * - VFS nodes: files are packaged as tar.gz and uploaded separately
 * - Non-VFS nodes: content is stored in descriptor
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, VFSNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import { createApiClient } from '@pubwiki/api/client';
import { type components, computeArtifactCommit, computeContentHash, computeNodeCommit, computeSha256Hex } from '@pubwiki/api';
import type { BuildDataForPublish } from './build-output-serializer';
import { loadBuildDataForPublish } from './build-output-serializer';
import { API_BASE_URL } from '$lib/config';
import { nodeStore } from '../persistence';
import { packageVfsAsTarGz } from './vfs-archive';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

// API types from OpenAPI schema
type CreateArtifactNode = components['schemas']['CreateArtifactNode'];
type ArtifactEdgeDescriptor = components['schemas']['ArtifactEdgeDescriptor'];
type ArtifactNodeContent = components['schemas']['ArtifactNodeContent'];

// ============================================================================
// Descriptor and FormData Creation
// ============================================================================
export interface PublishMetadata {
	/** Artifact ID - client-generated UUID, used for both create and update */
	artifactId: string;
	name: string;
	slug: string;
	description: string;
	/** Whether the artifact is listed in public discovery */
	isListed: boolean;
	/** Whether the artifact is private (only owner/authorized users can access) */
	isPrivate: boolean;
	version: string;
	tags: string[];
	/** Optional homepage content in Markdown format */
	homepage?: string;
	/** Optional commit tags (e.g., ["draft-latest"]) */
	commitTags?: string[];
	/** Parent commit hash for updates (null for initial publish) */
	parentCommit?: string | null;
	/** Optional entrypoint for sandbox launch */
	entrypoint?: {
		saveCommit: string;
		sandboxNodeId: string;
	};
}

/**
 * Node type for API - all studio node types are publishable
 */
type ApiNodeType = components['schemas']['ArtifactNodeType'];

/**
 * Result of preparing nodes for publish
 */
interface PreparedNodes {
	/** Node descriptors for the API */
	nodes: CreateArtifactNode[];
	/** VFS archives keyed by filesHash (SHA-256 of archive) for upload */
	vfsArchives: Map<string, Uint8Array>;
}

/**
 * Prepare nodes for publish
 * 
 * In the new version control architecture:
 * - All nodes are published with their content
 * - nodeId is preserved (globally unique UUID)
 * - parent tracks version lineage
 * - No Fork-on-Write needed
 * 
 * After content-hash-realtime-update refactoring:
 * - Sync versions first to ensure contentHash/commit are up-to-date
 * - VFS nodes: content.toJSON() includes complete file info, hash is consistent
 * - Non-VFS nodes: directly use freshData.contentHash (already up-to-date)
 */
async function prepareNodesForPublish(
	nodes: Node<StudioNodeData>[]
): Promise<PreparedNodes> {
	const apiNodes: CreateArtifactNode[] = [];
	const vfsArchives = new Map<string, Uint8Array>();

	// Ensure all nodes' versions are up-to-date (contentHash/commit)
	await nodeStore.ensureVersionsSynced(nodes.map(n => n.id));

	for (const node of nodes) {
		const freshData = nodeStore.get(node.id)!;
		let nodeContent: ArtifactNodeContent;

		if (freshData.type === 'VFS') {
			// VFS: transform to API format with filesHash and file metadata
			const vfsData = freshData as VFSNodeData;
			const { archive, totalFiles, totalSize, files } = await packageVfsAsTarGz(
				vfsData.content.projectId,
				node.id
			);
			// Compute SHA-256 of the archive for the filesHash field and form data key
			const filesHash = await computeSha256Hex(archive.buffer as ArrayBuffer);
			vfsArchives.set(filesHash, archive);

			nodeContent = {
				type: 'VFS' as const,
				filesHash,
				mounts: vfsData.content.mounts,
				fileCount: totalFiles,
				totalSize,
				fileTree: files
			} as ArtifactNodeContent;
		} else {
			// Other types (including STATE): toJSON() matches API format
			nodeContent = freshData.content.toJSON() as ArtifactNodeContent;
		}

		// Compute contentHash from the actual API-format content being sent.
		// For VFS nodes this is critical: local format ({projectId}) differs from
		// API format ({filesHash, files, ...}), so the local contentHash is invalid.
		// For other types toJSON() == API format, so this is a no-op in practice.
		const contentHash = await computeContentHash(nodeContent);
		const commit = await computeNodeCommit(
			freshData.id,
			freshData.parent ?? null,
			contentHash,
			freshData.type
		);

		const apiNode: CreateArtifactNode = {
			nodeId: freshData.id,
			commit,
			parent: freshData.parent ?? null,
			type: freshData.type as ApiNodeType,
			name: freshData.name || undefined,
			position: { x: node.position.x, y: node.position.y },
			content: nodeContent,
			contentHash
		};

		apiNodes.push(apiNode);
	}

	return { nodes: apiNodes, vfsArchives };
}

export interface PublishResult {
	success: boolean;
	artifactId?: string;
	/** Commit hash of the created version */
	latestCommit?: string;
	error?: string;
}

/**
 * Validate STATE nodes before publish
 * 
 * NOTE: Cloud checkpoint validation is temporarily disabled pending new Save API migration.
 * STATE nodes can be published without cloud checkpoints. Local state data will be included
 * in the published artifact, but cloud save sync features are not available until the
 * new Save API is fully implemented.
 */
function validateStateNodes(): { valid: boolean; error?: string } {
	// Cloud checkpoint validation is temporarily disabled
	// STATE nodes can be published with local data only
	return { valid: true };
}

/**
 * Publish nodes as an artifact to the backend
 * 
 * In the new version control architecture:
 * - All nodes are published with their original nodeId
 * - No Fork-on-Write - editing creates new commits, not new nodes
 * - parent commit tracks version lineage
 * 
 * Authentication is handled via session cookie (credentials: 'include')
 */
export async function publishArtifact(
	metadata: PublishMetadata,
	flowNodes: Node<FlowNodeData>[],
	edges: Edge[],
	buildCacheKey?: string
): Promise<PublishResult> {
	// Reconstruct full nodes with business data from nodeStore
	let nodes: Node<StudioNodeData>[] = flowNodes
		.map(n => {
			const data = nodeStore.get(n.id);
			if (!data) return null;
			return {
				...n,
				data: data as StudioNodeData
			};
		})
		.filter((n): n is Node<StudioNodeData> => n !== null);

	// Re-fetch node data after auto-selection (since nodeStore was updated)
	nodes = flowNodes
		.map(n => {
			const data = nodeStore.get(n.id);
			if (!data) return null;
			return {
				...n,
				data: data as StudioNodeData
			};
		})
		.filter((n): n is Node<StudioNodeData> => n !== null);

	// Validate STATE nodes have checkpoints
	const stateValidation = validateStateNodes();
	if (!stateValidation.valid) {
		return {
			success: false,
			error: stateValidation.error
		};
	}

	// Prepare nodes and VFS archives
	const { nodes: apiNodes, vfsArchives } = await prepareNodesForPublish(nodes);

	// Convert edges to API format
	const apiEdges: ArtifactEdgeDescriptor[] = edges.map((edge) => ({
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle ?? undefined,
		targetHandle: edge.targetHandle ?? undefined
	}));

	// Compute the artifact version commit hash
	// For new artifacts, parentCommit is null; for updates, it should be the previous version
	const commitNodes = apiNodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
	const commitEdges = apiEdges.map(e => ({
		source: e.source,
		target: e.target,
		sourceHandle: e.sourceHandle ?? null,
		targetHandle: e.targetHandle ?? null
	}));
	const commit = await computeArtifactCommit(
		metadata.artifactId,
		metadata.parentCommit ?? null,
		commitNodes,
		commitEdges
	);

	try {
		// Package build output archive from OPFS cache (lazy — not stored in memory)
		let buildData: BuildDataForPublish | undefined;
		if (buildCacheKey) {
			const loaded = await loadBuildDataForPublish(buildCacheKey);
			if (loaded) buildData = loaded;
		}

		// Build the API metadata with buildCacheKey as top-level field
		const apiMetadata = {
			artifactId: metadata.artifactId,
			commit,
			parentCommit: metadata.parentCommit ?? null,
			name: metadata.name,
			description: metadata.description || undefined,
			isListed: metadata.isListed,
			isPrivate: metadata.isPrivate,
			version: metadata.version,
			tags: metadata.tags.length > 0 ? metadata.tags : undefined,
			commitTags: metadata.commitTags && metadata.commitTags.length > 0 ? metadata.commitTags : undefined,
			entrypoint: metadata.entrypoint || undefined,
			// buildCacheKey is now a top-level field (not inside entrypoint)
			buildCacheKey: buildCacheKey,
		};

		// Use openapi-fetch with bodySerializer for multipart/form-data
		// See: https://openapi-ts.dev/openapi-fetch/api#bodyserializer
		const { data, error, response } = await apiClient.POST('/artifacts', {
			body: {
				metadata: apiMetadata,
				nodes: apiNodes,
				edges: apiEdges,
				// VFS archives will be added in bodySerializer
				_vfsArchives: vfsArchives,
				// Homepage markdown if provided
				_homepage: metadata.homepage,
				// Pre-packaged build data from OPFS (if any)
				_buildData: buildData
			},
			bodySerializer: (body) => {
				const formData = new FormData();
				
				// Add metadata as JSON string
				formData.append('metadata', JSON.stringify(body.metadata));
				
				// Add nodes and edges as JSON strings
				formData.append('nodes', JSON.stringify(body.nodes));
				formData.append('edges', JSON.stringify(body.edges));
				
				// Add VFS tar.gz archives keyed by filesHash
				const archives = body._vfsArchives as Map<string, Uint8Array>;
				for (const [filesHash, archive] of archives.entries()) {
					const blob = new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: 'application/gzip' });
					formData.append(`vfs[${filesHash}]`, blob, `${filesHash}.tar.gz`);
				}
				
				// Add build output archive + metadata if available
				const bd = body._buildData as BuildDataForPublish | undefined;
				if (bd) {
					const blob = new Blob([bd.archive.buffer as ArrayBuffer], { type: 'application/gzip' });
					formData.append(`build[${bd.buildCacheKey}]`, blob, `${bd.buildCacheKey}.tar.gz`);
					// Send per-file hashes as JSON metadata for build_cache table
					formData.append(`buildMeta[${bd.buildCacheKey}]`, JSON.stringify(bd.fileHashes));
				}
				
				// Add homepage markdown if provided
				const homepage = body._homepage as string | undefined;
				if (homepage && homepage.trim().length > 0) {
					const homepageBlob = new Blob([homepage], { type: 'text/markdown' });
					formData.append('homepage', homepageBlob, 'homepage.md');
				}
				
				return formData;
			}
		});

		if (error) {
			return {
				success: false,
				error: error.error || `HTTP ${response.status}: ${response.statusText}`
			};
		}

		return {
			success: true,
			artifactId: data?.artifact?.id,
			latestCommit: data?.commitHash
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Network error'
		};
	}
}

// ============================================================================
// PATCH Artifact - Incremental Update
// ============================================================================

/**
 * Metadata for patching an existing artifact
 */
export interface PatchMetadata {
	/** Artifact ID to patch */
	artifactId: string;
	/** Base commit hash to apply patch on */
	baseCommit: string;
	/** Optional new version string */
	version?: string;
	/** Optional changelog */
	changelog?: string;
	/** Optional commit tags (e.g., ["draft-latest"]) */
	commitTags?: string[];
	/** Optional entrypoint for sandbox launch */
	entrypoint?: {
		saveCommit: string;
		sandboxNodeId: string;
	};
}

/**
 * Graph data from backend for computing diff
 */
interface BaseGraph {
	nodes: Array<{
		id: string;
		type: string;
		commit: string;
		contentHash: string;
		name?: string | null;
		position?: { x?: number; y?: number };
		content?: unknown;
	}>;
	edges: Array<{
		source: string;
		target: string;
		sourceHandle?: string;
		targetHandle?: string;
	}>;
}

/**
 * Fetch the graph of a specific artifact version
 */
async function fetchBaseGraph(artifactId: string, commit: string): Promise<BaseGraph | null> {
	try {
		const { data, error } = await apiClient.GET('/artifacts/{artifactId}/graph', {
			params: {
				path: { artifactId },
				query: { version: commit }
			}
		});

		if (error || !data) {
			console.error('Failed to fetch base graph:', error);
			return null;
		}

		return {
			nodes: data.nodes.map(n => ({
				id: n.id,
				type: n.type,
				commit: n.commit,
				contentHash: n.contentHash,
				name: n.name,
				position: n.position,
				content: n.content
			})),
			edges: data.edges.map(e => ({
				source: e.source,
				target: e.target,
				sourceHandle: e.sourceHandle,
				targetHandle: e.targetHandle
			}))
		};
	} catch (err) {
		console.error('Error fetching base graph:', err);
		return null;
	}
}

/**
 * Compute the diff between current nodes/edges and base graph
 */
function computeGraphDiff(
	currentNodes: CreateArtifactNode[],
	currentEdges: ArtifactEdgeDescriptor[],
	baseGraph: BaseGraph
): {
	addNodes: CreateArtifactNode[];
	removeNodeIds: string[];
	addEdges: ArtifactEdgeDescriptor[];
	removeEdges: ArtifactEdgeDescriptor[];
} {
	const baseNodeMap = new Map(baseGraph.nodes.map(n => [n.id, n]));
	const currentNodeMap = new Map(currentNodes.map(n => [n.nodeId, n]));

	// Find added/modified nodes
	const addNodes: CreateArtifactNode[] = [];
	for (const node of currentNodes) {
		const baseNode = baseNodeMap.get(node.nodeId);
		if (!baseNode) {
			// New node
			addNodes.push(node);
		} else if (baseNode.commit !== node.commit) {
			// Modified node (different commit)
			addNodes.push(node);
		}
	}

	// Find removed nodes
	const removeNodeIds: string[] = [];
	for (const baseNode of baseGraph.nodes) {
		if (!currentNodeMap.has(baseNode.id)) {
			removeNodeIds.push(baseNode.id);
		}
	}

	// Edge comparison helper
	const edgeKey = (e: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) =>
		`${e.source}|${e.target}|${e.sourceHandle ?? ''}|${e.targetHandle ?? ''}`;

	const baseEdgeSet = new Set(baseGraph.edges.map(edgeKey));
	const currentEdgeSet = new Set(currentEdges.map(edgeKey));

	// Find added edges
	const addEdges: ArtifactEdgeDescriptor[] = currentEdges.filter(e => !baseEdgeSet.has(edgeKey(e)));

	// Find removed edges
	const removeEdges: ArtifactEdgeDescriptor[] = baseGraph.edges
		.filter(e => !currentEdgeSet.has(edgeKey(e)))
		.map(e => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle
		}));

	return { addNodes, removeNodeIds, addEdges, removeEdges };
}

export interface PatchResult {
	success: boolean;
	/** New commit hash from the response */
	newCommit?: string;
	/** Whether graph changes were sent (addNodes/removeNodes/addEdges/removeEdges) */
	hasGraphChanges?: boolean;
	error?: string;
}

/**
 * Patch an existing artifact with incremental changes
 * 
 * This is more efficient than full publish when only a few nodes changed.
 * The backend merges the base version with the patch to create a new version.
 * 
 * @param metadata - Patch metadata including artifactId and baseCommit
 * @param flowNodes - Current nodes in the workspace
 * @param edges - Current edges in the workspace
 */
export async function patchArtifact(
	metadata: PatchMetadata,
	flowNodes: Node<FlowNodeData>[],
	edges: Edge[],
	buildCacheKey?: string
): Promise<PatchResult> {
	// Reconstruct full nodes with business data from nodeStore
	const nodes: Node<StudioNodeData>[] = flowNodes
		.map(n => {
			const data = nodeStore.get(n.id);
			if (!data) return null;
			return {
				...n,
				data: data as StudioNodeData
			};
		})
		.filter((n): n is Node<StudioNodeData> => n !== null);

	// Fetch base graph for diff computation
	const baseGraph = await fetchBaseGraph(metadata.artifactId, metadata.baseCommit);
	if (!baseGraph) {
		return {
			success: false,
			error: 'Failed to fetch base version graph. Please try a full publish instead.'
		};
	}

	// Prepare current nodes
	const { nodes: currentNodes, vfsArchives } = await prepareNodesForPublish(nodes);
	// Convert null handles to undefined for API compatibility
	const currentEdges: ArtifactEdgeDescriptor[] = edges.map(edge => ({
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle ?? undefined,
		targetHandle: edge.targetHandle ?? undefined
	}));

	// Compute diff
	const { addNodes, removeNodeIds, addEdges, removeEdges } = computeGraphDiff(
		currentNodes,
		currentEdges,
		baseGraph
	);

	// Check if there are any changes
	const hasChanges = addNodes.length > 0 || removeNodeIds.length > 0 || 
					   addEdges.length > 0 || removeEdges.length > 0;

	// No graph changes: skip PATCH, return current baseCommit
	if (!hasChanges) {
		return {
			success: true,
			newCommit: metadata.baseCommit,
			hasGraphChanges: false
		};
	}

	// Compute merged graph (base + patch) for commit hash computation.
	const addNodeIds = new Set(addNodes.map(n => n.nodeId));
	const patchedNodes = [
		...baseGraph.nodes.filter(n => !removeNodeIds.includes(n.id) && !addNodeIds.has(n.id)),
		...addNodes
	];
	const patchedEdges = [
		...baseGraph.edges.filter(e => !removeEdges.some(re => re.source === e.source && re.target === e.target)),
		...addEdges
	];
	const commitNodes = patchedNodes.map(n => ({
		nodeId: 'nodeId' in n ? n.nodeId : n.id,
		commit: n.commit
	}));
	const commitEdges = patchedEdges.map(e => ({
		source: e.source,
		target: e.target,
		sourceHandle: e.sourceHandle ?? null,
		targetHandle: e.targetHandle ?? null
	}));
	const commit = await computeArtifactCommit(
		metadata.artifactId,
		metadata.baseCommit,
		commitNodes,
		commitEdges
	);

	// Build patch request metadata
	const patchMetadata: components['schemas']['PatchArtifactRequest'] = {
		artifactId: metadata.artifactId,
		baseCommit: metadata.baseCommit,
		commit
	};

	// Add optional metadata fields
	if (metadata.version) patchMetadata.version = metadata.version;
	if (metadata.changelog) patchMetadata.changelog = metadata.changelog;
	if (metadata.commitTags) patchMetadata.commitTags = metadata.commitTags;
	// Add buildCacheKey at top level if available
	if (buildCacheKey) patchMetadata.buildCacheKey = buildCacheKey;
	if (metadata.entrypoint) patchMetadata.entrypoint = metadata.entrypoint;

	// Add graph changes
	patchMetadata.addNodes = addNodes;
	if (removeNodeIds.length > 0) patchMetadata.removeNodeIds = removeNodeIds;
	if (addEdges.length > 0) patchMetadata.addEdges = addEdges;
	if (removeEdges.length > 0) patchMetadata.removeEdges = removeEdges;

	// Collect VFS archives for new/modified VFS nodes (filter by filesHash from addNodes' content)
	const addFilesHashes = new Set(
		addNodes
			.filter(n => n.type === 'VFS')
			.map(n => (n.content as { filesHash: string }).filesHash)
	);
	const patchVfsArchives = new Map<string, Uint8Array>();
	for (const [filesHash, archive] of vfsArchives.entries()) {
		if (addFilesHashes.has(filesHash)) {
			patchVfsArchives.set(filesHash, archive);
		}
	}

	try {
		// Package build output archive from OPFS cache (lazy — not stored in memory)
		let buildData: BuildDataForPublish | undefined;
		if (buildCacheKey) {
			const loaded = await loadBuildDataForPublish(buildCacheKey);
			if (loaded) buildData = loaded;
		}

		// Use openapi-fetch with bodySerializer for multipart/form-data
		// See: https://openapi-ts.dev/openapi-fetch/api#bodyserializer
		const { data, error, response } = await apiClient.PATCH('/artifacts', {
			body: {
				metadata: patchMetadata,
				// VFS archives will be added in bodySerializer
				_vfsArchives: patchVfsArchives,
				// Pre-packaged build data from OPFS (if any)
				_buildData: buildData
			},
			bodySerializer: (body) => {
				const formData = new FormData();
				
				// Add metadata as JSON string
				formData.append('metadata', JSON.stringify(body.metadata));
				
				// Add VFS tar.gz archives keyed by filesHash
				const archives = body._vfsArchives as Map<string, Uint8Array>;
				for (const [filesHash, archive] of archives.entries()) {
					const blob = new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: 'application/gzip' });
					formData.append(`vfs[${filesHash}]`, blob, `${filesHash}.tar.gz`);
				}

				// Add build output archive + metadata if available
				const bd = body._buildData as BuildDataForPublish | undefined;
				if (bd) {
					const blob = new Blob([bd.archive.buffer as ArrayBuffer], { type: 'application/gzip' });
					formData.append(`build[${bd.buildCacheKey}]`, blob, `${bd.buildCacheKey}.tar.gz`);
					// Send per-file hashes as JSON metadata for build_cache table
					formData.append(`buildMeta[${bd.buildCacheKey}]`, JSON.stringify(bd.fileHashes));
				}
				
				return formData;
			}
		});

		if (error) {
			return {
				success: false,
				error: error.error || `HTTP ${response.status}: ${response.statusText}`
			};
		}

		return {
			success: true,
			newCommit: data?.commitHash,
			hasGraphChanges: true
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Network error'
		};
	}
}