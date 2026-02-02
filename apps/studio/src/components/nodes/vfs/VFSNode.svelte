<script lang="ts">
	/**
	 * VFSNode - Virtual File System node with compact view
	 * 
	 * Features:
	 * - Compact file tree preview in node card (using shared FileTree component)
	 * - File editing via sidebar properties panel
	 * - Uses BaseNode for consistent styling
	 * - Shares VfsController with VFSProperties for single event subscription
	 * - Node name is the VFS name (edited via BaseNode header)
	 * - Drag-to-folder mounting with visual feedback
	 * - Dynamic mount handles (similar to reftag handles)
	 */
	import { type NodeProps, type Node, useConnection, useEdges, useUpdateNodeInternals, Position, Handle } from '@xyflow/svelte';
	import { onMount, onDestroy } from 'svelte';
	import type { VFSNodeData, FlowNodeData, VFSContent } from '$lib/types';
	import { countFiles, countFolders, validateVfsName } from '$lib/vfs';
	import { getStudioContext, setVfsDropTarget, clearVfsDropTarget } from '$lib/state';
	import { nodeStore } from '$lib/persistence';
	import { getVfsController, releaseVfsController, type VfsController } from './controller.svelte';
	import UploadOverlay from './UploadOverlay.svelte';
	import BaseNode from '../BaseNode.svelte';
	import TaggedHandlePanel from '../TaggedHandlePanel.svelte';
	import type { TaggedHandle, HandleColorScheme } from '../TaggedHandlePanel.svelte';
	import { createVfsMountHandleId, isVfsMountHandle, HandleId } from '$lib/graph';
	import { FileTree, type FileItem } from '@pubwiki/ui/components';
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
	const vfsContent = $derived(nodeData?.content as VFSContent | undefined);
	const projectId = $derived(vfsContent?.projectId ?? '');
	// VFS name is now the node name, not displayName
	const vfsName = $derived(nodeData?.name ?? '');

	// ============================================================================
	// State
	// ============================================================================

	let controller: VfsController | null = $state<VfsController | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	
	// UI state - local only, not persisted
	let expandedFolders = $state<Set<string>>(new Set());
	
	// Viewing path for FileTree - set when clicking a mount handle
	let viewingPath = $state<string | undefined>(undefined);
	
	// Mouse position for mount tooltip
	let mousePos = $state<{ x: number; y: number } | null>(null);
	
	// Current hovered folder path for tooltip
	let hoveredFolderPath = $state<string | null>(null);

	// ============================================================================
	// Connection State (for drag-to-folder visual feedback)
	// ============================================================================

	const connection = useConnection();
	
	// Check if we're receiving a VFS drag (source is a VFS node and target is not yet connected)
	const isReceivingVfsDrag = $derived.by(() => {
		const conn = connection.current;
		if (!conn.inProgress || !conn.fromNode) return false;
		
		// Check if source is a VFS node (different from this node)
		const sourceNodeData = nodeStore.get(conn.fromNode.id);
		return sourceNodeData?.type === 'VFS' && conn.fromNode.id !== id;
	});

	// ============================================================================
	// Derived
	// ============================================================================

	const fileTree = $derived(controller?.fileTree ?? []);
	const fileCount = $derived(countFiles(fileTree));
	const folderCount = $derived(countFolders(fileTree));
	const uploadState = $derived(controller?.uploadState);
	const mountCount = $derived(vfsContent?.mounts?.length ?? 0);

	// ============================================================================
	// Mount Handles (similar to reftag handles)
	// ============================================================================

	const currentEdges = useEdges();
	const updateNodeInternals = useUpdateNodeInternals();

	// Check if this VFS has a generator connection (from loader/generated node)
	const hasGeneratorConnection = $derived.by(() => {
		const edges = currentEdges.current;
		const result = edges.some(
			e => e.target === id && e.targetHandle === HandleId.VFS_GENERATOR_INPUT
		);
		// Debug log
		const relevantEdges = edges.filter(e => e.target === id);
		if (relevantEdges.length > 0) {
			console.log(`[VFSNode ${id}] hasGeneratorConnection:`, result, 'relevant edges:', relevantEdges.map(e => ({ targetHandle: e.targetHandle })));
		}
		return result;
	});

	// Color scheme for mount handles
	const MOUNT_CONNECTED_COLOR: HandleColorScheme = {
		bg: '#f5f3ff',
		border: '#a78bfa',
		text: 'text-purple-600',
		handle: 'bg-purple-500'
	};

	const MOUNT_DISCONNECTED_COLOR: HandleColorScheme = {
		bg: '#faf5ff',
		border: '#d8b4fe',
		text: 'text-purple-500',
		handle: 'bg-purple-400'
	};

	// Get the set of connected mount handles
	const mountConnections = $derived.by(() => {
		const connected = new Set<string>();
		for (const edge of currentEdges.current) {
			if (edge.target === id && isVfsMountHandle(edge.targetHandle)) {
				connected.add(edge.targetHandle!);
			}
		}
		return connected;
	});

	// Create tagged handles for each mount
	const mountHandles = $derived<TaggedHandle[]>(
		(vfsContent?.mounts ?? []).map(mount => {
			const handleId = createVfsMountHandleId(mount.id);
			return {
				id: handleId,
				label: mount.mountPath,
				isConnected: mountConnections.has(handleId),
				connectedColor: MOUNT_CONNECTED_COLOR,
				disconnectedColor: MOUNT_DISCONNECTED_COLOR,
				data: { mountPath: mount.mountPath }
			};
		})
	);

	// Update node internals when mounts change or generator connection changes
	$effect(() => {
		// Trigger on mounts change or generator connection change
		vfsContent?.mounts;
		hasGeneratorConnection;
		updateNodeInternals(id);
	});

	// Clean up orphan edges when mounts are deleted
	$effect(() => {
		// Get current valid mount handle IDs
		const validHandleIds = new Set((vfsContent?.mounts ?? []).map(m => createVfsMountHandleId(m.id)));
		
		// Find edges targeting this node's mount handles that no longer exist
		const orphanEdges = currentEdges.current.filter(edge => 
			edge.target === id &&
			isVfsMountHandle(edge.targetHandle) &&
			!validHandleIds.has(edge.targetHandle!)
		);
		
		// Delete orphan edges
		if (orphanEdges.length > 0) {
			const orphanEdgeIds = new Set(orphanEdges.map(e => e.id));
			ctx.updateEdges(edges => edges.filter(e => !orphanEdgeIds.has(e.id)));
		}
	});

	// ============================================================================
	// Initialization
	// ============================================================================

	onMount(async () => {
		const mountTime = performance.now();
		console.log(`[VFSNode] onMount triggered for ${id} at ${mountTime.toFixed(2)}ms`);
		
		if (!nodeData?.content?.projectId) {
			error = 'Missing project ID';
			isLoading = false;
			console.log(`[VFSNode] ${id} missing projectId, aborting`);
			return;
		}
		
		// If this is a new node (no name set), trigger BaseNode's name editing
		if (!vfsName) {
			ctx.setEditingNameNodeId(id);
		}
		
		try {
			console.log(`[VFSNode] ${id} starting getVfsController...`);
			const startTime = performance.now();
			controller = await getVfsController(nodeData.content.projectId, id);
			const endTime = performance.now();
			console.log(`[VFSNode] ${id} getVfsController completed in ${(endTime - startTime).toFixed(2)}ms`, {
				fileTreeLength: controller?.fileTree?.length,
				isLoading: controller?.isLoading,
				error: controller?.error
			});
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

	function handleFolderToggle(path: string, expanded: boolean) {
		const newExpanded = new Set(expandedFolders);
		if (expanded) {
			newExpanded.add(path);
		} else {
			newExpanded.delete(path);
		}
		expandedFolders = newExpanded;
	}

	function handleExpandedChange(folders: Set<string>) {
		expandedFolders = folders;
	}

	/**
	 * Handle hover over file tree items.
	 * Updates global drop target state when receiving VFS drag.
	 */
	function handleItemHover(item: FileItem | null) {
		if (!isReceivingVfsDrag) {
			// Not receiving a VFS drag, clear any existing target for this node
			clearVfsDropTarget(id);
			hoveredFolderPath = null;
			return;
		}

		if (item === null) {
			// Mouse left an item, fall back to root
			setVfsDropTarget({
				nodeId: id,
				folder: null,
				folderPath: '/'
			});
			hoveredFolderPath = '/';
			return;
		}

		// Only folders can be drop targets
		if (item.type !== 'folder') {
			// Not a folder, fall back to root
			setVfsDropTarget({
				nodeId: id,
				folder: null,
				folderPath: '/'
			});
			hoveredFolderPath = '/';
			return;
		}

		// Can't drop on already mounted folders
		if (item.isMounted) {
			// Mounted folder, fall back to root
			setVfsDropTarget({
				nodeId: id,
				folder: null,
				folderPath: '/'
			});
			hoveredFolderPath = '/';
			return;
		}

		// Set this folder as the drop target
		setVfsDropTarget({
			nodeId: id,
			folder: item,
			folderPath: item.path
		});
		hoveredFolderPath = item.path;
	}

	/**
	 * Handle mouse entering the file tree root (empty area or root level)
	 */
	function handleRootMouseEnter() {
		if (isReceivingVfsDrag) {
			setVfsDropTarget({
				nodeId: id,
				folder: null,
				folderPath: '/'
			});
			hoveredFolderPath = '/';
		}
	}

	/**
	 * Handle mouse leaving the entire file tree
	 */
	function handleRootMouseLeave() {
		clearVfsDropTarget(id);
		hoveredFolderPath = null;
		mousePos = null;
	}
	
	/**
	 * Handle mouse move over file tree to track position for tooltip
	 */
	function handleMouseMove(e: MouseEvent) {
		if (isReceivingVfsDrag) {
			mousePos = { x: e.clientX, y: e.clientY };
		}
	}
	
	/**
	 * Handle mount handle click - focus the corresponding folder in FileTree
	 */
	function handleMountHandleClick(handleId: string, data?: Record<string, unknown>) {
		const mountPath = data?.mountPath as string | undefined;
		if (mountPath) {
			// Clear first to allow re-triggering the same path
			viewingPath = undefined;
			// Set in next tick to trigger the effect
			setTimeout(() => {
				viewingPath = mountPath;
			}, 0);
		}
	}
	
	// VFS name validation callback for BaseNode
	function handleValidateName(name: string, nodeId: string): string | null {
		return validateVfsName(name, projectId, nodeId);
	}

	// Action to portal an element to document.body (avoids transform issues with fixed positioning)
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
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
	validateName={handleValidateName}
>
	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
		</svg>
	{/snippet}

	{#snippet children()}
		<!-- Compact File Tree -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div 
			class="max-h-48 overflow-y-auto bg-gray-50 text-sm nodrag nowheel relative vfs-drop-target transition-colors" 
			class:min-h-32={uploadState?.isUploading} 
			use:captureWheel
			onmouseenter={handleRootMouseEnter}
			onmouseleave={handleRootMouseLeave}
			onmousemove={handleMouseMove}
		>
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
				<FileTree 
					items={fileTree}
					{expandedFolders}
					{viewingPath}
					compact={true}
					onFolderToggle={handleFolderToggle}
					onExpandedChange={handleExpandedChange}
					onItemHover={handleItemHover}
					class="p-2"
				/>
			{/if}
		</div>

		<!-- Footer stats -->
		<div class="px-3 py-1.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex items-center gap-3">
			<span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
			<span>{folderCount} folder{folderCount !== 1 ? 's' : ''}</span>
			{#if mountCount > 0}
				<span class="text-indigo-500">{mountCount} mount{mountCount !== 1 ? 's' : ''}</span>
			{/if}
		</div>
	{/snippet}

	{#snippet leftHandles()}
		<!-- Mount handles panel (similar to reftag panel) -->
		{#if mountHandles.length > 0}
			<TaggedHandlePanel 
				handles={mountHandles}
				{isConnectable}
				handleType="target"
				position="left"
				nodeOverlap={24}
				onClick={handleMountHandleClick}
			/>
		{/if}
	{/snippet}
</BaseNode>

<!-- Generator Input Handle - positioned at top center, flat bar style -->
{#if hasGeneratorConnection}
	<Handle 
		type="target" 
		id={HandleId.VFS_GENERATOR_INPUT}
		position={Position.Top} 
		{isConnectable}
		class="w-16! h-1! bg-indigo-400! border-0! rounded-full! shadow-[0_0_4px_rgba(129,140,248,0.6)]!"
		style="left: 50%; top: 0; transform: translate(-50%, -100%);"
	/>
{/if}

<!-- Mount tooltip portal - rendered outside transform context -->
{#if isReceivingVfsDrag && hoveredFolderPath && mousePos}
	<div 
		use:portalToBody
		class="fixed z-[10000] px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg pointer-events-none whitespace-nowrap"
		style="left: {mousePos.x + 12}px; top: {mousePos.y + 12}px;"
	>
		mount to <span class="font-mono text-indigo-300">{hoveredFolderPath}</span>
	</div>
{/if}
