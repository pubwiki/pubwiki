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
	GeneratedNodeData
} from '../../../types';
import type { FlowNodeData } from '../../../types/flow';
import type { MessageBlock } from '@pubwiki/chat';
import { createGeneratedNodeData } from '../../../types';
import { 
	HandleId, 
	isMountpointHandle, 
	getMountpointId, 
	createMountpointHandleId,
	generateMountpointId
} from '../../../graph';
import { 
	onConnection, 
	onEdgeDelete,
	type ConnectionEvent,
	type EdgeDeleteEvent
} from '../../../state';
import { prepareForGeneration, syncNode, getIncomingEdges } from '../../../version';
import { positionNewNodesFromSources } from '../../../graph';
import { getNodeVfs } from '../../../vfs';
import { createMountedVfs, getMountedProvider, MountedVfsProvider, Vfs } from '@pubwiki/vfs';
import { generateBlockId, blocksToContent } from '@pubwiki/chat';
import { generateCommitHash } from '../../../version';
import { 
	createPubChat, 
	streamGeneration, 
	notifyStreamingChange,
	type StreamGenerationCallbacks,
	type GenerationConfig
} from '../generated/controller.svelte';
import { nodeStore, layoutStore } from '../../../persistence';



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
 * Now uses nodeStore directly, no longer requires updateNodes/updateEdges callbacks
 */
export function updateMountpointPath(
	nodeId: string,
	mountpointId: string,
	newPath: string
): void {
	// Update the mountpoint path in the Input node via nodeStore
	const nodeData = nodeStore.get(nodeId);
	if (nodeData && nodeData.type === 'INPUT') {
		const inputData = nodeData as InputNodeData;
		nodeStore.update(nodeId, (data) => {
			const input = data as InputNodeData;
			return {
				...input,
				content: inputData.content.updateMountpointPath(mountpointId, newPath)
			};
		});
	}
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

	// Get existing mountpoints for validation from nodeStore
	const nodeData = nodeStore.get(event.target);
	const existingMountpoints = nodeData?.type === 'INPUT' 
		? (nodeData as InputNodeData).content.mountpoints ?? []
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
	
	// Update the Input node to add the new mountpoint via nodeStore
	if (nodeData && nodeData.type === 'INPUT') {
		const inputData = nodeData as InputNodeData;
		nodeStore.update(event.target, (data) => {
			const input = data as InputNodeData;
			return {
				...input,
				content: inputData.content.addMountpoint(newMountpoint)
			};
		});
	}

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

	// Remove the mountpoint from the Input node via nodeStore
	const nodeData = nodeStore.get(targetNodeId);
	if (nodeData && nodeData.type === 'INPUT') {
		const inputData = nodeData as InputNodeData;
		nodeStore.update(targetNodeId, (data) => {
			const input = data as InputNodeData;
			return {
				...input,
				content: inputData.content.removeMountpoint(mountpointId)
			};
		});
	}
}

// ============================================================================
// Generation Logic
// ============================================================================

/**
 * Find all VFS nodes connected to a node via mountpoint handles
 * Returns a map of mount path -> VFS node ID
 * 
 * After layer separation:
 * - Uses FlowNodeData for flow layer
 * - Uses nodeStore for business data lookup
 */
export function findConnectedVfsNodes(
	nodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): Map<string, string> {
	const result = new Map<string, string>();
	
	// Get the target Input node's business data
	const inputData = nodeStore.get(nodeId);
	if (!inputData || inputData.type !== 'INPUT') {
		return result;
	}
	const mountpoints = (inputData as InputNodeData).content.mountpoints ?? [];
	
	// Find edges where this node is the target and handle is a mountpoint
	for (const edge of edges) {
		if (edge.target === nodeId && isMountpointHandle(edge.targetHandle)) {
			const mountpointId = getMountpointId(edge.targetHandle!);
			// Look up the path from the node's mountpoints array
			const mountpoint = mountpoints.find(mp => mp.id === mountpointId);
			if (!mountpoint) continue;
			
			const sourceNode = nodes.find(n => n.id === edge.source);
			if (!sourceNode) continue;
			
			const sourceData = nodeStore.get(sourceNode.id);
			if (sourceData && sourceData.type === 'VFS') {
				result.set(mountpoint.path, sourceNode.id);
			}
		}
	}
	
	return result;
}

/**
 * Callbacks for generation operations
 */
export interface GenerationCallbacks {
	/** Called to update a specific node's data */
	updateNodeData: (nodeId: string, updater: (data: StudioNodeData) => StudioNodeData) => void;
	/** Called to update flow nodes */
	updateNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void;
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
 * After layer separation:
 * - Uses FlowNodeData for flow layer
 * - Uses nodeStore for business data
 * 
 * @param config - LLM configuration (apiKey, model, baseUrl)
 * @returns The new generated node, or null if generation cannot proceed
 */
export async function generate(
	config: GenerationConfig,
	inputNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[],
	callbacks: GenerationCallbacks
): Promise<Node<FlowNodeData> | null> {
	const inputData = nodeStore.get(inputNodeId);
	if (!inputData || inputData.type !== 'INPUT' || !inputData.content) {
		return null;
	}

	// Create PubChat on-demand so user settings changes take effect immediately
	const pubchat = createPubChat(config);

	// Check if there are VFS nodes connected to this input node via mountpoints
	const vfsNodeIds = findConnectedVfsNodes(inputNodeId, nodes, edges);
	
	// If VFS nodes exist, set up mounted VFS for the generation
	let mountedVfs: Vfs<MountedVfsProvider> | null = null;
	if (vfsNodeIds.size > 0) {
		console.log("vfs", vfsNodeIds)
		mountedVfs = createMountedVfs();
		const provider = mountedVfs.getProvider()
		
		for (const [mountPath, vfsNodeId] of vfsNodeIds) {
			const vfsData = nodeStore.get(vfsNodeId);
			if (!vfsData || vfsData.type !== 'VFS') continue;
			const vfs = await getNodeVfs((vfsData as VFSNodeData).content.projectId, vfsNodeId);
			provider.mount(mountPath, vfs);
		}
	
		pubchat.setVFS(mountedVfs);
	}

	// Prepare for generation - creates snapshots, gets refs, and resolves tags
	// Note: prepareForGeneration needs to be updated to use FlowNodeData and nodeStore
	const prepared = await prepareForGeneration(nodes, edges, inputNodeId, (nodeId) => nodeStore.get(nodeId) as StudioNodeData | undefined);
	
	// Update nodes with synced data via nodeStore
	for (const n of prepared.nodes) {
		const existingData = nodeStore.get(n.id);
		if (existingData && JSON.stringify(existingData) !== JSON.stringify(n.data)) {
			nodeStore.set(n.id, n.data);
		}
	}

	// Create streaming generated node with indirect refs (empty blocks to start)
	const newGeneratedData = await createGeneratedNodeData(
		[],
		prepared.inputRef,
		prepared.promptRefs,
		prepared.indirectPromptRefs,
		prepared.parentRefs
	);
	
	// Calculate position for the new node using flow nodes
	const inputNode = nodes.find(n => n.id === inputNodeId);
	const position = inputNode 
		? { x: inputNode.position.x + 400, y: inputNode.position.y }
		: { x: 0, y: 0 };
	
	// Store the new node data in nodeStore
	nodeStore.create(newGeneratedData);
	
	// Mark as streaming (component will subscribe when mounted)
	notifyStreamingChange(newGeneratedData.id, true);
	
	// Store the position in layoutStore
	layoutStore.add(newGeneratedData.id, position.x, position.y);
	
	// Create the flow node (minimal data for SvelteFlow)
	const generatedNode: Node<FlowNodeData> = {
		id: newGeneratedData.id,
		type: 'GENERATED',
		data: { 
			id: newGeneratedData.id,
			type: 'GENERATED',
		},
		position,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
	};

	// Create edge from input to generated
	const newEdge: Edge = {
		id: `e-${inputNodeId}-${newGeneratedData.id}`,
		source: inputNodeId,
		target: newGeneratedData.id,
	};

	// Add the node to the flow
	callbacks.updateNodes(nodes => [...nodes, generatedNode]);
	
	// Add the edge
	callbacks.updateEdges(edges => [...edges, newEdge]);

	// Helper to update blocks in a generated node
	const updateBlocks = (nodeId: string, updater: (blocks: MessageBlock[]) => MessageBlock[]) => {
		const currentData = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
		if (currentData && currentData.type === 'GENERATED') {
			const newBlocks = updater(currentData.content.blocks || []);
			nodeStore.update(nodeId, (data) => {
				const genData = data as GeneratedNodeData;
				return {
					...genData,
					content: genData.content.withBlocks(newBlocks)
				};
			});
		}
	};

	// Define stream callbacks using MessageBlock model
	const streamCallbacks: StreamGenerationCallbacks = {
		onToken: (nodeId, accumulatedContent) => {
			updateBlocks(nodeId, (blocks) => {
				// Find the last markdown block
				const lastBlock = blocks[blocks.length - 1];
				if (lastBlock && lastBlock.type === 'markdown') {
					// Update existing markdown block
					return blocks.map((b, i) =>
						i === blocks.length - 1
							? { ...b, content: accumulatedContent }
							: b
					);
				} else {
					// Create new markdown block
					const newBlock: MessageBlock = {
						id: generateBlockId(),
						type: 'markdown',
						content: accumulatedContent
					};
					return [...blocks, newBlock];
				}
			});
		},
		onToolCall: (nodeId, toolCallId, name, args) => {
			updateBlocks(nodeId, (blocks) => {
				// Add a new tool_call block
				const toolCallBlock: MessageBlock = {
					id: generateBlockId(),
					type: 'tool_call',
					content: '',
					toolCallId,
					toolName: name,
					toolArgs: args,
					toolStatus: 'running'
				};
				return [...blocks, toolCallBlock];
			});
		},
		onToolResult: (nodeId, toolCallId, result) => {
			updateBlocks(nodeId, (blocks) => {
				// Update the tool_call block status and add a tool_result block
				const updatedBlocks = blocks.map(b =>
					b.type === 'tool_call' && b.toolCallId === toolCallId
						? { ...b, toolStatus: 'completed' as const }
						: b
				);
				// Add tool_result block
				const resultBlock: MessageBlock = {
					id: generateBlockId(),
					type: 'tool_result',
					content: typeof result === 'string' ? result : JSON.stringify(result),
					toolCallId
				};
				return [...updatedBlocks, resultBlock];
			});
		},
		onDone: async (nodeId, _finalContent, _finalCommit) => {
			// Notify streaming complete
			notifyStreamingChange(nodeId, false);
			
			// Get the current blocks and compute commit hash
			const updatedData = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
			const currentBlocks = updatedData?.content?.blocks || [];
			const contentText = blocksToContent(currentBlocks);
			const commit = await generateCommitHash(contentText);
			
			// Update commit
			const finalData = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
			if (finalData) {
				nodeStore.update(nodeId, (data) => ({
					...data,
					commit
				}));
				
				// Save snapshot with incoming edge information
				// The incoming edge is from the input node to this generated node
				const dataWithCommit = nodeStore.get(nodeId) as GeneratedNodeData;
				const incomingEdges = getIncomingEdges(nodeId, [newEdge]);
				await nodeStore.saveSnapshot(dataWithCommit, { 
					incomingEdges, 
					position 
				});
			}
			
			// Clear VFS after generation completes
			if (mountedVfs) {
				pubchat.clearVFS();
			}
			callbacks.onComplete?.();
		},
		onError: (nodeId, _error) => {
			// Notify streaming complete (even on error)
			notifyStreamingChange(nodeId, false);
			
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
