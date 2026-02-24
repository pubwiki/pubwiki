/**
 * Version Control Types
 * 
 * Core type definitions for the version control system.
 * These types are designed to be node-type agnostic.
 */

// Re-export core types from flow-core
export type {
	NodeRef,
	SnapshotEdge,
	SnapshotPosition,
	NodeSnapshot,
	Versionable,
	VersionHandler,
	PreviewState,
	HistoricalTreeResult
} from '@pubwiki/flow-core';

// Re-export content types from flow-core
export type { NodeContent, NodeType } from '@pubwiki/flow-core';

// Import for use within this module
import type { Versionable, VersionHandler } from '@pubwiki/flow-core';

// ============================================================================
// Version Handler Registry (Svelte-specific, stays in Studio)
// ============================================================================

/**
 * Global registry for version handlers.
 * Node types register their handlers here.
 */
export const versionHandlerRegistry = new Map<string, VersionHandler>()

/**
 * Register a version handler for a node type.
 */
export function registerVersionHandler<TData extends Versionable>(
	nodeType: string,
	handler: VersionHandler<TData>
): void {
	versionHandlerRegistry.set(nodeType.toUpperCase(), handler as VersionHandler)
}

/**
 * Get version handler for a node type.
 * Returns undefined if no handler is registered.
 */
export function getVersionHandler(nodeType: string): VersionHandler | undefined {
	return versionHandlerRegistry.get(nodeType.toUpperCase())
}