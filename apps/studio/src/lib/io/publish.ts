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
import type { StudioNodeData, VFSNodeData, StateNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import type { VisibilityType } from '$lib/types';
import { StateContent } from '../types';
import { createApiClient, type paths } from '@pubwiki/api/client';
import { type components, computeArtifactCommit, computeNodeCommit, computeContentHash } from '@pubwiki/api';
import { API_BASE_URL } from '$lib/config';
import { getNodeVfs } from '../vfs';
import { nodeStore } from '../persistence';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

// API types from OpenAPI schema
type CreateArtifactMetadata = components['schemas']['CreateArtifactMetadata'];
type CreateArtifactNode = components['schemas']['CreateArtifactNode'];
type ArtifactEdgeDescriptor = components['schemas']['ArtifactEdgeDescriptor'];
type ArtifactNodeContent = components['schemas']['ArtifactNodeContent'];

// ============================================================================
// Simple TAR Implementation
// ============================================================================

/**
 * Create a TAR header for a file
 * TAR uses 512-byte headers with ustar format
 */
function createTarHeader(filename: string, size: number): Uint8Array {
	const header = new Uint8Array(512);
	const encoder = new TextEncoder();
	
	// Truncate filename to 100 chars (TAR limit)
	const name = filename.slice(0, 100);
	
	// File name (0-99)
	header.set(encoder.encode(name), 0);
	
	// File mode (100-107) - regular file with 644 permissions
	header.set(encoder.encode('0000644\0'), 100);
	
	// UID (108-115) - 0
	header.set(encoder.encode('0000000\0'), 108);
	
	// GID (116-123) - 0
	header.set(encoder.encode('0000000\0'), 116);
	
	// File size in octal (124-135)
	const sizeOctal = size.toString(8).padStart(11, '0') + ' ';
	header.set(encoder.encode(sizeOctal), 124);
	
	// Modification time (136-147) - current time
	const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
	header.set(encoder.encode(mtime), 136);
	
	// Checksum placeholder (148-155) - filled with spaces for calculation
	header.set(encoder.encode('        '), 148);
	
	// Type flag (156) - '0' for regular file
	header[156] = 0x30; // '0'
	
	// Link name (157-256) - empty
	
	// Magic (257-262) - 'ustar\0'
	header.set(encoder.encode('ustar\0'), 257);
	
	// Version (263-264) - '00'
	header.set(encoder.encode('00'), 263);
	
	// Calculate checksum (sum of all bytes in header, treating checksum field as spaces)
	let checksum = 0;
	for (let i = 0; i < 512; i++) {
		checksum += header[i];
	}
	const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
	header.set(encoder.encode(checksumStr), 148);
	
	return header;
}

/**
 * Create a TAR archive from files
 */
function createTar(files: { path: string; content: Uint8Array }[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	
	for (const file of files) {
		// Create header
		const header = createTarHeader(file.path, file.content.byteLength);
		chunks.push(header);
		
		// Add file content
		chunks.push(file.content);
		
		// Pad to 512-byte boundary
		const padding = 512 - (file.content.byteLength % 512);
		if (padding < 512) {
			chunks.push(new Uint8Array(padding));
		}
	}
	
	// Add two empty blocks to mark end of archive
	chunks.push(new Uint8Array(1024));
	
	// Concatenate all chunks
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	
	return result;
}

/**
 * Compress data using gzip via CompressionStream API
 */
async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
	const stream = new CompressionStream('gzip');
	const writer = stream.writable.getWriter();
	// Create a new ArrayBuffer to avoid TypeScript type issues with SharedArrayBuffer
	const buffer = new Uint8Array(data).buffer as ArrayBuffer;
	writer.write(buffer);
	writer.close();
	
	const chunks: Uint8Array[] = [];
	const reader = stream.readable.getReader();
	
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	
	return result;
}

/**
 * Metadata for publishing an artifact
 */
export interface PublishMetadata {
	/** Artifact ID - client-generated UUID, used for both create and update */
	artifactId: string;
	name: string;
	slug: string;
	description: string;
	visibility: VisibilityType;
	version: string;
	tags: string[];
	/** Optional homepage content in Markdown format */
	homepage?: string;
	/** Optional commit tags (e.g., ["draft-latest"]) */
	commitTags?: string[];
	/** Parent commit hash for updates (null for initial publish) */
	parentCommit?: string | null;
}

/**
 * Node type for API - all studio node types are publishable
 */
type ApiNodeType = components['schemas']['ArtifactNodeType'];

/**
 * File info for VFS packaging
 */
interface VfsFileInfo {
	path: string;
	content: Uint8Array;
}

/**
 * Collect all files with content from a VFS
 */
async function collectVfsFiles(
	projectId: string,
	nodeId: string
): Promise<VfsFileInfo[]> {
	const vfs = await getNodeVfs(projectId, nodeId);
	const files: VfsFileInfo[] = [];

	async function collectRecursive(path: string): Promise<void> {
		const items = await vfs.listFolder(path);
		for (const item of items) {
			if ('folderPath' in item) {
				// It's a file - read its content
				const file = await vfs.readFile(item.path);
				if (file.content) {
					const content = typeof file.content === 'string' 
						? new TextEncoder().encode(file.content)
						: new Uint8Array(file.content);
					files.push({ path: item.path, content });
				}
			} else {
				// It's a folder, recurse into it
				await collectRecursive(item.path);
			}
		}
	}

	try {
		await collectRecursive('/');
	} catch {
		// VFS might be empty or not initialized
	}

	return files;
}

/**
 * File info for VFS content in descriptor
 */
interface VfsContentFileInfo {
	path: string;
	size: number;
	mimeType?: string;
}

/**
 * Package VFS files as a tar.gz archive
 * Returns file info for descriptor content
 */
async function packageVfsAsTarGz(
	projectId: string,
	nodeId: string
): Promise<{ archive: Uint8Array; totalFiles: number; totalSize: number; files: VfsContentFileInfo[] }> {
	const collectedFiles = await collectVfsFiles(projectId, nodeId);
	
	let totalSize = 0;
	const tarFiles: { path: string; content: Uint8Array }[] = [];
	const fileInfos: VfsContentFileInfo[] = [];
	
	for (const file of collectedFiles) {
		// Remove leading slash for tar path
		const tarPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
		tarFiles.push({ path: tarPath, content: file.content });
		totalSize += file.content.byteLength;
		
		// Build file info for descriptor content
		fileInfos.push({
			path: tarPath,
			size: file.content.byteLength,
			mimeType: guessMimeType(tarPath)
		});
	}
	
	const tarData = createTar(tarFiles);
	const gzipped = await gzipCompress(tarData);
	
	return {
		archive: gzipped,
		totalFiles: collectedFiles.length,
		totalSize,
		files: fileInfos
	};
}

/**
 * Guess MIME type from file extension
 */
function guessMimeType(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	const mimeTypes: Record<string, string> = {
		'txt': 'text/plain',
		'md': 'text/markdown',
		'json': 'application/json',
		'js': 'text/javascript',
		'ts': 'text/typescript',
		'html': 'text/html',
		'css': 'text/css',
		'xml': 'application/xml',
		'yaml': 'text/yaml',
		'yml': 'text/yaml',
		'lua': 'text/x-lua',
		'png': 'image/png',
		'jpg': 'image/jpeg',
		'jpeg': 'image/jpeg',
		'gif': 'image/gif',
		'svg': 'image/svg+xml',
		'webp': 'image/webp',
		'pdf': 'application/pdf',
		'zip': 'application/zip',
		'tar': 'application/x-tar',
		'gz': 'application/gzip',
	};
	return mimeTypes[ext] ?? 'application/octet-stream';
}

// ============================================================================
// Descriptor and FormData Creation
// ============================================================================

/**
 * Result of preparing nodes for publish
 */
interface PreparedNodes {
	/** Node descriptors for the API */
	nodes: CreateArtifactNode[];
	/** VFS nodes that need tar.gz archives uploaded (nodeId -> archive data) */
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
		const nodeContent = freshData.content.toJSON() as ArtifactNodeContent;
		
		// VFS needs to package file archive (but no need to recompute hash,
		// since local already includes complete info)
		if (freshData.type === 'VFS') {
			const vfsData = freshData as VFSNodeData;
			const { archive } = await packageVfsAsTarGz(
				vfsData.content.projectId,
				node.id
			);
			vfsArchives.set(node.id, archive);
		}

		const apiNode: CreateArtifactNode = {
			nodeId: freshData.id,
			commit: freshData.commit,
			parent: freshData.parent ?? undefined,
			type: freshData.type as ApiNodeType,
			name: freshData.name || undefined,
			position: { x: node.position.x, y: node.position.y },
			content: nodeContent,
			contentHash: freshData.contentHash  // Directly use, already up-to-date
		};

		apiNodes.push(apiNode);
	}

	return { nodes: apiNodes, vfsArchives };
}

export interface PublishResult {
	success: boolean;
	artifactId?: string;
	/** Latest commit hash after publish */
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
function validateStateNodes(_nodes: Node<StudioNodeData>[]): { valid: boolean; error?: string } {
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
	edges: Edge[]
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
	const stateValidation = validateStateNodes(nodes);
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
		// Use openapi-fetch with bodySerializer for multipart/form-data
		// See: https://openapi-ts.dev/openapi-fetch/api#bodyserializer
		const { data, error, response } = await apiClient.POST('/artifacts', {
			body: {
				metadata: {
					artifactId: metadata.artifactId,
					commit,
					parentCommit: metadata.parentCommit ?? null,
					name: metadata.name,
					description: metadata.description || undefined,
					visibility: metadata.visibility,
					version: metadata.version,
					tags: metadata.tags.length > 0 ? metadata.tags : undefined,
					commitTags: metadata.commitTags && metadata.commitTags.length > 0 ? metadata.commitTags : undefined
				},
				nodes: apiNodes,
				edges: apiEdges,
				// VFS archives will be added in bodySerializer
				_vfsArchives: vfsArchives,
				// Homepage markdown if provided
				_homepage: metadata.homepage
			},
			bodySerializer: (body) => {
				const formData = new FormData();
				
				// Add metadata as JSON string
				formData.append('metadata', JSON.stringify(body.metadata));
				
				// Add nodes and edges as JSON strings
				formData.append('nodes', JSON.stringify(body.nodes));
				formData.append('edges', JSON.stringify(body.edges));
				
				// Add VFS tar.gz archives with dynamic keys
				const archives = body._vfsArchives as Map<string, Uint8Array>;
				for (const [nodeId, archive] of archives.entries()) {
					const blob = new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: 'application/gzip' });
					formData.append(`vfs[${nodeId}]`, blob, `${nodeId}.tar.gz`);
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

		const artifactId = data?.artifact?.id;

		// Fetch the latest commit hash
		let latestCommit: string | undefined;
		if (artifactId) {
			try {
				const graphResponse = await apiClient.GET('/artifacts/{artifactId}/graph', {
					params: {
						path: { artifactId },
						query: { version: 'latest' }
					}
				});
				latestCommit = graphResponse.data?.version?.commitHash;
			} catch {
				// Non-fatal: continue without commit hash
				console.warn('Failed to fetch latest commit hash after publish');
			}
		}

		return {
			success: true,
			artifactId,
			latestCommit
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
	/** Optional visibility change */
	visibility?: VisibilityType;
	/** Optional name change */
	name?: string;
	/** Optional description change */
	description?: string;
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
	/** New commit hash if a new version was created */
	newCommit?: string;
	/** Whether a new version was created (false = metadata-only update) */
	versionCreated?: boolean;
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
	edges: Edge[]
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

	// Build patch request metadata
	const patchMetadata: components['schemas']['PatchArtifactRequest'] = {
		artifactId: metadata.artifactId,
		baseCommit: metadata.baseCommit
	};

	// Add optional metadata fields
	if (metadata.version) patchMetadata.version = metadata.version;
	if (metadata.changelog) patchMetadata.changelog = metadata.changelog;
	if (metadata.commitTags) patchMetadata.commitTags = metadata.commitTags;
	if (metadata.visibility) patchMetadata.visibility = metadata.visibility;
	if (metadata.name) patchMetadata.name = metadata.name;
	if (metadata.description) patchMetadata.description = metadata.description;

	// Add graph changes if any
	if (hasChanges) {
		// addNodes is already CreateArtifactNode[]
		patchMetadata.addNodes = addNodes;
		if (removeNodeIds.length > 0) patchMetadata.removeNodeIds = removeNodeIds;
		if (addEdges.length > 0) patchMetadata.addEdges = addEdges;
		if (removeEdges.length > 0) patchMetadata.removeEdges = removeEdges;

		// Compute commit hash for the patched version
		// Merge base graph with changes
		// Note: addNodes may include both new nodes and modified nodes (nodes with different commits)
		// We need to exclude modified nodes from baseGraph to avoid duplicates
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
		patchMetadata.commit = await computeArtifactCommit(
			metadata.artifactId,
			metadata.baseCommit,
			commitNodes,
			commitEdges
		);
	}

	// Collect VFS archives for new/modified VFS nodes
	const vfsAddNodeIds = new Set(addNodes.map(n => n.nodeId));
	const patchVfsArchives = new Map<string, Uint8Array>();
	for (const [nodeId, archive] of vfsArchives.entries()) {
		if (vfsAddNodeIds.has(nodeId)) {
			patchVfsArchives.set(nodeId, archive);
		}
	}

	try {
		// Use openapi-fetch with bodySerializer for multipart/form-data
		// See: https://openapi-ts.dev/openapi-fetch/api#bodyserializer
		const { data, error, response } = await apiClient.PATCH('/artifacts', {
			body: {
				metadata: patchMetadata,
				// VFS archives will be added in bodySerializer
				_vfsArchives: patchVfsArchives
			},
			bodySerializer: (body) => {
				const formData = new FormData();
				
				// Add metadata as JSON string
				formData.append('metadata', JSON.stringify(body.metadata));
				
				// Add VFS tar.gz archives with dynamic keys
				const archives = body._vfsArchives as Map<string, Uint8Array>;
				for (const [nodeId, archive] of archives.entries()) {
					const blob = new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: 'application/gzip' });
					formData.append(`vfs[${nodeId}]`, blob, `${nodeId}.tar.gz`);
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

		// Fetch the new commit hash (ArtifactListItem doesn't include it directly)
		let newCommit: string | undefined;
		if (data?.versionCreated) {
			try {
				const graphResponse = await apiClient.GET('/artifacts/{artifactId}/graph', {
					params: {
						path: { artifactId: metadata.artifactId },
						query: { version: 'latest' }
					}
				});
				newCommit = graphResponse.data?.version?.commitHash;
			} catch {
				console.warn('Failed to fetch new commit hash after patch');
			}
		}

		return {
			success: true,
			newCommit,
			versionCreated: data?.versionCreated
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Network error'
		};
	}
}