<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode, type IsValidConnection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from 'dagre';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { GraphNode, VFSNode, SandboxNode, LoaderNode } from '../components/nodes';
	import FlowController from '../components/FlowController.svelte';
	import { StudioSidebar } from '../components/sidebar';
	import { 
		type StudioNodeData, 
		type NodeRef,
		type GeneratedNodeData,
		type VFSNodeData,
		snapshotStore,
		createPromptNodeData, 
		createInputNodeData,
		createGeneratedNodeData,
		createVFSNodeData,
		createSandboxNodeData,
		createLoaderNodeData,
		generateCommitHash,
		restoreSnapshot,
		syncNode
	} from '../utils/types';
	import {
		prepareForGeneration,
		rebuildHistoricalTree,
		styleEdgesForVersions,
		type HistoricalTreeResult
	} from '../utils/version';
	import { resolvePromptContentFromRefs } from '../utils/reftag';
	import { validateConnection, HandleId } from '../utils/connection';
	import { publishArtifact, type PublishMetadata } from '../utils/publish';
	import { setStudioContext, type StudioContext } from '../stores/context';
	import { initSnapshotStore } from '../stores/snapshot';
	import { loadGraph, saveGraph, saveProject, ensureProject, deleteProject, remapNodeIds, setCurrentProject } from '../stores/db';
	import { getNodeVfs } from '../stores/vfs';
	import { useAuth } from '$lib/stores/auth.svelte';
	import { PubChat, MemoryMessageStore, createSystemMessage } from '@pubwiki/chat';

	// ============================================================================
	// LLM Configuration (for internal generation)
	// ============================================================================
	
	const pubchat = new PubChat({
		llm: {
			// FIXME: only for test, do not bring to production
			apiKey: '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',
			model: 'google/gemini-2.5-flash',
			baseUrl: 'https://openrouter.ai/api/v1'
		},
		messageStore: new MemoryMessageStore(),
		toolCalling: {
			enabled: true,
			maxIterations: 10
		}
	});

	// ============================================================================
	// Node Types
	// ============================================================================
	
	const nodeTypes = {
		prompt: GraphNode,
		input: GraphNode,
		generated: GraphNode,
		vfs: VFSNode,
		sandbox: SandboxNode,
		loader: LoaderNode
	};

	// ============================================================================
	// Auth
	// ============================================================================

	const auth = useAuth();

	// ============================================================================
	// Page Data (project ID from URL)
	// ============================================================================

	let { data }: { data: PageData } = $props();

	// ============================================================================
	// Flow State
	// ============================================================================
	
	let nodes = $state.raw<Node<StudioNodeData>[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let editingNodeId = $state<string | null>(null);
	let editingNameNodeId = $state<string | null>(null);
	let selectedNodes = $state<Node<StudioNodeData>[]>([]);
	let flowApi = $state<ReturnType<typeof useSvelteFlow> | null>(null);
	let initialized = $state(false);
	let loaded = $state(false);
	let saving = $state(false);
	
	// Whether this project is a draft (not yet published)
	let isDraft = $state(true);
	
	// Project name
	let projectName = $state('');
	
	// Current project ID (from URL params)
	let currentProjectId = $derived(data.projectId);
	
	// Historical tree state for preview mode
	let historicalTree = $state<HistoricalTreeResult | null>(null);
	
	// Auto-save debounce timer
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const SAVE_DEBOUNCE_MS = 500;
	
	// Schedule a debounced save to IndexedDB
	function scheduleSave() {
		if (!loaded) return;
		
		if (saveTimer) {
			clearTimeout(saveTimer);
		}
		
		saveTimer = setTimeout(async () => {
			saving = true;
			try {
				await saveGraph(
					untrack(() => nodes),
					untrack(() => edges),
					currentProjectId
				);
			} catch (err) {
				console.error('[Studio] Failed to save graph:', err);
			} finally {
				saving = false;
			}
		}, SAVE_DEBOUNCE_MS);
	}
	
	// Watch for changes and auto-save
	$effect(() => {
		// Access nodes and edges to track them
		nodes;
		edges;
		// Schedule save on any change
		untrack(() => scheduleSave());
	});

	// ============================================================================
	// Textarea Registry (for external focus control from badges)
	// ============================================================================
	
	const textareaRegistry = new Map<string, HTMLTextAreaElement>();
	
	function registerTextarea(id: string, el: HTMLTextAreaElement) {
		textareaRegistry.set(id, el);
	}
	
	function unregisterTextarea(id: string) {
		textareaRegistry.delete(id);
	}
	
	function focusNode(id: string) {
		const textarea = textareaRegistry.get(id);
		if (textarea) {
			textarea.focus();
		}
	}

	// ============================================================================
	// Node Operations (defined before context)
	// ============================================================================

	function onRestore(id: string, snapshotRef: NodeRef) {
		nodes = nodes.map(n => {
			if (n.id === id) {
				const restoredData = restoreSnapshot(n.data, snapshotRef);
				if (restoredData) {
					return { ...n, data: restoredData };
				}
			}
			return n;
		});
	}

	// ============================================================================
	// Studio Context (Dependency Injection)
	// ============================================================================
	
	const studioContext: StudioContext = {
		get nodes() { return nodes; },
		get edges() { return edges; },
		get editingNodeId() { return editingNodeId; },
		get editingNameNodeId() { return editingNameNodeId; },
		
		setNodes: (newNodes) => { nodes = newNodes; },
		updateNode: (id, updater) => {
			nodes = nodes.map(n => 
				n.id === id ? { ...n, data: updater(n.data) } : n
			);
		},
		setEdges: (newEdges) => { edges = newEdges; },
		setEditingNodeId: (id) => { 
			editingNodeId = id;
			// Update isEditing state on nodes
			nodes = nodes.map(n => ({
				...n,
				data: { ...n.data, isEditing: n.id === id }
			}));
		},
		setEditingNameNodeId: (id) => { editingNameNodeId = id; },
		
		registerTextarea,
		unregisterTextarea,
		
		onGenerate,
		onRegenerate,
		onRestore,
		saveVersionBeforeEdit: async (nodeId) => {
			const node = nodes.find(n => n.id === nodeId);
			if (node) {
				const synced = await syncNode(node, edges);
				if (synced !== node.data) {
					nodes = nodes.map(n => n.id === nodeId ? { ...n, data: synced } : n);
				}
			}
		},
		
		getPreviewState: (nodeId) => {
			if (!historicalTree) return null;
			
			const override = historicalTree.nodeOverrides.get(nodeId);
			if (override) {
				// Node has historical changes
				return {
					content: override.content as string,
					commit: override.commit,
					incomingEdges: historicalTree.historicalEdges
						.filter(e => e.target === nodeId)
						.map(e => ({
							source: e.source,
							sourceHandle: e.sourceHandle,
							targetHandle: e.targetHandle
						}))
				};
			}
			
			// Check if node is used but not changed
			if (historicalTree.usedNodeIds.has(nodeId)) {
				return {
					isUsed: true
				};
			}
			
			return null;
		},
	};
	
	setStudioContext(studioContext);

	// ============================================================================
	// Generation (from Input Node)
	// ============================================================================
	
	/**
	 * Find VFS node connected to a node via incoming edges to VFS_INPUT handle
	 */
	function findConnectedVfsNode(nodeId: string): Node<VFSNodeData> | null {
		// Find edges where this node is the target and handle is VFS_INPUT
		const incomingEdges = edges.filter(e => 
			e.target === nodeId && e.targetHandle === HandleId.VFS_INPUT
		);
		
		for (const edge of incomingEdges) {
			const sourceNode = nodes.find(n => n.id === edge.source);
			if (sourceNode && sourceNode.data.type === 'VFS') {
				return sourceNode as Node<VFSNodeData>;
			}
		}
		return null;
	}
	
	async function onGenerate(inputNodeId: string) {
		const inputNode = nodes.find(n => n.id === inputNodeId);
		if (!inputNode || inputNode.data.type !== 'INPUT' || !inputNode.data.content) return;

		// Check if there's a VFS node connected to this input node
		const vfsNode = findConnectedVfsNode(inputNodeId);
		
		// If VFS node exists, set up VFS for the generation
		if (vfsNode) {
			const vfsData = vfsNode.data as VFSNodeData;
			const vfs = await getNodeVfs(vfsData.projectId, vfsNode.id);
			pubchat.setVFS(vfs);
		}

		// Prepare for generation - creates snapshots, gets refs, and resolves reftags
		const prepared = await prepareForGeneration(nodes, edges, inputNodeId);
		nodes = prepared.nodes;

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
			position: { x: 0, y: 0 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};

		// Create edge from input to generated
		const newEdge: Edge = {
			id: `e-${inputNodeId}-${newGeneratedData.id}`,
			source: inputNodeId,
			target: newGeneratedData.id,
		};

		// Add nodes and edges, then position the new generated node relative to its source
		const allNodes = [...nodes, generatedNode];
		const allEdges = [...edges, newEdge];
		nodes = positionNewNodesFromSources([newGeneratedData.id], allNodes, allEdges);
		edges = allEdges;

		setTimeout(() => flowApi?.fitView({ padding: 0.2, duration: 300 }), 50);

		try {
			// Stream generation using resolved system prompt (with reftags substituted)
			await streamGeneration(
				newGeneratedData.id,
				inputNode.data.content,
				prepared.resolvedSystemPrompt
			);
		} finally {
			// Clear VFS after generation completes (success or error)
			if (vfsNode) {
				pubchat.clearVFS();
			}
		}
	}

	async function streamGeneration(nodeId: string, userContent: string, systemPrompt: string) {
		try {
			let historyId: string | undefined;
			if (systemPrompt) {
				const systemMessage = createSystemMessage(systemPrompt, null);
				const historyIds = await pubchat.addConversation([systemMessage]);
				historyId = historyIds[historyIds.length - 1];
			}

			let accumulatedContent = '';
			for await (const event of pubchat.streamChat(userContent, historyId)) {
				if (event.type === 'token') {
					accumulatedContent += event.token;
					nodes = nodes.map(n => 
						n.id === nodeId && n.data.type !== 'VFS'
							? { ...n, data: { ...n.data, content: accumulatedContent } }
							: n
					) as typeof nodes;
				} else if (event.type === 'done') {
					const finalCommit = await generateCommitHash(accumulatedContent);
					nodes = nodes.map(n => 
						n.id === nodeId && n.data.type !== 'VFS'
							? { ...n, data: { ...n.data, content: accumulatedContent, commit: finalCommit, isStreaming: false } }
							: n
					) as typeof nodes;
				} else if (event.type === 'error') {
					console.error('Generation error:', event.error);
					nodes = nodes.map(n => 
						n.id === nodeId && n.data.type !== 'VFS' ? { ...n, data: { ...n.data, isStreaming: false } } : n
					) as typeof nodes;
				}
			}
		} catch (error) {
			console.error('Generation failed:', error);
			nodes = nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS' ? { ...n, data: { ...n.data, isStreaming: false } } : n
			) as typeof nodes;
		}
	}

	// ============================================================================
	// Regeneration (from Generated Node)
	// ============================================================================

	/**
	 * Regenerate content using the historical snapshots stored in the generated node.
	 * This uses the original inputRef, promptRefs, and indirectPromptRefs to 
	 * reconstruct the exact context that was used for the original generation,
	 * including reftag-substituted content.
	 */
	async function onRegenerate(generatedNodeId: string) {
		const generatedNode = nodes.find(n => n.id === generatedNodeId);
		if (!generatedNode || generatedNode.data.type !== 'GENERATED') return;

		const genData = generatedNode.data as GeneratedNodeData;

		// Get the historical input content
		const inputNode = nodes.find(n => n.id === genData.inputRef.id);
		let inputContent: string;
		
		// If the input ref points to an old version, get it from snapshotStore
		if (inputNode && inputNode.data.commit === genData.inputRef.commit) {
			// Current version matches the ref - use current content
			inputContent = inputNode.data.content as string;
		} else {
			// Different version - get from snapshot store
			const snapshot = snapshotStore.get<string>(genData.inputRef.id, genData.inputRef.commit);
			if (!snapshot) {
				console.error('Cannot find historical input snapshot');
				return;
			}
			inputContent = snapshot.content;
		}

		// Combine all refs for content resolution
		const allRefs = [
			...genData.promptRefs, 
			...(genData.indirectPromptRefs || [])
		];

		// Resolve each direct prompt ref with reftag substitution
		const resolvedPrompts: string[] = [];
		for (const promptRef of genData.promptRefs) {
			const resolved = resolvePromptContentFromRefs(
				promptRef.id,
				promptRef.commit,
				nodes,
				edges,
				allRefs,
				new Set()
			);
			resolvedPrompts.push(resolved);
		}

		const systemPrompt = resolvedPrompts.filter(Boolean).join('\n\n---\n\n');

		// Set streaming state
		nodes = nodes.map(n => 
			n.id === generatedNodeId && n.data.type !== 'VFS'
				? { ...n, data: { ...n.data, isStreaming: true, content: '' } }
				: n
		) as typeof nodes;

		// Stream regeneration
		await streamGeneration(generatedNodeId, inputContent, systemPrompt);
	}

	// ============================================================================
	// Version Preview Effects
	// ============================================================================
	
	// Track phantom node IDs so we can remove them when preview ends
	let phantomNodeIds = $state<Set<string>>(new Set());
	
	// Track hidden edges (edges connected to historical nodes that are temporarily removed)
	let hiddenEdges = $state<Edge[]>([]);
	
	// When a generated node is selected, rebuild historical tree for referenced nodes
	$effect(() => {
		const selected = selectedNodes;
		
		if (selected.length !== 1 || selected[0].data.type !== 'GENERATED') {
			// Clear historical tree and remove phantom nodes when not viewing a single generated node
			untrack(() => {
				if (historicalTree !== null) {
					console.log('[cleanup] restoring hiddenEdges:', hiddenEdges.length);
					// Remove phantom nodes
					if (phantomNodeIds.size > 0) {
						nodes = nodes.filter(n => !phantomNodeIds.has(n.id));
					}
					// Remove any edges connected to phantom nodes or historical edges
					// and restore hidden edges
					const restoredEdges = [
						...edges.filter(e => 
							!phantomNodeIds.has(e.source) && 
							!phantomNodeIds.has(e.target) &&
							!e.id.startsWith('historical-')
						),
						...hiddenEdges
					];
					console.log('[cleanup] edges before:', edges.length, 'after:', restoredEdges.length);
					edges = restoredEdges;
					phantomNodeIds = new Set();
					hiddenEdges = [];
					historicalTree = null;
				}
			});
			return;
		}

		untrack(() => {
			// First, restore any previously hidden edges before processing new selection
			let currentEdges = edges;
			if (hiddenEdges.length > 0) {
				// Remove old phantom nodes if any
				if (phantomNodeIds.size > 0) {
					nodes = nodes.filter(n => !phantomNodeIds.has(n.id));
				}
				// Restore hidden edges and remove old historical edges
				currentEdges = [
					...edges.filter(e => 
						!phantomNodeIds.has(e.source) && 
						!phantomNodeIds.has(e.target) &&
						!e.id.startsWith('historical-')
					),
					...hiddenEdges
				];
				phantomNodeIds = new Set();
				hiddenEdges = [];
			}
			
			const tree = rebuildHistoricalTree(selected[0], nodes, currentEdges);
			historicalTree = tree;
			
			const selectedGenNodeId = selected[0].id;
			
			// Get IDs of nodes that are truly historical (have overrides, not just used)
			const historicalNodeIds = new Set(tree.nodeOverrides.keys());
			
			// Get all node IDs that are part of the tree (used + historical + phantom + generated)
			const treeNodeIds = new Set([
				selectedGenNodeId,
				...tree.usedNodeIds,
				...historicalNodeIds,
				...tree.phantomNodes.map(n => n.id)
			]);
			
			// Hide edges connected to historical nodes, EXCEPT edges that are part of the tree
			// (i.e., edges where BOTH source and target are in the tree)
			const edgesToHide = currentEdges.filter(e => 
				(historicalNodeIds.has(e.source) || historicalNodeIds.has(e.target)) &&
				!(treeNodeIds.has(e.source) && treeNodeIds.has(e.target))
			);
			hiddenEdges = edgesToHide;
			
			// Remove hidden edges from current edges
			const hiddenEdgeIds = new Set(edgesToHide.map(e => e.id));
			let newEdges = currentEdges.filter(e => !hiddenEdgeIds.has(e.id));
			
			// Add phantom nodes to the graph
			if (tree.phantomNodes.length > 0) {
				// Mark phantom nodes with special flag for styling
				const phantomsWithFlag = tree.phantomNodes.map(n => ({
					...n,
					data: { ...n.data, isPhantom: true }
				}));
				nodes = [...nodes, ...phantomsWithFlag];
				phantomNodeIds = new Set(tree.phantomNodes.map(n => n.id));
			}
			
			// Add all historical edges (styled differently)
			if (tree.historicalEdges.length > 0) {
				const styledHistoricalEdges = tree.historicalEdges.map(e => ({
					...e,
					style: 'stroke: #f59e0b; stroke-dasharray: 5 5;',
					animated: false
				}));
				newEdges = [...newEdges, ...styledHistoricalEdges];
			}
			
			edges = newEdges;
		});
	});

	// Style edges for old version references
	$effect(() => {
		const hasGeneratedNodes = nodes.some(n => n.data.type === 'GENERATED');
		if (!hasGeneratedNodes) return;

		const { edges: styledEdges, changed } = styleEdgesForVersions(edges, nodes);
		if (changed) {
			edges = styledEdges;
		}
	});

	// ============================================================================
	// Connection Validation
	// ============================================================================

	/**
	 * Validate connection using the type system
	 */
	const isValidConnection: IsValidConnection = (connection) => {
		const result = validateConnection(
			{
				source: connection.source,
				target: connection.target,
				sourceHandle: connection.sourceHandle ?? null,
				targetHandle: connection.targetHandle ?? null,
			},
			(nodeId) => nodes.find(n => n.id === nodeId)?.data.type,
			edges
		);
		return result.valid;
	};

	// ============================================================================
	// Layout
	// ============================================================================
	
	// Default dimensions used when node hasn't been measured yet
	const DEFAULT_NODE_WIDTH = 320;
	const DEFAULT_NODE_HEIGHT = 180;

	/**
	 * Get the actual dimensions of a node, using measured values if available
	 */
	function getNodeDimensions(node: Node): { width: number; height: number } {
		return {
			width: node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH,
			height: node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT
		};
	}

	/**
	 * Full dagre layout for all nodes. Only use this when explicitly requested by user.
	 */
	function getLayoutedElements<T extends Node>(
		layoutNodes: T[],
		layoutEdges: Edge[],
		direction: 'TB' | 'LR' = 'LR'
	): { nodes: T[]; edges: Edge[] } {
		const dagreGraph = new dagre.graphlib.Graph();
		dagreGraph.setDefaultEdgeLabel(() => ({}));

		const isHorizontal = direction === 'LR';
		dagreGraph.setGraph({ 
			rankdir: direction,
			nodesep: 50,
			ranksep: 80,
			marginx: 50,
			marginy: 50
		});

		// Use real node dimensions
		layoutNodes.forEach((node) => {
			const { width, height } = getNodeDimensions(node);
			dagreGraph.setNode(node.id, { width, height });
		});

		layoutEdges.forEach((edge) => {
			dagreGraph.setEdge(edge.source, edge.target);
		});

		dagre.layout(dagreGraph);

		const newNodes = layoutNodes.map((node): T => {
			const nodeWithPosition = dagreGraph.node(node.id);
			const { width, height } = getNodeDimensions(node);
			return {
				...node,
				position: {
					x: nodeWithPosition.x - width / 2,
					y: nodeWithPosition.y - height / 2,
				},
				sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
				targetPosition: isHorizontal ? Position.Left : Position.Top,
			};
		});

		return { nodes: newNodes, edges: layoutEdges };
	}

	/**
	 * Position new nodes relative to their connected source nodes.
	 * This is used for generation flow where we add input -> generated nodes.
	 */
	function positionNewNodesFromSources(
		newNodeIds: string[],
		allNodes: Node<StudioNodeData>[],
		allEdges: Edge[]
	): Node<StudioNodeData>[] {
		const newNodeIdSet = new Set(newNodeIds);
		const HORIZONTAL_GAP = 100;
		const VERTICAL_GAP = 30;

		return allNodes.map(node => {
			if (!newNodeIdSet.has(node.id)) {
				return node;
			}

			// Find incoming edges to this new node
			const incomingEdges = allEdges.filter(e => e.target === node.id);
			if (incomingEdges.length === 0) {
				// No sources, position based on viewport or existing nodes
				const existingNodes = allNodes.filter(n => !newNodeIdSet.has(n.id));
				if (existingNodes.length > 0) {
					// Position to the right of rightmost existing node
					const rightmostNode = existingNodes.reduce((max, n) => {
						const nodeRight = n.position.x + (n.measured?.width ?? DEFAULT_NODE_WIDTH);
						const maxRight = max.position.x + (max.measured?.width ?? DEFAULT_NODE_WIDTH);
						return nodeRight > maxRight ? n : max;
					});
					return {
						...node,
						position: {
							x: rightmostNode.position.x + (rightmostNode.measured?.width ?? DEFAULT_NODE_WIDTH) + HORIZONTAL_GAP,
							y: rightmostNode.position.y
						}
					};
				}
				return node;
			}

			// Get source nodes
			const sourceNodes = incomingEdges
				.map(e => allNodes.find(n => n.id === e.source))
				.filter((n): n is Node<StudioNodeData> => n !== undefined);

			if (sourceNodes.length === 0) {
				return node;
			}

			// Calculate average Y position of sources and position to their right
			const avgY = sourceNodes.reduce((sum, n) => sum + n.position.y, 0) / sourceNodes.length;
			const rightmostSource = sourceNodes.reduce((max, n) => {
				const nodeRight = n.position.x + (n.measured?.width ?? DEFAULT_NODE_WIDTH);
				const maxRight = max.position.x + (max.measured?.width ?? DEFAULT_NODE_WIDTH);
				return nodeRight > maxRight ? n : max;
			});

			return {
				...node,
				position: {
					x: rightmostSource.position.x + (rightmostSource.measured?.width ?? DEFAULT_NODE_WIDTH) + HORIZONTAL_GAP,
					y: avgY + (newNodeIds.indexOf(node.id) * VERTICAL_GAP)
				}
			};
		});
	}

	/**
	 * Position a single new node using context menu position (converted to flow coordinates).
	 */
	function getNewNodePosition(): { x: number; y: number } {
		// Use context menu position, convert from screen to flow coordinates
		return flowApi!.screenToFlowPosition({ x: contextMenu!.x, y: contextMenu!.y });
	}

	function applyLayout() {
		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges);
		nodes = layoutedNodes;
		edges = layoutedEdges;
		setTimeout(() => flowApi?.fitView({ padding: 0.2, duration: 300 }), 50);
	}

	// ============================================================================
	// Node Management
	// ============================================================================
	
	async function addPromptNode() {
		const newPromptData = await createPromptNodeData('');
		const position = getNewNodePosition();
		const newNode: Node<StudioNodeData> = {
			id: newPromptData.id,
			type: 'prompt',
			data: newPromptData,
			position,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		closeContextMenu();
	}

	async function addInputNode() {
		const newInputData = await createInputNodeData('', [], []);
		const position = getNewNodePosition();
		const newNode: Node<StudioNodeData> = {
			id: newInputData.id,
			type: 'input',
			data: newInputData,
			position,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		closeContextMenu();
	}

	async function addVFSNode() {
		const newVFSData = await createVFSNodeData(currentProjectId, 'Files');
		const position = getNewNodePosition();
		const newNode: Node<StudioNodeData> = {
			id: newVFSData.id,
			type: 'vfs',
			data: newVFSData,
			position,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		closeContextMenu();
	}

	async function addSandboxNode() {
		const newSandboxData = await createSandboxNodeData('Preview');
		const position = getNewNodePosition();
		const newNode: Node<StudioNodeData> = {
			id: newSandboxData.id,
			type: 'sandbox',
			data: newSandboxData,
			position,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		closeContextMenu();
	}

	async function addLoaderNode() {
		const newLoaderData = await createLoaderNodeData('echo', 'Service');
		const position = getNewNodePosition();
		const newNode: Node<StudioNodeData> = {
			id: newLoaderData.id,
			type: 'loader',
			data: newLoaderData,
			position,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		closeContextMenu();
	}

	function deleteNodes(nodeIds: string[]) {
		nodes = nodes.filter(n => !nodeIds.includes(n.id));
		edges = edges.filter(e => !nodeIds.includes(e.source) && !nodeIds.includes(e.target));
		selectedNodes = selectedNodes.filter(n => !nodeIds.includes(n.id));
		closeContextMenu();
	}

	// ============================================================================
	// Initialization (Load from IndexedDB)
	// ============================================================================
	
	$effect(() => {
		if (!initialized) {
			initialized = true;
			(async () => {
				try {
					// Initialize snapshot store (loads from IndexedDB)
					await initSnapshotStore();
					
					// Ensure project exists and get its metadata
					const project = await ensureProject(currentProjectId);
					isDraft = project.isDraft;
					projectName = project.name;
					
					// Set this project as the current project
					setCurrentProject(currentProjectId);
					
					// Load graph from IndexedDB
					const savedGraph = await loadGraph<StudioNodeData>(currentProjectId);
					
					if (savedGraph.nodes.length > 0) {
						// Restore saved graph
						nodes = savedGraph.nodes.map(n => ({
							...n,
							sourcePosition: Position.Right,
							targetPosition: Position.Left,
						}));
						edges = savedGraph.edges;
					} else {
						// Create initial empty prompt node
						const initialPromptData = await createPromptNodeData('');
						nodes = [{
							id: initialPromptData.id,
							type: 'prompt',
							data: initialPromptData,
							position: { x: 0, y: 0 },
							sourcePosition: Position.Right,
							targetPosition: Position.Left,
						}];
					}
					
					loaded = true;
				} catch (err) {
					console.error('[Studio] Failed to load from IndexedDB:', err);
					// Fallback: create initial node
					const initialPromptData = await createPromptNodeData('');
					nodes = [{
						id: initialPromptData.id,
						type: 'prompt',
						data: initialPromptData,
						position: { x: 0, y: 0 },
						sourcePosition: Position.Right,
						targetPosition: Position.Left,
					}];
					loaded = true;
				}
			})();
		}
	});

	// ============================================================================
	// Context Menu
	// ============================================================================
	
	let contextMenu = $state<{ x: number; y: number; nodeId: string | null; isPaneMenu: boolean } | null>(null);
	let addNodeSubmenuOpen = $state(false);

	function handleNodeContextMenu(event: MouseEvent, nodeId: string) {
		event.preventDefault();
		event.stopPropagation();
		contextMenu = { x: event.clientX, y: event.clientY, nodeId, isPaneMenu: false };
		addNodeSubmenuOpen = false;
	}

	function handlePaneContextMenu(event: MouseEvent) {
		event.preventDefault();
		contextMenu = { x: event.clientX, y: event.clientY, nodeId: null, isPaneMenu: true };
		addNodeSubmenuOpen = false;
	}

	function closeContextMenu() {
		contextMenu = null;
		addNodeSubmenuOpen = false;
	}

	function handleAutoLayout() {
		applyLayout();
		closeContextMenu();
	}

	function handleDeleteFromContextMenu() {
		if (contextMenu?.nodeId) {
			deleteNodes([contextMenu.nodeId]);
		} else if (selectedNodes.length > 0) {
			deleteNodes(selectedNodes.map(n => n.id));
		}
	}

	function handleFocusNode(node: Node<StudioNodeData>) {
		if (flowApi) {
			flowApi.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.2 });
		}
		setTimeout(() => focusNode(node.id), 100);
	}

	async function handlePublish(
		metadata: PublishMetadata,
		nodesToPublish: Node<StudioNodeData>[],
		edgesToPublish: Edge[]
	) {
		const result = await publishArtifact(metadata, nodesToPublish, edgesToPublish, auth.token.value);
		
		if (!result.success) {
			throw new Error(result.error || 'Failed to publish');
		}
		
		// If we have nodeIdMapping, update local state with new IDs
		if (result.nodeIdMapping && Object.keys(result.nodeIdMapping).length > 0) {
			// Remap all nodes and edges with new server-assigned IDs
			const remapped = remapNodeIds(nodes, edges, result.nodeIdMapping);
			nodes = remapped.nodes;
			edges = remapped.edges;
			
			// Use artifactId directly as project ID
			if (result.artifactId) {
				const newProjectId = result.artifactId;
				const oldProjectId = currentProjectId;
				
				// Save the remapped graph to the new project (with artifact ID, isDraft = false)
				await saveProject({
					id: newProjectId,
					name: metadata.name,
					artifactId: result.artifactId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					isDraft: false
				});
				await saveGraph(nodes, edges, newProjectId);
				
				// Delete the old temporary project if it's different from the new one
				if (oldProjectId !== newProjectId) {
					await deleteProject(oldProjectId);
				}
				
				// Update local state
				isDraft = false;
				projectName = metadata.name;
				
				// Set the new project as current project
				setCurrentProject(newProjectId);
				
				// Navigate to the new project URL (artifact ID based)
				goto(`/studio/${newProjectId}`);
			}
		}
	}
</script>

<svelte:window onclick={() => contextMenu && closeContextMenu()} />

<div class="h-screen w-full relative flex">
	<!-- Flow Editor -->
	<div class="flex-1 h-full relative">
		<SvelteFlow 
			bind:nodes 
			bind:edges
			{nodeTypes} 
			fitView
			selectionOnDrag
			deleteKey="Delete"
			selectionMode={SelectionMode.Partial}
			panOnDrag={[1]}
			multiSelectionKey="Shift"
			{isValidConnection}
			proOptions={{hideAttribution: true}}
			onselectionchange={(e) => selectedNodes = e.nodes}
			onnodecontextmenu={(e) => handleNodeContextMenu(e.event, e.node.id)}
			onpanecontextmenu={(e) => handlePaneContextMenu(e.event)}
		>
			<FlowController onInit={(flow) => flowApi = flow} />
			<Background />
			<Controls />
		</SvelteFlow>
	</div>
	
	<!-- Studio Sidebar (Left) - Outside SvelteFlow to avoid pointer event conflicts -->
	<StudioSidebar
		{nodes}
		{edges}
		{selectedNodes}
		projectId={currentProjectId}
		{projectName}
		{isDraft}
		isAuthenticated={auth.isAuthenticated}
		onFocusNode={handleFocusNode}
		onPublish={handlePublish}
	/>
	
	<!-- Context Menu -->
	{#if contextMenu}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div 
			class="fixed bg-white rounded-lg shadow-lg border border-gray-200 p-1 z-50 min-w-40"
			style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
			onclick={(e) => e.stopPropagation()}
		>
			{#if contextMenu.isPaneMenu}
				<!-- Pane Context Menu -->
				<div class="relative">
					<button
						class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center justify-between gap-2"
						onmouseenter={() => addNodeSubmenuOpen = true}
					>
						<span class="flex items-center gap-2">
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
							</svg>
							Add Node
						</span>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					</button>
					
					{#if addNodeSubmenuOpen}
						<div 
							class="absolute left-full top-0 ml-1 bg-white rounded-lg shadow-lg border border-gray-200 p-1 min-w-36"
							onmouseleave={() => addNodeSubmenuOpen = false}
						>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addPromptNode}
							>
								<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
								Prompt
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addInputNode}
							>
								<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
								</svg>
								Input
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addVFSNode}
							>
								<svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
								</svg>
								VFS
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addSandboxNode}
							>
								<svg class="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
								</svg>
								Sandbox
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addLoaderNode}
							>
								<svg class="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
								</svg>
								Loader
							</button>
						</div>
					{/if}
				</div>
				
				<button
					class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
					onclick={handleAutoLayout}
					onmouseenter={() => addNodeSubmenuOpen = false}
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
					</svg>
					Auto Layout
				</button>
			{:else}
				<!-- Node Context Menu -->
				{#if contextMenu.nodeId}
					<button
						class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
						onclick={() => {
							if (contextMenu?.nodeId) {
								editingNameNodeId = contextMenu.nodeId;
							}
							closeContextMenu();
						}}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
						</svg>
						Edit Name
					</button>
				{/if}
				<button
					class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 rounded-md flex items-center gap-2"
					onclick={handleDeleteFromContextMenu}
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
					</svg>
					{#if contextMenu.nodeId}
						Delete Node
					{:else}
						Delete {selectedNodes.length} Node{selectedNodes.length > 1 ? 's' : ''}
					{/if}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	:global(.svelte-flow__selection-wrapper) {
		display: none;
	}
</style>