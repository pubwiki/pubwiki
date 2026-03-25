<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode, type IsValidConnection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from 'dagre';
	import { untrack, onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { 
		PromptNode,
		InputNode,
		GeneratedNode,
		VFSNode, 
		SandboxNode, 
		LoaderNode, 
		StateNode, 
		registerGeneratedNodeHandlers,
		registerLoaderNodeHandlers,
		registerVfsNodeHandlers,
		createMountToFolder
	} from '$components/nodes';
	import VFSFileEditor from '$components/nodes/vfs/VFSFileEditor.svelte';
	import FlowController from '$components/FlowController.svelte';
	import { StudioSidebar, type EditorMode } from '$components/sidebar';
	import { CopilotPanel } from '$components/copilot';
	import { WorldEditor } from '$components/world-editor';
	import { SimpleModeBridge } from '$lib/simple-mode/bridge';
	import { 
		type FlowNodeData,
		type NodeType,
		createPromptNodeData, 
		createInputNodeData,
		createVFSNodeData,
		createSandboxNodeData,
		createLoaderNodeData,
		createStateNodeData,
		createFlowNode
	} from '$lib/types';
	import {
		createPreviewController,
		type NodeRef
	} from '$lib/version';
	import { validateConnection, HandleId, createVfsMountHandleId } from '$lib/graph';
	import { getNodeDimensions } from '$lib/graph';
	import { publishArtifact, patchArtifact, type PublishMetadata, type PatchMetadata, exportProjectToZip, selectZipFile, importFromZipFile, addArtifactToProject, type ImportProgressCallback } from '$lib/io';
	import type { UpdateMetadata } from '$components/sidebar/ProjectTab.svelte';
	import { createDraftSyncService, type DraftSyncService, type DraftSyncState } from '$lib/sync';
	import { createPublishState } from '$lib/state/publish-state.svelte';
	import { setStudioContext, type StudioContext } from '$lib/state';
	import { getPendingConfirmation, respondConfirmation } from '$lib/state/pubwiki-confirm.svelte';
	import { PubWikiConfirmDialog } from '$components/pubwiki';
	import VfsDeleteConfirmDialog from '$components/dialogs/VfsDeleteConfirmDialog.svelte';
	import { dispatchConnection, dispatchEdgeDeletes, dispatchNodeDeletes, clearAllHandlers, getVfsDropTarget } from '$lib/state';
	import { 
		nodeStore, 
		layoutStore, 
		saveProject, 
		saveEdges,
		getEdges,
		setCurrentProject, 
		getProject,
		reportSaveState
	} from '$lib/persistence';
	import { getNodeVfs, getVfsFactory, type NodeVfs } from '$lib/vfs';
	import { generateUniqueNodeName } from '$lib/validation';
	import { requestVfsDeleteConfirmation } from '$lib/state/vfs-delete-confirm.svelte';
	import { useAuth } from '@pubwiki/ui/stores';
	import { persist } from '@pubwiki/ui/utils';
	import { createApiClient } from '@pubwiki/api/client';
	import { API_BASE_URL } from '$lib/config';
	import * as m from '$lib/paraglide/messages';
	import { browser } from '$app/environment';

	// Create a singleton API client
	const apiClient = createApiClient(API_BASE_URL);

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
	
	// Touch device detection for mobile-friendly canvas interaction
	// On touch devices: single touch pans canvas, long press to select nodes
	// On desktop: left drag selects, middle drag pans
	let isTouchDevice = $state(false);
	
	$effect(() => {
		if (browser) {
			// Check for touch capability
			isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		}
	});
	
	// Import state for loading overlay
	let importing = $state(false);
	let importProgress = $state<{
		phase: 'fetching' | 'processing' | 'adding' | 'refreshing';
		subPhase?: 'downloading-vfs' | 'writing-vfs' | 'processing-nodes' | 'saving';
		artifactId?: string;
		nodeCount?: number;
		edgeCount?: number;
		currentStep?: number;
		totalSteps?: number;
		subCurrent?: number;
		subTotal?: number;
		subDetail?: string;
	} | null>(null);

	// Whether this project is a draft (not yet published)
	const publishState = createPublishState();
	
	// Project name (display, updated on every keystroke)
	let projectName = $state('');
	
	// Copilot panel state (controlled from sidebar button)
	let copilotCollapsed = $state(true);

	// Editor mode state (persisted to localStorage)
	const persistedEditorMode = persist<EditorMode>('studio-editor-mode', 'expert');
	let editorMode = $derived(persistedEditorMode.value);

	// Simple Mode Bridge — lazily initialised when the user switches to simple mode
	let simpleBridge: SimpleModeBridge | null = null;
	let simpleBridgeGraphReady: Promise<void> | null = null;

	function ensureSimpleBridge(projectId: string): Promise<import('@pubwiki/rdfstore').TripleStore> {
		if (!simpleBridge || simpleBridge['projectId'] !== projectId) {
			simpleBridge = new SimpleModeBridge(projectId, {
				updateNodes: (updater) => { nodes = updater(nodes); },
				updateEdges: (updater) => { edges = updater(edges); }
			});
			simpleBridgeGraphReady = null;
		}
		if (!simpleBridgeGraphReady) {
			simpleBridgeGraphReady = simpleBridge.ensureGraph().then(() => {});
		}
		// Always fetch a fresh TripleStore — the cached one may have been closed
		// by StateNode's onDestroy when switching back from expert mode.
		return simpleBridgeGraphReady.then(() => simpleBridge!.getTripleStore());
	}

	// Build cache state
	let selectedEntrypoint = $state<string | null>(null);
	
	// Draft Sync Service
	let syncService = $state<DraftSyncService | null>(null);
	const defaultSyncState: DraftSyncState = {
		status: 'idle',
		hasUnsyncedChanges: false,
		hasVfsChanges: false,
		lastSyncedAt: null,
		lastSyncedCommit: null,
		error: null,
		enabled: false,
		backendValidated: false,
		diverged: undefined
	};
	let syncState = $derived(syncService !== null ? syncService.state : defaultSyncState);
	
	// Track initial modificationCount to avoid marking dirty on init
	let initialModificationCount = $state<number | null>(null);
	
	// Watch nodeStore modifications and mark syncService as dirty when changes occur
	$effect(() => {
		const currentCount = nodeStore.modificationCount;
		// Skip if syncService not initialized or this is the initial read
		if (syncService && initialModificationCount !== null && currentCount > initialModificationCount) {
			syncService.markDirty();
		}
	});
	
	// Update tracked VFS nodes when nodes array changes
	$effect(() => {
		if (syncService && loaded) {
			// This will track new VFS nodes and untrack removed ones
			syncService.updateTrackedVfsNodes(nodes);
		}
	});
	
	// Current project ID (from URL params)
	let currentProjectId = $derived(data.projectId);
	
	// Import artifact ID (from URL params, e.g., ?import=artifactId)
	let importArtifactId = $derived(data.importArtifactId);

	// ============================================================================
	// PubWiki Confirmation Dialog State
	// ============================================================================
	
	const pendingConfirmation = $derived(getPendingConfirmation());

	// ============================================================================
	// VFS File Editor State
	// ============================================================================
	
	let vfsEditorState = $state<{
		nodeId: string;
		filePath: string;
		vfs: NodeVfs;
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
			const vfsContent = nodeData.content as import('$lib/types').VFSContent;
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
		
		reportSaveState('edges', 'dirty');
		if (edgeSaveTimer) {
			clearTimeout(edgeSaveTimer);
		}
		
		edgeSaveTimer = setTimeout(async () => {
			reportSaveState('edges', 'saving');
			// Filter out historical edges (temporary edges for version preview)
			const edgesToSave = untrack(() => edges.filter(e => !e.id.startsWith('historical-')));
			console.log('[Studio] Saving edges to IndexedDB...', { projectId: currentProjectId, edgesCount: edgesToSave.length });
			try {
				await saveEdges(edgesToSave, currentProjectId);
				console.log('[Studio] Edges saved successfully');
			} catch (err) {
				console.error('[Studio] Failed to save edges:', err);
			} finally {
				reportSaveState('edges', 'idle');
			}
		}, EDGE_SAVE_DEBOUNCE_MS);
	}
	
	// Watch for edge changes and auto-save
	$effect(() => {
		// Access edges to track them
		void edges;
		// Schedule save on any change
		untrack(() => scheduleEdgeSave());
	});

	// ============================================================================
	// Textarea Registry (for external focus control from badges)
	// ============================================================================
	
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- imperative registry, not reactive state
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
		
		// Get historical snapshot
		const snapshot = await nodeStore.getVersion(snapshotRef.id, snapshotRef.commit);
		if (!snapshot) {
			console.warn('[Studio] Failed to restore snapshot for node:', id, snapshotRef);
			return;
		}

		// Store current version as snapshot before restoring
		await nodeStore.saveSnapshot(nodeData.id);

		const currentRef: NodeRef = {
			id: nodeData.id,
			commit: nodeData.commit
		};

		// Update nodeStore with restored data
		// Use Object.assign to preserve the exact type
		nodeStore.set(id, Object.assign({}, nodeData, {
			content: snapshot.content,
			commit: snapshot.commit,
			snapshotRefs: [...nodeData.snapshotRefs, currentRef]
		}));
		console.log('[Studio] Restored snapshot for node:', id, snapshotRef);
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
		
		getPreviewState: (nodeId) => previewCtrl?.getPreviewState(nodeId) ?? null,
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
			edges
		);
		return result.valid;
	};

	// ============================================================================
	// Node Controller Registration
	// ============================================================================
	
	// Register node-specific event handlers
	let unregisterGeneratedNode: (() => void) | null = null;
	let unregisterLoaderNode: (() => void) | null = null;
	let unregisterVfsNode: (() => void) | null = null;
	
	onMount(() => {
		unregisterGeneratedNode = registerGeneratedNodeHandlers();
		unregisterLoaderNode = registerLoaderNodeHandlers();
		unregisterVfsNode = registerVfsNodeHandlers();
	});
	
	onDestroy(() => {
		unregisterGeneratedNode?.();
		unregisterLoaderNode?.();
		unregisterVfsNode?.();
		clearAllHandlers();
		
		// Cleanup VFS tracking in sync service
		syncService?.cleanupVfsTracking();

		// Reset simple-mode bridge state
		simpleBridge = null;
		simpleBridgeGraphReady = null;
	});

	// ============================================================================
	// Connection Handling (Event-driven)
	// ============================================================================

	/**
	 * Handle new connection creation.
	 * Dispatches to registered node handlers via flow-events.
	 */
	function handleConnect(connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
		dispatchConnection({
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

	/**
	 * Handle connection end - detect drag-to-folder mount gesture.
	 * Called when a user stops dragging a connection line (whether connected or not).
	 * Uses state-driven approach: VFSNode updates vfsDropTarget state on hover,
	 * and we read it here instead of querying DOM.
	 */
	async function handleConnectEnd(event: MouseEvent | TouchEvent, connectionState: { toHandle: unknown; fromNode?: { id: string } | null }) {
		// If the connection was successful (connected to a handle), do nothing extra
		if (connectionState.toHandle) {
			return;
		}

		// Get source node info from connection state
		const sourceNodeId = connectionState.fromNode?.id;
		if (!sourceNodeId) return;

		// Check if source is a VFS node
		const sourceNode = nodes.find(n => n.id === sourceNodeId);
		if (!sourceNode || sourceNode.data.type !== 'VFS') {
			return;
		}

		// Get current drop target from state (set by VFSNode on hover)
		const dropTarget = getVfsDropTarget();
		if (!dropTarget) return;

		const { nodeId: targetNodeId, folder, folderPath: targetFolderPath } = dropTarget;
		
		// Cannot drop on an already mounted folder
		if (folder?.isMounted) {
			console.warn('[VFS:Mount] Cannot mount to an already mounted folder');
			return;
		}

		// Cannot drop on self
		if (targetNodeId === sourceNodeId) {
			return;
		}

		if (targetNodeId && targetFolderPath) {
			// Create mount to the target folder
			const mount = await createMountToFolder(sourceNodeId, targetNodeId, targetFolderPath);
			
			if (mount) {
				// Create visual edge to represent the mount relationship
				// Use the mount's dynamic handle ID (similar to reftag)
				const targetHandleId = createVfsMountHandleId(mount.id);
				const newEdge: Edge = {
					id: `${sourceNodeId}-${targetNodeId}-${mount.id}`,
					source: sourceNodeId,
					target: targetNodeId,
					sourceHandle: HandleId.DEFAULT,
					targetHandle: targetHandleId,
				};
				
				// Check if edge already exists
				if (!edges.some(e => e.id === newEdge.id)) {
					edges = [...edges, newEdge];
					scheduleEdgeSave();
				}
			}
		}
	}

	// ============================================================================
	// Node/Edge Deletion Handling (Event-driven)
	// ============================================================================

	/**
	 * Handle before delete - shows confirmation for VFS nodes.
	 * Returns false to cancel deletion, true to proceed.
	 */
	async function handleBeforeDelete({ nodes: deletedNodes, edges: _deletedEdges }: { nodes: Node<FlowNodeData>[]; edges: Edge[] }): Promise<boolean> {
		// Separate VFS nodes from other nodes (all VFS nodes require confirmation)
		const vfsNodes = deletedNodes.filter(n => n.data.type === 'VFS');
		const otherNodes = deletedNodes.filter(n => n.data.type !== 'VFS');
		
		// If there are VFS nodes being deleted, request confirmation
		if (vfsNodes.length > 0) {
			const confirmed = await requestVfsDeleteConfirmation(vfsNodes, otherNodes);
			if (!confirmed) {
				// User cancelled - don't delete anything
				return false;
			}
		}
		
		// Allow deletion to proceed
		return true;
	}

	/**
	 * Handle deletion of nodes and edges.
	 * Dispatches to registered node handlers via flow-events.
	 * Called after onbeforedelete returns true.
	 */
	async function handleDelete({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node<FlowNodeData>[]; edges: Edge[] }) {
		// Delete VFS data from OPFS for all VFS nodes
		const vfsNodes = deletedNodes.filter(n => n.data.type === 'VFS');
		if (vfsNodes.length > 0) {
			const factory = getVfsFactory();
			for (const node of vfsNodes) {
				try {
					// First dispose any active VFS instance
					await factory.disposeVfs(data.projectId, node.id);
					// Then delete the underlying OPFS data
					await factory.deleteVfsData(data.projectId, node.id);
				} catch (e) {
					console.error(`[VFS] Failed to delete VFS data for node ${node.id}:`, e);
				}
			}
		}
		
		// Dispatch edge delete events
		dispatchEdgeDeletes(
			deletedEdges,
			(updater) => { nodes = updater(nodes); }
		);
		
		// Delete from stores
		// VFS change tracking cleanup is automatic via the $effect
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
		// Filter out phantom nodes - they should not be persisted
		const updates = event.nodes
			.filter(n => !n.data.isPhantom)
			.map(n => ({
				nodeId: n.id,
				x: n.position.x,
				y: n.position.y
			}));
		if (updates.length > 0) {
			layoutStore.updateMany(updates);
		}
	}
	
	/**
	 * Handle selection drag stop - save positions to layoutStore
	 * Note: SvelteFlow passes the event inside a wrapper object
	 */
	function handleSelectionDragStop(_event: MouseEvent) {
		// Selection drag stop just receives the MouseEvent
		// We need to save all selected node positions, excluding phantom nodes
		const selected = nodes.filter(n => n.selected && !n.data.isPhantom);
		const updates = selected.map(n => ({
			nodeId: n.id,
			x: n.position.x,
			y: n.position.y
		}));
		if (updates.length > 0) {
			layoutStore.updateMany(updates);
		}
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
		nodeData: import('$lib/types').StudioNodeData,
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
		const uniqueName = generateUniqueNodeName('PROMPT');
		const newPromptData = await createPromptNodeData('', null, uniqueName);
		const position = getNewNodePosition();
		await addNode(newPromptData, position);
		closeContextMenu();
		editingNameNodeId = newPromptData.id;
	}

	async function addInputNode() {
		const uniqueName = generateUniqueNodeName('INPUT');
		const newInputData = await createInputNodeData('', null, uniqueName);
		const position = getNewNodePosition();
		await addNode(newInputData, position);
		closeContextMenu();
		editingNameNodeId = newInputData.id;
	}

	async function addVFSNode() {
		const uniqueName = generateUniqueNodeName('VFS');
		const newVFSData = await createVFSNodeData(currentProjectId, uniqueName);
		const position = getNewNodePosition();
		await addNode(newVFSData, position);
		closeContextMenu();
		editingNameNodeId = newVFSData.id;
	}

	async function addSandboxNode() {
		const uniqueName = generateUniqueNodeName('SANDBOX');
		const newSandboxData = await createSandboxNodeData(uniqueName);
		const position = getNewNodePosition();
		await addNode(newSandboxData, position);
		closeContextMenu();
		editingNameNodeId = newSandboxData.id;
	}

	async function addLoaderNode() {
		const uniqueName = generateUniqueNodeName('LOADER');
		const newLoaderData = await createLoaderNodeData(uniqueName);
		const position = getNewNodePosition();
		await addNode(newLoaderData, position);
		closeContextMenu();
		editingNameNodeId = newLoaderData.id;
	}

	async function addStateNode() {
		const uniqueName = generateUniqueNodeName('STATE');
		const newStateData = await createStateNodeData(uniqueName);
		const position = getNewNodePosition();
		await addNode(newStateData, position);
		closeContextMenu();
		editingNameNodeId = newStateData.id;
	}

	function _deleteNodes(nodeIds: string[]) {
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
			
			const { error } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: { 
					path: { artifactId },
					query: { version: 'latest' }
				},
				signal: controller.signal
			});
			clearTimeout(timeoutId);
			const exists = !error;
			console.log('[Studio] checkArtifactExists response:', exists);
			return exists;
		} catch (err) {
			console.log('[Studio] checkArtifactExists error:', err);
			return false;
		}
	}
	
	/**
	 * Handle artifact import from URL parameter
	 * Fetches artifact graph and adds nodes to the current project
	 */
	async function handleArtifactImport(artifactId: string) {
		console.log('[Studio] handleArtifactImport starting:', artifactId);
		
		// Show loading overlay
		importing = true;
		importProgress = { 
			phase: 'fetching', 
			artifactId: artifactId,
			currentStep: 1,
			totalSteps: 4
		};
		
		try {
			// Fetch artifact graph
			console.log('[Studio] Fetching artifact graph...');
			const { data: graphData, error } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: {
					path: { artifactId },
					query: { version: 'latest' }
				}
			});
			
			console.log('[Studio] Artifact graph response:', { graphData, error });
			
			if (error || !graphData) {
				console.error('[Studio] Failed to fetch artifact graph:', error);
				importing = false;
				importProgress = null;
				return;
			}
			
			// Update progress with node count
			importProgress = { 
				phase: 'processing',
				artifactId: artifactId,
				nodeCount: graphData.nodes?.length ?? 0,
				edgeCount: graphData.edges?.length ?? 0,
				currentStep: 2,
				totalSteps: 4
			};
			
			console.log('[Studio] Artifact graph nodes:', graphData.nodes?.length ?? 0);
			console.log('[Studio] Artifact graph edges:', graphData.edges?.length ?? 0);
			
			if (!graphData.nodes || graphData.nodes.length === 0) {
				console.warn('[Studio] Artifact has no nodes to import');
				importing = false;
				importProgress = null;
				return;
			}
			
			// Import artifact nodes to current project
			console.log('[Studio] Adding artifact to project...');
			importProgress = { 
				phase: 'adding',
				artifactId: artifactId,
				nodeCount: graphData.nodes?.length ?? 0,
				edgeCount: graphData.edges?.length ?? 0,
				currentStep: 3,
				totalSteps: 4
			};
			
			// Progress callback for detailed updates
			const onImportProgress: ImportProgressCallback = (progress) => {
				importProgress = {
					phase: 'adding',
					subPhase: progress.phase,
					artifactId: artifactId,
					nodeCount: graphData.nodes?.length ?? 0,
					edgeCount: graphData.edges?.length ?? 0,
					currentStep: 3,
					totalSteps: 4,
					subCurrent: progress.current,
					subTotal: progress.total,
					subDetail: progress.detail
				};
			};
			
			await addArtifactToProject(
				{ nodes: graphData.nodes, edges: graphData.edges, version: graphData.version },
				artifactId,
				currentProjectId,
				onImportProgress
			);
			
			console.log('[Studio] Artifact import complete, refreshing view...');
			importProgress = { 
				phase: 'refreshing',
				artifactId: artifactId,
				nodeCount: graphData.nodes?.length ?? 0,
				edgeCount: graphData.edges?.length ?? 0,
				currentStep: 4,
				totalSteps: 4
			};
			
			// Refresh nodes and edges from stores
			const layouts = layoutStore.getAll();
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
			edges = await getEdges(currentProjectId);
			
			console.log('[Studio] View refreshed, nodes:', nodes.length, 'edges:', edges.length);
			
			// VFS change tracking is automatically setup by the $effect
			// when the nodes array is updated
			
			// Clear import parameter from URL to prevent re-import on refresh
			await goto(resolve(`/${currentProjectId}`), { replaceState: true });
		} catch (err) {
			console.error('[Studio] Failed to import artifact:', err);
		} finally {
			importing = false;
			importProgress = null;
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
					publishState.init(localProject?.isDraft ?? true, localProject?.lastCloudCommit);
					selectedEntrypoint = localProject?.selectedEntrypoint ?? null;
					
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
						nodeStore.create(initialPromptData);
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
					
					// Initialize Draft Sync Service
					syncService = createDraftSyncService();
					await syncService.init(currentProjectId);
					console.log('[Studio] Draft Sync Service initialized');
					
					// Wire VFS change tracking into publish state
					publishState.setVfsChangesGetter(() => syncService!.state.hasVfsChanges);
					
					// VFS change tracking is automatically setup by the $effect
					// when syncService becomes available
					
					// Capture initial modification count after initialization
					// This prevents marking as dirty during initial load
					initialModificationCount = nodeStore.modificationCount;
					
					// Handle import if artifactId is provided in URL
					if (importArtifactId) {
						console.log('[Studio] Import artifact requested:', importArtifactId);
						await handleArtifactImport(importArtifactId);
					}
					
					// Check backend status asynchronously (non-blocking)
					// This only affects the publish button text (Publish vs Update)
					checkArtifactExists(currentProjectId).then(async (existsOnBackend) => {
						console.log('[Studio] Backend check complete, exists:', existsOnBackend);
						if (existsOnBackend) {
							publishState.setDraft(false);
							// Update local project record
							const project = await getProject(currentProjectId);
							if (project && project.isDraft) {
								await saveProject({ ...project, isDraft: false, artifactId: currentProjectId });
							}
						} else {
							// Artifact not found or inaccessible — reset to draft if locally marked as published
							const project = await getProject(currentProjectId);
							if (project && !project.isDraft) {
								console.log('[Studio] Artifact deleted on backend, resetting to draft');
								publishState.init(true, undefined);
								await saveProject({ ...project, isDraft: true, lastCloudCommit: undefined });
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
					nodeStore.create(initialPromptData);
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

	async function handleDeleteFromContextMenu() {
		let nodesToDelete: Node<FlowNodeData>[] = [];
		let edgesToDelete: Edge[] = [];
		
		const contextNodeId = contextMenu?.nodeId;
		if (contextNodeId) {
			const node = nodes.find(n => n.id === contextNodeId);
			if (node) nodesToDelete = [node];
		} else if (selectedNodes.length > 0) {
			nodesToDelete = selectedNodes;
		}
		
		if (nodesToDelete.length === 0) {
			closeContextMenu();
			return;
		}
		
		// Find connected edges to delete
		const nodeIds = nodesToDelete.map(n => n.id);
		edgesToDelete = edges.filter(e => nodeIds.includes(e.source) || nodeIds.includes(e.target));
		
		// Use the same confirmation flow as keyboard delete
		const shouldDelete = await handleBeforeDelete({ nodes: nodesToDelete, edges: edgesToDelete });
		if (!shouldDelete) {
			closeContextMenu();
			return;
		}
		
		// Perform the actual deletion
		handleDelete({ nodes: nodesToDelete, edges: edgesToDelete });
		
		// Update flow state
		nodes = nodes.filter(n => !nodeIds.includes(n.id));
		edges = edges.filter(e => !nodeIds.includes(e.source) && !nodeIds.includes(e.target));
		selectedNodes = selectedNodes.filter(n => !nodeIds.includes(n.id));
		closeContextMenu();
	}

	function handleFocusNode(node: Node<FlowNodeData>) {
		if (flowApi) {
			flowApi.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.2 });
		}
		setTimeout(() => focusNode(node.id), 100);
	}

	// ============================================================================
	// Draft Sync Handlers
	// ============================================================================
	
	async function handleSync() {
		if (!syncService || !auth.isAuthenticated) return;
		
		// Flush any pending changes first
		await nodeStore.flush();
		await layoutStore.flush();
		await saveEdges(edges, currentProjectId);
		
		// Perform sync
		const result = await syncService.sync(nodes, edges, projectName);
		if (result.success) {
			// Update initial modification count after successful sync
			// This ensures subsequent modifications are tracked correctly
			initialModificationCount = nodeStore.modificationCount;
		} else if (result.error) {
			console.error('[Studio] Sync failed:', result.error);
		}
	}
	
	async function handleEnableSync() {
		if (!syncService || !auth.isAuthenticated) return;
		
		// Enable sync
		syncService.enable();
		
		// Immediately perform first sync
		await handleSync();
	}

	/**
	 * Handle accepting cloud state when local and cloud histories diverge.
	 * This updates local references to match cloud, allowing normal sync to resume.
	 */
	async function handleAcceptCloud() {
		if (!syncService) return;
		
		await syncService.acceptCloudState();
		console.log('[Studio] Accepted cloud state, local references updated');
	}

	/**
	 * Handle force pushing local state to cloud when diverged.
	 * This creates a new commit based on current cloud commit.
	 */
	async function handleForcePushLocal() {
		if (!syncService || !auth.isAuthenticated) return;
		
		// Flush any pending changes first
		await nodeStore.flush();
		await layoutStore.flush();
		await saveEdges(edges, currentProjectId);
		
		const result = await syncService.forcePushLocal(nodes, edges, projectName);
		if (result.success) {
			initialModificationCount = nodeStore.modificationCount;
			console.log('[Studio] Force pushed local state to cloud');
		} else if (result.error) {
			console.error('[Studio] Force push failed:', result.error);
		}
	}

	function handleNewProject() {
		// Generate a new project ID and open in a new tab
		const newId = crypto.randomUUID();
		window.open(`/${newId}`, '_blank');
	}

	async function handleExport() {
		try {
			await exportProjectToZip(currentProjectId);
		} catch (err) {
			console.error('[Studio] Export failed:', err);
			alert(err instanceof Error ? err.message : 'Export failed');
		}
	}

	async function handleImport() {
		try {
			const file = await selectZipFile();
			if (!file) return;

			// Show overlay only after user has selected a file
			importing = true;
			importProgress = {
				phase: 'processing',
				currentStep: 1,
				totalSteps: 2
			};

			const result = await importFromZipFile(file);
			importProgress = {
				phase: 'refreshing',
				currentStep: 2,
				totalSteps: 2
			};
			// Use hard navigation to ensure full page reload (same as ProjectListModal)
			window.location.href = `/${result.projectId}`;
		} catch (err) {
			console.error('[Studio] Import failed:', err);
			importing = false;
			importProgress = null;
			alert(err instanceof Error ? err.message : 'Import failed');
		}
	}

	/** Shared post-commit logic: flush local stores and update project metadata */
	async function finalizeAfterCommit(newCommit: string, projectName: string) {
		await nodeStore.flush();
		await layoutStore.flush();
		await saveEdges(edges, currentProjectId);

		const existingProject = await getProject(currentProjectId);
		await saveProject({
			...existingProject,
			id: currentProjectId,
			name: projectName,
			artifactId: currentProjectId,
			createdAt: existingProject?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
			isDraft: false,
			lastCloudCommit: newCommit
		});

		// Commit all VFS changes locally so isDirty resets
		const vfsNodes = nodes.filter(n => n.data.type === 'VFS');
		console.log('[Studio] finalizeAfterCommit: VFS nodes to commit:', vfsNodes.length);
		for (const node of vfsNodes) {
			try {
				const vfs = await getNodeVfs(currentProjectId, node.id);
				const status = await vfs.getStatus();
				console.log(`[Studio] VFS node ${node.id}: status entries=${status.length}, isDirty=${vfs.isDirty}`);
				if (status.length > 0) {
					await vfs.commit(`Published ${newCommit}`);
					console.log(`[Studio] VFS node ${node.id}: committed, isDirty now=${vfs.isDirty}`);
				}
			} catch (err) {
				console.warn(`[Studio] Failed to commit VFS node ${node.id} after publish:`, err);
			}
		}

		publishState.markPublished(newCommit);
	}

	/** First-time publish (POST) for draft artifacts */
	async function handlePublish(
		metadata: PublishMetadata,
		nodesToPublish: Node<FlowNodeData>[],
		edgesToPublish: Edge[],
		buildCacheKey?: string
	) {
		const result = await publishArtifact(metadata, nodesToPublish, edgesToPublish, buildCacheKey);
		if (!result.success || !result.latestCommit) {
			throw new Error(result.error || 'Failed to publish');
		}

		await finalizeAfterCommit(result.latestCommit, metadata.name);
		projectName = metadata.name;

		// Keep draft sync in sync with published state
		initialModificationCount = nodeStore.modificationCount;
		if (syncService?.state.enabled) {
			await handleSync();
		}
	}

	/** Incremental update (PATCH) for already-published artifacts */
	async function handleUpdate(
		metadata: UpdateMetadata,
		nodesToPublish: Node<FlowNodeData>[],
		edgesToPublish: Edge[],
		buildCacheKey?: string
	) {
		let baseCommit = publishState.state.lastCloudCommit;

		// Recover from missing local commit (e.g. IndexedDB write lost due to navigation race)
		if (!baseCommit) {
			console.warn('[Studio] lastCloudCommit missing locally, fetching latest from server...');
			const { data } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: { path: { artifactId: currentProjectId }, query: { version: 'latest' } },
			});
			baseCommit = data?.version?.commitHash;
			if (baseCommit) {
				console.log('[Studio] Recovered baseCommit from server:', baseCommit);
				publishState.markPublished(baseCommit);
			} else {
				throw new Error('No base commit for update. Please try a full publish instead.');
			}
		}

		const patchMeta: PatchMetadata = {
			artifactId: currentProjectId,
			baseCommit,
			version: metadata.version,
			commitTags: ['draft-latest'],
			entrypoint: metadata.entrypoint,
			saveData: metadata.saveData,
		};

		const patchResult = await patchArtifact(patchMeta, nodesToPublish, edgesToPublish, buildCacheKey);
		if (!patchResult.success || !patchResult.newCommit) {
			throw new Error(patchResult.error || 'Failed to update artifact');
		}

		if (!patchResult.hasGraphChanges && metadata.entrypoint) {
			// No graph changes but entrypoint needs updating on existing version
			await apiClient.PUT('/artifacts/{artifactId}/versions/{commitHash}/metadata', {
				params: { path: { artifactId: currentProjectId, commitHash: patchResult.newCommit } },
				body: {
					entrypoint: metadata.entrypoint,
				},
			});
		}

		await finalizeAfterCommit(patchResult.newCommit, metadata.name);

		// Always sync all metadata to server (idempotent)
		await apiClient.PUT('/artifacts/{artifactId}/metadata', {
			params: { path: { artifactId: currentProjectId } },
			body: {
				name: metadata.name,
				description: metadata.description,
				isListed: metadata.isListed,
				isPrivate: metadata.isPrivate,
				tags: metadata.tags,
				thumbnailUrl: metadata.thumbnailUrl,
			},
		});

		projectName = metadata.name;

		// Keep draft sync in sync with published state
		initialModificationCount = nodeStore.modificationCount;
		if (syncService?.state.enabled) {
			await handleSync();
		}
	}

	
</script>

<svelte:window onclick={() => contextMenu && closeContextMenu()} />

<div class="h-screen w-full relative flex">
	<!-- Import Loading Overlay -->
	{#if importing}
		<div class="fixed inset-0 bg-black/60 flex items-center justify-center z-9999 backdrop-blur-sm">
			<div class="bg-white rounded-2xl shadow-2xl p-10 max-w-lg w-full mx-4">
				<!-- Header with spinner -->
				<div class="flex items-center gap-4 mb-6">
					<div class="shrink-0">
						<svg class="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					</div>
					<div>
						<h3 class="text-xl font-semibold text-gray-900">
							{m.studio_import_title()}
						</h3>
						{#if importProgress?.artifactId}
							<p class="text-sm text-gray-500 font-mono mt-0.5">
								{importProgress.artifactId.substring(0, 8)}...
							</p>
						{/if}
					</div>
				</div>
				
				<!-- Progress bar -->
				{#if importProgress?.currentStep && importProgress?.totalSteps}
					<div class="mb-6">
						<div class="flex justify-between text-xs text-gray-500 mb-1.5">
							<span>{m.studio_import_step({ current: importProgress.currentStep, total: importProgress.totalSteps })}</span>
							<span>{Math.round((importProgress.currentStep / importProgress.totalSteps) * 100)}%</span>
						</div>
						<div class="w-full bg-gray-200 rounded-full h-2">
							<div 
								class="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
								style="width: {(importProgress.currentStep / importProgress.totalSteps) * 100}%"
							></div>
						</div>
					</div>
				{/if}
				
				<!-- Progress steps -->
				<div class="space-y-3">
					<!-- Step 1: Fetching -->
					<div class="flex items-center gap-3 {importProgress?.phase === 'fetching' ? 'text-blue-600' : importProgress?.currentStep && importProgress.currentStep > 1 ? 'text-green-600' : 'text-gray-400'}">
						{#if importProgress?.currentStep && importProgress.currentStep > 1}
							<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
						{:else if importProgress?.phase === 'fetching'}
							<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
						{:else}
							<div class="w-5 h-5 rounded-full border-2 border-current"></div>
						{/if}
						<span class="text-sm font-medium">{m.studio_import_step_fetching()}</span>
					</div>
					
					<!-- Step 2: Processing -->
					<div class="flex items-center gap-3 {importProgress?.phase === 'processing' ? 'text-blue-600' : importProgress?.currentStep && importProgress.currentStep > 2 ? 'text-green-600' : 'text-gray-400'}">
						{#if importProgress?.currentStep && importProgress.currentStep > 2}
							<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
						{:else if importProgress?.phase === 'processing'}
							<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
						{:else}
							<div class="w-5 h-5 rounded-full border-2 border-current"></div>
						{/if}
						<span class="text-sm font-medium">{m.studio_import_step_processing()}</span>
						{#if importProgress?.nodeCount !== undefined && importProgress.phase !== 'fetching'}
							<span class="text-xs text-gray-500">({importProgress.nodeCount} {m.studio_import_nodes()}, {importProgress.edgeCount ?? 0} {m.studio_import_edges()})</span>
						{/if}
					</div>
					
					<!-- Step 3: Adding -->
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-3 {importProgress?.phase === 'adding' ? 'text-blue-600' : importProgress?.currentStep && importProgress.currentStep > 3 ? 'text-green-600' : 'text-gray-400'}">
							{#if importProgress?.currentStep && importProgress.currentStep > 3}
								<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
							{:else if importProgress?.phase === 'adding'}
								<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
							{:else}
								<div class="w-5 h-5 rounded-full border-2 border-current"></div>
							{/if}
							<span class="text-sm font-medium">{m.studio_import_step_adding()}</span>
						</div>
						
						<!-- Sub-progress for Adding phase -->
						{#if importProgress?.phase === 'adding' && importProgress?.subPhase}
							<div class="ml-8 space-y-1.5">
								<!-- Sub-phase label -->
								<div class="flex items-center gap-2 text-xs text-gray-600">
									{#if importProgress.subPhase === 'downloading-vfs'}
										<span>{m.studio_import_downloading_vfs()}</span>
									{:else if importProgress.subPhase === 'writing-vfs'}
										<span>{m.studio_import_writing_vfs()}</span>
									{:else if importProgress.subPhase === 'processing-nodes'}
										<span>{m.studio_import_processing_nodes()}</span>
									{:else if importProgress.subPhase === 'saving'}
										<span>{m.studio_import_saving()}</span>
									{/if}
									{#if importProgress.subDetail}
										<span class="text-gray-400">• {importProgress.subDetail}</span>
									{/if}
								</div>
								
								<!-- Sub-progress bar -->
								{#if importProgress.subTotal && importProgress.subTotal > 0}
									<div class="flex items-center gap-2">
										<div class="flex-1 bg-gray-200 rounded-full h-1.5">
											<div 
												class="bg-blue-400 h-1.5 rounded-full transition-all duration-150 ease-out"
												style="width: {((importProgress.subCurrent ?? 0) / importProgress.subTotal) * 100}%"
											></div>
										</div>
										<span class="text-xs text-gray-500 w-12 text-right">{importProgress.subCurrent ?? 0}/{importProgress.subTotal}</span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
					
					<!-- Step 4: Refreshing -->
					<div class="flex items-center gap-3 {importProgress?.phase === 'refreshing' ? 'text-blue-600' : 'text-gray-400'}">
						{#if importProgress?.phase === 'refreshing'}
							<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
						{:else}
							<div class="w-5 h-5 rounded-full border-2 border-current"></div>
						{/if}
						<span class="text-sm font-medium">{m.studio_import_step_refreshing()}</span>
					</div>
				</div>
			</div>
		</div>
	{/if}
	
	<!-- Flow Editor (Expert Mode) / World Editor (Simple Mode) -->
	{#if !loaded}
		<div class="flex-1 h-full flex items-center justify-center">
			<span class="text-sm text-muted-foreground">Loading…</span>
		</div>
	{:else if editorMode === 'expert'}
		<div class="flex-1 h-full relative">
			<SvelteFlow 
				bind:nodes 
				bind:edges
				{nodeTypes} 
				fitView
				selectionOnDrag={!isTouchDevice}
				deleteKey="Delete"
				selectionMode={SelectionMode.Partial}
				panOnDrag={isTouchDevice ? true : [1]}
				multiSelectionKey="Shift"
				{isValidConnection}
				proOptions={{hideAttribution: true}}
				onselectionchange={(e) => selectedNodes = e.nodes}
				onnodecontextmenu={(e) => handleNodeContextMenu(e.event, e.node.id)}
				onpanecontextmenu={(e) => handlePaneContextMenu(e.event)}
				onconnect={(connection) => handleConnect(connection)}
				onconnectend={(event, connectionState) => handleConnectEnd(event, connectionState)}
				onbeforedelete={handleBeforeDelete}
				ondelete={handleDelete}
				onnodedragstop={handleNodeDragStop}
				onselectiondragstop={handleSelectionDragStop}
			>
				<FlowController onInit={(flow) => flowApi = flow} />
				<Background />
				<Controls />
			</SvelteFlow>
		</div>
	{:else}
		<!-- World Editor (Simple Mode) -->
		{#await ensureSimpleBridge(currentProjectId)}
			<div class="flex-1 h-full flex items-center justify-center">
				<span class="text-sm text-muted-foreground">Initializing world editor…</span>
			</div>
		{:then tripleStore}
			<WorldEditor projectId={currentProjectId} store={tripleStore} bind:copilotCollapsed={copilotCollapsed} />
		{:catch err}
			<div class="flex-1 h-full flex items-center justify-center text-destructive">
				<span class="text-sm">Failed to initialize: {err?.message ?? err}</span>
			</div>
		{/await}
	{/if}
	
	<!-- Studio Sidebar (Left) - Outside SvelteFlow to avoid pointer event conflicts -->
	<StudioSidebar
		{nodes}
		{edges}
		{selectedNodes}
		projectId={currentProjectId}
		{projectName}
		{publishState}
		isAuthenticated={auth.isAuthenticated}
		onFocusNode={handleFocusNode}
		onPublish={handlePublish}
		onUpdate={handleUpdate}
		onOpenVfsFile={handleOpenVfsFile}
		onNewProject={handleNewProject}
		onExport={handleExport}
		onImport={handleImport}
		{syncState}
		onSync={handleSync}
		onEnableSync={handleEnableSync}
		onAcceptCloud={handleAcceptCloud}
		onForcePushLocal={handleForcePushLocal}
		{selectedEntrypoint}
		onEntrypointChange={async (id) => {
			selectedEntrypoint = id;
			const project = await getProject(currentProjectId);
			if (project) {
				await saveProject({ ...project, selectedEntrypoint: id, updatedAt: Date.now() });
			}
		}}
		copilotOpen={!copilotCollapsed}
		onCopilotToggle={() => copilotCollapsed = !copilotCollapsed}
		{editorMode}
		onModeChange={(mode) => persistedEditorMode.value = mode}
		onNameChange={async (name) => {
			projectName = name;
			const project = await getProject(currentProjectId);
			if (project) {
				await saveProject({ ...project, name, updatedAt: Date.now() });
			}
		}}
	/>

	<!-- VFS File Editor (Right side floating panel) -->
	{#if vfsEditorState}
		<VFSFileEditor
			vfs={vfsEditorState.vfs}
			nodeId={vfsEditorState.nodeId}
			filePath={vfsEditorState.filePath}
			onClose={handleCloseVfsEditor}
		/>
	{/if}
	
	<!-- Copilot Panel (Right side chat panel) — Expert mode only -->
	{#if editorMode === 'expert'}
		<CopilotPanel projectId={currentProjectId} bind:collapsed={copilotCollapsed} hideCollapsedButton={true} />
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
	
	<!-- PubWiki Confirmation Dialog (global, Portal rendered) -->
	{#if pendingConfirmation}
		<PubWikiConfirmDialog
			type={pendingConfirmation.type}
			FormComponent={pendingConfirmation.formComponent}
			initialValues={pendingConfirmation.initialValues}
			onConfirm={(editedValues) => respondConfirmation(editedValues)}
			onCancel={() => respondConfirmation(null)}
		/>
	{/if}
	
	<!-- VFS Delete Confirmation Dialog -->
	<VfsDeleteConfirmDialog />
</div>

<style>
	:global(.svelte-flow__selection-wrapper) {
		display: none;
	}
</style>