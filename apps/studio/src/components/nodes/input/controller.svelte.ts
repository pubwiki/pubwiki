/**
 * InputNode Controller
 * 
 * Handles InputNode-specific logic:
 * - Creating mountpoints when VFS connects to ADD_MOUNT handle
 * - Removing mountpoints when edges are deleted
 * - Managing mountpoint path editing state
 * - Generation trigger from input nodes (onGenerate)
 * - Auto-creation of output VFS for file creation scenarios
 */

import { tick } from 'svelte';
import { Position, type Node, type Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	InputNodeData, 
	VFSNodeData,
	Mountpoint,
	GeneratedNodeData,
	VfsRef
} from '$lib/types';
import type { FlowNodeData } from '$lib/types/flow';
import type { MessageBlock } from '@pubwiki/chat';
import { createGeneratedNodeData, createVFSNodeData } from '$lib/types';
import { 
	HandleId, 
	isMountpointHandle, 
	getMountpointId, 
	createMountpointHandleId,
	generateMountpointId
} from '$lib/graph';
import { 
	onConnection, 
	onEdgeDelete,
	type ConnectionEvent,
	type EdgeDeleteEvent
} from '$lib/state';
import { prepareForGeneration, syncNode, getIncomingEdges } from '$lib/version';
import { positionNewNodesFromSources } from '$lib/graph';
import { getNodeVfs } from '$lib/vfs';
import { getVfsController } from '../vfs/controller.svelte';
import { createMountedVfs, getMountedProvider, MountedVfsProvider, Vfs } from '@pubwiki/vfs';
import { generateBlockId, blocksToContent } from '@pubwiki/chat';
import { generateCommitHash } from '$lib/version';
import { 
	createPubChat, 
	streamGeneration, 
	notifyStreamingChange,
	type StreamGenerationCallbacks,
	type GenerationConfig
} from '../generated/controller.svelte';
import { nodeStore, layoutStore } from '$lib/persistence';


// ============================================================================
// VFS Tool Detection
// ============================================================================

/** Tools that perform file write operations */
const FILE_WRITE_TOOLS = new Set(['write_file', 'delete_file', 'mkdir', 'rmdir']);

/**
 * Check if a tool name is a file write operation
 */
export function isFileWriteTool(toolName: string): boolean {
	return FILE_WRITE_TOOLS.has(toolName);
}

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
	tick().then(() => tick()).then(() => tick()).then(() => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				event.updateEdges(edges => [
					...edges.filter(e => e.targetHandle !== HandleId.ADD_MOUNT),
					newEdge
				]);
			});
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

// ============================================================================
// Auto-VFS Creation for File Operations
// ============================================================================

/**
 * Pre-created VFS node info (not yet shown in flow)
 */
interface PendingVfsNode {
	nodeData: VFSNodeData;
	flowNode: Node<FlowNodeData>;
	edge: Edge;
	vfs: Vfs<any>;
}

/**
 * Pre-create a VFS node associated with a Generated node for file creation scenarios.
 * The node is created in stores but NOT added to flow yet - call showPendingVfsNode() to display it.
 * 
 * @param generatedNodeId - The ID of the generated node to associate with
 * @param projectId - The project ID for the VFS
 * @returns The pending VFS node info
 */
export async function createPendingVfsNode(
	generatedNodeId: string,
	projectId: string
): Promise<PendingVfsNode> {
	// Create the VFS node data with the same project ID as the generated node's context
	const vfsNodeData = await createVFSNodeData(projectId, 'Generated Files');
	
	// Store in nodeStore
	nodeStore.create(vfsNodeData);
	
	// Get the generated node's position from layoutStore
	const genLayout = layoutStore.get(generatedNodeId);
	const position = genLayout 
		? { x: genLayout.x, y: genLayout.y + 200 }  // Position below the generated node
		: { x: 0, y: 200 };
	
	// Store the VFS node position
	layoutStore.add(vfsNodeData.id, position.x, position.y);
	
	// Create the flow node (not added to flow yet)
	const vfsFlowNode: Node<FlowNodeData> = {
		id: vfsNodeData.id,
		type: 'VFS',
		data: {
			id: vfsNodeData.id,
			type: 'VFS',
		},
		position,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
	};
	
	// Create edge from Generated VFS_OUTPUT to VFS (not added yet)
	const vfsEdge: Edge = {
		id: `e-${generatedNodeId}-${vfsNodeData.id}-vfs`,
		source: generatedNodeId,
		sourceHandle: HandleId.VFS_OUTPUT,
		target: vfsNodeData.id,
		targetHandle: HandleId.DEFAULT,
	};
	
	// Pre-initialize the VFS so it's ready for tool calls
	const vfs = await getNodeVfs(projectId, vfsNodeData.id);
	
	// Update Generated node's outputVfsId immediately
	nodeStore.update(generatedNodeId, (data) => {
		const gen = data as GeneratedNodeData;
		return {
			...gen,
			content: gen.content.withOutputVfs(vfsNodeData.id)
		};
	});
	
	return {
		nodeData: vfsNodeData,
		flowNode: vfsFlowNode,
		edge: vfsEdge,
		vfs
	};
}

/**
 * Show a pending VFS node in the flow
 */
export function showPendingVfsNode(
	pendingVfs: PendingVfsNode,
	callbacks: GenerationCallbacks
): void {
	callbacks.updateNodes(nodes => [...nodes, pendingVfs.flowNode]);
	callbacks.updateEdges(edges => [...edges, pendingVfs.edge]);
}

/**
 * Clean up a pending VFS node that was never shown (no file operations occurred)
 */
export function cleanupPendingVfsNode(
	pendingVfs: PendingVfsNode,
	generatedNodeId: string
): void {
	// Remove from stores
	nodeStore.delete(pendingVfs.nodeData.id);
	layoutStore.delete(pendingVfs.nodeData.id);
	
	// Clear the outputVfsId from the generated node
	nodeStore.update(generatedNodeId, (data) => {
		const gen = data as GeneratedNodeData;
		return {
			...gen,
			content: gen.content.withOutputVfs(null)
		};
	});
	
	console.log('[Generate] Cleaned up unused pending VFS:', pendingVfs.nodeData.id);
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
 * Settings required for generation - matches SettingsStore interface
 */
export interface GenerationSettings {
	api: {
		apiKey: string;
		selectedModel: string;
	};
	effectiveBaseUrl: string;
}

/**
 * Generate from an input node
 * This handles the full generation flow including:
 * - Reading node's generationConfig and merging with global settings
 * - Finding connected VFS nodes and setting up mounts
 * - Preparing snapshots and refs
 * - Creating the generated node
 * - Streaming the response
 * - Auto-creating VFS for file creation scenarios
 * 
 * @param inputNodeId - The ID of the input node to generate from
 * @param nodes - Current flow nodes
 * @param edges - Current flow edges
 * @param settings - Global settings (from SettingsStore)
 * @param callbacks - Callbacks for updating state
 * @param projectId - Optional project ID for auto-VFS creation (defaults to generated node ID)
 * @returns The new generated node, or null if generation cannot proceed
 */
export async function generate(
	inputNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[],
	settings: GenerationSettings,
	callbacks: GenerationCallbacks,
	projectId?: string
): Promise<Node<FlowNodeData> | null> {
	// Get node data from nodeStore
	const inputData = nodeStore.get(inputNodeId) as InputNodeData | undefined;
	if (!inputData || inputData.type !== 'INPUT' || !inputData.content) {
		return null;
	}
	
	// Build config: node-level settings override global settings
	const nodeConfig = inputData.content.generationConfig;
	const config: GenerationConfig = {
		apiKey: settings.api.apiKey,
		model: nodeConfig?.model || settings.api.selectedModel,
		baseUrl: settings.effectiveBaseUrl,
		temperature: nodeConfig?.temperature,
		schema: nodeConfig?.schema
	};

	// Create PubChat on-demand so user settings changes take effect immediately
	const pubchat = createPubChat(config);

	// Check if there are VFS nodes connected to this input node via mountpoints
	const vfsNodeIds = findConnectedVfsNodes(inputNodeId, nodes, edges);
	
	// Track input VFS ref for file modification scenario
	let inputVfsRef: VfsRef | null = null;
	let outputVfsId: string | null = null;
	
	// If VFS nodes exist, set up mounted VFS for the generation
	let mountedVfs: Vfs<MountedVfsProvider> | null = null;
	if (vfsNodeIds.size > 0) {
		console.log("vfs", vfsNodeIds)
		mountedVfs = createMountedVfs();
		const provider = mountedVfs.getProvider()
		
		// For file modification scenario: commit the VFS and record inputVfsRef
		// Use the first VFS as the primary input/output VFS
		const [firstMountPath, firstVfsNodeId] = vfsNodeIds.entries().next().value as [string, string];
		const firstVfsData = nodeStore.get(firstVfsNodeId) as VFSNodeData | undefined;
		
		if (firstVfsData) {
			const vfsController = await getVfsController(firstVfsData.content.projectId, firstVfsNodeId);
			try {
				// Commit current VFS state as base for modifications
				const baseCommit = await vfsController.vfs.commit('Pre-generation snapshot');
				inputVfsRef = { nodeId: firstVfsNodeId, commit: baseCommit.hash };
				outputVfsId = firstVfsNodeId;  // Output to the same VFS
				console.log('[Generate] Recorded input VFS ref:', inputVfsRef);
			} catch (e) {
				// May fail if no changes to commit - get HEAD instead
				try {
					const head = await vfsController.vfs.getHead();
					inputVfsRef = { nodeId: firstVfsNodeId, commit: head.hash };
					outputVfsId = firstVfsNodeId;
					console.log('[Generate] Using existing HEAD as input VFS ref:', inputVfsRef);
				} catch {
					// No commits yet, that's OK
					console.log('[Generate] No existing commits in VFS');
				}
			}
		}
		
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
	// Include inputVfsRef and outputVfsId for file modification scenarios
	const newGeneratedData = await createGeneratedNodeData(
		[],
		prepared.inputRef,
		prepared.promptRefs,
		prepared.indirectPromptRefs,
		prepared.parentRefs,
		'',  // name
		inputVfsRef,
		outputVfsId
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
	
	// Track whether VFS output edge has been created (for file modification scenario)
	let vfsOutputEdgeCreated = false;

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

	// Pre-create VFS node for file creation scenario (if no existing VFS connection)
	// The node is created but not shown until a file write operation occurs
	let pendingVfs: PendingVfsNode | null = null;
	let vfsShown = false;
	
	if (vfsNodeIds.size === 0) {
		// No existing VFS connected - pre-create one for potential file operations
		const vfsProjectId = projectId ?? crypto.randomUUID();
		pendingVfs = await createPendingVfsNode(newGeneratedData.id, vfsProjectId);
		
		// Set the pending VFS directly for pubchat so tool calls can write to it
		// No need for MountedVfs wrapper since there's only one VFS
		pubchat.setVFS(pendingVfs.vfs);
		
		console.log('[Generate] Pre-created pending VFS:', {
			nodeId: pendingVfs.nodeData.id,
			projectId: vfsProjectId,
			contentProjectId: pendingVfs.nodeData.content.projectId
		});
	}

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
			// Check if this is a file write tool
			if (isFileWriteTool(name)) {
				// For file creation scenario: show the pending VFS node
				if (pendingVfs && !vfsShown) {
					showPendingVfsNode(pendingVfs, callbacks);
					vfsShown = true;
					console.log('[Generate] Showed pending VFS for file operation:', pendingVfs.nodeData.id);
				}
				
				// For file modification scenario: create edge from Generated to VFS
				if (outputVfsId && !vfsOutputEdgeCreated) {
					const vfsOutputEdge: Edge = {
						id: `e-${nodeId}-${outputVfsId}-vfs`,
						source: nodeId,
						sourceHandle: HandleId.VFS_OUTPUT,
						target: outputVfsId,
						targetHandle: HandleId.DEFAULT,
					};
					callbacks.updateEdges(edges => [...edges, vfsOutputEdge]);
					vfsOutputEdgeCreated = true;
					console.log('[Generate] Created VFS output edge for file modification:', vfsOutputEdge.id);
				}
			}
			
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
			
			// Handle pending VFS: cleanup if not shown, commit if shown
			if (pendingVfs) {
				if (!vfsShown) {
					// No file operations occurred - clean up the unused VFS
					cleanupPendingVfsNode(pendingVfs, nodeId);
				} else {
					// VFS was shown - auto-commit the changes
					try {
						const vfsController = await getVfsController(pendingVfs.nodeData.content.projectId, pendingVfs.nodeData.id);
						await vfsController.vfs.commit('AI generated files');
						console.log('[Generate] Auto-committed VFS:', pendingVfs.nodeData.id);
					} catch (e) {
						// May fail if no changes to commit
						console.log('[Generate] No changes to commit in VFS:', e);
					}
				}
			} else {
				// Auto-commit VFS if we have an existing output VFS (file modification scenario)
				const genDataFinal = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
				if (genDataFinal?.content.outputVfsId) {
					const vfsNodeId = genDataFinal.content.outputVfsId;
					const vfsData = nodeStore.get(vfsNodeId) as VFSNodeData | undefined;
					if (vfsData) {
						try {
							const vfsController = await getVfsController(vfsData.content.projectId, vfsNodeId);
							await vfsController.vfs.commit('AI generated files');
							console.log('[Generate] Auto-committed VFS:', vfsNodeId);
						} catch (e) {
							// May fail if no changes to commit
							console.log('[Generate] No changes to commit in VFS:', e);
						}
					}
				}
			}
			
			// Clear VFS after generation completes
			if (mountedVfs || pendingVfs) {
				pubchat.clearVFS();
			}
			callbacks.onComplete?.();
		},
		onError: (nodeId, _error) => {
			// Notify streaming complete (even on error)
			notifyStreamingChange(nodeId, false);
			
			// Clean up pending VFS if not shown
			if (pendingVfs && !vfsShown) {
				cleanupPendingVfsNode(pendingVfs, nodeId);
			}
			
			// Clear VFS on error too
			if (mountedVfs || pendingVfs) {
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
