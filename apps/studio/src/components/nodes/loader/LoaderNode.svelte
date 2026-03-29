<script lang="ts">
	/**
	 * LoaderNode - Lua VM service provider node
	 * 
	 * Features:
	 * - Backend VFS handle for init.lua and service implementations
	 * - Asset VFS handle for mounting additional VFS nodes
	 * - Auto-loads when backend VFS is connected
	 * - Displays registered services list
	 * - Service output handle for connecting to Sandbox nodes
	 * 
	 * Runtime state (error, registeredServices) is managed locally,
	 * not persisted to nodeStore.
	 */
	import { Handle, Position, useEdges, useUpdateNodeInternals } from '@xyflow/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { LoaderNodeData, FlowNodeData, VFSContent } from '$lib/types';
	import { getStudioContext } from '$lib/state';
	import { getSettingsStore, useAuth } from '@pubwiki/ui/stores';
	import { getNodeVfs } from '$lib/vfs';
	import { getNodeRDFStore } from '$lib/rdf';
	import { nodeStore } from '$lib/persistence';
	import { validateNodeName } from '$lib/validation';
	import BaseNode from '../BaseNode.svelte';
	import TaggedHandlePanel from '../TaggedHandlePanel.svelte';
	import type { HandleColorScheme, TaggedHandle } from '../TaggedHandlePanel.svelte';
	import { HandleId } from '$lib/graph';
	import { 
		initializeLoader,
		destroyLoader,
		findBackendVfsNode,
		findMountedVfsNodes,
		findStateNode,
		onLoaderReload,
		getLoaderBackendType,
		generateDocs,
		type DocsGenerationCallbacks
	} from './controller.svelte';
	import { createApiClient } from '@pubwiki/api/client';
	import { API_BASE_URL } from '$lib/config';
	import {
		createSaveCheckpoint as flowCoreSaveCheckpoint,
		createSaveFromQuads as flowCoreSaveFromTriples,
		createSaveBatch as flowCoreSaveBatch,
		type PubWikiModuleConfig,
		type RuntimeGraph,
		type RuntimeNode,
		type RuntimeEdge,
	} from '@pubwiki/flow-core';
	import { getArtifactContext } from '$lib/gamesave';
	import { publishArtifact as studioPublishArtifact, type PublishMetadata } from '$lib/io/publish';
	import { requestConfirmation } from '$lib/state/pubwiki-confirm.svelte';
	import PublishForm from '$components/pubwiki/PublishForm.svelte';
	import UploadCheckpointForm from '$components/pubwiki/UploadCheckpointForm.svelte';
	import UploadCheckpointsForm from '$components/pubwiki/UploadCheckpointsForm.svelte';
	import UploadArticleForm from '$components/pubwiki/UploadArticleForm.svelte';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { isConnectable, selected, id }: NodeProps<Node<FlowNodeData, 'loader'>> = $props();
	const ctx = getStudioContext();
	const settings = getSettingsStore();
	const auth = useAuth();
	const allEdges = useEdges();
	const updateNodeInternals = useUpdateNodeInternals();

	// ============================================================================
	// Node Data (persistent)
	// ============================================================================

	const _nodeData = $derived(nodeStore.get(id) as LoaderNodeData | undefined);

	// ============================================================================
	// Runtime State (local, not persisted)
	// ============================================================================

	/** Error message from loader initialization */
	let error = $state<string | null>(null);
	
	/** Registered services after successful initialization */
	let registeredServices = $state<string[]>([]);
	
	/** Last reload/load timestamp for "reloaded xxx ago" display */
	let lastReloadTime = $state<number | null>(null);
	
	/** Formatted relative time string, updated every second */
	let relativeTimeStr = $state<string>('');

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

	/** Check if Docs VFS is connected */
	const hasDocsVfs = $derived(
		allEdges.current.some(
			e => e.source === id && e.sourceHandle === HandleId.LOADER_DOCS_OUTPUT
		)
	);

	/** Get the Docs VFS node ID if it exists */
	const docsVfsNodeId = $derived.by(() => {
		const edge = allEdges.current.find(
			e => e.source === id && e.sourceHandle === HandleId.LOADER_DOCS_OUTPUT
		);
		return edge?.target;
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

	/** All left handles */
	const allHandles = $derived([backendHandle, stateHandle]);

	/** Whether there's an error */
	const hasError = $derived(error !== null);

	/** Whether the loader is ready (has registered services) */
	const isReady = $derived(registeredServices.length > 0);

	// ============================================================================
	// Local State
	// ============================================================================

	/** Prevent multiple load attempts */
	let isLoading = $state(false);

	/** Track whether a reload is in progress (to show loading UI while keeping old data) */
	let isReloading = $state(false);

	/** Track whether docs generation is in progress */
	let isGeneratingDocs = $state(false);

	/** Track whether load has been attempted (prevents infinite loop when services is empty) */
	let hasLoaded = $state(false);

	/** Track connected VFS and State nodes to detect changes */
	let lastConnectedIds = $state<string>('');

	// ============================================================================
	// Effects
	// ============================================================================

	// Auto-load when backend is connected and not already loaded
	$effect(() => {
		if (backendConnected && !hasLoaded && !hasError) {
			handleLoad();
		}
	});

	// Update relative time string every second
	$effect(() => {
		if (!lastReloadTime) {
			relativeTimeStr = '';
			return;
		}
		
		function updateRelativeTime() {
			if (!lastReloadTime) return;
			const minutes = Math.floor((Date.now() - lastReloadTime) / 60000);
			if (minutes < 1) {
				relativeTimeStr = 'less than a minute ago';
			} else if (minutes < 60) {
				relativeTimeStr = `${minutes}m ago`;
			} else {
				relativeTimeStr = `${Math.floor(minutes / 60)}h ago`;
			}
		}
		
		updateRelativeTime();
		const interval = setInterval(updateRelativeTime, 60000);
		return () => clearInterval(interval);
	});

	// Subscribe to hot reload events
	$effect(() => {
		// Only subscribe when we have successfully loaded
		if (!hasLoaded) return;
		
		const unsubscribe = onLoaderReload(id, (result) => {
			console.log(`[LoaderNode] Hot reload complete for ${id}:`, result);
			error = result.error;
			registeredServices = result.services;
			if (result.success) {
				lastReloadTime = Date.now();
			}
		});
		
		return unsubscribe;
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
		
		// Asset VFS connections are now managed via the LOADER_ASSET_VFS handle
		const assetVfsId = allEdges.current.find(
			e => e.target === id && e.targetHandle === HandleId.LOADER_ASSET_VFS
		)?.source ?? '';
		const currentIds = `${backendVfsId}|${stateNodeId}|${assetVfsId}`;
		
		// If connections changed and we have previously loaded
		if (lastConnectedIds && currentIds !== lastConnectedIds && hasLoaded) {
			if (backendConnected) {
				// Backend still connected, reload with new connections
				handleReload();
			} else {
				// Backend disconnected, destroy the loader and clear state
				destroyLoader(id);
				error = null;
				registeredServices = [];
				hasLoaded = false;
			}
		}
		lastConnectedIds = currentIds;
	});

	// ============================================================================
	// Event Handlers
	// ============================================================================

	async function handleLoad() {
		if (isLoading || hasLoaded) return;
		
		isLoading = true;
		hasLoaded = true;
		
		try {
			// Find backend VFS
			const backendVfsNodeId = findBackendVfsNode(id, ctx.nodes, ctx.edges);
			if (!backendVfsNodeId) {
				error = 'No backend VFS connected';
				return;
			}
			
			// Get backend VFS instance using nodeStore
			const backendVfsData = nodeStore.get(backendVfsNodeId);
			if (!backendVfsData || backendVfsData.type !== 'VFS') {
				error = 'Backend VFS node data not found';
				return;
			}
			const backendVfsContent = backendVfsData.content as VFSContent;
			const backendVfs = await getNodeVfs(backendVfsContent.projectId, backendVfsNodeId);
			
			// Find mounted asset VFS nodes
			const mountedVfsNodeIds = findMountedVfsNodes(id, ctx.nodes, ctx.edges);
			const assetMounts = new SvelteMap<string, Awaited<ReturnType<typeof getNodeVfs>>>();
			
			for (const [path, vfsNodeId] of mountedVfsNodeIds) {
				const vfsData = nodeStore.get(vfsNodeId);
				if (!vfsData || vfsData.type !== 'VFS') continue;
				const vfsContent = vfsData.content as VFSContent;
				const vfs = await getNodeVfs(vfsContent.projectId, vfsNodeId);
				assetMounts.set(path, vfs);
			}
			
			// Find State node and get RDF store (if connected)
			const stateNodeId = findStateNode(id, ctx.nodes, ctx.edges);
			const rdfStore = stateNodeId ? await getNodeRDFStore(stateNodeId) : undefined;

			
			// Get LLM config from settings (narrative role as base config)
			const narrativeConfig = settings.getLLMConfigForRole('narrative');
			const llmConfig = narrativeConfig.apiKey && narrativeConfig.model ? narrativeConfig : undefined;
			const roleConfigs = Object.fromEntries(
				(['narrative', 'recall', 'updater', 'designer'] as const).map(
					role => [role, settings.getLLMConfigForRole(role)]
				)
			);
			
			// Create PubWiki module config (flow-core's unified module)
			const formComponents: Record<string, typeof PublishForm> = {
				publish: PublishForm,
				uploadCheckpoint: UploadCheckpointForm,
				uploadCheckpoints: UploadCheckpointsForm,
				uploadArticle: UploadArticleForm,
			};
			const pubwikiConfig: PubWikiModuleConfig = {
				getGraph: (): RuntimeGraph => {
					// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local variable in callback
					const runtimeNodes = new Map<string, RuntimeNode>();
					for (const n of ctx.nodes) {
						runtimeNodes.set(n.id, {
							id: n.id,
							type: n.data.type,
							name: '',
							content: {} as never,
							commit: '',
							contentHash: '',
						});
					}
					const runtimeEdges: RuntimeEdge[] = ctx.edges.map(e => ({
						source: e.source,
						target: e.target,
						sourceHandle: e.sourceHandle ?? '',
						targetHandle: e.targetHandle ?? '',
					}));
					return { nodes: runtimeNodes, edges: runtimeEdges, entrypoint: null, buildCacheKey: null };
				},
				projectId: backendVfsContent.projectId,
				loaderNodeId: id,
				apiClient: createApiClient(`${API_BASE_URL}/api`),
				getCurrentUserId: () => auth.user?.id ?? null,
				confirmation: {
					async confirm(action, initialValues) {
						const FormComponent = formComponents[action];
						if (!FormComponent) return null;
						return requestConfirmation(
							action as 'publish' | 'uploadArticle' | 'uploadCheckpoint' | 'uploadCheckpoints',
							FormComponent,
							initialValues as Record<string, unknown>,
						) as Promise<typeof initialValues | null>;
					},
				},
				getArtifactContext: (projectId) => getArtifactContext(projectId),
				getRDFStore: async (nodeId) => getNodeRDFStore(nodeId),
				createSaveCheckpoint: (store, options) =>
					flowCoreSaveCheckpoint(store, options, API_BASE_URL),
				createSaveFromTriples: (triples, options) =>
					flowCoreSaveFromTriples(triples, options, API_BASE_URL),
				createSaveBatch: (entries, options) =>
					flowCoreSaveBatch(entries, options, API_BASE_URL),
				publishArtifact: async (metadata) => {
					const finalMetadata: PublishMetadata = {
						artifactId: crypto.randomUUID(),
						name: metadata.name,
						slug: metadata.slug,
						description: metadata.description || '',
						version: metadata.version || '1.0.0',
						isListed: metadata.isListed ?? true,
						isPrivate: metadata.isPrivate ?? false,
						tags: metadata.tags || [],
						homepage: metadata.homepage || undefined,							thumbnailUrl: metadata.thumbnailUrl || undefined,					};
					const result = await studioPublishArtifact(finalMetadata, ctx.nodes, ctx.edges);
					return {
						success: result.success,
						artifactId: result.artifactId,
						error: result.error,
					};
				},
			};
			
			// Initialize loader and get result
			const result = await initializeLoader(
				id,
				backendVfs,
				assetMounts,
				rdfStore,
				llmConfig,
				pubwikiConfig,
				stateNodeId ?? undefined,
				roleConfigs,
			);
			
			// Update local state with result
			error = result.error;
			registeredServices = result.services;
			if (result.success) {
				lastReloadTime = Date.now();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			registeredServices = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleReload() {
		// Set reloading state - keep old data visible during reload
		isReloading = true;
		
		// Clear error state only (keep services visible during reload)
		error = null;
		
		// Reset loading state and trigger reload
		isLoading = false;
		hasLoaded = false;
		try {
			await handleLoad();
		} finally {
			isReloading = false;
		}
	}

	async function handleGenerateDocs() {
		if (isGeneratingDocs) return;
		
		isGeneratingDocs = true;
		
		try {
			const callbacks: DocsGenerationCallbacks = {
				updateNodes: ctx.updateNodes,
				updateEdges: ctx.updateEdges
			};
			
			// Pass existing VFS node ID if regenerating
			const result = await generateDocs(id, callbacks, docsVfsNodeId);
			
			if (!result.success) {
				console.error('[LoaderNode] Failed to generate docs:', result.error);
				error = result.error ?? 'Failed to generate docs';
			} else {
				// Update node internals to show new handle
				updateNodeInternals(id);
			}
		} catch (e) {
			console.error('[LoaderNode] Error generating docs:', e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isGeneratingDocs = false;
		}
	}

	// Node name validation callback for BaseNode
	function handleValidateName(name: string, nodeId: string): string | null {
		return validateNodeName(name, nodeId);
	}
</script>

<BaseNode
	{id}
	{selected}
	{isConnectable}
	nodeType="LOADER"
	headerBgClass="bg-purple-500"
	handleBgClass="bg-purple-400!"
	showLeftHandle={false}
	showRightHandle={false}
	validateName={handleValidateName}
>
	{#snippet leftHandles()}
		<TaggedHandlePanel
			handles={allHandles}
			{isConnectable}
			handleType="target"
			position="left"
			nodeOverlap={24}
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if isReady}
			<span class="text-xs text-white/90 font-medium uppercase">
				{getLoaderBackendType(id) ?? 'unknown'}
			</span>
		{/if}
	{/snippet}

		<div class="p-3 bg-gray-50 space-y-3 min-w-50 min-h-24 flex flex-col {!backendConnected && !isLoading ? 'justify-center items-center' : ''}">
			<!-- Loading State -->
			{#if isLoading && !isReloading}
				<div class="flex flex-col items-center justify-center gap-2 py-4">
					<svg class="w-6 h-6 text-purple-500 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span class="text-xs text-gray-500">Loading backend...</span>
				</div>
			{:else}
				<!-- Status Display -->
				<div class="flex items-center justify-between">
					{#if isReady}
						<div class="flex items-center gap-1.5 text-green-600">
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
							</svg>
							<span class="text-sm font-medium">{registeredServices.length} services</span>
							{#if isReloading}
								<svg class="w-3 h-3 text-purple-500 animate-spin ml-1" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}
						</div>
						<!-- Generate Docs Button (or Regenerate if already exists) -->
						<button
							class="nodrag flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-colors disabled:opacity-50 {hasDocsVfs ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}"
							onclick={handleGenerateDocs}
							disabled={isGeneratingDocs}
							title={hasDocsVfs ? "Regenerate TypeScript type definitions and documentation" : "Generate TypeScript type definitions and documentation"}
						>
							{#if isGeneratingDocs}
								<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{:else if hasDocsVfs}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
							{:else}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							{/if}
							{hasDocsVfs ? 'Regen' : 'Docs'}
						</button>
					{:else if hasError}
						<div class="text-sm text-red-500">Load failed</div>
					{:else if !backendConnected}
						<div class="text-sm text-gray-500">Connect backend VFS</div>
					{/if}
				</div>

				<!-- Registered Services List -->
				{#if isReady && registeredServices.length > 0}
					<div class="border-t border-gray-200 pt-2">
						<div class="flex items-center justify-between mb-1.5">
							<span class="text-xs font-medium text-gray-500">Registered Services</span>
							{#if relativeTimeStr}
								<span class="text-xs text-gray-400">reloaded {relativeTimeStr}</span>
							{/if}
						</div>
						<div class="space-y-1 max-h-32 overflow-y-auto">
							{#each registeredServices as service (service)}
								<div class="flex items-center gap-1.5 text-xs">
									<span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
									<span class="font-mono text-gray-700">{service}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			<!-- Error Display -->
			{#if hasError && error}
				<div class="space-y-2">
					<div class="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
						<svg class="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<p class="text-xs text-red-700 break-all">{error}</p>
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

	{#snippet rightHandles()}
		<!-- Main Output Handle -->
		<Handle
			type="source"
			position={Position.Right}
			id={HandleId.LOADER_OUTPUT}
			{isConnectable}
			class="w-3! h-3! bg-purple-500! border-2! border-white!"
		/>
		<!-- Docs VFS Output Handle (shown only when docs VFS exists) -->
		{#if hasDocsVfs}
			<Handle
				type="source"
				position={Position.Right}
				id={HandleId.LOADER_DOCS_OUTPUT}
				{isConnectable}
				class="w-3! h-3! bg-blue-500! border-2! border-white!"
				style="top: 70%;"
			/>
		{/if}
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
