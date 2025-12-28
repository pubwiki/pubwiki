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
import type { StudioNodeData } from '../../utils/types'
import { getVersionHandler } from './types'
import { rebuildHistoricalTree, styleEdgesForVersions } from './version-service'
import { getStudioContext } from '../context'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get version references from node data using registered handler.
 */
function getVersionRefsFromRegistry(data: StudioNodeData): NodeRef[] | undefined {
	const handler = getVersionHandler(data.type)
	return handler?.getVersionRefs?.(data)
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

	/**
	 * Get preview state for a specific node.
	 * Returns null if no preview is active or node is not part of preview.
	 */
	function getPreviewState(nodeId: string): PreviewState | null {
		if (!historicalTree) return null

		const override = historicalTree.nodeOverrides.get(nodeId)
		if (override) {
			// Use getText() for display content (polymorphic call)
			const content = override.content
			const displayContent = typeof content === 'object' && content !== null && 'getText' in content
				? (content as { getText(): string }).getText()
				: String(content)
			return {
				content: displayContent,
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

		// Remove phantom nodes
		if (phantomNodeIds.size > 0) {
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
	}

	/**
	 * Update preview state based on selected nodes.
	 * Call this in a $effect when selectedNodes changes.
	 */
	function updateSelection(selectedNodes: Node<StudioNodeData>[]) {
		const nodes = ctx.nodes
		const edges = ctx.edges

		// Get version refs for single selected node (if any)
		const versionRefs = selectedNodes.length === 1 
			? getVersionRefsFromRegistry(selectedNodes[0].data)
			: undefined

		// Non-single selection or selected doesn't have version refs - cleanup and return
		if (!versionRefs) {
			if (historicalTree !== null) {
				// Remove phantom nodes
				if (phantomNodeIds.size > 0) {
					ctx.setNodes(nodes.filter(n => !phantomNodeIds.has(n.id)))
				}
				// Restore hidden edges
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
			}
			return
		}

		const selected = selectedNodes[0]

		// First, restore any previously hidden edges before processing new selection
		let currentEdges = edges
		if (hiddenEdges.length > 0) {
			// Remove old phantom nodes if any
			if (phantomNodeIds.size > 0) {
				ctx.setNodes(nodes.filter(n => !phantomNodeIds.has(n.id)))
			}
			// Restore hidden edges and remove old historical edges
			currentEdges = [
				...edges.filter(e =>
					!phantomNodeIds.has(e.source) &&
					!phantomNodeIds.has(e.target) &&
					!e.id.startsWith('historical-')
				),
				...hiddenEdges
			]
			phantomNodeIds = new Set()
			hiddenEdges = []
		}

		// Build historical tree
		const tree = rebuildHistoricalTree(
			versionRefs,
			selected.id,
			selected.position,
			nodes,
			currentEdges
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
		if (tree.phantomNodes.length > 0) {
			const phantomsWithFlag = tree.phantomNodes.map(n => ({
				...n,
				data: { ...n.data, isPhantom: true }
			})) as Node<StudioNodeData>[]
			ctx.setNodes([...nodes, ...phantomsWithFlag])
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

	/**
	 * Apply version styling to edges.
	 * Call this in a separate $effect to update edge styles.
	 */
	function applyEdgeVersionStyles() {
		const nodes = ctx.nodes
		const edges = ctx.edges

		// Check if any node has version refs
		const hasRefHolders = nodes.some(n => getVersionRefsFromRegistry(n.data) !== undefined)
		if (!hasRefHolders) return

		const { edges: styledEdges, changed } = styleEdgesForVersions(
			edges,
			nodes,
			getVersionRefsFromRegistry
		)
		if (changed) {
			ctx.setEdges(styledEdges)
		}
	}

	return {
		// State accessors
		get historicalTree() { return historicalTree },

		// Methods
		getPreviewState,
		updateSelection,
		cleanup,
		applyEdgeVersionStyles
	}
}

export type PreviewController = ReturnType<typeof createPreviewController>
