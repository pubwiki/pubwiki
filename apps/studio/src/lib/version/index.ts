/**
 * Version Module
 * 
 * Unified version control system for studio nodes.
 * Provides version tracking, snapshot management, and preview capabilities.
 * 
 * After content-hash-realtime-update refactoring:
 * - VersionService class handles dirty tracking and contentHash computation
 * - syncNode removed - version tracking is implicit and real-time
 * - computeContentHash from @pubwiki/api is the single source of truth
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

// VersionService (dirty tracking, contentHash management, snapshot storage)
export { VersionService, versionService } from './version-service.svelte'

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
