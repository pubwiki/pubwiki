/**
 * InputNode Controller
 * 
 * Handles InputNode-specific logic:
 * - Generation trigger from input nodes (onGenerate)
 * - Auto-creation of output VFS for file creation scenarios
 */

import { tick } from 'svelte';
import { Position, type Node, type Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	InputNodeData, 
	VFSNodeData,
	GeneratedNodeData,
	VfsRef
} from '$lib/types';
import type { FlowNodeData } from '$lib/types/flow';
import type { MessageBlock } from '@pubwiki/chat';
import { createGeneratedNodeData, createVFSNodeData } from '$lib/types';
import { 
	HandleId
} from '$lib/graph';
import { prepareForGeneration, syncNode, getIncomingEdges } from '$lib/version';
import { positionNewNodesFromSources } from '$lib/graph';
import { getNodeVfs } from '$lib/vfs';
import { getVfsController } from '../vfs/controller.svelte';
import { Vfs } from '@pubwiki/vfs';
import { generateBlockId, blocksToContent } from '@pubwiki/chat';
import { generateContentHash } from '$lib/version';
import { computeNodeCommit } from '@pubwiki/api';
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
// Generation Logic
// ============================================================================

// ============================================================================
// Auto-VFS Creation for File Operations
// ============================================================================

/**
 * Pre-created VFS node info (not yet shown in flow)
 */
interface PendingVfsNode {
	nodeData: VFSNodeData;
	flowNode: Node<FlowNodeData>;
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
		vfs
	};
}

// ============================================================================
// VFS Mount Resolution
// ============================================================================

/**
 * Find VFS nodes connected to an input node.
 * Returns a Map of mount path -> source VFS node ID.
 * 
 * NOTE: The VFS_MOUNT handle has been removed in favor of drag-to-folder mounting.
 * This function currently returns an empty Map. VFS context for generation 
 * may need to be provided through a different mechanism in the future.
 * 
 * @deprecated VFS_MOUNT handle removed. Consider using VFSContent.mounts on VFS nodes.
 */
/**
 * Find the VFS node connected to an input node's VFS_INPUT handle.
 * Input node can only connect to a single VFS node.
 * 
 * @returns The VFS node ID if connected, null otherwise
 */
export function findConnectedVfsNode(
	inputNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): string | null {
	// Find edge connected to the VFS_INPUT handle
	const vfsEdge = edges.find(e => 
		e.target === inputNodeId && 
		e.targetHandle === HandleId.VFS_INPUT
	);
	
	if (!vfsEdge) {
		return null;
	}
	
	const sourceNode = nodes.find(n => n.id === vfsEdge.source);
	if (sourceNode && sourceNode.type === 'VFS') {
		console.log('[findConnectedVfsNode] Found VFS node:', vfsEdge.source);
		return vfsEdge.source;
	}
	
	return null;
}

/**
 * Show a pending VFS node in the flow
 */
export function showPendingVfsNode(
	pendingVfs: PendingVfsNode,
	callbacks: GenerationCallbacks
): void {
	callbacks.updateNodes(nodes => [...nodes, pendingVfs.flowNode]);
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

	// Check if a VFS node is connected to this input node
	const vfsNodeId = findConnectedVfsNode(inputNodeId, nodes, edges);
	
	// Track input VFS ref for file modification scenario
	let inputVfsRef: VfsRef | null = null;
	let outputVfsId: string | null = null;
	
	// If VFS node exists, set up VFS for the generation
	if (vfsNodeId) {
		console.log('[Generate] Connected VFS node:', vfsNodeId);
		const vfsData = nodeStore.get(vfsNodeId) as VFSNodeData | undefined;
		
		if (vfsData) {
			const vfsController = await getVfsController(vfsData.content.projectId, vfsNodeId);
			
			// For file modification scenario: commit the VFS and record inputVfsRef
			try {
				// Commit current VFS state as base for modifications
				const baseCommit = await vfsController.vfs.commit('Pre-generation snapshot');
				inputVfsRef = { nodeId: vfsNodeId, commit: baseCommit.hash };
				outputVfsId = vfsNodeId;  // Output to the same VFS
				console.log('[Generate] Recorded input VFS ref:', inputVfsRef);
			} catch (e) {
				// May fail if no changes to commit - get HEAD instead
				try {
					const head = await vfsController.vfs.getHead();
					inputVfsRef = { nodeId: vfsNodeId, commit: head.hash };
					outputVfsId = vfsNodeId;
					console.log('[Generate] Using existing HEAD as input VFS ref:', inputVfsRef);
				} catch {
					// No commits yet, that's OK
					console.log('[Generate] No existing commits in VFS');
					outputVfsId = vfsNodeId;
				}
			}
			
			// Set VFS directly for pubchat
			const vfs = await getNodeVfs(vfsData.content.projectId, vfsNodeId);
			pubchat.setVFS(vfs);
		}
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
	// parent is null for newly created nodes (no version lineage yet)
	const newGeneratedData = await createGeneratedNodeData(
		[],
		prepared.inputRef,
		prepared.promptRefs,
		prepared.indirectPromptRefs,
		null, // parent - new node has no version lineage
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
	
	// Track whether VFS node has been shown (for file creation scenario)
	let vfsShown = false;

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
	
	if (!vfsNodeId) {
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
			const contentHash = await generateContentHash(contentText);
			const commit = await computeNodeCommit(nodeId, updatedData?.parent ?? null, contentHash, 'GENERATED');
			
			// Update commit and contentHash
			const finalData = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
			if (finalData) {
				nodeStore.update(nodeId, (data) => ({
					...data,
					commit,
					contentHash
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
				// and record the postGenerationCommit
				const genDataFinal = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
				if (genDataFinal?.content.outputVfsId) {
					const vfsNodeId = genDataFinal.content.outputVfsId;
					const vfsData = nodeStore.get(vfsNodeId) as VFSNodeData | undefined;
					if (vfsData) {
						try {
							const vfsController = await getVfsController(vfsData.content.projectId, vfsNodeId);
							const postCommit = await vfsController.vfs.commit('AI generated files');
							console.log('[Generate] Auto-committed VFS:', vfsNodeId, 'commit:', postCommit.hash);
							
							// Record postGenerationCommit in GeneratedContent
							nodeStore.update(nodeId, (data) => {
								const genData = data as GeneratedNodeData;
								return {
									...genData,
									content: genData.content.withPostGenerationCommit(postCommit.hash)
								};
							});
						} catch (e) {
							// May fail if no changes to commit - get current HEAD as postGenerationCommit
							console.log('[Generate] No changes to commit in VFS:', e);
							try {
								const vfsController = await getVfsController(vfsData.content.projectId, vfsNodeId);
								const head = await vfsController.vfs.getHead();
								nodeStore.update(nodeId, (data) => {
									const genData = data as GeneratedNodeData;
									return {
										...genData,
										content: genData.content.withPostGenerationCommit(head.hash)
									};
								});
							} catch {
								// No commits at all, that's fine
							}
						}
					}
				}
			}
			
			// Clear VFS after generation completes
			if (vfsNodeId || pendingVfs) {
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
			if (vfsNodeId || pendingVfs) {
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
