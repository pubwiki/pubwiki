<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode, type IsValidConnection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from 'dagre';
	import { untrack, onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { 
		GraphNode, 
		VFSNode, 
		SandboxNode, 
		LoaderNode, 
		StateNode, 
		registerInputNodeHandlers,
		registerGeneratedNodeHandlers,
		registerLoaderNodeHandlers
	} from '../components/nodes';
	import FlowController from '../components/FlowController.svelte';
	import { StudioSidebar } from '../components/sidebar';
	import { 
		type StudioNodeData, 
		type GeneratedNodeData,
		createPromptNodeData, 
		createInputNodeData,
		createVFSNodeData,
		createSandboxNodeData,
		createLoaderNodeData,
		createStateNodeData
	} from '../types';
	import {
		restoreSnapshot,
		syncNode,
		initSnapshotStore,
		createPreviewController,
		type NodeRef
	} from '../version';
	import { validateConnection } from '../graph';
	import { positionNewNodesFromSources, getNodeDimensions, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, HORIZONTAL_GAP, VERTICAL_GAP } from '../graph';
	import { publishArtifact, type PublishMetadata } from '../io';
	import { setStudioContext, type StudioContext } from '../state';
	import { dispatchConnection, dispatchEdgeDeletes, dispatchNodeDeletes, clearAllHandlers } from '../state';
	import { loadGraph, saveGraph, saveProject, ensureProject, deleteProject, remapNodeIds, setCurrentProject } from '../persistence';
	import { useAuth } from '$lib/stores/auth.svelte';
	import { getSettingsStore } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Node Types
	// ============================================================================
	
	const nodeTypes = {
		prompt: GraphNode,
		input: GraphNode,
		generated: GraphNode,
		vfs: VFSNode,
		sandbox: SandboxNode,
		loader: LoaderNode,
		state: StateNode
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

	async function onRestore(id: string, snapshotRef: NodeRef) {
		const node = nodes.find(n => n.id === id);
		if (!node) return;
		
		const restoredData = await restoreSnapshot(node.data, snapshotRef);
		if (restoredData) {
			nodes = nodes.map(n => {
				if (n.id === id) {
					return { ...n, data: restoredData };
				}
				return n;
			});
		}
	}

	// ============================================================================
	// Version Preview Controller
	// ============================================================================

	// Preview controller - created after setStudioContext
	let previewCtrl: ReturnType<typeof createPreviewController> | null = null;

	// ============================================================================
	// Studio Context (Dependency Injection)
	// ============================================================================
	
	const studioContext: StudioContext = {
		get nodes() { return nodes; },
		get edges() { return edges; },
		get editingNodeId() { return editingNodeId; },
		get editingNameNodeId() { return editingNameNodeId; },
		
		setNodes: (newNodes) => { nodes = newNodes; },
		updateNodes: (updater) => { nodes = updater(nodes); },
		updateNode: (id, updater) => {
			nodes = nodes.map(n => 
				n.id === id ? { ...n, data: updater(n.data) } : n
			);
		},
		setEdges: (newEdges) => { edges = newEdges; },
		updateEdges: (updater) => { edges = updater(edges); },
		setEditingNodeId: (id) => { 
			editingNodeId = id;
			nodes = nodes.map(n => ({
				...n,
				data: { ...n.data, isEditing: n.id === id }
			}));
		},
		setEditingNameNodeId: (id) => { editingNameNodeId = id; },
		
		registerTextarea,
		unregisterTextarea,
		
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
		
		getPreviewState: (nodeId) => previewCtrl?.getPreviewState(nodeId) ?? null
	};
	
	setStudioContext(studioContext);
	
	// Create preview controller after context is set
	previewCtrl = createPreviewController();

	// ============================================================================
	// Version Preview Effects
	// ============================================================================
	
	// Update preview when selection changes
	$effect(() => {
		const selected = selectedNodes;
		untrack(() => previewCtrl?.updateSelection(selected));
	});

	// Apply edge version styling
	$effect(() => {
		// Track nodes and edges to trigger on change
		nodes;
		edges;
		untrack(() => previewCtrl?.applyEdgeVersionStyles());
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
			edges,
			(nodeId) => nodes.find(n => n.id === nodeId)?.data
		);
		return result.valid;
	};

	// ============================================================================
	// Node Controller Registration
	// ============================================================================
	
	// Register node-specific event handlers
	let unregisterInputNode: (() => void) | null = null;
	let unregisterGeneratedNode: (() => void) | null = null;
	let unregisterLoaderNode: (() => void) | null = null;
	
	onMount(() => {
		unregisterInputNode = registerInputNodeHandlers();
		unregisterGeneratedNode = registerGeneratedNodeHandlers();
		unregisterLoaderNode = registerLoaderNodeHandlers();
	});
	
	onDestroy(() => {
		unregisterInputNode?.();
		unregisterGeneratedNode?.();
		unregisterLoaderNode?.();
		clearAllHandlers();
	});

	// ============================================================================
	// Connection Handling (Event-driven)
	// ============================================================================

	/**
	 * Handle new connection creation.
	 * Dispatches to registered node handlers via flow-events.
	 */
	function handleConnect(connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
		const handled = dispatchConnection({
			type: 'connection',
			source: connection.source,
			target: connection.target,
			sourceHandle: connection.sourceHandle ?? null,
			targetHandle: connection.targetHandle ?? null,
			nodes: nodes,
			edges: edges,
			updateNodes: (updater) => { nodes = updater(nodes); },
			updateEdges: (updater) => { edges = updater(edges); }
		});
		
		// If no handler handled it, the default SvelteFlow behavior creates the edge
		// (which is fine for normal connections)
	}

	// ============================================================================
	// Node/Edge Deletion Handling (Event-driven)
	// ============================================================================

	/**
	 * Handle deletion of nodes and edges.
	 * Dispatches to registered node handlers via flow-events.
	 */
	function handleDelete({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node<StudioNodeData>[]; edges: Edge[] }) {
		// Dispatch edge delete events
		dispatchEdgeDeletes(
			deletedEdges,
			(updater) => { nodes = updater(nodes); }
		);
		
		// Dispatch node delete events
		dispatchNodeDeletes(deletedNodes);
	}

	// ============================================================================
	// Layout
	// ============================================================================

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
		const newInputData = await createInputNodeData('');
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
		const newVFSData = await createVFSNodeData(currentProjectId, m.studio_default_files());
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
		const newSandboxData = await createSandboxNodeData(m.studio_default_preview());
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
		const newLoaderData = await createLoaderNodeData(m.studio_default_service());
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

	async function addStateNode() {
		const newStateData = await createStateNodeData(m.studio_default_state());
		const position = getNewNodePosition();
		const newNode: Node<StudioNodeData> = {
			id: newStateData.id,
			type: 'state',
			data: newStateData,
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
			onconnect={(connection) => handleConnect(connection)}
			ondelete={handleDelete}
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
							{m.studio_context_add_node()}
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
								{m.studio_node_type_prompt()}
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addInputNode}
							>
								<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
								</svg>
								{m.studio_node_type_input()}
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
								{m.studio_node_type_sandbox()}
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addLoaderNode}
							>
								<svg class="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
								</svg>
								{m.studio_node_type_loader()}
							</button>
							<button
								class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-2"
								onclick={addStateNode}
							>
								<svg class="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
								</svg>
								{m.studio_node_type_state()}
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
					{m.studio_context_auto_layout()}
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
						{m.studio_context_edit_name()}
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
						{m.studio_context_delete_node()}
					{:else}
						{m.studio_context_delete_nodes({ count: selectedNodes.length })}
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