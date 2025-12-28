/**
 * Version Module
 * 
 * Unified version control system for studio nodes.
 * Provides version tracking, snapshot management, and preview capabilities.
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

// Snapshot Store
export {
	snapshotStore,
	generateCommitHash,
	initSnapshotStore
} from './snapshot-store'

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
