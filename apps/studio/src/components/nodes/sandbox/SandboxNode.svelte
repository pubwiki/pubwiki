<script lang="ts">
	/**
	 * SandboxNode - Sandbox preview node for VFS content
	 * 
	 * Features:
	 * - Accepts connection from VFS node (vfs-input handle)
	 * - Accepts connections from Loader nodes (service-input handle)
	 * - Detects project configuration from tsconfig.json
	 * - Opens floating preview panel on start
	 * - Uses BaseNode for consistent styling
	 * 
	 * Runtime state (error, isLoading, etc.) is managed locally,
	 * not persisted to nodeStore.
	 */
	import { Handle, Position, type NodeProps, type Node, useEdges, useSvelteFlow } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	import type { SandboxNodeData, VFSNodeData, LoaderNodeData, StudioNodeData, FlowNodeData } from '$lib/types';
	import { getNodeVfs, type VersionedVfs } from '$lib/vfs';
	import { getStudioContext } from '$lib/state';
	import { nodeStore } from '$lib/persistence';
	import { HandleId } from '$lib/graph';
	import BaseNode from '../BaseNode.svelte';
	import SandboxPreviewView from './SandboxPreviewView.svelte';
	import type { ProjectConfig } from '@pubwiki/sandbox-host';
	import { detectProject } from '@pubwiki/bundler';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { isConnectable, selected, id }: NodeProps<Node<FlowNodeData, 'sandbox'>> = $props();
	const ctx = getStudioContext();
	const allEdges = useEdges();
	const { fitView } = useSvelteFlow();

	// ============================================================================
	// Node Data
	// ============================================================================

	const nodeData = $derived(nodeStore.get(id) as SandboxNodeData | undefined);

	// ============================================================================
	// State
	// ============================================================================

	let vfs: VersionedVfs | null = $state(null);
	let projectConfig: ProjectConfig | null = $state(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let showPreview = $state(false);

	// ============================================================================
	// Derived
	// ============================================================================

	/**
	 * Find the connected VFS node ID by looking at incoming edges to vfs-input handle
	 */
	const connectedVfsNodeId = $derived.by(() => {
		const incomingEdges = allEdges.current.filter(e => 
			e.target === id && (e.targetHandle === HandleId.VFS_INPUT || !e.targetHandle)
		);
		
		for (const edge of incomingEdges) {
			const sourceData = nodeStore.get(edge.source);
			if (sourceData?.type === 'VFS') {
				return edge.source;
			}
		}
		return null;
	});

	/**
	 * Get the connected VFS node data
	 */
	const connectedVfsNode = $derived.by(() => {
		if (!connectedVfsNodeId) return null;
		const data = nodeStore.get(connectedVfsNodeId);
		return data?.type === 'VFS' ? data as VFSNodeData : null;
	});

	/**
	 * Find connected Loader nodes by looking at incoming edges to service-input handle
	 * Returns both node id and data for focus functionality
	 */
	const connectedLoaderNodes = $derived.by(() => {
		const incomingEdges = allEdges.current.filter(e => 
			e.target === id && e.targetHandle === HandleId.SERVICE_INPUT
		);
		
		const loaders: { id: string; data: LoaderNodeData }[] = [];
		for (const edge of incomingEdges) {
			const sourceData = nodeStore.get(edge.source);
			if (sourceData?.type === 'LOADER') {
				loaders.push({ id: edge.source, data: sourceData as LoaderNodeData });
			}
		}
		return loaders;
	});

	/**
	 * Count of connected services
	 */
	const connectedServiceCount = $derived(connectedLoaderNodes.length);

	// ============================================================================
	// Lifecycle
	// ============================================================================

	// Note: error state is fully local, not persisted to nodeStore

	// ============================================================================
	// Watch for VFS connection changes
	// ============================================================================

	$effect(() => {
		const vfsNodeId = connectedVfsNodeId;
		const vfsNodeData = connectedVfsNode;
		
		untrack(() => {
			if (vfsNodeId && vfsNodeData) {
				// VFS connected - detect project
				detectProjectConfig(vfsNodeData.content.projectId, vfsNodeId);
			} else {
				// VFS disconnected - cleanup
				vfs = null;
				projectConfig = null;
				showPreview = false;
			}
		});
	});

	// ============================================================================
	// Project Detection
	// ============================================================================

	async function detectProjectConfig(projectId: string, vfsNodeId: string) {
		try {
			isLoading = true;
			error = null;
			
			// Get VFS instance for the connected VFS node
			vfs = await getNodeVfs(projectId, vfsNodeId);
			
			// Detect project configuration from tsconfig.json
			const config = await detectProject('/tsconfig.json', vfs);
			
			if (!config) {
				error = 'No tsconfig.json found in VFS';
				projectConfig = null;
				return;
			}
			
			if (!config.isBuildable) {
				error = 'Project is not buildable (missing files in tsconfig.json)';
				projectConfig = null;
				return;
			}
			
			projectConfig = config;
			
		} catch (err) {
			console.error('[SandboxNode] Failed to detect project:', err);
			error = err instanceof Error ? err.message : 'Failed to detect project';
			projectConfig = null;
		} finally {
			isLoading = false;
		}
	}

	// ============================================================================
	// Preview Actions
	// ============================================================================

	function openPreview() {
		showPreview = true;
	}

	function closePreview() {
		showPreview = false;
	}
</script>

<BaseNode
	{id}
	{selected}
	{isConnectable}
	nodeType="SANDBOX"
	headerBgClass="bg-orange-500"
	handleBgClass="bg-orange-400!"
	showRightHandle={false}
	showLeftHandle={false}
>
	{#snippet leftHandles()}
		<!-- VFS Input Handle (top) -->
		<Handle 
			type="target" 
			id={HandleId.VFS_INPUT}
			position={Position.Left} 
			style="top: 30%;"
			{isConnectable}
			class="w-3! h-3! bg-indigo-400! border-2! border-white!"
		/>
		<!-- Service Input Handle (bottom) -->
		<Handle 
			type="target" 
			id={HandleId.SERVICE_INPUT}
			position={Position.Left} 
			style="top: 70%;"
			{isConnectable}
			class="w-3! h-3! bg-purple-400! border-2! border-white!"
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		<!-- Services indicator badge -->
		{#if connectedServiceCount > 0}
			<span class="px-1.5 py-0.5 text-xs bg-purple-400/80 rounded text-white flex items-center gap-1" title={m.studio_sandbox_services_title()}>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
				</svg>
				{connectedServiceCount}
			</span>
		{/if}
	{/snippet}

	{#snippet children()}
		<div class="p-3 bg-gray-50 space-y-3">
			<!-- Connection Status -->
			{#if !connectedVfsNodeId}
				<!-- No VFS Connected -->
				<div class="flex items-center gap-3 text-gray-400">
					<svg class="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
					</svg>
					<div>
						<p class="text-sm font-medium">{m.studio_sandbox_connect_vfs()}</p>
						<p class="text-xs text-gray-400">{m.studio_sandbox_connect_hint()}</p>
					</div>
				</div>
			{:else if isLoading}
				<!-- Loading -->
				<div class="flex items-center gap-3 text-gray-400">
					<svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="text-sm">{m.studio_sandbox_detecting()}</p>
				</div>
			{:else if error}
				<!-- Error -->
				<div class="flex items-center gap-3 text-red-500">
					<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<p class="text-sm font-medium">{error}</p>
				</div>
			{:else if !projectConfig}
				<!-- No project config -->
				<div class="flex items-center gap-3 text-gray-400">
					<svg class="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
					<div>
						<p class="text-sm font-medium">{m.studio_sandbox_no_project()}</p>
						<p class="text-xs text-gray-400">{m.studio_sandbox_add_tsconfig()}</p>
					</div>
				</div>
			{:else}
				<!-- Ready to run -->
				<div class="flex items-center gap-3">
					<svg class="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
					</svg>
					<div class="flex-1">
						<p class="text-sm font-medium text-gray-600">{m.studio_sandbox_ready()}</p>
						<p class="text-xs text-gray-400">{m.studio_node_entry({ entryFile: nodeData?.content?.entryFile ?? 'index.ts' })}</p>
					</div>
					<button
						class="px-3 py-1.5 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors nodrag"
						onclick={openPreview}
					>
						{m.studio_sandbox_open()}
					</button>
				</div>
			{/if}

			<!-- Connected Services List -->
			{#if connectedLoaderNodes.length > 0}
				<div class="border-t border-gray-200 pt-2">
					<p class="text-xs font-medium text-gray-500 mb-1.5">{m.studio_sandbox_connected_services()}</p>
					<div class="flex flex-wrap gap-1">
						{#each connectedLoaderNodes as loader}
							<button 
								type="button"
								class="nodrag px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full flex items-center gap-1 hover:bg-purple-200 transition-colors cursor-pointer"
								title={loader.data.name || 'Loader'}
								onclick={() => fitView({ nodes: [{ id: loader.id }], duration: 300, padding: 0.3 })}
							>
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
								</svg>
								{loader.data.name || 'Loader'}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/snippet}
</BaseNode>

<!-- Preview Panel -->
{#if showPreview && vfs && projectConfig && nodeData}
	<SandboxPreviewView
		{vfs}
		{projectConfig}
		sandboxOrigin={process.env.PUBLIC_SANDBOX_SITE_URL ?? "https://sandbox.soyo.mu"}
		entryFile={nodeData.content.entryFile}
		name={nodeData.name}
		loaderNodes={connectedLoaderNodes}
		onClose={closePreview}
	/>
{/if}

<style>
	/* Override xyflow default node wrapper styles */
	:global(.svelte-flow__node-sandbox) {
		background: transparent !important;
		border: none !important;
		padding: 0 !important;
		border-radius: 0 !important;
		width: auto !important;
		box-shadow: none !important;
		outline: none !important;
	}
	
	:global(.svelte-flow__node-sandbox.selected) {
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
		outline: none !important;
	}
</style>