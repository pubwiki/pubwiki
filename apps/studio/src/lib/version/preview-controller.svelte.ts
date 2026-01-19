/**
 * Preview Controller
 * 
 * Svelte 5 runes-based controller for version preview state management.
 * Handles phantom nodes, historical edges, and preview state for UI display.
 */

import type { Node, Edge } from '@xyflow/svelte'
import type {
	NodeRef,
	Versionable,
	HistoricalTreeResult,
	PreviewState
} from './types'
import type { StudioNodeData } from '../types'
import type { FlowNodeData } from '../types/flow'
import { nodeStore } from '../persistence'
import { getVersionHandler } from './types'
import { rebuildHistoricalTree } from './version-service'
import { getStudioContext } from '../state'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get version references from node data using registered handler.
 */
function getVersionRefsFromRegistry(data: StudioNodeData | undefined): NodeRef[] | undefined {
	if (!data) return undefined
	const handler = getVersionHandler(data.type)
	return handler?.getVersionRefs?.(data as StudioNodeData)
}



// ============================================================================
// Preview Controller Factory
// ============================================================================

/**
 * Create a preview controller for managing version preview state.
 * Uses StudioContext for accessing and mutating nodes/edges.
 * 
 * Note: Before using the preview controller, register handlers for node types
 * that have version references using `registerVersionHandler()`.
 * 
 * Usage:
 * ```typescript
 * // Register handlers first (typically in node module)
 * registerVersionHandler('GENERATED', {
 *   getVersionRefs: (data) => [data.inputRef, ...data.promptRefs, ...data.indirectPromptRefs]
 * })
 * 
 * // Create controller (after setStudioContext)
 * const previewCtrl = createPreviewController()
 * 
 * // In $effect:
 * previewCtrl.updateSelection(selectedNodes)
 * 
 * // In another $effect:
 * previewCtrl.applyEdgeVersionStyles()
 * ```
 */
export function createPreviewController() {
	const ctx = getStudioContext()
	
	// Internal state using Svelte 5 runes
	let historicalTree = $state<HistoricalTreeResult<StudioNodeData> | null>(null)
	let phantomNodeIds = $state<Set<string>>(new Set())
	let hiddenEdges = $state<Edge[]>([])
	// Track the current refHolder node ID to detect selection changes
	let currentRefHolderId = $state<string | null>(null)

	/**
	 * Get preview state for a specific node.
	 * Returns null if no preview is active or node is not part of preview.
	 */
	function getPreviewState(nodeId: string): PreviewState | null {
		if (!historicalTree) return null

		const override = historicalTree.nodeOverrides.get(nodeId)
		if (override) {
			// Return the full content object for type-safe access in node components
			return {
				content: override.content,
				commit: override.commit,
				incomingEdges: historicalTree.historicalEdges
					.filter(e => e.target === nodeId)
					.map(e => ({
						source: e.source,
						sourceHandle: e.sourceHandle,
						targetHandle: e.targetHandle
					}))
			}
		}

		if (historicalTree.usedNodeIds.has(nodeId)) {
			return { isUsed: true }
		}

		return null
	}

	/**
	 * Clean up preview state - removes phantom nodes and restores hidden edges.
	 */
	function cleanup() {
		if (historicalTree === null) return

		const nodes = ctx.nodes
		const edges = ctx.edges

		// Remove phantom nodes from nodeStore and flow
		if (phantomNodeIds.size > 0) {
			for (const phantomId of phantomNodeIds) {
				nodeStore.delete(phantomId)
			}
			ctx.setNodes(nodes.filter(n => !phantomNodeIds.has(n.id)))
		}

		// Restore hidden edges and remove historical edges
		const restoredEdges = [
			...edges.filter(e =>
				!phantomNodeIds.has(e.source) &&
				!phantomNodeIds.has(e.target) &&
				!e.id.startsWith('historical-')
			),
			...hiddenEdges
		]
		ctx.setEdges(restoredEdges)

		phantomNodeIds = new Set()
		hiddenEdges = []
		historicalTree = null
		currentRefHolderId = null
	}

	/**
	 * Internal cleanup that modifies nodes/edges and resets state
	 */
	function performCleanup() {
		const nodes = ctx.nodes
		const edges = ctx.edges
		
		// Remove phantom nodes from nodeStore
		if (phantomNodeIds.size > 0) {
			for (const phantomId of phantomNodeIds) {
				nodeStore.delete(phantomId)
			}
		}

		// Calculate new nodes (remove phantoms)
		const newNodes = nodes.filter(n => !phantomNodeIds.has(n.id))

		// Calculate restored edges
		const restoredEdges = [
			...edges.filter(e =>
				!phantomNodeIds.has(e.source) &&
				!phantomNodeIds.has(e.target) &&
				!e.id.startsWith('historical-')
			),
			...hiddenEdges
		]

		// Apply changes
		ctx.setNodes(newNodes)
		ctx.setEdges(restoredEdges)

		// Reset state
		phantomNodeIds = new Set()
		hiddenEdges = []
		historicalTree = null
		currentRefHolderId = null
	}

	/**
	 * Update preview state based on selected nodes.
	 * Call this in a $effect when selectedNodes changes.
	 */
	async function updateSelection(selectedNodes: Node<FlowNodeData>[]) {
		// Determine the new refHolder (if any)
		const selectedNodeData = selectedNodes.length === 1 
			? nodeStore.get(selectedNodes[0].id)
			: undefined
		const versionRefs = selectedNodeData
			? getVersionRefsFromRegistry(selectedNodeData)
			: undefined
		const newRefHolderId = versionRefs ? selectedNodes[0].id : null

		// If the refHolder changed (including to null), cleanup first
		if (currentRefHolderId !== null && currentRefHolderId !== newRefHolderId) {
			performCleanup()
		}

		// If no new refHolder, we're done
		if (!newRefHolderId || !versionRefs) {
			return
		}

		const selected = selectedNodes[0]
		// Read nodes/edges AFTER cleanup has been applied
		const currentEdges = ctx.edges
		const nodes = ctx.nodes
		
		// Set current refHolder
		currentRefHolderId = newRefHolderId

		// Build historical tree with data getter callback (async)
		const tree = await rebuildHistoricalTree(
			versionRefs,
			selected.id,
			selected.position,
			nodes,
			currentEdges,
			(nodeId) => nodeStore.get(nodeId) as StudioNodeData | undefined
		)
		historicalTree = tree

		// Get IDs of nodes that are truly historical (have overrides, not just used)
		const historicalNodeIds = new Set(tree.nodeOverrides.keys())

		// Get all node IDs that are part of the tree
		const treeNodeIds = new Set([
			selected.id,
			...tree.usedNodeIds,
			...historicalNodeIds,
			...tree.phantomNodes.map(n => n.id)
		])

		// Hide edges connected to historical nodes, EXCEPT edges that are part of the tree
		const edgesToHide = currentEdges.filter(e =>
			(historicalNodeIds.has(e.source) || historicalNodeIds.has(e.target)) &&
			!(treeNodeIds.has(e.source) && treeNodeIds.has(e.target))
		)
		hiddenEdges = edgesToHide

		// Remove hidden edges from current edges
		const hiddenEdgeIds = new Set(edgesToHide.map(e => e.id))
		let newEdges = currentEdges.filter(e => !hiddenEdgeIds.has(e.id))

		// Add phantom nodes to the graph
		// Phantom nodes are flow nodes - their business data comes from snapshots
		if (tree.phantomNodes.length > 0) {
			const phantomFlowNodes: Node<FlowNodeData>[] = tree.phantomNodes.map(n => {
				// Store phantom node's business data in nodeStore transiently (no persistence)
				nodeStore.setTransient(n.id, n.data as StudioNodeData)
				
				return {
					id: n.id,
					type: n.type,
					position: n.position,
					data: { 
						id: n.id, 
						type: n.type,
						isPhantom: true 
					}
				}
			})
			ctx.setNodes([...nodes, ...phantomFlowNodes])
			phantomNodeIds = new Set(tree.phantomNodes.map(n => n.id))
		}

		// Add all historical edges (styled differently)
		if (tree.historicalEdges.length > 0) {
			const styledHistoricalEdges = tree.historicalEdges.map(e => ({
				...e,
				style: 'stroke: #f59e0b; stroke-dasharray: 5 5;',
				animated: false
			}))
			newEdges = [...newEdges, ...styledHistoricalEdges]
		}

		ctx.setEdges(newEdges)
	}

	return {
		// State accessors
		get historicalTree() { return historicalTree },

		// Methods
		getPreviewState,
		updateSelection,
		cleanup
	}
}

export type PreviewController = ReturnType<typeof createPreviewController>
