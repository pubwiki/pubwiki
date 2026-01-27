/**
 * Publish Utilities for Studio
 *
 * Functions to publish workspace nodes as an artifact to the backend.
 * 
 * After artifact storage refactoring:
 * - Non-VFS nodes: content is stored in descriptor, no separate file uploads
 * - VFS nodes: files are packaged as tar.gz and uploaded separately
 * - Simplified upload: just descriptor with content + VFS tar.gz archives
 * 
 * After layer separation:
 * - FlowNodeData for flow layer
 * - nodeStore for business data
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, VFSNodeData, StateNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import type { ArtifactType, VisibilityType } from '$lib/types';
import { StateContent } from '../types';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import { getNodeVfs } from '../vfs';
import { nodeStore } from '../persistence';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

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
 * After artifact storage refactoring:
 * - content field contains the serialized node content (for non-external nodes)
 * - VFS nodes include filesSummary instead of files array
 */
interface ArtifactNodeDescriptor {
	id: string;
	external?: boolean;
	type: ApiNodeType;
	name?: string;
	position: { x: number, y: number }
	/** Serialized node content (included for non-external nodes) */
	content?: unknown;
	/** Summary of files for VFS nodes (count, size, etc.) */
	filesSummary?: {
		totalFiles: number;
		totalSize: number;
	};
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
// VFS File Collection and Packaging Helpers
// ============================================================================

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
	/** Node descriptors for the API (includes content) */
	descriptors: ArtifactNodeDescriptor[];
	/** Map from original node ID to forked node ID (for edge remapping) */
	idMapping: Map<string, string>;
	/** VFS nodes that need tar.gz archives uploaded (nodeId -> archive data) */
	vfsArchives: Map<string, Uint8Array>;
}

/**
 * Prepare nodes for publish, applying Fork-on-Write for modified external nodes
 * 
 * After artifact storage refactoring:
 * - Non-VFS nodes: content is serialized directly into descriptor
 * - VFS nodes: files are packaged as tar.gz, only filesSummary in descriptor
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
	const vfsArchives = new Map<string, Uint8Array>();

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
				position: { x: node.position.x, y: node.position.y },
				// Preserve original reference for lineage tracking
				originalRef: node.data.originalRef
			};

			// Add content based on node type
			if (node.data.type === 'VFS') {
				const vfsData = node.data as VFSNodeData;
				const { archive, totalFiles, totalSize } = await packageVfsAsTarGz(
					vfsData.content.projectId, 
					node.data.id  // Use original ID to access VFS
				);
				vfsArchives.set(newId, archive);  // Use new ID for upload
				descriptor.content = vfsData.content.toJSON();
				descriptor.filesSummary = { totalFiles, totalSize };
			} else {
				descriptor.content = node.data.content.toJSON();
			}

			descriptors.push(descriptor);
		} else if (node.data.external) {
			// Unmodified external node - just reference it (no content)
			descriptors.push({
				id: node.data.id,
				external: true,
				type: node.data.type as ApiNodeType,
				name: node.data.name || undefined,
				position: { x: node.position.x, y: node.position.y }
			});
			// External nodes don't need content uploaded
		} else {
			// Regular internal node
			const descriptor: ArtifactNodeDescriptor = {
				id: node.data.id,
				external: false,
				type: node.data.type as ApiNodeType,
				name: node.data.name || undefined,
				position: { x: node.position.x, y: node.position.y }
			};

			// Add content based on node type
			if (node.data.type === 'VFS') {
				const vfsData = node.data as VFSNodeData;
				const { archive, totalFiles, totalSize, files } = await packageVfsAsTarGz(
					vfsData.content.projectId,
					node.data.id
				);
				vfsArchives.set(node.data.id, archive);
				// VFS content must have files array for backend validation
				descriptor.content = { files };
				descriptor.filesSummary = { totalFiles, totalSize };
			} else {
				descriptor.content = node.data.content.toJSON();
			}

			descriptors.push(descriptor);
		}
	}

	return { descriptors, idMapping, vfsArchives };
}

/**
 * Prepare artifact descriptor from nodes and edges
 * 
 * After artifact storage refactoring:
 * - Descriptors include content for non-external nodes
 * - VFS nodes have their files packaged separately as tar.gz
 * 
 * Applies Fork-on-Write for modified external nodes
 */
async function createDescriptor(
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Promise<{ descriptor: ArtifactDescriptor; vfsArchives: Map<string, Uint8Array> }> {
	const { descriptors, idMapping, vfsArchives } = await prepareNodesForPublish(nodes);

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

	return { descriptor, vfsArchives };
}

/**
 * Create form data for multipart upload
 * 
 * After artifact storage refactoring:
 * - Descriptor contains all node content (no separate node.json uploads)
 * - Only VFS nodes need separate file uploads (as tar.gz archives)
 * 
 * @param metadata - Artifact metadata
 * @param descriptor - Artifact descriptor (includes node content)
 * @param vfsArchives - Map of VFS node ID to tar.gz archive data
 */
function createFormData(
	metadata: PublishMetadata,
	descriptor: ArtifactDescriptor,
	vfsArchives: Map<string, Uint8Array>
): FormData {
	const formData = new FormData();

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

	// Add descriptor as JSON string (includes all node content)
	formData.append('descriptor', JSON.stringify(descriptor));

	// Add VFS tar.gz archives
	for (const [nodeId, archive] of vfsArchives.entries()) {
		// Create a new Uint8Array to ensure proper ArrayBuffer type
		const blob = new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: 'application/gzip' });
		formData.append(`vfs[${nodeId}]`, blob, `${nodeId}.tar.gz`);
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

// Visibility order for comparison
const visibilityOrder: Record<string, number> = {
	'PRIVATE': 0,
	'UNLISTED': 1,
	'PUBLIC': 2
};

/**
 * Auto-select cloud checkpoint for STATE nodes based on artifact visibility
 * 
 * For each STATE node, finds the most recent cloud checkpoint with visibility >= artifact visibility
 * and automatically selects it. This updates the nodeStore directly.
 * 
 * @param nodes - Nodes to check
 * @param artifactVisibility - The artifact's visibility level
 * @returns Object with updated node count and any errors
 */
function autoSelectStateCheckpoints(
	nodes: Node<StudioNodeData>[],
	artifactVisibility: VisibilityType
): { updatedCount: number; errors: string[] } {
	const result = { updatedCount: 0, errors: [] as string[] };
	const requiredVisibilityLevel = visibilityOrder[artifactVisibility];

	for (const node of nodes) {
		if (node.data.type !== 'STATE' || node.data.external) continue;
		
		const stateData = node.data as StateNodeData;
		const stateContent = stateData.content as StateContent;
		
		// Skip if no cloud save configured
		if (!stateContent.saveId) {
			continue;
		}
		
		// Get cloud checkpoints (stored in StateContent.checkpoints)
		const cloudCheckpoints = stateContent.checkpoints.filter(cp => {
			const cpVisibilityLevel = visibilityOrder[cp.visibility] ?? 0;
			return cpVisibilityLevel >= requiredVisibilityLevel;
		});
		
		if (cloudCheckpoints.length === 0) {
			continue;
		}
		
		// Find the most recent checkpoint by timestamp
		const latestCheckpoint = cloudCheckpoints.reduce((latest, cp) => {
			return cp.createdAt > latest.createdAt ? cp : latest;
		});
		
		// Check if we need to update
		const currentCheckpointVisibility = stateContent.checkpointId
			? stateContent.checkpoints.find(cp => cp.id === stateContent.checkpointId)?.visibility
			: null;
		
		const currentVisibilityLevel = currentCheckpointVisibility 
			? visibilityOrder[currentCheckpointVisibility] ?? 0 
			: -1;
		
		// Update if:
		// 1. No checkpoint selected, or
		// 2. Current checkpoint visibility is insufficient
		if (!stateContent.checkpointId || currentVisibilityLevel < requiredVisibilityLevel) {
			const updatedContent = stateContent.withCheckpoint(latestCheckpoint.id, latestCheckpoint.ref);
			nodeStore.update(node.id, (prev) => ({
				...prev,
				content: updatedContent
			}) as StateNodeData);
			result.updatedCount++;
		}
	}

	return result;
}

/**
 * Select appropriate cloud checkpoints for STATE nodes based on visibility requirement.
 * This is the public API that works with FlowNodeData and nodeStore.
 * 
 * Call this when visibility changes in the UI to update checkpoint selections.
 * 
 * @param flowNodes - FlowNodeData nodes from the flow layer
 * @param artifactVisibility - The artifact's visibility level
 * @returns Object with updated node count and any errors
 */
export function selectCheckpointsForVisibility(
	flowNodes: Node<FlowNodeData>[],
	artifactVisibility: VisibilityType
): { updatedCount: number; errors: string[] } {
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

	return autoSelectStateCheckpoints(nodes, artifactVisibility);
}

/**
 * Validate STATE nodes have required checkpoint before publish
 * STATE nodes must have a saveId and checkpointId to be published
 */
function validateStateNodes(nodes: Node<StudioNodeData>[]): { valid: boolean; error?: string } {
	for (const node of nodes) {
		if (node.data.type === 'STATE' && !node.data.external) {
			const stateContent = node.data.content as StateContent;
			if (!stateContent.saveId || !stateContent.checkpointId) {
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
 * After artifact storage refactoring:
 * - Descriptor includes all node content (no separate file uploads)
 * - Only VFS nodes need separate tar.gz archive uploads
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

	// Auto-select appropriate checkpoints for STATE nodes based on artifact visibility
	autoSelectStateCheckpoints(nodes, metadata.visibility);

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

	// Create descriptor with content and VFS archives
	const { descriptor, vfsArchives } = await createDescriptor(nodes, edges);
	const formData = createFormData(metadata, descriptor, vfsArchives);

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
