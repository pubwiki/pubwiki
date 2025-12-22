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
	 */
	import { Handle, Position, type NodeProps, type Node, useEdges } from '@xyflow/svelte';
	import { onMount, untrack } from 'svelte';
	import type { SandboxNodeData, VFSNodeData, LoaderNodeData, StudioNodeData } from '../../utils/types';
	import { getNodeVfs, type VersionedVfs } from '../../stores/vfs';
	import { getStudioContext } from '../../stores/context';
	import BaseNode from './BaseNode.svelte';
	import SandboxPreviewView from './SandboxPreviewView.svelte';
	import type { ProjectConfig } from '@pubwiki/sandbox-host';
	import { detectProject } from '@pubwiki/bundler';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<SandboxNodeData, 'sandbox'>> = $props();
	const ctx = getStudioContext();
	const allEdges = useEdges();

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
			e.target === id && (e.targetHandle === 'vfs-input' || !e.targetHandle)
		);
		
		for (const edge of incomingEdges) {
			const sourceNode = ctx.nodes.find(n => n.id === edge.source);
			if (sourceNode?.data.type === 'VFS') {
				return sourceNode.id;
			}
		}
		return null;
	});

	/**
	 * Get the connected VFS node data
	 */
	const connectedVfsNode = $derived.by(() => {
		if (!connectedVfsNodeId) return null;
		const node = ctx.nodes.find(n => n.id === connectedVfsNodeId);
		return node?.data.type === 'VFS' ? node.data as VFSNodeData : null;
	});

	/**
	 * Find connected Loader nodes by looking at incoming edges to service-input handle
	 */
	const connectedLoaderNodes = $derived.by(() => {
		const incomingEdges = allEdges.current.filter(e => 
			e.target === id && e.targetHandle === 'service-input'
		);
		
		const loaders: LoaderNodeData[] = [];
		for (const edge of incomingEdges) {
			const sourceNode = ctx.nodes.find(n => n.id === edge.source);
			if (sourceNode?.data.type === 'LOADER') {
				loaders.push(sourceNode.data as LoaderNodeData);
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

	onMount(() => {
		// Initialize error state from data
		error = data.error;
	});

	// ============================================================================
	// Watch for VFS connection changes
	// ============================================================================

	$effect(() => {
		const vfsNodeId = connectedVfsNodeId;
		const vfsNodeData = connectedVfsNode;
		
		untrack(() => {
			if (vfsNodeId && vfsNodeData) {
				// VFS connected - detect project
				detectProjectConfig(vfsNodeData.projectId, vfsNodeId);
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
	{data}
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
			id="vfs-input"
			position={Position.Left} 
			style="top: 30%;"
			{isConnectable}
			class="w-3! h-3! bg-indigo-400! border-2! border-white!"
		/>
		<!-- Service Input Handle (bottom) -->
		<Handle 
			type="target" 
			id="service-input"
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
			<span class="px-1.5 py-0.5 text-xs bg-purple-400/80 rounded text-white flex items-center gap-1" title="Connected services">
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
						<p class="text-sm font-medium">Connect a VFS node</p>
						<p class="text-xs text-gray-400">Drag from a VFS node's output</p>
					</div>
				</div>
			{:else if isLoading}
				<!-- Loading -->
				<div class="flex items-center gap-3 text-gray-400">
					<svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="text-sm">Detecting project...</p>
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
						<p class="text-sm font-medium">No project detected</p>
						<p class="text-xs text-gray-400">Add tsconfig.json to your VFS</p>
					</div>
				</div>
			{:else}
				<!-- Ready to run -->
				<div class="flex items-center gap-3">
					<svg class="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
					</svg>
					<div class="flex-1">
						<p class="text-sm font-medium text-gray-600">Ready to preview</p>
						<p class="text-xs text-gray-400">Entry: {data.entryFile}</p>
					</div>
					<button
						class="px-3 py-1.5 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors nodrag"
						onclick={openPreview}
					>
						Open
					</button>
				</div>
			{/if}

			<!-- Connected Services List -->
			{#if connectedLoaderNodes.length > 0}
				<div class="border-t border-gray-200 pt-2">
					<p class="text-xs font-medium text-gray-500 mb-1.5">Connected Services</p>
					<div class="flex flex-wrap gap-1">
						{#each connectedLoaderNodes as loader}
							<span class="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full flex items-center gap-1">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
								</svg>
								{loader.serviceType}
							</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/snippet}
</BaseNode>

<!-- Preview Panel -->
{#if showPreview && vfs && projectConfig}
	<SandboxPreviewView
		{vfs}
		{projectConfig}
		sandboxOrigin={data.sandboxOrigin}
		entryFile={data.entryFile}
		name={data.name}
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