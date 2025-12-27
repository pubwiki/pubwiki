/**
 * InputNode Controller
 * 
 * Handles InputNode-specific logic:
 * - Creating mountpoints when VFS connects to ADD_MOUNT handle
 * - Removing mountpoints when edges are deleted
 * - Managing mountpoint path editing state
 * - Generation trigger from input nodes (onGenerate)
 */

import { tick } from 'svelte';
import { Position, type Node, type Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	InputNodeData, 
	VFSNodeData,
	Mountpoint,
	GeneratedNodeData,
	ToolCallState
} from '../../../utils/types';
import { createGeneratedNodeData } from '../../../utils/types';
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
import { prepareForGeneration } from '../../../utils/version';
import { positionNewNodesFromSources } from '../../../utils/layout';
import { getNodeVfs } from '../../../stores/vfs';
import { createMountedVfs, getMountedProvider, MountedVfsProvider, Vfs } from '@pubwiki/vfs';
import { 
	createPubChat, 
	streamGeneration, 
	type StreamGenerationCallbacks,
	type GenerationConfig
} from '../generated/controller.svelte';

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
// Generation Logic
// ============================================================================

/**
 * Find all VFS nodes connected to a node via mountpoint handles
 * Returns a map of mount path -> VFS node
 */
export function findConnectedVfsNodes(
	nodeId: string,
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Map<string, Node<VFSNodeData>> {
	const result = new Map<string, Node<VFSNodeData>>();
	
	// Get the target Input node to look up mountpoint paths
	const inputNode = nodes.find(n => n.id === nodeId);
	if (!inputNode || inputNode.data.type !== 'INPUT') {
		return result;
	}
	const inputData = inputNode.data as InputNodeData;
	const mountpoints = inputData.mountpoints ?? [];
	
	// Find edges where this node is the target and handle is a mountpoint
	for (const edge of edges) {
		if (edge.target === nodeId && isMountpointHandle(edge.targetHandle)) {
			const mountpointId = getMountpointId(edge.targetHandle!);
			// Look up the path from the node's mountpoints array
			const mountpoint = mountpoints.find(mp => mp.id === mountpointId);
			if (!mountpoint) continue;
			
			const sourceNode = nodes.find(n => n.id === edge.source);
			if (sourceNode && sourceNode.data.type === 'VFS') {
				result.set(mountpoint.path, sourceNode as Node<VFSNodeData>);
			}
		}
	}
	
	return result;
}

/**
 * Callbacks for generation operations
 */
export interface GenerationCallbacks {
	/** Called to update nodes */
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void;
	/** Called to update edges */
	updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
	/** Called when generation completes successfully */
	onComplete?: () => void;
}

/**
 * Generate from an input node
 * This handles the full generation flow including:
 * - Finding connected VFS nodes and setting up mounts
 * - Preparing snapshots and refs
 * - Creating the generated node
 * - Streaming the response
 * 
 * @param config - LLM configuration (apiKey, model, baseUrl)
 * @returns The new generated node, or null if generation cannot proceed
 */
export async function generate(
	config: GenerationConfig,
	inputNodeId: string,
	nodes: Node<StudioNodeData>[],
	edges: Edge[],
	callbacks: GenerationCallbacks
): Promise<Node<StudioNodeData> | null> {
	const inputNode = nodes.find(n => n.id === inputNodeId);
	if (!inputNode || inputNode.data.type !== 'INPUT' || !inputNode.data.content) {
		return null;
	}

	// Create PubChat on-demand so user settings changes take effect immediately
	const pubchat = createPubChat(config);

	// Check if there are VFS nodes connected to this input node via mountpoints
	const vfsNodes = findConnectedVfsNodes(inputNodeId, nodes, edges);
	
	// If VFS nodes exist, set up mounted VFS for the generation
	let mountedVfs: Vfs<MountedVfsProvider> | null = null;
	if (vfsNodes.size > 0) {
		console.log("vfs", vfsNodes)
		mountedVfs = createMountedVfs();
		const provider = mountedVfs.getProvider()
		
		if (provider) {
			for (const [mountPath, vfsNode] of vfsNodes) {
				const vfsData = vfsNode.data as VFSNodeData;
				const vfs = await getNodeVfs(vfsData.projectId, vfsNode.id);
				provider.mountVfs(mountPath, vfs);
			}
		}
		
		pubchat.setVFS(mountedVfs);
	}

	// Prepare for generation - creates snapshots, gets refs, and resolves tags
	const prepared = await prepareForGeneration(nodes, edges, inputNodeId);
	
	// Update nodes with synced data
	callbacks.updateNodes(() => prepared.nodes);

	// Create streaming generated node with indirect refs
	const newGeneratedData = await createGeneratedNodeData(
		'',
		prepared.inputRef,
		prepared.promptRefs,
		prepared.indirectPromptRefs,
		prepared.parentRefs
	);
	
	const generatedNode: Node<StudioNodeData> = {
		id: newGeneratedData.id,
		type: 'generated',
		data: { 
			...newGeneratedData,
			isStreaming: true,
		},
		position: { x: 0, y: 0 }, // TODO calculate a suitable position Will be positioned by caller
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
	};

	// Create edge from input to generated
	const newEdge: Edge = {
		id: `e-${inputNodeId}-${newGeneratedData.id}`,
		source: inputNodeId,
		target: newGeneratedData.id,
	};

	// Add the generated node and edge, then position it relative to source
	callbacks.updateEdges(edges => [...edges, newEdge]);
	callbacks.updateNodes(nodes => {
		const updatedNodes = [...nodes, generatedNode];
		return positionNewNodesFromSources([generatedNode.id], updatedNodes, [...edges, newEdge]);
	});

	// Define stream callbacks
	const streamCallbacks: StreamGenerationCallbacks = {
		onToken: (nodeId, accumulatedContent) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS'
					? { ...n, data: { ...n.data, content: accumulatedContent } }
					: n
			) as Node<StudioNodeData>[]);
		},
		onToolCall: (nodeId, toolCallId, name, args) => {
			callbacks.updateNodes(nodes => nodes.map(n => {
				if (n.id === nodeId && n.data.type === 'GENERATED') {
					const genData = n.data as GeneratedNodeData;
					const newToolCall: ToolCallState = {
						id: toolCallId,
						name,
						args,
						status: 'running'
					};
					return { 
						...n, 
						data: { 
							...genData, 
							toolCalls: [...(genData.toolCalls || []), newToolCall] 
						} 
					};
				}
				return n;
			}) as Node<StudioNodeData>[]);
		},
		onToolResult: (nodeId, toolCallId, result) => {
			callbacks.updateNodes(nodes => nodes.map(n => {
				if (n.id === nodeId && n.data.type === 'GENERATED') {
					const genData = n.data as GeneratedNodeData;
					return { 
						...n, 
						data: { 
							...genData, 
							toolCalls: (genData.toolCalls || []).map(tc => 
								tc.id === toolCallId 
									? { ...tc, status: 'completed' as const, result } 
									: tc
							) 
						} 
					};
				}
				return n;
			}) as Node<StudioNodeData>[]);
		},
		onDone: (nodeId, finalContent, finalCommit) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS'
					? { ...n, data: { ...n.data, content: finalContent, commit: finalCommit, isStreaming: false } }
					: n
			) as Node<StudioNodeData>[]);
			// Clear VFS after generation completes
			if (mountedVfs) {
				pubchat.clearVFS();
			}
			callbacks.onComplete?.();
		},
		onError: (nodeId, _error) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS' 
					? { ...n, data: { ...n.data, isStreaming: false } } 
					: n
			) as Node<StudioNodeData>[]);
			// Clear VFS on error too
			if (mountedVfs) {
				pubchat.clearVFS();
			}
		}
	};

	// Stream generation (don't await - let it run in background)
	streamGeneration(
		config,
		newGeneratedData.id,
		prepared.resolvedUserInput,
		prepared.resolvedSystemPrompt,
		streamCallbacks,
		pubchat  // Pass the configured PubChat instance with VFS
	).catch(err => {
		console.error('Generation failed:', err);
		streamCallbacks.onError(newGeneratedData.id, err);
	});

	return generatedNode;
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
