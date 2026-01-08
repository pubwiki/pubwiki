/**
 * Version Service
 * 
 * Core version control logic for studio nodes.
 * Handles version synchronization, restoration, and historical tree building.
 * 
 * After the content-type refactoring:
 * - All persistent data is in node.data.content
 * - Content implements NodeContent interface with clone()/serialize() methods
 * - Commit hash is computed via content.serialize()
 * 
 * After layer separation refactoring:
 * - Flow layer (positions) is separate from business layer (node data)
 * - Business data is accessed via nodeStore or a getNodeData callback
 */

import type { Node, Edge } from '@xyflow/svelte'
import type {
	NodeRef,
	NodeSnapshot,
	SnapshotEdge,
	SnapshotPosition,
	Versionable,
	HistoricalTreeResult
} from './types'
import type { FlowNodeData } from '../types/flow'
import { snapshotStore, generateCommitHash } from './snapshot-store'
import type { NodeContent } from '../types/content'

// Re-export generateCommitHash for convenience
export { generateCommitHash }

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
 * Save current node state to snapshot store.
 * Call this BEFORE the user edits the content to preserve the current version.
 * 
 * Uses content.clone() for deep copy (polymorphic call).
 * 
 * @internal Used by syncNode - prefer using syncNode directly
 */
function saveCurrentVersion(
	nodeData: Versionable,
	edges?: Edge[],
	position?: SnapshotPosition
): void {
	// Only save if not already in store
	if (!snapshotStore.has(nodeData.id, nodeData.commit)) {
		const incomingEdges = edges ? getIncomingEdges(nodeData.id, edges) : undefined
		
		// Deep clone content for snapshot using polymorphic clone()
		const snapshotContentData = nodeData.content.clone()
		
		const snapshot: NodeSnapshot<unknown> = {
			nodeId: nodeData.id,
			commit: nodeData.commit,
			type: nodeData.type,
			name: nodeData.name,
			content: snapshotContentData,
			timestamp: Date.now(),
			incomingEdges,
			position
		}
		snapshotStore.add(snapshot)
	}
}

/**
 * Sync node's commit hash with its current content and save snapshot.
 * 
 * This function:
 * 1. Saves the current version to snapshot store (with edges and position)
 * 2. If content has changed, updates the commit hash
 * 
 * @param node - The full node object (including position)
 * @param edges - All edges in the graph (to save incoming connections)
 */
export async function syncNode<T extends Versionable>(
	node: Node<T>,
	edges: Edge[]
): Promise<T> {
	const nodeData = node.data
	const position: SnapshotPosition | undefined = node.position
		? { x: node.position.x, y: node.position.y }
		: undefined

	// Get content hash using polymorphic serialize() method
	const currentContentHash = await generateCommitHash(nodeData.content.serialize())

	// If commit matches current content, save snapshot with current commit and return
	if (currentContentHash === nodeData.commit) {
		// Save current version (idempotent - won't save if already exists)
		saveCurrentVersion(nodeData, edges, position)
		return nodeData
	}

	// Content has changed - the old commit doesn't match current content
	// Save snapshot of OLD version first (before we update the commit)
	saveCurrentVersion(nodeData, edges, position)

	// Create ref to the old version
	const snapshotRef: NodeRef = {
		id: nodeData.id,
		commit: nodeData.commit
	}

	// Create updated node data with new commit matching current content
	const updatedNodeData: T = {
		...nodeData,
		commit: currentContentHash,
		snapshotRefs: [...nodeData.snapshotRefs, snapshotRef]
	}

	// Also save snapshot with the NEW commit (current content)
	// This ensures promptRefs can find the snapshot
	saveCurrentVersion(updatedNodeData, edges, position)

	return updatedNodeData
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
	const snapshot = snapshotStore.get<unknown>(snapshotRef.id, snapshotRef.commit)
	if (!snapshot) {
		return null
	}

	// Store current version as snapshot before restoring using clone()
	const currentSnapshotContent = nodeData.content.clone()
	
	const currentSnapshot: NodeSnapshot<unknown> = {
		nodeId: nodeData.id,
		commit: nodeData.commit,
		type: nodeData.type,
		name: nodeData.name,
		content: currentSnapshotContent,
		timestamp: Date.now()
	}
	snapshotStore.add(currentSnapshot)

	const currentRef: NodeRef = {
		id: nodeData.id,
		commit: nodeData.commit
	}

	// Directly use snapshot content (already the correct type)
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
 * Get all snapshots for a node from the store
 */
export function getNodeSnapshots<T>(nodeData: Versionable): NodeSnapshot<T>[] {
	return snapshotStore.getByNodeId<T>(nodeData.id)
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
 * @param versionRefs - Array of version references to process
 * @param refHolderNodeId - ID of the node that holds these references
 * @param refHolderPosition - Position of the ref holder node (for positioning phantoms)
 * @param allNodes - All current nodes in the graph (flow layer)
 * @param currentEdges - All current edges in the graph
 * @param getNodeData - Callback to get business data for a node ID
 * @returns HistoricalTreeResult with overrides, phantoms, and edges
 */
export function rebuildHistoricalTree<TData extends Versionable>(
	versionRefs: NodeRef[],
	refHolderNodeId: string,
	refHolderPosition: { x: number; y: number } | undefined,
	allNodes: Node<FlowNodeData>[],
	currentEdges: Edge[],
	getNodeData: (nodeId: string) => TData | undefined
): HistoricalTreeResult<TData> {
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

	// Second pass: process each ref
	for (const ref of versionRefs) {
		const existingNode = allNodes.find(n => n.id === ref.id)
		const snapshot = snapshotStore.get<unknown>(ref.id, ref.commit)

		if (existingNode) {
			// Node exists - mark as used
			usedNodeIds.add(ref.id)

			// Get business data from nodeStore via callback
			const nodeData = getNodeData(existingNode.id)
			
			// Check if we need to show historical version
			if (nodeData && nodeData.commit !== ref.commit && snapshot) {
				// Create override with historical data
				const historicalData: TData = {
					...nodeData,
					content: snapshot.content,
					commit: snapshot.commit
				}
				nodeOverrides.set(ref.id, historicalData)
			}

			// Check incoming edges to restore connections from phantom nodes
			const edgesToCheck = snapshot?.incomingEdges
			if (edgesToCheck) {
				for (const snapshotEdge of edgesToCheck) {
					// Only add edge if source is a phantom node (deleted)
					if (phantomNodeIds.has(snapshotEdge.source)) {
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

			// Use saved position from snapshot, or calculate fallback position
			const phantomNode = {
				id: ref.id,
				type: nodeType,
				position: snapshot.position ?? {
					x: (refHolderPosition?.x ?? 0) - 400,
					y: (refHolderPosition?.y ?? 0) + phantomNodes.length * 150
				},
				data: phantomData
			}

			phantomNodes.push(phantomNode)

			// Add historical edges from snapshot (only from other phantom nodes)
			if (snapshot.incomingEdges) {
				for (const snapshotEdge of snapshot.incomingEdges) {
					// Only add edge if source is also a phantom node
					if (phantomNodeIds.has(snapshotEdge.source)) {
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
			const { style, animated, ...rest } = edge
			return rest
		}

		return edge
	})

	return { edges: styledEdges, changed }
}
