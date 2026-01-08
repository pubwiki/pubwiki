<script lang="ts">
	/**
	 * LoaderNode - Lua VM service provider node
	 * 
	 * Features:
	 * - Backend VFS handle for init.lua and service implementations
	 * - Dynamic mountpoint handles for asset VFS
	 * - Auto-loads when backend VFS is connected
	 * - Displays registered services list
	 * - Service output handle for connecting to Sandbox nodes
	 */
	import { Handle, Position, useEdges, useUpdateNodeInternals } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { LoaderNodeData, VFSNodeData, StateNodeData } from '../../../types';
	import { getStudioContext } from '../../../state';
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import { getNodeVfs } from '../../../vfs';
	import { getNodeRDFStore } from '../../../rdf';
	import BaseNode from '../BaseNode.svelte';
	import TaggedHandlePanel, { type TaggedHandle, type HandleColorScheme } from '../TaggedHandlePanel.svelte';
	import * as m from '$lib/paraglide/messages';
	import { 
		HandleId,
		createLoaderMountpointHandleId, 
		isLoaderMountpointHandle, 
		getLoaderMountpointId 
	} from '../../../graph';
	import { 
		getEditingMountpoint, 
		setEditingMountpoint, 
		updateMountpointPath,
		validateMountpointPath,
		initializeLoader,
		destroyLoader,
		findBackendVfsNode,
		findMountedVfsNodes,
		findStateNode
	} from './controller.svelte';
	import type { Vfs, VfsProvider } from '@pubwiki/vfs';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<LoaderNodeData, 'loader'>> = $props();
	const ctx = getStudioContext();
	const settings = getSettingsStore();
	const allEdges = useEdges();
	const updateNodeInternals = useUpdateNodeInternals();

	// ============================================================================
	// Color Schemes
	// ============================================================================

	const BACKEND_CONNECTED: HandleColorScheme = {
		bg: '#eef2ff',
		border: '#818cf8',
		text: 'text-indigo-600',
		handle: 'bg-indigo-500'
	};

	const BACKEND_DISCONNECTED: HandleColorScheme = {
		bg: '#f5f3ff',
		border: '#c7d2fe',
		text: 'text-indigo-400',
		handle: 'bg-indigo-300'
	};

	const MOUNT_TAG_CONNECTED: HandleColorScheme = {
		bg: '#eef2ff',
		border: '#a5b4fc',
		text: 'text-indigo-600',
		handle: 'bg-indigo-500'
	};

	const MOUNT_TAG_DISCONNECTED: HandleColorScheme = {
		bg: '#f5f3ff',
		border: '#c7d2fe',
		text: 'text-indigo-400',
		handle: 'bg-indigo-300'
	};

	const ADD_MOUNT_COLOR: HandleColorScheme = {
		bg: '#e0e7ff',
		border: '#a5b4fc',
		text: 'text-indigo-500',
		handle: 'bg-indigo-400'
	};

	const STATE_CONNECTED: HandleColorScheme = {
		bg: '#ccfbf1',
		border: '#14b8a6',
		text: 'text-teal-700',
		handle: 'bg-teal-600'
	};

	const STATE_DISCONNECTED: HandleColorScheme = {
		bg: '#ccfbf1',
		border: '#2dd4bf',
		text: 'text-teal-600',
		handle: 'bg-teal-500'
	};

	// ============================================================================
	// Derived
	// ============================================================================

	/** Check if backend VFS is connected */
	const backendConnected = $derived(
		allEdges.current.some(
			e => e.target === id && e.targetHandle === HandleId.LOADER_BACKEND
		)
	);

	/** Check if State node is connected */
	const stateConnected = $derived(
		allEdges.current.some(
			e => e.target === id && e.targetHandle === HandleId.LOADER_STATE
		)
	);

	/** Map of mountpoint ID -> source node ID */
	const mountpointConnections = $derived.by(() => {
		return new Map(
			allEdges.current
				.filter(e => e.target === id && isLoaderMountpointHandle(e.targetHandle))
				.map(e => [getLoaderMountpointId(e.targetHandle!), e.source])
		);
	});

	/** Check if we're editing a mountpoint on this node */
	const editingMountpointId = $derived.by(() => {
		const editing = getEditingMountpoint();
		return editing?.nodeId === id ? editing.mountpointId : null;
	});

	/** Backend handle definition */
	const backendHandle = $derived<TaggedHandle>({
		id: HandleId.LOADER_BACKEND,
		label: 'backend',
		isConnected: backendConnected,
		connectedColor: BACKEND_CONNECTED,
		disconnectedColor: BACKEND_DISCONNECTED
	});

	/** State handle definition */
	const stateHandle = $derived<TaggedHandle>({
		id: HandleId.LOADER_STATE,
		label: 'state',
		isConnected: stateConnected,
		connectedColor: STATE_CONNECTED,
		disconnectedColor: STATE_DISCONNECTED
	});

	/** Mountpoint handles from data.content.mountpoints */
	const mountpointHandles = $derived.by(() => {
		const mounts = data.content.mountpoints ?? [];
		return mounts.map((mp): TaggedHandle => ({
			id: createLoaderMountpointHandleId(mp.id),
			label: mp.path,
			isConnected: mountpointConnections.has(mp.id),
			connectedColor: MOUNT_TAG_CONNECTED,
			disconnectedColor: MOUNT_TAG_DISCONNECTED,
			isEditing: mp.id === editingMountpointId,
			editable: true,
			data: { mountpointId: mp.id }
		}));
	});

	/** All left handles */
	const allHandles = $derived([backendHandle, stateHandle, ...mountpointHandles]);

	/** Whether there's an error */
	const hasError = $derived(data.error !== null);

	/** Whether the loader is ready (has registered services) */
	const isReady = $derived(data.registeredServices.length > 0);

	// ============================================================================
	// Local State
	// ============================================================================

	/** Prevent multiple load attempts */
	let isLoading = $state(false);

	/** Track whether a reload is in progress (to show loading UI while keeping old data) */
	let isReloading = $state(false);

	/** Track whether load has been attempted (prevents infinite loop when services is empty) */
	let hasLoaded = $state(false);

	/** Track connected VFS and State nodes to detect changes */
	let lastConnectedIds = $state<string>('');

	// ============================================================================
	// Effects
	// ============================================================================

	$effect(() => {
		// Update node internals when mountpoints change
		data.mountpoints;
		updateNodeInternals(id);
	});

	// Auto-load when backend is connected and not already loaded
	$effect(() => {
		if (backendConnected && !hasLoaded && !hasError) {
			handleLoad();
		}
	});

	// Reload when VFS or State connections change
	$effect(() => {
		// Build a string of all connected node IDs (VFS + State)
		const backendVfsId = allEdges.current.find(
			e => e.target === id && e.targetHandle === HandleId.LOADER_BACKEND
		)?.source ?? '';
		
		const stateNodeId = allEdges.current.find(
			e => e.target === id && e.targetHandle === HandleId.LOADER_STATE
		)?.source ?? '';
		
		const mountVfsIds = Array.from(mountpointConnections.values()).sort().join(',');
		const currentIds = `${backendVfsId}|${stateNodeId}|${mountVfsIds}`;
		
		// If connections changed and we have previously loaded
		if (lastConnectedIds && currentIds !== lastConnectedIds && hasLoaded) {
			if (backendConnected) {
				// Backend still connected, reload with new connections
				handleReload();
			} else {
				// Backend disconnected, destroy the loader and clear state
				destroyLoader(id, (nodeId, updater) => {
					ctx.updateNode(nodeId, (nodeData) => {
						if (nodeData.type === 'LOADER') {
							return updater(nodeData as LoaderNodeData);
						}
						return nodeData;
					});
				});
				hasLoaded = false;
			}
		}
		lastConnectedIds = currentIds;
	});

	// ============================================================================
	// Event Handlers
	// ============================================================================

	function handleMountpointLabelChange(handleId: string, _oldLabel: string, newLabel: string, handleData?: Record<string, unknown>) {
		let validPath = newLabel.trim();
		if (!validPath.startsWith('/')) {
			validPath = '/' + validPath;
		}
		
		const mountpointId = handleData?.mountpointId as string | undefined;
		if (!mountpointId) {
			console.warn('Missing mountpointId in handle data');
			return;
		}
		
		updateMountpointPath(
			id,
			mountpointId,
			validPath,
			ctx.updateNodes
		);
	}

	function handleMountpointEditComplete(_handleId: string) {
		setEditingMountpoint(null);
	}
	
	function handleMountpointValidation(_handleId: string, label: string, handleData?: Record<string, unknown>): string | null {
		const existingMountpoints = data.content.mountpoints ?? [];
		const currentMountpointId = handleData?.mountpointId as string | undefined;
		return validateMountpointPath(label, existingMountpoints, currentMountpointId);
	}

	function handleMountpointStartEdit(_handleId: string, handleData?: Record<string, unknown>) {
		const mountpointId = handleData?.mountpointId as string | undefined;
		if (mountpointId) {
			setEditingMountpoint({ nodeId: id, mountpointId });
		}
	}

	async function handleLoad() {
		if (isLoading || hasLoaded) return;
		
		isLoading = true;
		hasLoaded = true;
		
		try {
			// Find backend VFS
			const backendVfsNode = findBackendVfsNode(id, ctx.nodes, ctx.edges);
			if (!backendVfsNode) {
				console.error('No backend VFS connected');
				return;
			}
			
			// Get backend VFS instance
			const backendVfsData = backendVfsNode.data as VFSNodeData;
			const backendVfs = await getNodeVfs(backendVfsData.content.projectId, backendVfsNode.id);
			
			// Find mounted asset VFS nodes
			const mountedVfsNodes = findMountedVfsNodes(id, ctx.nodes, ctx.edges);
			const assetMounts = new Map<string, Vfs<VfsProvider>>();
			
			for (const [path, vfsNode] of mountedVfsNodes) {
				const vfsData = vfsNode.data as VFSNodeData;
				const vfs = await getNodeVfs(vfsData.content.projectId, vfsNode.id);
				assetMounts.set(path, vfs);
			}
			
			// Find State node and get RDF store (if connected)
			const stateNode = findStateNode(id, ctx.nodes, ctx.edges);
			const rdfStore = stateNode ? await getNodeRDFStore(stateNode.id) : undefined;
			
			// Get LLM config from settings
			const llmConfig = settings.api.apiKey && settings.api.selectedModel ? {
				apiKey: settings.api.apiKey,
				model: settings.api.selectedModel,
				baseUrl: settings.effectiveBaseUrl
			} : undefined;
			
			// Initialize loader
			await initializeLoader(
				id,
				backendVfs,
				assetMounts,
				rdfStore,
				llmConfig,
				(nodeId, updater) => {
					ctx.updateNode(nodeId, (nodeData) => {
						if (nodeData.type === 'LOADER') {
							return updater(nodeData as LoaderNodeData);
						}
						return nodeData;
					});
				}
			);
		} finally {
			isLoading = false;
		}
	}

	async function handleReload() {
		// Set reloading state - keep old data visible during reload
		isReloading = true;
		
		// Clear error state only
		ctx.updateNode(id, (nodeData) => {
			if (nodeData.type === 'LOADER') {
				return { ...nodeData, error: null } as LoaderNodeData;
			}
			return nodeData;
		});
		
		// Reset loading state and trigger reload
		isLoading = false;
		hasLoaded = false;
		try {
			await handleLoad();
		} finally {
			isReloading = false;
		}
	}
</script>

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="LOADER"
	headerBgClass="bg-purple-500"
	handleBgClass="bg-purple-400!"
	showLeftHandle={false}
	showRightHandle={false}
>
	{#snippet leftHandles()}
		<TaggedHandlePanel
			handles={allHandles}
			{isConnectable}
			handleType="target"
			position="left"
			nodeOverlap={24}
			addHandle={{
				id: HandleId.LOADER_ADD_MOUNT,
				label: 'mount',
				color: ADD_MOUNT_COLOR
			}}
			onLabelChange={handleMountpointLabelChange}
			onEditComplete={handleMountpointEditComplete}
			validateLabel={handleMountpointValidation}
			onStartEdit={handleMountpointStartEdit}
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if isReady}
			<span class="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
				✓ Ready
			</span>
		{:else if hasError}
			<span class="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">
				✕ Error
			</span>
		{:else if !backendConnected}
			<span class="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
				⏸ Idle
			</span>
		{/if}
	{/snippet}

	{#snippet children()}
		<div class="p-3 bg-gray-50 space-y-3 min-w-50 min-h-24 flex flex-col {!backendConnected ? 'justify-center items-center' : ''}">
			<!-- Status Display -->
			<div class="flex items-center">
				{#if isReady}
					<div class="flex items-center gap-1.5 text-green-600">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						<span class="text-sm font-medium">{data.registeredServices.length} services</span>
					</div>
				{:else if hasError}
					<div class="text-sm text-red-500">Load failed</div>
				{:else if !backendConnected}
					<div class="text-sm text-gray-500">Connect backend VFS</div>
				{/if}
			</div>

			<!-- Registered Services List -->
			{#if isReady && data.registeredServices.length > 0}
				<div class="border-t border-gray-200 pt-2">
					<div class="text-xs font-medium text-gray-500 mb-1.5">Registered Services</div>
					<div class="space-y-1 max-h-32 overflow-y-auto">
						{#each data.registeredServices as service}
							<div class="flex items-center gap-1.5 text-xs">
								<span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
								<span class="font-mono text-gray-700">{service}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Error Display -->
			{#if hasError && data.error}
				<div class="space-y-2">
					<div class="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
						<svg class="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<p class="text-xs text-red-700 break-all">{data.error}</p>
					</div>
					<button
						class="nodrag w-full px-3 py-1.5 text-xs font-medium bg-purple-500 text-white hover:bg-purple-600 rounded transition-colors disabled:opacity-50"
						onclick={handleReload}
						disabled={isLoading}
					>
						{isLoading ? 'Loading...' : 'Reload'}
					</button>
				</div>
			{/if}
		</div>
	{/snippet}

	{#snippet rightHandles()}
		<!-- Output Handle -->
		<Handle
			type="source"
			position={Position.Right}
			id={HandleId.LOADER_OUTPUT}
			{isConnectable}
			class="w-3! h-3! bg-purple-500! border-2! border-white!"
		/>
	{/snippet}
</BaseNode>

<style>
	/* Override xyflow default node wrapper styles */
	:global(.svelte-flow__node-loader) {
		background: transparent !important;
		border: none !important;
		padding: 0 !important;
		border-radius: 0 !important;
		width: auto !important;
		box-shadow: none !important;
		outline: none !important;
	}
	
	:global(.svelte-flow__node-loader.selected) {
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
		outline: none !important;
	}
</style>
