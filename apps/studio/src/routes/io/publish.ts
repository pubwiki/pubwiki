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
import { API_BASE_URL } from '$lib/config';
import { getNodeVfs } from '../vfs';
import { nodeStore } from '../persistence';

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
 * Artifact descriptor for API
 */
interface ArtifactNodeDescriptor {
	id: string;
	external?: boolean;
	type: ApiNodeType;
	name?: string;
	files?: string[];
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
			if ('folderId' in item) {
				// It's a file (VfsFile has folderId, VfsFolder has parentFolderId)
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
			if ('folderId' in item) {
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
 * Prepare artifact descriptor from nodes and edges
 * All nodes are published (external nodes are marked as such)
 * VFS nodes include their file list
 */
async function createDescriptor(
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Promise<ArtifactDescriptor> {
	const nodeDescriptors: ArtifactNodeDescriptor[] = await Promise.all(
		nodes.map(async (node) => {
			const descriptor: ArtifactNodeDescriptor = {
				id: node.data.id,
				external: node.data.external ?? false,
				type: node.data.type as ApiNodeType,
				name: node.data.name || undefined
			};

			// For VFS nodes, include file list
			if (node.data.type === 'VFS' && !node.data.external) {
				const vfsData = node.data as VFSNodeData;
				const filePaths = await collectVfsFilePaths(vfsData.content.projectId, node.data.id);
				descriptor.files = filePaths;
			}

			return descriptor;
		})
	);

	const edgeDescriptors: ArtifactEdgeDescriptor[] = edges.map((edge) => ({
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle
	}));

	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		nodes: nodeDescriptors,
		edges: edgeDescriptors
	};
}

/**
 * Create form data for multipart upload
 * 
 * After content-type refactoring:
 * - All node content is uploaded as JSON (node.json)
 * - This preserves structured data like MessageBlocks, mountpoints, etc.
 * - External nodes are skipped (they don't have content to upload)
 * - VFS nodes upload all their files
 */
async function createFormData(
	metadata: PublishMetadata,
	descriptor: ArtifactDescriptor,
	nodes: Node<StudioNodeData>[]
): Promise<FormData> {
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

	// Add descriptor as JSON string
	formData.append('descriptor', JSON.stringify(descriptor));

	// Add node content files
	for (const node of nodes) {
		// Skip external nodes (they don't have content to upload)
		if (node.data.external) continue;

		if (node.data.type === 'VFS') {
			// For VFS nodes, upload all files
			const vfsData = node.data as VFSNodeData;
			const files = await collectVfsFiles(vfsData.content.projectId, node.data.id);
			
			for (const file of files) {
				// Remove leading slash from path for the filename
				const filename = file.path.startsWith('/') ? file.path.slice(1) : file.path;
				const blob = new Blob([file.content.buffer as ArrayBuffer], { type: 'application/octet-stream' });
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
 * Publish nodes as an artifact to the backend
 * 
 * After layer separation:
 * - Takes FlowNodeData nodes from flow layer
 * - Gets business data from nodeStore
 */
export async function publishArtifact(
	metadata: PublishMetadata,
	flowNodes: Node<FlowNodeData>[],
	edges: Edge[],
	token: string | null
): Promise<PublishResult> {
	if (!token) {
		return { success: false, error: 'Authentication required' };
	}

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

	const descriptor = await createDescriptor(nodes, edges);
	const formData = await createFormData(metadata, descriptor, nodes);

	try {
		const response = await fetch(`${API_BASE_URL}/artifacts`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`
			},
			body: formData
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			return {
				success: false,
				error: errorData.error || `HTTP ${response.status}: ${response.statusText}`
			};
		}

		const data = await response.json();
		return {
			success: true,
			artifactId: data.artifact?.id
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Network error'
		};
	}
}
