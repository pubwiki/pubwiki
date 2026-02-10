/**
 * Version Module
 * 
 * Unified version control system for studio nodes.
 * Provides version tracking, snapshot management, and preview capabilities.
 * 
 * After version-store-unification:
 * - snapshotStore removed, version access through nodeStore
 * - generateContentHash in node-store.svelte computes content hash
 * - Actual commit must be computed using computeNodeCommit from @pubwiki/api
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

// Re-export hash function from node-store
export { generateContentHash } from '../persistence/node-store.svelte'

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

// Version List Store (for version history UI)
export {
	createVersionListStore,
	type VersionListStore,
	type VersionEntry
} from './version-list-store.svelte'

// Version Preparation (for generation)
export {
	prepareForGeneration
} from './prepare'
