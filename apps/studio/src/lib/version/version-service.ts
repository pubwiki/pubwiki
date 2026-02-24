/**
 * Version Service (Legacy)
 * 
 * Contains version control utilities that are still needed:
 * - Historical tree building (rebuildHistoricalTree)
 * - Snapshot restoration (restoreSnapshot)
 * - Version query helpers (hasVersionHistory, getVersionCount)
 * - Edge version styling
 * 
 * The core VersionService class (dirty tracking, contentHash management)
 * is now in version-service.svelte.ts
 */

import type { Node, Edge } from '@xyflow/svelte'
import type {
	NodeRef,
	SnapshotEdge,
	Versionable,
	HistoricalTreeResult
} from './types'
import type { FlowNodeData } from '$lib/types'
import { nodeStore } from '../persistence/node-store.svelte'
import type { StudioNodeData } from '../types'
import { db } from '../persistence/db'
import { computeContentHash, type ArtifactNodeContent } from '@pubwiki/api'

// ============================================================================
// Version Sync Functions
// ============================================================================

/**
 * Extract incoming edges for a node, converting to SnapshotEdge format
 */
export function getIncomingEdges(nodeId: string, edges: Edge[]): SnapshotEdge[] {
	return edges
		.filter(e => e.target === nodeId)
		.map(e => ({
			source: e.source,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle
		}))
}

/**
 * Restore node to a specific snapshot version.
 * 
 * Uses content.clone() for deep copy (polymorphic call).
 */
export async function restoreSnapshot<T extends Versionable>(
	nodeData: T,
	snapshotRef: NodeRef
): Promise<T | null> {
	const snapshot = await nodeStore.getVersion(snapshotRef.id, snapshotRef.commit)
	if (!snapshot) {
		return null
	}

	// Store current version as snapshot before restoring
	// saveSnapshot automatically ensures version is up-to-date
	await nodeStore.saveSnapshot(nodeData.id)

	const currentRef: NodeRef = {
		id: nodeData.id,
		commit: nodeData.commit
	}

	// Use the restored content (already a class instance from getVersion)
	return {
		...nodeData,
		content: snapshot.content,
		commit: snapshot.commit,
		snapshotRefs: [...nodeData.snapshotRefs, currentRef]
	}
}

// ============================================================================
// Version Query Functions
// ============================================================================

/**
 * Check if a node has version history
 */
export function hasVersionHistory(nodeData: Versionable): boolean {
	return nodeData.snapshotRefs.length > 0
}

/**
 * Get the number of versions (current + snapshots)
 */
export function getVersionCount(nodeData: Versionable): number {
	return nodeData.snapshotRefs.length + 1
}

/**
 * Get all snapshots for a node from the store (async)
 */
export async function getNodeSnapshots(nodeId: string): Promise<StudioNodeData[]> {
	return nodeStore.getHistory(nodeId)
}

// ============================================================================
// Historical Tree Building
// ============================================================================

/**
 * Rebuild the historical dependency tree from version references.
 * 
 * This function:
 * 1. Finds all nodes referenced by the version refs
 * 2. For existing nodes with different commits, creates nodeOverrides with historical data
 * 3. For deleted nodes, creates phantom nodes from snapshots
 * 4. Reconstructs historical edges from snapshots
 * 
 * After layer separation:
 * - allNodes contains flow data only (id, position, type)
 * - getNodeData callback fetches business data from nodeStore
 * 
 * After version-store-unification:
 * - Now async, uses nodeStore.getVersion() for historical data
 * 
 * @param versionRefs - Array of version references to process
 * @param refHolderNodeId - ID of the node that holds these references
 * @param refHolderPosition - Position of the ref holder node (for positioning phantoms)
 * @param allNodes - All current nodes in the graph (flow layer)
 * @param currentEdges - All current edges in the graph
 * @param getNodeData - Callback to get business data for a node ID
 * @returns HistoricalTreeResult with overrides, phantoms, and edges
 */
export async function rebuildHistoricalTree<TData extends Versionable>(
	versionRefs: NodeRef[],
	refHolderNodeId: string,
	refHolderPosition: { x: number; y: number } | undefined,
	allNodes: Node<FlowNodeData>[],
	currentEdges: Edge[],
	getNodeData: (nodeId: string) => TData | undefined
): Promise<HistoricalTreeResult<TData>> {
	console.log('[rebuildHistoricalTree] START', {
		versionRefs,
		refHolderNodeId,
		allNodeIds: allNodes.map(n => n.id),
		currentEdgeCount: currentEdges.length
	})

	const nodeOverrides = new Map<string, TData>()
	const phantomNodes: HistoricalTreeResult<TData>['phantomNodes'] = []
	const historicalEdges: HistoricalTreeResult<TData>['historicalEdges'] = []
	const usedNodeIds = new Set<string>()

	// First pass: identify phantom nodes (deleted nodes)
	const phantomNodeIds = new Set<string>()
	for (const ref of versionRefs) {
		const existingNode = allNodes.find(n => n.id === ref.id)
		if (!existingNode) {
			phantomNodeIds.add(ref.id)
		}
	}
	console.log('[rebuildHistoricalTree] Phantom node IDs:', Array.from(phantomNodeIds))

	// Second pass: process each ref (async to fetch historical versions)
	for (const ref of versionRefs) {
		const existingNode = allNodes.find(n => n.id === ref.id)
		const snapshot = await nodeStore.getVersion(ref.id, ref.commit)
		console.log(`[rebuildHistoricalTree] Processing ref ${ref.id}@${ref.commit.slice(0,8)}`, {
			exists: !!existingNode,
			hasSnapshot: !!snapshot
		})

		if (existingNode) {
			// Node exists - mark as used
			usedNodeIds.add(ref.id)

			// Get business data from nodeStore via callback
			const nodeData = getNodeData(existingNode.id)
			
			// Calculate current content hash to detect unsaved edits
			// The stored commit might be stale if user edited but didn't regenerate
			const contentJson = nodeData?.content?.toJSON() as ArtifactNodeContent | undefined
			const currentContentHash = contentJson 
				? await computeContentHash(contentJson)
				: nodeData?.commit
			
			console.log(`[rebuildHistoricalTree] Existing node ${ref.id} commit check:`, {
				storedCommit: nodeData?.commit?.slice(0, 8),
				currentContentHash: currentContentHash?.slice(0, 8),
				refCommit: ref.commit.slice(0, 8),
				needsOverride: currentContentHash !== ref.commit,
				hasSnapshot: !!snapshot
			})
			
			// Check if we need to show historical version
			// Compare actual content hash (not stored commit) with ref commit
			if (nodeData && currentContentHash !== ref.commit && snapshot) {
				console.log(`[rebuildHistoricalTree] Creating override for ${ref.id}`)
				// Create override with historical data
				const historicalData: TData = {
					...nodeData,
					content: snapshot.content,
					commit: snapshot.commit
				}
				nodeOverrides.set(ref.id, historicalData)
			}

			// For existing nodes, also restore incoming edges from phantom nodes
			// This handles the case where an edge's source was deleted but target still exists
			const rawSnapshot = await db.snapshots.get([ref.id, ref.commit])
			console.log(`[rebuildHistoricalTree] Existing node ${ref.id} rawSnapshot:`, {
				hasRawSnapshot: !!rawSnapshot,
				incomingEdges: rawSnapshot?.incomingEdges
			})
			if (rawSnapshot?.incomingEdges) {
				for (const snapshotEdge of rawSnapshot.incomingEdges) {
					// Add edge if source is a phantom node (deleted)
					if (phantomNodeIds.has(snapshotEdge.source)) {
						console.log(`[rebuildHistoricalTree] Adding edge from phantom to existing: ${snapshotEdge.source} -> ${ref.id}`)
						historicalEdges.push({
							id: `historical-${snapshotEdge.source}-${ref.id}-${snapshotEdge.targetHandle || 'default'}`,
							source: snapshotEdge.source,
							target: ref.id,
							sourceHandle: snapshotEdge.sourceHandle,
							targetHandle: snapshotEdge.targetHandle
						})
					}
				}
			}
		} else if (snapshot) {
			// Node was deleted - create phantom node using type from snapshot
			const nodeType = snapshot.type

			const phantomData = {
				id: ref.id,
				name: snapshot.name,
				type: nodeType.toUpperCase(),
				content: snapshot.content,
				commit: snapshot.commit,
				snapshotRefs: [],
				parents: []
			} as unknown as TData

			// For phantom nodes, we need to get position from the raw snapshot in db
			// Since StudioNodeData doesn't include position, query directly
			const rawSnapshot = await db.snapshots.get([ref.id, ref.commit])
			console.log(`[rebuildHistoricalTree] Phantom node ${ref.id} rawSnapshot:`, {
				hasRawSnapshot: !!rawSnapshot,
				incomingEdges: rawSnapshot?.incomingEdges
			})
			
			// Use saved position from snapshot, or calculate fallback position
			const phantomNode = {
				id: ref.id,
				type: nodeType,
				position: rawSnapshot?.position ?? {
					x: (refHolderPosition?.x ?? 0) - 400,
					y: (refHolderPosition?.y ?? 0) + phantomNodes.length * 150
				},
				data: phantomData
			}

			phantomNodes.push(phantomNode)

			// Add historical edges from snapshot
			// Include edges from any node that is part of the historical tree (phantom or existing)
			if (rawSnapshot?.incomingEdges) {
				for (const snapshotEdge of rawSnapshot.incomingEdges) {
					// Add edge if source is a phantom node OR an existing node in versionRefs
					const sourceInVersionRefs = versionRefs.some(r => r.id === snapshotEdge.source)
					console.log(`[rebuildHistoricalTree] Checking phantom incoming edge: ${snapshotEdge.source} -> ${ref.id}`, {
						sourceIsPhantom: phantomNodeIds.has(snapshotEdge.source),
						sourceInVersionRefs
					})
					if (phantomNodeIds.has(snapshotEdge.source) || sourceInVersionRefs) {
						console.log(`[rebuildHistoricalTree] Adding edge to phantom: ${snapshotEdge.source} -> ${ref.id}`)
						historicalEdges.push({
							id: `historical-${snapshotEdge.source}-${ref.id}-${snapshotEdge.targetHandle || 'default'}`,
							source: snapshotEdge.source,
							target: ref.id,
							sourceHandle: snapshotEdge.sourceHandle,
							targetHandle: snapshotEdge.targetHandle
						})
					}
				}
			}
		}
	}

	// Third pass: restore refHolder's incoming edges from phantom nodes
	// This handles edges like: phantom_node → refHolder (e.g., deleted_input → generated)
	const refHolderData = getNodeData(refHolderNodeId)
	console.log(`[rebuildHistoricalTree] Third pass - refHolder ${refHolderNodeId}:`, {
		hasRefHolderData: !!refHolderData,
		refHolderCommit: refHolderData?.commit?.slice(0, 8),
		phantomNodeCount: phantomNodeIds.size,
		phantomNodeIds: Array.from(phantomNodeIds)
	})
	
	if (refHolderData && phantomNodeIds.size > 0) {
		const refHolderSnapshot = await db.snapshots.get([refHolderNodeId, refHolderData.commit])
		console.log(`[rebuildHistoricalTree] refHolder snapshot:`, {
			hasSnapshot: !!refHolderSnapshot,
			incomingEdges: refHolderSnapshot?.incomingEdges
		})
		
		if (refHolderSnapshot?.incomingEdges) {
			for (const snapshotEdge of refHolderSnapshot.incomingEdges) {
				if (phantomNodeIds.has(snapshotEdge.source)) {
					const edgeExists = historicalEdges.some(
						e => e.source === snapshotEdge.source && e.target === refHolderNodeId
					)
					if (!edgeExists) {
						console.log(`[rebuildHistoricalTree] Adding edge to refHolder: ${snapshotEdge.source} -> ${refHolderNodeId}`)
						historicalEdges.push({
							id: `historical-${snapshotEdge.source}-${refHolderNodeId}-${snapshotEdge.targetHandle || 'default'}`,
							source: snapshotEdge.source,
							target: refHolderNodeId,
							sourceHandle: snapshotEdge.sourceHandle,
							targetHandle: snapshotEdge.targetHandle
						})
					}
				}
			}
		}
	}

	console.log('[rebuildHistoricalTree] RESULT:', {
		nodeOverrideCount: nodeOverrides.size,
		phantomNodeCount: phantomNodes.length,
		historicalEdgeCount: historicalEdges.length,
		historicalEdges: historicalEdges.map(e => `${e.source} -> ${e.target}`)
	})

	return { nodeOverrides, phantomNodes, historicalEdges, usedNodeIds }
}

// ============================================================================
// Edge Version Styling
// ============================================================================

const OLD_VERSION_STYLE = 'stroke-dasharray: 5 5; stroke: #9ca3af;'

/**
 * Check if an edge connects to a node using an old version reference.
 * 
 * After layer separation:
 * - nodes contains flow data only
 * - getNodeData callback fetches business data
 * 
 * @param edge - The edge to check
 * @param nodes - All nodes in the graph (flow layer)
 * @param getNodeData - Callback to get business data for a node ID
 * @param getVersionRefs - Function to extract version refs from node data
 */
export function isOldVersionEdge<TData extends Versionable>(
	edge: Edge,
	nodes: Node<FlowNodeData>[],
	getNodeData: (nodeId: string) => TData | undefined,
	getVersionRefs: (data: TData) => NodeRef[] | undefined
): boolean {
	const targetNode = nodes.find(n => n.id === edge.target)
	if (!targetNode) return false

	const targetData = getNodeData(targetNode.id)
	if (!targetData) return false

	const refs = getVersionRefs(targetData)
	if (!refs) return false

	const sourceNode = nodes.find(n => n.id === edge.source)
	if (!sourceNode) return false

	const sourceData = getNodeData(sourceNode.id)
	if (!sourceData) return false

	// Check if source is referenced at an old version
	const matchingRef = refs.find(ref => ref.id === edge.source)
	if (matchingRef && sourceData.commit !== matchingRef.commit) {
		return true
	}

	return false
}

/**
 * Apply styling to edges based on version references.
 * Old version references get dashed styling.
 * 
 * After layer separation:
 * - nodes contains flow data only
 * - getNodeData callback fetches business data
 * 
 * @param edges - All edges in the graph
 * @param nodes - All nodes in the graph (flow layer)
 * @param getNodeData - Callback to get business data for a node ID
 * @param getVersionRefs - Function to extract version refs from node data
 */
export function styleEdgesForVersions<TData extends Versionable>(
	edges: Edge[],
	nodes: Node<FlowNodeData>[],
	getNodeData: (nodeId: string) => TData | undefined,
	getVersionRefs: (data: TData) => NodeRef[] | undefined
): { edges: Edge[]; changed: boolean } {
	let changed = false

	const styledEdges = edges.map(edge => {
		const shouldBeDashed = isOldVersionEdge(edge, nodes, getNodeData, getVersionRefs)

		if (shouldBeDashed) {
			if (edge.style !== OLD_VERSION_STYLE) {
				changed = true
				return { ...edge, style: OLD_VERSION_STYLE, animated: false }
			}
		} else if (edge.style) {
			changed = true
			// Destructure to remove style/animated properties while keeping rest
			const edgeWithStyle = edge as Edge & { style?: unknown; animated?: unknown }
			const { style, animated, ...rest } = edgeWithStyle
			void style
			void animated
			return rest
		}

		return edge
	})

	return { edges: styledEdges, changed }
}
