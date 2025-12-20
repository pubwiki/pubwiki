/**
 * Publish Utilities for Studio
 *
 * Functions to publish workspace nodes as an artifact to the backend.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData } from './types';
import type { ArtifactType, VisibilityType } from '$lib/types';

const API_BASE_URL = 'http://localhost:8787/api';

/**
 * Metadata for publishing an artifact
 */
export interface PublishMetadata {
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
 * Node type mapping from Studio to API
 */
type ApiNodeType = 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS';

function mapNodeType(type: StudioNodeData['type']): ApiNodeType {
	return type; // Currently the types are the same
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

/**
 * Prepare artifact descriptor from nodes and edges
 */
function createDescriptor(
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): ArtifactDescriptor {
	const nodeDescriptors: ArtifactNodeDescriptor[] = nodes.map((node) => ({
		id: node.data.id,
		external: node.data.external ?? false,
		type: mapNodeType(node.data.type),
		name: node.data.name || undefined
	}));

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
 */
function createFormData(
	metadata: PublishMetadata,
	descriptor: ArtifactDescriptor,
	nodes: Node<StudioNodeData>[]
): FormData {
	const formData = new FormData();

	// Add metadata as JSON string
	const metadataJson = JSON.stringify({
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

		const content = node.data.content;
		if (typeof content === 'string' && content.length > 0) {
			const blob = new Blob([content], { type: 'text/plain' });
			formData.append(`nodes[${node.data.id}]`, blob, `${node.data.id}.txt`);
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
	/** Mapping from old node IDs to new server-assigned IDs */
	nodeIdMapping?: Record<string, string>;
	error?: string;
}

/**
 * Publish nodes as an artifact to the backend
 */
export async function publishArtifact(
	metadata: PublishMetadata,
	nodes: Node<StudioNodeData>[],
	edges: Edge[],
	token: string | null
): Promise<PublishResult> {
	if (!token) {
		return { success: false, error: 'Authentication required' };
	}

	const descriptor = createDescriptor(nodes, edges);
	const formData = createFormData(metadata, descriptor, nodes);

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
			artifactId: data.artifact?.id,
			nodeIdMapping: data.nodeIdMapping
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Network error'
		};
	}
}
