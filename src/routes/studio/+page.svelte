<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from 'dagre';
	import GraphNode from './GraphNode.svelte';
	import FlowController from './FlowController.svelte';
	
	import { ChatUI, type PreprocessParams, type DisplayMessage } from '@pubwiki/svelte-chat';
	import { PubChat, MemoryMessageStore, createSystemMessage } from '@pubwiki/chat';

	// Initialize Chat
	// Note: In a real app, you might want to persist this or load config from somewhere
	const pubchat = new PubChat({
		llm: {
            // FIXME: only for test, do not bring to production
			apiKey: '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', // Placeholder - user will likely need to configure this
			model: 'google/gemini-2.5-flash',
            baseUrl: 'https://openrouter.ai/api/v1'
		},
		messageStore: new MemoryMessageStore(),
	});

	const nodeTypes = {
		prompt: GraphNode,
		input: GraphNode
	};

	// Textarea registry for external focus control
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

	// Shared callbacks for node editing state - declared before nodes initialization
	function onEditStart(id: string) {
		editingNodeId = id;
		nodes = nodes.map(n => ({
			...n,
			data: {
				...n.data,
				isEditing: n.id === id
			}
		}));
	}
	
	function onEditEnd(id: string) {
		if (editingNodeId === id) {
			editingNodeId = null;
			nodes = nodes.map(n => ({
				...n,
				data: {
					...n.data,
					isEditing: false
				}
			}));
		}
	}

	// Flow State - use $state.raw for xyflow compatibility
	let nodes = $state.raw<Node[]>([
		{
			id: '1',
			type: 'prompt',
			data: { type: 'PROMPT', content: '', onEditStart, onEditEnd, registerTextarea, unregisterTextarea },
			position: { x: 0, y: 0 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		},
	]);
	
	let edges = $state.raw<Edge[]>([]);
	let editingNodeId = $state<string | null>(null);
	let selectedNodes = $state<Node[]>([]);
	let flowApi = $state<ReturnType<typeof useSvelteFlow> | null>(null);

	// Dagre layout configuration
	const NODE_WIDTH = 320;
	const NODE_HEIGHT = 180;

	/**
	 * Apply dagre layout to nodes and edges
	 */
	function getLayoutedElements(
		layoutNodes: Node[],
		layoutEdges: Edge[],
		direction: 'TB' | 'LR' = 'LR'
	): { nodes: Node[]; edges: Edge[] } {
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

		const newNodes = layoutNodes.map((node) => {
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

	/**
	 * Apply layout and update state
	 */
	function applyLayout() {
		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges);
		nodes = layoutedNodes;
		edges = layoutedEdges;
		
		// Fit view after layout
		setTimeout(() => {
			flowApi?.fitView({ padding: 0.2, duration: 300 });
		}, 50);
	}

	function addNode() {
		const newNode: Node = {
			id: crypto.randomUUID(),
			type: 'prompt',
			data: { type: 'PROMPT', content: '', onEditStart, onEditEnd, registerTextarea, unregisterTextarea },
			position: { x: 0, y: 0 }, // Will be set by layout
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
		
		// Apply layout after adding node
		applyLayout();
	}

	function handleBadgeClick(node: Node) {
		// Center the view on the node first
		if (flowApi) {
			flowApi.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.2 });
		}
		// Focus the textarea after a short delay to allow view animation
		setTimeout(() => {
			focusNode(node.id);
		}, 100);
	}

	// Current historyId for conversation continuity
	let currentHistoryId = $state<string | undefined>(undefined);
	
	// Store the last user message content and selected prompt IDs for onResponseReceived
	let lastUserMessageContent = $state<string>('');
	let lastSelectedPromptIds = $state<string[]>([]);

	/**
	 * Preprocess function for chat
	 * Creates a new conversation with selected prompts as system message prefix
	 */
	async function preprocessChat(params: PreprocessParams): Promise<PreprocessParams> {
		// Get selected node IDs
		const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
		
		// Get CURRENT content from nodes array (not from selectedNodes which may be stale)
		const selectedPromptNodes = nodes
			.filter(n => selectedNodeIds.has(n.id) && n.type === 'prompt' && n.data.content);
		
		const selectedPrompts = selectedPromptNodes.map(n => n.data.content as string);
		
		// Store for onResponseReceived
		lastUserMessageContent = params.content;
		lastSelectedPromptIds = selectedPromptNodes.map(n => n.id);

		// If no prompts selected, return original params
		if (selectedPrompts.length === 0) {
			return params;
		}

		// Combine prompts into system message
		const systemPrompt = selectedPrompts.join('\n\n---\n\n');
		
		// Create system message
		const systemMessage = createSystemMessage(systemPrompt, null);
		
		// Delete old conversation if exists
		if (params.historyId) {
			try {
				await pubchat.deleteConversation(params.historyId, true);
			} catch (e) {
				// Ignore if conversation doesn't exist
			}
		}
		
		// Add system message to create new conversation
		const historyIds = await pubchat.addConversation([systemMessage]);
		const newHistoryId = historyIds[historyIds.length - 1];
		
		// Update current history ID
		currentHistoryId = newHistoryId;
		
		return {
			content: params.content,
			historyId: newHistoryId
		};
	}

	/**
	 * Called when assistant response is received
	 * Creates input node and prompt node, then connects them
	 */
	function onResponseReceived(message: DisplayMessage) {
		// Extract text content from the response
		const responseContent = message.blocks
			.filter(b => b.type === 'text' || b.type === 'markdown')
			.map(b => b.content)
			.join('');

		if (!responseContent) return;

		// Create input node (user message)
		const inputNodeId = crypto.randomUUID();
		const inputNode: Node = {
			id: inputNodeId,
			type: 'input',
			data: { 
				type: 'INPUT',
				content: lastUserMessageContent,
				sourcePromptIds: [...lastSelectedPromptIds]
			},
			position: { x: 0, y: 0 }, // Will be set by layout
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};

		// Create prompt node (assistant response)
		const promptNodeId = crypto.randomUUID();
		const promptNode: Node = {
			id: promptNodeId,
			type: 'prompt',
			data: { 
				type: 'PROMPT', 
				content: responseContent, 
				onEditStart, 
				onEditEnd, 
				registerTextarea, 
				unregisterTextarea 
			},
			position: { x: 0, y: 0 }, // Will be set by layout
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};

		// Create edges from selected prompts to input node
		const newEdges: Edge[] = lastSelectedPromptIds.map(sourceId => ({
			id: `e-${sourceId}-${inputNodeId}`,
			source: sourceId,
			target: inputNodeId,
		}));

		// Create edge from input node to prompt node
		newEdges.push({
			id: `e-${inputNodeId}-${promptNodeId}`,
			source: inputNodeId,
			target: promptNodeId,
		});

		// Update state with new nodes and edges
		const allNodes = [...nodes, inputNode, promptNode];
		const allEdges = [...edges, ...newEdges];
		
		// Apply layout
		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(allNodes, allEdges);
		nodes = layoutedNodes;
		edges = layoutedEdges;

		// Fit view after layout
		setTimeout(() => {
			flowApi?.fitView({ padding: 0.2, duration: 300 });
		}, 50);

		// Clear stored values
		lastUserMessageContent = '';
		lastSelectedPromptIds = [];
	}

	// Context menu state
	let contextMenu = $state<{ x: number; y: number; nodeId: string | null } | null>(null);

	/**
	 * Handle right-click on node
	 */
	function handleNodeContextMenu(event: MouseEvent, nodeId: string) {
		event.preventDefault();
		event.stopPropagation();
		contextMenu = { x: event.clientX, y: event.clientY, nodeId };
	}

	/**
	 * Handle right-click on canvas (pane)
	 */
	function handlePaneContextMenu(event: MouseEvent) {
		event.preventDefault();
		// If right-clicked on empty canvas, check if there are selected nodes
		if (selectedNodes.length > 0) {
			contextMenu = { x: event.clientX, y: event.clientY, nodeId: null };
		}
	}

	/**
	 * Close context menu
	 */
	function closeContextMenu() {
		contextMenu = null;
	}

	/**
	 * Delete node(s) and their connected edges
	 */
	function deleteNodes(nodeIds: string[]) {
		// Remove nodes
		nodes = nodes.filter(n => !nodeIds.includes(n.id));
		// Remove edges connected to deleted nodes
		edges = edges.filter(e => !nodeIds.includes(e.source) && !nodeIds.includes(e.target));
		// Clear selection
		selectedNodes = selectedNodes.filter(n => !nodeIds.includes(n.id));
		closeContextMenu();
	}

	/**
	 * Handle delete action from context menu
	 */
	function handleDeleteFromContextMenu() {
		if (contextMenu?.nodeId) {
			// Delete specific node that was right-clicked
			deleteNodes([contextMenu.nodeId]);
		} else if (selectedNodes.length > 0) {
			// Delete all selected nodes
			deleteNodes(selectedNodes.map(n => n.id));
		}
	}

	// Close context menu when clicking elsewhere
	function handleWindowClick() {
		if (contextMenu) {
			closeContextMenu();
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<div class="h-screen w-full relative flex">
	<!-- Flow Editor -->
	<div class="flex-1 h-full relative">
		<SvelteFlow 
			bind:nodes 
			bind:edges 
			{nodeTypes} 
			fitView
			selectionOnDrag
			selectionMode={SelectionMode.Partial}
			panOnDrag={[1, 2]}
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
			</div>
		{/if}
		
		<!-- Toolbar -->
		<div class="absolute top-4 left-4 z-10 bg-white p-2 rounded shadow flex gap-2">
			<button 
				class="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition text-sm font-medium"
				onclick={addNode}
			>
				Add Node
			</button>
			<button 
				class="bg-gray-600 text-white px-4 py-2 rounded shadow hover:bg-gray-700 transition text-sm font-medium"
				onclick={applyLayout}
			>
				Auto Layout
			</button>
		</div>
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

