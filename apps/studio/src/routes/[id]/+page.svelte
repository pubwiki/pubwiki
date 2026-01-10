<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode, type IsValidConnection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from 'dagre';
	import { untrack, onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { 
		PromptNode,
		InputNode,
		GeneratedNode,
		VFSNode, 
		SandboxNode, 
		LoaderNode, 
		StateNode, 
		registerInputNodeHandlers,
		registerGeneratedNodeHandlers,
		registerLoaderNodeHandlers
	} from '../components/nodes';
	import VFSFileEditor from '../components/nodes/vfs/VFSFileEditor.svelte';
	import FlowController from '../components/FlowController.svelte';
	import { StudioSidebar } from '../components/sidebar';
	import { 
		type StudioNodeData, 
		type GeneratedNodeData,
		type VFSNodeData,
		type FlowNodeData,
		type NodeType,
		createPromptNodeData, 
		createInputNodeData,
		createVFSNodeData,
		createSandboxNodeData,
		createLoaderNodeData,
		createStateNodeData,
		createFlowNode
	} from '../types';
	import {
		restoreSnapshot,
		createPreviewController,
		type NodeRef
	} from '../version';
	import { validateConnection } from '../graph';
	import { positionNewNodesFromSources, getNodeDimensions, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, HORIZONTAL_GAP, VERTICAL_GAP } from '../graph';
	import { publishArtifact, type PublishMetadata } from '../io';
	import { setStudioContext, type StudioContext } from '../state';
	import { dispatchConnection, dispatchEdgeDeletes, dispatchNodeDeletes, clearAllHandlers } from '../state';
	import { 
		nodeStore, 
		layoutStore, 
		saveProject, 
		deleteProject, 
		setCurrentProject, 
		getProject,
		saveEdges,
		getEdges
	} from '../persistence';
	import { getNodeVfs, type VersionedVfs } from '../vfs';
	import { useAuth } from '@pubwiki/ui/stores';
	import { API_BASE_URL } from '$lib/config';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Node Types
	// ============================================================================
	
	const nodeTypes = {
		PROMPT: PromptNode,
		INPUT: InputNode,
		GENERATED: GeneratedNode,
		VFS: VFSNode,
		SANDBOX: SandboxNode,
		LOADER: LoaderNode,
		STATE: StateNode
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
	// Flow State (Rendering Layer Only)
	// Business data is managed by nodeStore, positions by layoutStore
	// ============================================================================
	
	let nodes = $state.raw<Node<FlowNodeData>[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let editingNodeId = $state<string | null>(null);
	let editingNameNodeId = $state<string | null>(null);
	let selectedNodes = $state<Node<FlowNodeData>[]>([]);
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

	// ============================================================================
	// VFS File Editor State
	// ============================================================================
	
	let vfsEditorState = $state<{
		nodeId: string;
		filePath: string;
		vfs: VersionedVfs;
	} | null>(null);

	async function handleOpenVfsFile(nodeId: string, filePath: string) {
		// If editor is already open for the same node, just update the file path
		if (vfsEditorState && vfsEditorState.nodeId === nodeId) {
			vfsEditorState = { ...vfsEditorState, filePath };
			return;
		}
		
		// Otherwise, open a new editor with the VFS
		const nodeData = nodeStore.get(nodeId);
		if (!nodeData || nodeData.type !== 'VFS') return;
		
		try {
			const vfsContent = nodeData.content as import('../types').VFSContent;
			const vfs = await getNodeVfs(vfsContent.projectId, nodeId);
			vfsEditorState = { nodeId, filePath, vfs };
		} catch (err) {
			console.error('Failed to open VFS file:', err);
		}
	}

	function handleCloseVfsEditor() {
		vfsEditorState = null;
	}
	
	// ============================================================================
	// Edge Auto-save (Node data and layouts are saved by their stores)
	// ============================================================================
	
	let edgeSaveTimer: ReturnType<typeof setTimeout> | null = null;
	const EDGE_SAVE_DEBOUNCE_MS = 500;
	
	// Schedule a debounced save of edges to IndexedDB
	function scheduleEdgeSave() {
		if (!loaded) {
			console.log('[Studio] scheduleEdgeSave skipped - not loaded yet');
			return;
		}
		
		if (edgeSaveTimer) {
			clearTimeout(edgeSaveTimer);
		}
		
		edgeSaveTimer = setTimeout(async () => {
			saving = true;
			console.log('[Studio] Saving edges to IndexedDB...', { projectId: currentProjectId, edgesCount: edges.length });
			try {
				await saveEdges(untrack(() => edges), currentProjectId);
				console.log('[Studio] Edges saved successfully');
			} catch (err) {
				console.error('[Studio] Failed to save edges:', err);
			} finally {
				saving = false;
			}
		}, EDGE_SAVE_DEBOUNCE_MS);
	}
	
	// Watch for edge changes and auto-save
	$effect(() => {
		// Access edges to track them
		edges;
		// Schedule save on any change
		untrack(() => scheduleEdgeSave());
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
		const nodeData = nodeStore.get(id);
		if (!nodeData) return;
		
		// restoreSnapshot works with Versionable data (StudioNodeData implements Versionable)
		const restored = await restoreSnapshot(nodeData, snapshotRef);
		if (restored) {
			// Update nodeStore with restored data
			nodeStore.set(id, restored);
			console.log('[Studio] Restored snapshot for node:', id, snapshotRef);
		} else {
			console.warn('[Studio] Failed to restore snapshot for node:', id, snapshotRef);
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
		setEdges: (newEdges) => { edges = newEdges; },
		updateEdges: (updater) => { edges = updater(edges); },
		setEditingNodeId: (id) => { 
			editingNodeId = id;
		},
		setEditingNameNodeId: (id) => { editingNameNodeId = id; },
		
		// Business data updates go through nodeStore
		updateNodeData: (id, updater) => {
			nodeStore.update(id, updater);
		},
		
		registerTextarea,
		unregisterTextarea,
		
		onRestore,
		
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
			(nodeId) => nodeStore.get(nodeId)?.type,
			edges,
			(nodeId) => nodeStore.get(nodeId) as StudioNodeData | undefined
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
	function handleDelete({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node<FlowNodeData>[]; edges: Edge[] }) {
		// Dispatch edge delete events
		dispatchEdgeDeletes(
			deletedEdges,
			(updater) => { nodes = updater(nodes); }
		);
		
		// Delete from stores
		for (const node of deletedNodes) {
			nodeStore.delete(node.id);
			layoutStore.delete(node.id);
		}
		
		// Dispatch node delete events for any cleanup handlers
		dispatchNodeDeletes(deletedNodes);
	}
	
	// ============================================================================
	// Drag Event Handlers (Layout Persistence)
	// ============================================================================
	
	/**
	 * Handle node drag stop - save positions to layoutStore
	 * Event type: { targetNode: Node | null; nodes: Node[]; event: MouseEvent | TouchEvent }
	 */
	function handleNodeDragStop(event: { targetNode: Node<FlowNodeData> | null; nodes: Node<FlowNodeData>[]; event: MouseEvent | TouchEvent }) {
		const updates = event.nodes.map(n => ({
			nodeId: n.id,
			x: n.position.x,
			y: n.position.y
		}));
		layoutStore.updateMany(updates);
	}
	
	/**
	 * Handle selection drag stop - save positions to layoutStore
	 * Note: SvelteFlow passes the event inside a wrapper object
	 */
	function handleSelectionDragStop(event: MouseEvent) {
		// Selection drag stop just receives the MouseEvent
		// We need to save all selected node positions
		const selected = nodes.filter(n => n.selected);
		const updates = selected.map(n => ({
			nodeId: n.id,
			x: n.position.x,
			y: n.position.y
		}));
		layoutStore.updateMany(updates);
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
		
		// Update layoutStore with new positions
		const updates = layoutedNodes.map(n => ({
			nodeId: n.id,
			x: n.position.x,
			y: n.position.y
		}));
		layoutStore.updateMany(updates);
		
		setTimeout(() => flowApi?.fitView({ padding: 0.2, duration: 300 }), 50);
	}

	// ============================================================================
	// Node Management (Using Layer Separation)
	// ============================================================================
	
	/**
	 * Helper to add a new node with layer separation
	 * 1. Creates business data in nodeStore
	 * 2. Creates layout in layoutStore  
	 * 3. Creates minimal flow node for SvelteFlow
	 */
	async function addNode(
		nodeData: import('../types').StudioNodeData,
		position: { x: number; y: number }
	) {
		// 1. Add business data to nodeStore
		nodeStore.create(nodeData);
		
		// 2. Add layout to layoutStore
		layoutStore.add(nodeData.id, position.x, position.y);
		
		// 3. Add flow node (minimal data for rendering)
		const flowNode = createFlowNode(nodeData.id, nodeData.type, position);
		nodes = [...nodes, {
			...flowNode,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		}];
	}
	
	async function addPromptNode() {
		const newPromptData = await createPromptNodeData('');
		const position = getNewNodePosition();
		await addNode({
			id: newPromptData.id,
			type: 'PROMPT',
			name: newPromptData.name,
			commit: newPromptData.commit,
			snapshotRefs: newPromptData.snapshotRefs,
			parents: newPromptData.parents,
			content: newPromptData.content,
			external: newPromptData.external
		}, position);
		closeContextMenu();
	}

	async function addInputNode() {
		const newInputData = await createInputNodeData('');
		const position = getNewNodePosition();
		await addNode({
			id: newInputData.id,
			type: 'INPUT',
			name: newInputData.name,
			commit: newInputData.commit,
			snapshotRefs: newInputData.snapshotRefs,
			parents: newInputData.parents,
			content: newInputData.content,
			external: newInputData.external
		}, position);
		closeContextMenu();
	}

	async function addVFSNode() {
		const newVFSData = await createVFSNodeData(currentProjectId, m.studio_default_files());
		const position = getNewNodePosition();
		await addNode({
			id: newVFSData.id,
			type: 'VFS',
			name: newVFSData.name,
			commit: newVFSData.commit,
			snapshotRefs: newVFSData.snapshotRefs,
			parents: newVFSData.parents,
			content: newVFSData.content,
			external: newVFSData.external
		}, position);
		closeContextMenu();
	}

	async function addSandboxNode() {
		const newSandboxData = await createSandboxNodeData(m.studio_default_preview());
		const position = getNewNodePosition();
		await addNode({
			id: newSandboxData.id,
			type: 'SANDBOX',
			name: newSandboxData.name,
			commit: newSandboxData.commit,
			snapshotRefs: newSandboxData.snapshotRefs,
			parents: newSandboxData.parents,
			content: newSandboxData.content,
			external: newSandboxData.external
		}, position);
		closeContextMenu();
	}

	async function addLoaderNode() {
		const newLoaderData = await createLoaderNodeData(m.studio_default_service());
		const position = getNewNodePosition();
		await addNode({
			id: newLoaderData.id,
			type: 'LOADER',
			name: newLoaderData.name,
			commit: newLoaderData.commit,
			snapshotRefs: newLoaderData.snapshotRefs,
			parents: newLoaderData.parents,
			content: newLoaderData.content,
			external: newLoaderData.external
		}, position);
		closeContextMenu();
	}

	async function addStateNode() {
		const newStateData = await createStateNodeData(m.studio_default_state());
		const position = getNewNodePosition();
		await addNode({
			id: newStateData.id,
			type: 'STATE',
			name: newStateData.name,
			commit: newStateData.commit,
			snapshotRefs: newStateData.snapshotRefs,
			parents: newStateData.parents,
			content: newStateData.content,
			external: newStateData.external
		}, position);
		closeContextMenu();
	}

	function deleteNodes(nodeIds: string[]) {
		// Delete from stores
		for (const nodeId of nodeIds) {
			nodeStore.delete(nodeId);
			layoutStore.delete(nodeId);
		}
		
		// Update flow state
		nodes = nodes.filter(n => !nodeIds.includes(n.id));
		edges = edges.filter(e => !nodeIds.includes(e.source) && !nodeIds.includes(e.target));
		selectedNodes = selectedNodes.filter(n => !nodeIds.includes(n.id));
		closeContextMenu();
	}

	// ============================================================================
	// Initialization (Load from IndexedDB and check API)
	// ============================================================================
	
	/**
	 * Check if an artifact exists on the backend
	 * Returns artifact info if exists, null otherwise
	 */
	async function checkArtifactExists(artifactId: string): Promise<boolean> {
		console.log('[Studio] checkArtifactExists called:', { artifactId, apiUrl: API_BASE_URL });
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
			
			const response = await fetch(`${API_BASE_URL}/artifacts/${artifactId}/graph?version=latest`, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal
			});
			clearTimeout(timeoutId);
			console.log('[Studio] checkArtifactExists response:', response.ok);
			return response.ok;
		} catch (err) {
			console.log('[Studio] checkArtifactExists error:', err);
			return false;
		}
	}
	
	$effect(() => {
		console.log('[Studio] Init $effect running, initialized:', initialized, 'loaded:', loaded);
		if (!initialized) {
			initialized = true;
			console.log('[Studio] Starting initialization...');
			(async () => {
				try {
					// Get local project if exists
					const localProject = await getProject(currentProjectId);
					console.log('[Studio] Local project:', localProject);
					
					// Set initial state from local project
					projectName = localProject?.name ?? `Project ${currentProjectId.substring(0, 8)}`;
					isDraft = localProject?.isDraft ?? true;
					
					// Create local project record if not exists
					if (!localProject) {
						await saveProject({
							id: currentProjectId,
							name: projectName,
							createdAt: Date.now(),
							updatedAt: Date.now(),
							isDraft: true
						});
					}
					
					// Set this project as the current project
					setCurrentProject(currentProjectId);
					console.log('[Studio] Current project set:', currentProjectId);
					
					// Initialize stores (Layer Separation)
					console.log('[Studio] Initializing stores for project:', currentProjectId);
					await nodeStore.init(currentProjectId);
					const layouts = await layoutStore.init(currentProjectId);
					const savedEdges = await getEdges(currentProjectId);
					
					console.log('[Studio] Stores loaded:', { 
						nodesCount: nodeStore.getAllIds().length, 
						layoutsCount: layouts.size,
						edgesCount: savedEdges.length 
					});
					
					if (nodeStore.getAllIds().length > 0) {
						// Restore saved graph - build flow nodes from stores
						console.log('[Studio] Restoring saved graph with', nodeStore.getAllIds().length, 'nodes');
						nodes = nodeStore.getAllIds().map(nodeId => {
							const nodeData = nodeStore.get(nodeId)!;
							const layout = layouts.get(nodeId) ?? { x: 0, y: 0 };
							return {
								id: nodeId,
								type: nodeData.type,
								position: layout,
								data: { id: nodeId, type: nodeData.type },
								sourcePosition: Position.Right,
								targetPosition: Position.Left,
							};
						});
						edges = savedEdges;
					} else {
						// Create initial empty prompt node
						console.log('[Studio] No saved graph found, creating initial node');
						const initialPromptData = await createPromptNodeData('');
						const position = { x: 0, y: 0 };
						
						// Add to stores
						nodeStore.create({
							id: initialPromptData.id,
							type: 'PROMPT',
							name: initialPromptData.name,
							commit: initialPromptData.commit,
							snapshotRefs: initialPromptData.snapshotRefs,
							parents: initialPromptData.parents,
							content: initialPromptData.content,
							external: initialPromptData.external
						});
						layoutStore.add(initialPromptData.id, position.x, position.y);
						
						// Add flow node
						nodes = [{
							id: initialPromptData.id,
							type: 'PROMPT',
							data: { id: initialPromptData.id, type: 'PROMPT' as NodeType },
							position,
							sourcePosition: Position.Right,
							targetPosition: Position.Left,
						}];
					}
					
					loaded = true;
					console.log('[Studio] Graph loading complete, loaded set to:', loaded);
					
					// Check backend status asynchronously (non-blocking)
					// This only affects the publish button text (Publish vs Update)
					checkArtifactExists(currentProjectId).then(async (existsOnBackend) => {
						console.log('[Studio] Backend check complete, exists:', existsOnBackend);
						if (existsOnBackend) {
							isDraft = false;
							// Update local project record
							const project = await getProject(currentProjectId);
							if (project && project.isDraft) {
								await saveProject({ ...project, isDraft: false, artifactId: currentProjectId });
							}
						}
					});
				} catch (err) {
					console.error('[Studio] Failed to load from IndexedDB:', err);
					// Fallback: create initial node
					const initialPromptData = await createPromptNodeData('');
					const position = { x: 0, y: 0 };
					
					// Initialize stores first
					await nodeStore.init(currentProjectId);
					await layoutStore.init(currentProjectId);
					
					// Add to stores
					nodeStore.create({
						id: initialPromptData.id,
						type: 'PROMPT',
						name: initialPromptData.name,
						commit: initialPromptData.commit,
						snapshotRefs: initialPromptData.snapshotRefs,
						parents: initialPromptData.parents,
						content: initialPromptData.content,
						external: initialPromptData.external
					});
					layoutStore.add(initialPromptData.id, position.x, position.y);
					
					nodes = [{
						id: initialPromptData.id,
						type: "PROMPT",
						data: { id: initialPromptData.id, type: 'PROMPT' as NodeType },
						position,
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

	function handleFocusNode(node: Node<FlowNodeData>) {
		if (flowApi) {
			flowApi.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.2 });
		}
		setTimeout(() => focusNode(node.id), 100);
	}

	function handleNewProject() {
		// Generate a new project ID and open in a new tab
		const newId = crypto.randomUUID();
		window.open(`/${newId}`, '_blank');
	}

	async function handlePublish(
		metadata: PublishMetadata,
		nodesToPublish: Node<FlowNodeData>[],
		edgesToPublish: Edge[]
	) {
		const result = await publishArtifact(metadata, nodesToPublish, edgesToPublish);
		
		if (!result.success) {
			throw new Error(result.error || 'Failed to publish');
		}
		
		// Use artifactId (from metadata) as the new project ID
		const newProjectId = metadata.artifactId;
		const oldProjectId = currentProjectId;
		
		// Save the graph to the new project (with artifact ID, isDraft = false)
		await saveProject({
			id: newProjectId,
			name: metadata.name,
			artifactId: metadata.artifactId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isDraft: false
		});
		
		// Flush stores and save edges
		await nodeStore.flush();
		await layoutStore.flush();
		await saveEdges(edges, newProjectId);
		
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
		goto(`/${newProjectId}`);
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
			onnodedragstop={handleNodeDragStop}
			onselectiondragstop={handleSelectionDragStop}
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
		onOpenVfsFile={handleOpenVfsFile}
		onNewProject={handleNewProject}
	/>

	<!-- VFS File Editor (Right side floating panel) -->
	{#if vfsEditorState}
		<VFSFileEditor
			vfs={vfsEditorState.vfs}
			filePath={vfsEditorState.filePath}
			onClose={handleCloseVfsEditor}
		/>
	{/if}
	
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