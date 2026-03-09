/**
 * Artifact Loader
 * 
 * Converts API artifact graph response into RuntimeGraph.
 * Pure data transformation — no UI framework, no persistence.
 */

import type { GetArtifactGraphResponse, ArtifactNodeContent as ApiNodeContent } from '@pubwiki/api';
import {
	InputContent,
	PromptContent,
	GeneratedContent,
	VFSContent,
	SandboxContent,
	LoaderContent,
	StateContent,
	type NodeContent,
	type InputContentJSON,
	type PromptContentJSON,
	type GeneratedContentJSON,
	type SandboxContentJSON,
	type LoaderContentJSON,
	type StateContentJSON,
} from '../../types';
import { HandleId } from '../../registry';
import type {
	RuntimeGraph,
	RuntimeNode,
	RuntimeEdge,
	EntryNodeDiscovery,
} from '../types';

// ============================================================================
// Artifact → RuntimeGraph conversion
// ============================================================================

/**
 * Convert an API artifact graph response into a RuntimeGraph.
 * 
 * This is a pure data transformation: it parses the API response nodes
 * into resolved NodeContent objects and builds the runtime edge list.
 */
export function loadArtifactGraph(graphData: GetArtifactGraphResponse): RuntimeGraph {
	const nodes = new Map<string, RuntimeNode>();

	for (const apiNode of graphData.nodes) {
		const content = parseNodeContent(apiNode.type, apiNode.content as ApiNodeContent | undefined);
		if (!content) continue;

		const node: RuntimeNode = {
			id: apiNode.id,
			type: apiNode.type as RuntimeNode['type'],
			name: apiNode.name ?? apiNode.type,
			content,
			commit: apiNode.commit,
			contentHash: apiNode.contentHash,
		};
		nodes.set(node.id, node);
	}

	const edges: RuntimeEdge[] = graphData.edges.map(e => ({
		source: e.source,
		target: e.target,
		sourceHandle: e.sourceHandle ?? 'default',
		targetHandle: e.targetHandle ?? 'default',
	}));

	const entrypoint = graphData.version?.entrypoint
		? {
				saveCommit: graphData.version.entrypoint.saveCommit ?? '',
				sandboxNodeId: graphData.version.entrypoint.sandboxNodeId ?? '',
			}
		: null;

	const buildCacheKey = graphData.version?.buildCacheKey ?? null;

	return { nodes, edges, entrypoint, buildCacheKey };
}

// ============================================================================
// Entry Node Discovery
// ============================================================================

/**
 * Discover key entry nodes from the runtime graph.
 * 
 * Traverses connections to find SANDBOX, VFS (connected to sandbox),
 * LOADER (connected to sandbox), and STATE (connected to loader).
 * 
 * @param graph - The runtime graph
 * @param sandboxNodeId - Optional explicit sandbox node ID; auto-discovers if omitted
 */
export function discoverEntryNodes(
	graph: RuntimeGraph,
	sandboxNodeId?: string,
): EntryNodeDiscovery {
	// Resolve sandbox node
	const resolvedId = sandboxNodeId ?? autoDiscoverSandboxNodeId(graph);
	if (!resolvedId) {
		throw new Error('No SANDBOX node found in graph');
	}
	const sandboxNode = graph.nodes.get(resolvedId);
	if (!sandboxNode || sandboxNode.type !== 'SANDBOX') {
		throw new Error(`Node ${resolvedId} is not a SANDBOX node`);
	}

	// Find VFS nodes connected to sandbox via vfs-input
	const vfsNodes: RuntimeNode[] = [];
	for (const edge of graph.edges) {
		if (edge.target === resolvedId && edge.targetHandle === HandleId.VFS_INPUT) {
			const node = graph.nodes.get(edge.source);
			if (node?.type === 'VFS') {
				vfsNodes.push(node);
			}
		}
	}

	// Find LOADER nodes connected to sandbox via service-input
	const loaderNodes: RuntimeNode[] = [];
	for (const edge of graph.edges) {
		if (edge.target === resolvedId && edge.targetHandle === HandleId.SERVICE_INPUT) {
			const node = graph.nodes.get(edge.source);
			if (node?.type === 'LOADER') {
				loaderNodes.push(node);
			}
		}
	}

	// Find STATE node connected to any loader via loader-state
	let stateNode: RuntimeNode | null = null;
	for (const loader of loaderNodes) {
		if (stateNode) break;
		for (const edge of graph.edges) {
			if (edge.target === loader.id && edge.targetHandle === HandleId.LOADER_STATE) {
				const node = graph.nodes.get(edge.source);
				if (node?.type === 'STATE') {
					stateNode = node;
					break;
				}
			}
		}
	}

	return { sandboxNode, vfsNodes, loaderNodes, stateNode };
}

// ============================================================================
// Graph Topology Helpers
// ============================================================================

/**
 * Find the STATE node connected to a LOADER node via the loader-state handle.
 */
export function findConnectedStateNode(
	graph: RuntimeGraph,
	loaderNodeId: string,
): string | null {
	for (const edge of graph.edges) {
		if (edge.target === loaderNodeId && edge.targetHandle === HandleId.LOADER_STATE) {
			const node = graph.nodes.get(edge.source);
			if (node?.type === 'STATE') {
				return node.id;
			}
		}
	}
	return null;
}

/**
 * Find the backend VFS node connected to a LOADER node via the loader-backend handle.
 */
export function findBackendVfsNode(
	graph: RuntimeGraph,
	loaderNodeId: string,
): string | null {
	for (const edge of graph.edges) {
		if (edge.target === loaderNodeId && edge.targetHandle === HandleId.LOADER_BACKEND) {
			const node = graph.nodes.get(edge.source);
			if (node?.type === 'VFS') {
				return node.id;
			}
		}
	}
	return null;
}

/**
 * Find asset VFS nodes connected to a LOADER node via loader-asset-vfs handle.
 */
export function findAssetVfsNodes(
	graph: RuntimeGraph,
	loaderNodeId: string,
): string[] {
	const nodeIds: string[] = [];
	for (const edge of graph.edges) {
		if (edge.target === loaderNodeId && edge.targetHandle === HandleId.LOADER_ASSET_VFS) {
			const node = graph.nodes.get(edge.source);
			if (node?.type === 'VFS') {
				nodeIds.push(node.id);
			}
		}
	}
	return nodeIds;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Auto-discover the first SANDBOX node in the graph.
 */
function autoDiscoverSandboxNodeId(graph: RuntimeGraph): string | null {
	for (const node of graph.nodes.values()) {
		if (node.type === 'SANDBOX') {
			return node.id;
		}
	}
	return null;
}

/**
 * Parse raw API node content JSON into a NodeContent class instance.
 * 
 * Note: The API's ArtifactNodeContent and flow-core's local ArtifactNodeContent
 * have structurally compatible shapes for most fields. VFS nodes differ
 * (API has filesHash, local has projectId) — for runtime purposes we create
 * a VFSContent with an empty projectId since the Player app handles VFS
 * differently (commit-based OPFS cache).
 */
function parseNodeContent(
	type: string,
	content: ApiNodeContent | undefined,
): NodeContent | null {
	switch (type) {
		case 'INPUT':
			return content
				? InputContent.fromJSON(content as unknown as InputContentJSON)
				: new InputContent([]);

		case 'PROMPT':
			return content
				? PromptContent.fromJSON(content as unknown as PromptContentJSON)
				: PromptContent.fromText('');

		case 'GENERATED':
			return content
				? GeneratedContent.fromJSON(content as unknown as GeneratedContentJSON)
				: new GeneratedContent([], { id: '', commit: '' }, [], []);

		case 'VFS':
			// API VFS content has filesHash; runtime needs projectId.
			// Leave empty — the app layer assigns the correct projectId.
			return new VFSContent('');

		case 'SANDBOX':
			return content
				? SandboxContent.fromJSON(content as unknown as SandboxContentJSON)
				: new SandboxContent();

		case 'LOADER':
			return content
				? LoaderContent.fromJSON(content as unknown as LoaderContentJSON)
				: new LoaderContent();

		case 'STATE':
			return content
				? StateContent.fromJSON(content as unknown as StateContentJSON)
				: new StateContent('State');

		default:
			return null;
	}
}
