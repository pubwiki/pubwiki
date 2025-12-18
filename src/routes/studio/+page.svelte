<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from 'dagre';
	import { untrack } from 'svelte';
	import GraphNode from './components/GraphNode.svelte';
	import FlowController from './components/FlowController.svelte';
	import { 
		type StudioNodeData, 
		type NodeRef,
		type GeneratedNodeData,
		snapshotStore,
		createPromptNodeData, 
		createInputNodeData,
		createGeneratedNodeData,
		generateCommitHash,
		restoreSnapshot,
		syncNode
	} from './utils/types';
	import {
		prepareForGeneration,
		rebuildHistoricalTree,
		styleEdgesForVersions,
		type HistoricalTreeResult
	} from './utils/version';
	import { resolvePromptContentFromRefs, resolvePromptContent, getHashtagConnections } from './utils/hashtag';
	import { setStudioContext, type StudioContext, type PreviewState } from './stores/context';
	import { initSnapshotStore } from './stores/snapshot';
	import { loadGraph, saveGraph, ensureDefaultProject } from './stores/db';
	
	import { ChatUI, type PreprocessParams, type DisplayMessage } from '@pubwiki/svelte-chat';
	import { PubChat, MemoryMessageStore, createSystemMessage } from '@pubwiki/chat';

	// ============================================================================
	// Chat Configuration
	// ============================================================================
	
	const pubchat = new PubChat({
		llm: {
			// FIXME: only for test, do not bring to production
			apiKey: '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',
			model: 'google/gemini-2.5-flash',
			baseUrl: 'https://openrouter.ai/api/v1'
		},
		messageStore: new MemoryMessageStore(),
	});

	// ============================================================================
	// Node Types
	// ============================================================================
	
	const nodeTypes = {
		prompt: GraphNode,
		input: GraphNode,
		generated: GraphNode
	};

	// ============================================================================
	// Flow State
	// ============================================================================
	
	let nodes = $state.raw<Node<StudioNodeData>[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let editingNodeId = $state<string | null>(null);
	let selectedNodes = $state<Node<StudioNodeData>[]>([]);
	let flowApi = $state<ReturnType<typeof useSvelteFlow> | null>(null);
	let initialized = $state(false);
	let loaded = $state(false);
	let saving = $state(false);
	
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
					'default'
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
	
	async function onGenerate(inputNodeId: string) {
		const inputNode = nodes.find(n => n.id === inputNodeId);
		if (!inputNode || inputNode.data.type !== 'INPUT' || !inputNode.data.content) return;

		// Prepare for generation - creates snapshots, gets refs, and resolves hashtags
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

		// Add and layout
		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
			[...nodes, generatedNode],
			[...edges, newEdge]
		);
		nodes = layoutedNodes;
		edges = layoutedEdges;

		setTimeout(() => flowApi?.fitView({ padding: 0.2, duration: 300 }), 50);

		// Stream generation using resolved system prompt (with hashtags substituted)
		await streamGeneration(
			newGeneratedData.id,
			inputNode.data.content,
			prepared.resolvedSystemPrompt
		);
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
						n.id === nodeId 
							? { ...n, data: { ...n.data, content: accumulatedContent } }
							: n
					);
				} else if (event.type === 'done') {
					const finalCommit = await generateCommitHash(accumulatedContent);
					nodes = nodes.map(n => 
						n.id === nodeId 
							? { ...n, data: { ...n.data, content: accumulatedContent, commit: finalCommit, isStreaming: false } }
							: n
					);
				} else if (event.type === 'error') {
					console.error('Generation error:', event.error);
					nodes = nodes.map(n => 
						n.id === nodeId ? { ...n, data: { ...n.data, isStreaming: false } } : n
					);
				}
			}
		} catch (error) {
			console.error('Generation failed:', error);
			nodes = nodes.map(n => 
				n.id === nodeId ? { ...n, data: { ...n.data, isStreaming: false } } : n
			);
		}
	}

	// ============================================================================
	// Regeneration (from Generated Node)
	// ============================================================================

	/**
	 * Regenerate content using the historical snapshots stored in the generated node.
	 * This uses the original inputRef, promptRefs, and indirectPromptRefs to 
	 * reconstruct the exact context that was used for the original generation,
	 * including hashtag-substituted content.
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

		// Resolve each direct prompt ref with hashtag substitution
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
			n.id === generatedNodeId 
				? { ...n, data: { ...n.data, isStreaming: true, content: '' } }
				: n
		);

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
	// Layout
	// ============================================================================
	
	const NODE_WIDTH = 320;
	const NODE_HEIGHT = 180;

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

		layoutNodes.forEach((node) => {
			dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
		});

		layoutEdges.forEach((edge) => {
			dagreGraph.setEdge(edge.source, edge.target);
		});

		dagre.layout(dagreGraph);

		const newNodes = layoutNodes.map((node): T => {
			const nodeWithPosition = dagreGraph.node(node.id);
			return {
				...node,
				position: {
					x: nodeWithPosition.x - NODE_WIDTH / 2,
					y: nodeWithPosition.y - NODE_HEIGHT / 2,
				},
				sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
				targetPosition: isHorizontal ? Position.Left : Position.Top,
			};
		});

		return { nodes: newNodes, edges: layoutEdges };
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
		const newNode: Node<StudioNodeData> = {
			id: newPromptData.id,
			type: 'prompt',
			data: newPromptData,
			position: { x: 0, y: 0 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		applyLayout();
		closeContextMenu();
	}

	async function addInputNode() {
		const newInputData = await createInputNodeData('', [], []);
		const newNode: Node<StudioNodeData> = {
			id: newInputData.id,
			type: 'input',
			data: newInputData,
			position: { x: 0, y: 0 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		applyLayout();
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
					
					// Ensure default project exists
					await ensureDefaultProject();
					
					// Load graph from IndexedDB
					const savedGraph = await loadGraph<StudioNodeData>('default');
					
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
	// Chat Integration
	// ============================================================================
	
	let currentHistoryId = $state<string | undefined>(undefined);
	let lastUserMessageContent = $state<string>('');
	let lastSelectedPromptIds = $state<string[]>([]);

	async function preprocessChat(params: PreprocessParams): Promise<PreprocessParams> {
		const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
		const selectedPromptNodes = nodes
			.filter(n => selectedNodeIds.has(n.id) && n.type === 'prompt' && n.data.content);
		
		lastUserMessageContent = params.content;
		lastSelectedPromptIds = selectedPromptNodes.map(n => n.id);

		if (selectedPromptNodes.length === 0) {
			return params;
		}

		// Resolve each prompt with hashtag substitution
		const resolvedPrompts: string[] = [];
		for (const promptNode of selectedPromptNodes) {
			const resolved = resolvePromptContent(
				promptNode.id,
				nodes,
				edges,
				new Set(),
				[]
			);
			resolvedPrompts.push(resolved.content);
		}
		
		const systemPrompt = resolvedPrompts.filter(Boolean).join('\n\n---\n\n');
		const systemMessage = createSystemMessage(systemPrompt, null);
		
		if (params.historyId) {
			try {
				await pubchat.deleteConversation(params.historyId, true);
			} catch (e) { /* ignore */ }
		}
		
		const historyIds = await pubchat.addConversation([systemMessage]);
		currentHistoryId = historyIds[historyIds.length - 1];
		
		return { content: params.content, historyId: currentHistoryId };
	}

	async function onResponseReceived(message: DisplayMessage) {
		const responseContent = message.blocks
			.filter(b => b.type === 'text' || b.type === 'markdown')
			.map(b => b.content)
			.join('');

		if (!responseContent) return;

		// Collect all involved nodes (direct + indirect via hashtags)
		const collectAllInvolvedNodes = (nodeIds: string[], visited: Set<string> = new Set()): string[] => {
			const result: string[] = [];
			for (const nodeId of nodeIds) {
				if (visited.has(nodeId)) continue;
				visited.add(nodeId);
				result.push(nodeId);
				
				const node = nodes.find(n => n.id === nodeId);
				if (node && node.data.type === 'PROMPT') {
					const hashtagConnections = getHashtagConnections(nodeId, edges);
					const connectedIds = Array.from(hashtagConnections.values());
					result.push(...collectAllInvolvedNodes(connectedIds, visited));
				}
			}
			return result;
		};

		const allInvolvedPromptIds = collectAllInvolvedNodes(lastSelectedPromptIds);

		// Sync all involved prompt nodes (saves snapshots if content changed)
		let updatedNodes = await Promise.all(nodes.map(async n => {
			if (allInvolvedPromptIds.includes(n.id) && n.data.type === 'PROMPT') {
				const synced = await syncNode(n, edges);
				return { ...n, data: synced };
			}
			return n;
		}));
		nodes = updatedNodes;

		// Get direct prompt refs
		const freshPromptNodes = nodes.filter(n => 
			lastSelectedPromptIds.includes(n.id) && n.data.type === 'PROMPT'
		);
		const promptRefs: NodeRef[] = freshPromptNodes.map(n => ({ 
			id: n.id, 
			commit: n.data.commit 
		}));

		// Collect indirect refs via hashtag resolution
		const allPromptRefs: NodeRef[] = [];
		for (const promptNode of freshPromptNodes) {
			const resolved = resolvePromptContent(
				promptNode.id, 
				nodes, 
				edges, 
				new Set(), 
				[]
			);
			allPromptRefs.push(...resolved.allPromptRefs);
		}
		
		// Separate indirect refs
		const directPromptIdSet = new Set(promptRefs.map(r => r.id));
		const indirectPromptRefs = allPromptRefs.filter(
			ref => !directPromptIdSet.has(ref.id)
		);
		
		// Deduplicate indirect refs
		const seenIndirect = new Set<string>();
		const uniqueIndirectRefs = indirectPromptRefs.filter(ref => {
			const key = `${ref.id}:${ref.commit}`;
			if (seenIndirect.has(key)) return false;
			seenIndirect.add(key);
			return true;
		});

		// Create input node
		const inputNodeData = await createInputNodeData(
			lastUserMessageContent,
			[...lastSelectedPromptIds],
			promptRefs
		);
		const inputRef: NodeRef = { id: inputNodeData.id, commit: inputNodeData.commit };
		
		const inputNode: Node<StudioNodeData> = {
			id: inputNodeData.id,
			type: 'input',
			data: inputNodeData,
			position: { x: 0, y: 0 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};

		// Create generated node with indirect refs
		const generatedNodeData = await createGeneratedNodeData(
			responseContent,
			inputRef,
			promptRefs,
			uniqueIndirectRefs,
			[inputRef, ...promptRefs]
		);
		const generatedNode: Node<StudioNodeData> = {
			id: generatedNodeData.id,
			type: 'generated',
			data: generatedNodeData,
			position: { x: 0, y: 0 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};

		// Create edges
		const newEdges: Edge[] = [
			...lastSelectedPromptIds.map(sourceId => ({
				id: `e-${sourceId}-${inputNodeData.id}`,
				source: sourceId,
				target: inputNodeData.id,
			})),
			{
				id: `e-${inputNodeData.id}-${generatedNodeData.id}`,
				source: inputNodeData.id,
				target: generatedNodeData.id,
			}
		];

		// Layout and update
		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
			[...nodes, inputNode, generatedNode],
			[...edges, ...newEdges]
		);
		nodes = layoutedNodes;
		edges = layoutedEdges;

		setTimeout(() => flowApi?.fitView({ padding: 0.2, duration: 300 }), 50);

		lastUserMessageContent = '';
		lastSelectedPromptIds = [];
	}

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

	function handleBadgeClick(node: Node) {
		if (flowApi) {
			flowApi.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.2 });
		}
		setTimeout(() => focusNode(node.id), 100);
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
			onselectionchange={(e) => selectedNodes = e.nodes}
			onnodecontextmenu={(e) => handleNodeContextMenu(e.event, e.node.id)}
			onpanecontextmenu={(e) => handlePaneContextMenu(e.event)}
		>
			<FlowController onInit={(flow) => flowApi = flow} />
			<Background />
			<Controls />
		</SvelteFlow>
		
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
									Prompt Node
								</button>
								<button
									class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
									onclick={addInputNode}
								>
									<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
									</svg>
									Input Node
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

	<!-- Floating Chat -->
	<div class="w-96 h-full border-l border-gray-200 bg-white flex flex-col shadow-xl z-20">
		<div class="p-3 border-b border-gray-200 font-bold bg-gray-50 flex justify-between items-center">
			<span>Assistant</span>
		</div>
		
		<!-- Selected Nodes Badges -->
		{#if selectedNodes.length > 0}
			<div class="px-4 py-2 bg-white border-b border-gray-100 flex flex-wrap gap-2 min-h-12 items-center">
				{#each selectedNodes as node (node.id)}
					<button 
						class="px-2 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1
						{editingNodeId === node.id 
							? 'bg-blue-100 text-blue-700 border-blue-200 ring-1 ring-blue-300' 
							: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'}"
						onclick={() => handleBadgeClick(node)}
					>
						<div class="w-1.5 h-1.5 rounded-full {editingNodeId === node.id ? 'bg-green-400' : 'bg-gray-400'}"></div>
						{node.data.type || 'NODE'}
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex-1 overflow-hidden relative">
			<ChatUI {pubchat} preprocess={preprocessChat} bind:historyId={currentHistoryId} {onResponseReceived} />
		</div>
	</div>
</div>

<style>
	:global(.svelte-flow__selection-wrapper) {
		display: none;
	}
</style>
