/**
 * Publish Utilities for Studio
 *
 * Functions to publish workspace nodes as an artifact to the backend.
 * 
 * After content-type refactoring:
 * - All node content is stored in node.data.content
 * - Content is uploaded as JSON for structured data preservation
 * - VFS nodes upload all files and include file list in descriptor
 * 
 * After layer separation:
 * - FlowNodeData for flow layer
 * - nodeStore for business data
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, VFSNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import type { ArtifactType, VisibilityType } from '$lib/types';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import { getNodeVfs } from '../vfs';
import { nodeStore } from '../persistence';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

/**
 * Metadata for publishing an artifact
 */
export interface PublishMetadata {
	/** Artifact ID - client-generated UUID, used for both create and update */
	artifactId: string;
	type: ArtifactType;
	name: string;
	slug: string;
	description: string;
	visibility: VisibilityType;
	version: string;
	tags: string[];
	/** Optional homepage content in Markdown format */
	homepage?: string;
}

/**
 * Node type for API - all studio node types are publishable
 */
type ApiNodeType = 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'LOADER' | 'SANDBOX' | 'STATE';

/**
 * Reference to the original external node that was forked
 */
interface OriginalRefDescriptor {
	nodeId: string;
	commit: string;
}

/**
 * Artifact descriptor for API
 */
interface ArtifactNodeDescriptor {
	id: string;
	external?: boolean;
	type: ApiNodeType;
	name?: string;
	files?: string[];
	/** Reference to the original external node (for Fork-on-Write) */
	originalRef?: OriginalRefDescriptor;
}

interface ArtifactEdgeDescriptor {
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
}

interface ArtifactDescriptor {
	version: number;
	exportedAt: string;
	nodes: ArtifactNodeDescriptor[];
	edges: ArtifactEdgeDescriptor[];
}

// ============================================================================
// VFS File Collection Helpers
// ============================================================================

/**
 * Recursively collect all file paths from a VFS
 */
async function collectVfsFilePaths(
	projectId: string,
	nodeId: string
): Promise<string[]> {
	const vfs = await getNodeVfs(projectId, nodeId);
	const filePaths: string[] = [];

	async function collectRecursive(path: string): Promise<void> {
		const items = await vfs.listFolder(path);
		for (const item of items) {
			if ('folderPath' in item) {
				// It's a file (VfsFile has folderPath, VfsFolder has parentPath)
				filePaths.push(item.path);
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

	return filePaths;
}

/**
 * File info for VFS upload
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

// ============================================================================
// Descriptor and FormData Creation
// ============================================================================

/**
 * Check if an external node has been modified since import
 * A node is considered modified if its current commit differs from the original commit
 */
function isExternalNodeModified(node: StudioNodeData): boolean {
	if (!node.external) return false;
	if (!node.originalRef) return false;
	// Compare current commit with original commit
	return node.commit !== node.originalRef.commit;
}

/**
 * Result of preparing nodes for publish with Fork-on-Write applied
 */
interface PreparedNodes {
	/** Node descriptors for the API */
	descriptors: ArtifactNodeDescriptor[];
	/** Map from original node ID to forked node ID (for edge remapping) */
	idMapping: Map<string, string>;
	/** Nodes that need content uploaded (includes forked external nodes) */
	nodesToUpload: Node<StudioNodeData>[];
}

/**
 * Prepare nodes for publish, applying Fork-on-Write for modified external nodes
 * 
 * Fork-on-Write: When an external node has been modified (commit != originalRef.commit),
 * it is "forked" into a new internal node with a new ID, preserving the originalRef
 * to maintain lineage tracking.
 */
async function prepareNodesForPublish(
	nodes: Node<StudioNodeData>[]
): Promise<PreparedNodes> {
	const descriptors: ArtifactNodeDescriptor[] = [];
	const idMapping = new Map<string, string>();
	const nodesToUpload: Node<StudioNodeData>[] = [];

	for (const node of nodes) {
		const isModifiedExternal = isExternalNodeModified(node.data);

		if (isModifiedExternal) {
			// Fork-on-Write: Create a new internal node
			const newId = crypto.randomUUID();
			idMapping.set(node.data.id, newId);

			const descriptor: ArtifactNodeDescriptor = {
				id: newId,
				external: false, // Forked node is now internal
				type: node.data.type as ApiNodeType,
				name: node.data.name || undefined,
				// Preserve original reference for lineage tracking
				originalRef: node.data.originalRef
			};

			// For VFS nodes, include file list
			if (node.data.type === 'VFS') {
				const vfsData = node.data as VFSNodeData;
				const filePaths = await collectVfsFilePaths(vfsData.content.projectId, node.data.id);
				descriptor.files = filePaths;
			}

			descriptors.push(descriptor);
			// Forked nodes need content uploaded
			nodesToUpload.push({
				...node,
				data: { ...node.data, id: newId } as StudioNodeData
			});
		} else if (node.data.external) {
			// Unmodified external node - just reference it
			descriptors.push({
				id: node.data.id,
				external: true,
				type: node.data.type as ApiNodeType,
				name: node.data.name || undefined
			});
			// External nodes don't need content uploaded
		} else {
			// Regular internal node
			const descriptor: ArtifactNodeDescriptor = {
				id: node.data.id,
				external: false,
				type: node.data.type as ApiNodeType,
				name: node.data.name || undefined
			};

			// For VFS nodes, include file list
			if (node.data.type === 'VFS') {
				const vfsData = node.data as VFSNodeData;
				const filePaths = await collectVfsFilePaths(vfsData.content.projectId, node.data.id);
				descriptor.files = filePaths;
			}

			descriptors.push(descriptor);
			nodesToUpload.push(node);
		}
	}

	return { descriptors, idMapping, nodesToUpload };
}

/**
 * Prepare artifact descriptor from nodes and edges
 * Applies Fork-on-Write for modified external nodes
 * VFS nodes include their file list
 */
async function createDescriptor(
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Promise<{ descriptor: ArtifactDescriptor; nodesToUpload: Node<StudioNodeData>[] }> {
	const { descriptors, idMapping, nodesToUpload } = await prepareNodesForPublish(nodes);

	// Remap edge source/target IDs for forked nodes
	const edgeDescriptors: ArtifactEdgeDescriptor[] = edges.map((edge) => ({
		source: idMapping.get(edge.source) ?? edge.source,
		target: idMapping.get(edge.target) ?? edge.target,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle
	}));

	const descriptor: ArtifactDescriptor = {
		version: 1,
		exportedAt: new Date().toISOString(),
		nodes: descriptors,
		edges: edgeDescriptors
	};

	return { descriptor, nodesToUpload };
}

/**
 * Create form data for multipart upload
 * 
 * After content-type refactoring:
 * - All node content is uploaded as JSON (node.json)
 * - This preserves structured data like MessageBlocks, mountpoints, etc.
 * - Only nodesToUpload are processed (external nodes already filtered out)
 * - VFS nodes upload all their files
 * 
 * @param nodesToUpload - Pre-filtered nodes that need content uploaded (includes forked external nodes)
 * @param originalNodes - Original nodes for VFS file access (needed for forked VFS nodes)
 */
async function createFormData(
	metadata: PublishMetadata,
	descriptor: ArtifactDescriptor,
	nodesToUpload: Node<StudioNodeData>[],
	originalNodes: Node<StudioNodeData>[]
): Promise<FormData> {
	const formData = new FormData();

	// Build a map from node ID to original node for VFS file access
	const originalNodeMap = new Map(originalNodes.map(n => [n.data.id, n]));

	// Add metadata as JSON string
	const metadataJson = JSON.stringify({
		artifactId: metadata.artifactId,
		type: metadata.type,
		name: metadata.name,
		slug: metadata.slug,
		description: metadata.description || undefined,
		visibility: metadata.visibility,
		version: metadata.version,
		tags: metadata.tags.length > 0 ? metadata.tags : undefined
	});
	formData.append('metadata', metadataJson);

	// Add descriptor as JSON string
	formData.append('descriptor', JSON.stringify(descriptor));

	// Add node content files
	for (const node of nodesToUpload) {
		if (node.data.type === 'VFS') {
			// For VFS nodes, upload all files
			// For forked VFS nodes, we need to get files from the original node's VFS
			const vfsData = node.data as VFSNodeData;
			
			// Find original node to get the correct VFS projectId
			// For forked nodes, node.data.id is the new ID, but we need original ID for VFS access
			const originalNode = originalNodeMap.get(node.id) ?? node;
			const originalVfsData = originalNode.data as VFSNodeData;
			
			const files = await collectVfsFiles(originalVfsData.content.projectId, originalNode.data.id);
			
			for (const file of files) {
				// Remove leading slash from path for the filename
				const filename = file.path.startsWith('/') ? file.path.slice(1) : file.path;
				const blob = new Blob([file.content.buffer as ArrayBuffer], { type: 'application/octet-stream' });
				// Use the (potentially new) node ID for the upload key
				formData.append(`nodes[${node.data.id}]`, blob, filename);
			}
		} else {
			// For other nodes, upload content as JSON
			const contentJson = JSON.stringify(node.data.content.toJSON());
			const blob = new Blob([contentJson], { type: 'application/json' });
			formData.append(`nodes[${node.data.id}]`, blob, 'node.json');
		}
	}

	// Add homepage markdown if provided
	if (metadata.homepage && metadata.homepage.trim().length > 0) {
		const homepageBlob = new Blob([metadata.homepage], { type: 'text/markdown' });
		formData.append('homepage', homepageBlob, 'homepage.md');
	}

	return formData;
}

export interface PublishResult {
	success: boolean;
	artifactId?: string;
	error?: string;
}

/**
 * Validate STATE nodes have required checkpoint before publish
 * STATE nodes must have a saveId and checkpointRef to be published
 */
function validateStateNodes(nodes: Node<StudioNodeData>[]): { valid: boolean; error?: string } {
	for (const node of nodes) {
		if (node.data.type === 'STATE' && !node.data.external) {
			const stateContent = node.data.content as import('../types').StateContent;
			if (!stateContent.saveId || !stateContent.checkpointRef) {
				return {
					valid: false,
					error: `STATE node "${node.data.name || node.data.id}" must have a saved checkpoint before publish. Use "Save to Cloud" to create a checkpoint first.`
				};
			}
		}
	}
	return { valid: true };
}

/**
 * Publish nodes as an artifact to the backend
 * 
 * After layer separation:
 * - Takes FlowNodeData nodes from flow layer
 * - Gets business data from nodeStore
 * 
 * Implements Fork-on-Write:
 * - Modified external nodes are forked into new internal nodes
 * - Original reference is preserved for lineage tracking
 * 
 * Authentication is handled via session cookie (credentials: 'include')
 */
export async function publishArtifact(
	metadata: PublishMetadata,
	flowNodes: Node<FlowNodeData>[],
	edges: Edge[]
): Promise<PublishResult> {
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

	// Validate STATE nodes have checkpoints
	const stateValidation = validateStateNodes(nodes);
	if (!stateValidation.valid) {
		return {
			success: false,
			error: stateValidation.error
		};
	}

	// Create descriptor with Fork-on-Write applied
	const { descriptor, nodesToUpload } = await createDescriptor(nodes, edges);
	const formData = await createFormData(metadata, descriptor, nodesToUpload, nodes);

	try {
		// Use openapi-fetch with custom bodySerializer for FormData
		const { data, error, response } = await apiClient.POST('/artifacts', {
			// @ts-expect-error FormData body requires special handling for multipart uploads
			body: formData,
			bodySerializer: (body) => body
		});

		if (error) {
			return {
				success: false,
				error: error.error || `HTTP ${response.status}: ${response.statusText}`
			};
		}

		return {
			success: true,
			artifactId: data?.artifact?.id
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Network error'
		};
	}
}
