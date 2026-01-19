<script lang="ts">
	/**
	 * VFSNode - Virtual File System node with compact view
	 * 
	 * Features:
	 * - Compact file tree preview in node card
	 * - File editing via sidebar properties panel
	 * - Uses BaseNode for consistent styling
	 * - Shares VfsController with VFSProperties for single event subscription
	 */
	import { Handle, Position, type NodeProps, type Node } from '@xyflow/svelte';
	import { onMount, onDestroy } from 'svelte';
	import type { VFSNodeData, FlowNodeData } from '../../../types';
	import { countFiles, countFolders } from '../../../vfs';
	import { getStudioContext } from '../../../state';
	import { nodeStore } from '../../../persistence';
	import { getVfsController, releaseVfsController, type VfsController } from './controller.svelte';
	import UploadOverlay from './UploadOverlay.svelte';
	import BaseNode from '../BaseNode.svelte';
	import type { FileItem } from '@pubwiki/ui/components';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { isConnectable, selected, id }: NodeProps<Node<FlowNodeData, 'vfs'>> = $props();
	const ctx = getStudioContext();

	// ============================================================================
	// Node Data
	// ============================================================================

	const nodeData = $derived(nodeStore.get(id) as VFSNodeData | undefined);

	// ============================================================================
	// State
	// ============================================================================

	let controller: VfsController | null = $state<VfsController | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	
	// UI state - local only, not persisted
	let expandedFolders = $state<Set<string>>(new Set());

	// ============================================================================
	// Derived
	// ============================================================================

	const fileTree = $derived(controller?.fileTree ?? []);
	const fileCount = $derived(countFiles(fileTree));
	const folderCount = $derived(countFolders(fileTree));
	const uploadState = $derived(controller?.uploadState);

	// ============================================================================
	// Initialization
	// ============================================================================

	onMount(async () => {
		if (!nodeData?.content?.projectId) {
			error = 'Missing project ID';
			isLoading = false;
			return;
		}
		
		try {
			controller = await getVfsController(nodeData.content.projectId, id);
			isLoading = controller.isLoading;
			error = controller.error;
		} catch (err) {
			console.error('Failed to initialize VFS node:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize';
			isLoading = false;
		}
	});
	
	onDestroy(() => {
		releaseVfsController(id);
		controller = null;
	});

	// ============================================================================
	// UI Actions
	// ============================================================================

	function toggleFolder(path: string) {
		const newExpanded = new Set(expandedFolders);
		if (newExpanded.has(path)) {
			newExpanded.delete(path);
		} else {
			newExpanded.add(path);
		}
		expandedFolders = newExpanded;
	}

	// Action to capture wheel events and prevent canvas zoom/pan
	function captureWheel(node: HTMLElement) {
		function handleWheel(e: WheelEvent): void {
			const { scrollTop, scrollHeight, clientHeight } = node;
			const isScrollable = scrollHeight > clientHeight;

			if (isScrollable) {
				const isAtTop = scrollTop === 0 && e.deltaY < 0;
				const isAtBottom = Math.abs(scrollTop + clientHeight - scrollHeight) < 1 && e.deltaY > 0;
				if (!isAtTop && !isAtBottom) {
					e.stopPropagation();
				}
			}
		}
		
		// Use capture phase to intercept before xyflow
		node.addEventListener('wheel', handleWheel, { capture: true, passive: false });
		
		return {
			destroy() {
				node.removeEventListener('wheel', handleWheel, { capture: true });
			}
		};
	}
</script>

<BaseNode
	{id}
	{selected}
	{isConnectable}
	nodeType="VFS"
	headerBgClass="bg-indigo-500"
	handleBgClass="bg-indigo-400!"
>
	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
		</svg>
	{/snippet}

	{#snippet children()}
		<!-- Compact File Tree -->
		<div class="max-h-48 overflow-y-auto bg-gray-50 text-sm nodrag nowheel relative" class:min-h-32={uploadState?.isUploading} use:captureWheel>
			<!-- Upload overlay -->
			{#if uploadState?.isUploading && uploadState.progress}
				<UploadOverlay progress={uploadState.progress} />
			{/if}
			
			{#if isLoading}
				<div class="flex items-center justify-center py-8 text-gray-400 text-xs">
					{m.studio_vfs_loading()}
				</div>
			{:else if error}
				<div class="flex items-center justify-center py-4 text-red-500 text-xs px-3">
					{error}
				</div>
			{:else if fileTree.length === 0}
				<div class="text-gray-400 text-xs px-3 py-6 text-center">
					{m.studio_vfs_empty_folder()}
				</div>
			{:else}
				<div class="p-2">
					{#each fileTree as item}
						{@render compactFileTreeItem(item, 0)}
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer stats -->
		<div class="px-3 py-1.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex items-center gap-3">
			<span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
			<span>{folderCount} folder{folderCount !== 1 ? 's' : ''}</span>
		</div>
	{/snippet}
</BaseNode>

<!-- Compact File Tree Item Snippet -->
{#snippet compactFileTreeItem(item: FileItem, depth: number)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer text-gray-600 hover:bg-gray-200/50 transition-colors"
		style="padding-left: {depth * 10 + 4}px"
		onclick={() => item.type === 'folder' && toggleFolder(item.path)}
	>
		{#if item.type === 'folder'}
			<svg class="w-3 h-3 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				{#if expandedFolders.has(item.path)}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				{/if}
			</svg>
		{:else}
			<svg class="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
		{/if}
		<span class="truncate text-xs">{item.name}</span>
	</div>
	{#if item.type === 'folder' && expandedFolders.has(item.path) && item.files}
		{#each item.files as child}
			{@render compactFileTreeItem(child, depth + 1)}
		{/each}
	{/if}
{/snippet}
