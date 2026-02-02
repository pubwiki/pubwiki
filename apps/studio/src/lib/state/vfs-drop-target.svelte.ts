/**
 * VFS Drop Target State
 * 
 * Manages the current drop target for VFS-to-VFS mounting.
 * When dragging a connection from a VFS node over another VFS's file tree,
 * this state tracks which folder is being hovered.
 */

import type { FileItem } from '@pubwiki/ui/components';

// ============================================================================
// Types
// ============================================================================

export interface VfsDropTarget {
	/** The VFS node ID that contains the hovered folder */
	nodeId: string;
	/** The hovered folder item (or null for root) */
	folder: FileItem | null;
	/** The folder path (root = '/') */
	folderPath: string;
}

// ============================================================================
// State
// ============================================================================

let currentDropTarget = $state<VfsDropTarget | null>(null);

// ============================================================================
// API
// ============================================================================

/**
 * Get the current VFS drop target
 */
export function getVfsDropTarget(): VfsDropTarget | null {
	return currentDropTarget;
}

/**
 * Set the current VFS drop target
 * Called by VFSNode when a folder is hovered during VFS drag
 */
export function setVfsDropTarget(target: VfsDropTarget | null): void {
	currentDropTarget = target;
}

/**
 * Clear the drop target for a specific node
 * Called when mouse leaves the VFS node's file tree
 */
export function clearVfsDropTarget(nodeId: string): void {
	if (currentDropTarget?.nodeId === nodeId) {
		currentDropTarget = null;
	}
}
