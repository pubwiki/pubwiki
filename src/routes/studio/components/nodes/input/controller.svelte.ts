/**
 * InputNode Controller
 * 
 * Handles InputNode-specific logic for flow events:
 * - Creating mountpoints when VFS connects to ADD_MOUNT handle
 * - Removing mountpoints when edges are deleted
 * - Managing mountpoint path editing state
 */

import { tick } from 'svelte';
import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, InputNodeData, Mountpoint } from '../../../utils/types';
import { 
	HandleId, 
	isMountpointHandle, 
	getMountpointId, 
	createMountpointHandleId,
	generateMountpointId
} from '../../../utils/connection';
import { 
	onConnection, 
	onEdgeDelete,
	type ConnectionEvent,
	type EdgeDeleteEvent
} from '../../../stores/flow-events';

// ============================================================================
// State
// ============================================================================

/** Currently editing mountpoint (node-local state, exposed for UI) */
let editingMountpoint: { nodeId: string; mountpointId: string } | null = $state(null);

// ============================================================================
// Helpers
// ============================================================================

/** Initial mountpoint path - user must edit */
const INITIAL_MOUNTPOINT_PATH = '/';

/** Regex for valid mountpoint path characters (after the leading /) */
const VALID_PATH_CHARS = /^[0-9a-zA-Z]*$/;

/**
 * Validate a mountpoint path
 * @param path - The path to validate
 * @param existingMountpoints - All mountpoints in the node
 * @param currentMountpointId - The ID of the mountpoint being edited (to exclude from duplicate check)
 * @returns Error message if invalid, null if valid
 */
export function validateMountpointPath(
	path: string, 
	existingMountpoints: Mountpoint[], 
	currentMountpointId?: string
): string | null {
	// Must start with /
	if (!path.startsWith('/')) {
		return 'Path must start with /';
	}
	
	const pathPart = path.slice(1); // Remove leading /
	
	// Only allow alphanumeric characters (empty is OK for root /)
	if (!VALID_PATH_CHARS.test(pathPart)) {
		return 'Path can only contain letters and numbers (a-z, A-Z, 0-9)';
	}
	
	// Check for duplicates (excluding the current mountpoint being edited)
	const otherPaths = existingMountpoints
		.filter(mp => mp.id !== currentMountpointId)
		.map(mp => mp.path);
	
	if (otherPaths.includes(path)) {
		return 'This path already exists';
	}
	
	return null; // Valid
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the currently editing mountpoint
 */
export function getEditingMountpoint(): { nodeId: string; mountpointId: string } | null {
	return editingMountpoint;
}

/**
 * Set the editing mountpoint (called from UI when editing completes)
 */
export function setEditingMountpoint(mp: { nodeId: string; mountpointId: string } | null): void {
	editingMountpoint = mp;
}

/**
 * Update a mountpoint path in an Input node
 * Note: Since we use stable IDs for handles, we only need to update the node data, not the edges
 */
export function updateMountpointPath(
	nodeId: string,
	mountpointId: string,
	newPath: string,
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void,
	_updateEdges: (updater: (edges: Edge[]) => Edge[]) => void
): void {
	// Update the mountpoint path in the Input node
	updateNodes(nodes => nodes.map(n => {
		if (n.id === nodeId && n.data.type === 'INPUT') {
			const inputData = n.data as InputNodeData;
			return {
				...n,
				data: {
					...inputData,
					mountpoints: inputData.mountpoints.map(mp => 
						mp.id === mountpointId ? { ...mp, path: newPath } : mp
					)
				}
			};
		}
		return n;
	}));
	// No need to update edges - they use the stable mountpoint ID
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle connection to ADD_MOUNT handle
 * Creates a new mountpoint and redirects the edge
 */
function handleAddMountConnection(event: ConnectionEvent): boolean {
	if (event.targetHandle !== HandleId.ADD_MOUNT) {
		return false;
	}

	// Get existing mountpoints for validation
	const targetNode = event.nodes.find(n => n.id === event.target);
	const existingMountpoints = targetNode?.data.type === 'INPUT' 
		? (targetNode.data as InputNodeData).mountpoints ?? []
		: [];

	// Use the initial placeholder path - user will edit it
	const newMountPath = INITIAL_MOUNTPOINT_PATH;
	
	// Validate before creating - check for duplicates
	const validationError = validateMountpointPath(newMountPath, existingMountpoints);
	if (validationError) {
		console.warn(`Cannot create mountpoint: ${validationError}`);
		return true; // Handled (but rejected) - prevent default edge creation
	}
	
	// Generate a stable ID for the new mountpoint
	const newMountpointId = generateMountpointId();
	const newMountpoint: Mountpoint = { id: newMountpointId, path: newMountPath };
	
	// Update the Input node to add the new mountpoint
	event.updateNodes(nodes => nodes.map(n => {
		if (n.id === event.target && n.data.type === 'INPUT') {
			const data = n.data as InputNodeData;
			return {
				...n,
				data: {
					...data,
					mountpoints: [...(data.mountpoints ?? []), newMountpoint]
				}
			};
		}
		return n;
	}));

	// Create edge to the new mountpoint handle (using stable ID)
	const newEdge: Edge = {
		id: `e-${event.source}-${event.target}-${newMountpointId}`,
		source: event.source,
		target: event.target,
		sourceHandle: event.sourceHandle ?? undefined,
		targetHandle: createMountpointHandleId(newMountpointId)
	};

	// Set editing mountpoint to focus the input
	editingMountpoint = { nodeId: event.target, mountpointId: newMountpointId };

	// Wait for the node to re-render with the new handle before adding the edge
	// Need multiple ticks: one for Svelte to update DOM, one for SvelteFlow to register handles
	// Using requestAnimationFrame ensures the browser has completed layout/paint
	tick().then(() => {
		requestAnimationFrame(() => {
			event.updateEdges(edges => [
				...edges.filter(e => e.targetHandle !== HandleId.ADD_MOUNT),
				newEdge
			]);
		});
	});

	return true; // Handled - prevent default edge creation
}

/**
 * Handle edge deletion for mountpoint edges
 * Removes the corresponding mountpoint from the Input node
 */
function handleMountpointEdgeDelete(event: EdgeDeleteEvent): void {
	if (!isMountpointHandle(event.edge.targetHandle)) {
		return;
	}

	const mountpointId = getMountpointId(event.edge.targetHandle!);
	const targetNodeId = event.edge.target;

	// Remove the mountpoint from the Input node
	event.updateNodes(nodes => nodes.map(n => {
		if (n.id === targetNodeId && n.data.type === 'INPUT') {
			const inputData = n.data as InputNodeData;
			return {
				...n,
				data: {
					...inputData,
					mountpoints: inputData.mountpoints.filter(mp => mp.id !== mountpointId)
				}
			};
		}
		return n;
	}));
}

// ============================================================================
// Registration
// ============================================================================

let registered = false;

/**
 * Register InputNode event handlers
 * Call this once at app initialization
 */
export function registerInputNodeHandlers(): () => void {
	if (registered) {
		console.warn('InputNode handlers already registered');
		return () => {};
	}
	
	registered = true;
	
	const unsubConnection = onConnection(handleAddMountConnection);
	const unsubEdgeDelete = onEdgeDelete(handleMountpointEdgeDelete);
	
	return () => {
		unsubConnection();
		unsubEdgeDelete();
		registered = false;
	};
}
