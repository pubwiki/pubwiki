/**
 * Version Module
 * 
 * Unified version control system for studio nodes.
 * Provides version tracking, snapshot management, and preview capabilities.
 * 
 * After version-store-unification:
 * - snapshotStore removed, version access through nodeStore
 * - generateCommitHash moved to node-store.svelte
 */

// Types
export type {
	NodeRef,
	NodeSnapshot,
	SnapshotEdge,
	SnapshotPosition,
	Versionable,
	VersionHandler,
	PreviewState,
	HistoricalTreeResult
} from './types'

// Version Handler Registry
export {
	versionHandlerRegistry,
	registerVersionHandler,
	getVersionHandler
} from './types'

// Re-export generateCommitHash from node-store for backwards compatibility
export { generateCommitHash } from '../persistence/node-store.svelte'

// Version Service
export {
	syncNode,
	restoreSnapshot,
	hasVersionHistory,
	getVersionCount,
	getNodeSnapshots,
	getIncomingEdges,
	rebuildHistoricalTree,
	isOldVersionEdge,
	styleEdgesForVersions
} from './version-service'

// Preview Controller
export {
	createPreviewController,
	type PreviewController
} from './preview-controller.svelte'

// Version Preparation (for generation)
export {
	prepareForGeneration
} from './prepare'
