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
	 * - Version info in footbar with clickable commit history
	 */
	import { type NodeProps, type Node, useConnection, useEdges, useUpdateNodeInternals, Position, Handle, useSvelteFlow } from '@xyflow/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { onMount, onDestroy } from 'svelte';
	import type { VFSNodeData, FlowNodeData, VFSContent, GeneratedNodeData } from '$lib/types';
	import { countFiles, countFolders, vfsVersionStore, type VfsVersionState } from '$lib/vfs';
	import { validateNodeName } from '$lib/validation';
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
	
	// Version history popup state
	let showVersionPopup = $state(false);
	let footbarEl = $state<HTMLElement | null>(null);
	let popupPosition = $state<{ top: number; left: number; width: number } | null>(null);
	
	// Version store subscription cleanup
	let versionStoreUnsubscribe: (() => void) | null = null;

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
	
	// Version state from shared store
	const versionState = $derived<VfsVersionState | undefined>(vfsVersionStore.get(id));
	const headVersion = $derived(versionState?.headHash);
	const hasPendingChanges = $derived(versionState?.hasPendingChanges ?? false);
	const commits = $derived(versionState?.commits ?? []);
	
	// Find nodes that reference this VFS commit (both pre-generate and post-generate)
	type CommitLink = {
		type: 'pre-generate' | 'generated';
		nodeId: string; // input node for pre-generate, generated node for generated
		nodeName: string;
	};
	const commitLinks = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local variable in $derived computation
		const map = new Map<string, CommitLink[]>(); // commit hash -> links
		for (const data of nodeStore.getAll()) {
			if (data.type === 'GENERATED') {
				const genData = data as GeneratedNodeData;
				// Check inputVfsRef (pre-generation version) - link to input node
				if (genData.content.inputVfsRef?.nodeId === id) {
					const commitHash = genData.content.inputVfsRef.commit;
					const inputNodeId = genData.content.inputRef?.id;
					if (inputNodeId) {
						const inputName = nodeStore.get(inputNodeId)?.name || 'Input';
						const links = map.get(commitHash) || [];
						links.push({ type: 'pre-generate', nodeId: inputNodeId, nodeName: inputName });
						map.set(commitHash, links);
					}
				}
				// Check postGenerationCommit - link to generated node
				if (genData.content.inputVfsRef?.nodeId === id && genData.content.postGenerationCommit) {
					const commitHash = genData.content.postGenerationCommit;
					const genName = data.name || 'Generated';
					const links = map.get(commitHash) || [];
					links.push({ type: 'generated', nodeId: data.id, nodeName: genName });
					map.set(commitHash, links);
				}
			}
		}
		return map;
	});

	// ============================================================================
	// Mount Handles (similar to reftag handles)
	// ============================================================================

	const currentEdges = useEdges();
	const updateNodeInternals = useUpdateNodeInternals();

	// Check if this VFS has a generator connection (from loader node for docs output)
	const hasGeneratorConnection = $derived.by(() => {
		const edges = currentEdges.current;
		return edges.some(
			e => e.target === id && e.targetHandle === HandleId.VFS_GENERATOR_INPUT
		);
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
		const connected = new SvelteSet<string>();
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
		void vfsContent?.mounts;
		void hasGeneratorConnection;
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
			
			// Subscribe to version store for reactive version state
			versionStoreUnsubscribe = await vfsVersionStore.subscribe(nodeData.content.projectId, id);
		} catch (err) {
			console.error('Failed to initialize VFS node:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize';
			isLoading = false;
		}
	});
	
	onDestroy(() => {
		versionStoreUnsubscribe?.();
		releaseVfsController(id);
		controller = null;
	});

	// ============================================================================
	// UI Actions
	// ============================================================================

	function handleFolderToggle(path: string, expanded: boolean) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local variable for immutable state update
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
		return validateNodeName(name, nodeId);
	}
	
	// Node navigation
	const { fitView } = useSvelteFlow();
	
	function focusNode(nodeId: string) {
		fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.3 });
	}
	
	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);
		
		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}
	
	function toggleVersionPopup() {
		showVersionPopup = !showVersionPopup;
	}
	
	// Update popup position continuously when open (follows node during pan/zoom)
	$effect(() => {
		if (!showVersionPopup || !footbarEl) {
			popupPosition = null;
			return;
		}
		
		let animationId: number;
		
		function updatePosition() {
			if (footbarEl && showVersionPopup) {
				const rect = footbarEl.getBoundingClientRect();
				popupPosition = {
					top: rect.bottom,
					left: rect.left,
					width: rect.width
				};
				animationId = requestAnimationFrame(updatePosition);
			}
		}
		
		updatePosition();
		
		return () => {
			cancelAnimationFrame(animationId);
		};
	});

	// Action to portal an element to document.body (avoids transform issues with fixed positioning)
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
	
	// Action to detect clicks outside an element
	function clickOutside(node: HTMLElement, callback: () => void) {
		function handleClick(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			if (target && !node.contains(target) && !footbarEl?.contains(target)) {
				callback();
			}
		}
		
		// Use setTimeout to avoid immediate trigger from the click that opened the popup
		setTimeout(() => {
			document.addEventListener('click', handleClick, true);
		}, 0);
		
		return {
			destroy() {
				document.removeEventListener('click', handleClick, true);
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

		<!-- Compact File Tree -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
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

		<!-- Footer with stats and version info -->
		<div bind:this={footbarEl} class="border-t border-gray-200 bg-gray-50 text-xs">
			<!-- Single footbar row with stats and version -->
			<div class="px-3 py-1.5 flex items-center gap-3 text-gray-500">
				<span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
				<span>{folderCount} folder{folderCount !== 1 ? 's' : ''}</span>
				{#if mountCount > 0}
					<span class="text-indigo-500">{mountCount} mount{mountCount !== 1 ? 's' : ''}</span>
				{/if}
				
				<!-- Spacer -->
				<span class="flex-1"></span>
				
				<!-- Version button -->
				<button 
					class="flex items-center gap-1 hover:text-gray-700 transition-colors"
					onclick={toggleVersionPopup}
				>
					<!-- Git commit icon -->
					<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="3" stroke-width="2"/>
						<line x1="12" y1="3" x2="12" y2="9" stroke-width="2"/>
						<line x1="12" y1="15" x2="12" y2="21" stroke-width="2"/>
					</svg>
					<span class="font-mono">{headVersion?.slice(0, 7) || '—'}</span>
					{#if hasPendingChanges}
						<span class="text-amber-600">•</span>
					{/if}
					<!-- Chevron -->
					<svg class="w-3 h-3 transition-transform" class:rotate-180={showVersionPopup} fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
			</div>
		</div>
		
		<!-- Version history popup (floating below footbar, portaled to body) -->
		{#if showVersionPopup && commits.length > 0 && popupPosition}
			<div 
				use:portalToBody
				use:clickOutside={() => showVersionPopup = false}
				class="fixed bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto z-10 w-80"
				style="top: {popupPosition.top}px; left: {popupPosition.left}px;"
				role="dialog"
			>
				{#each commits as commit (commit.hash)}
					<div class="px-3 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="font-mono text-sm text-gray-700">{commit.hash.slice(0, 7)}</span>
							<span class="text-sm text-gray-400">{formatDate(commit.timestamp.getTime())}</span>
						</div>
						<div class="text-sm text-gray-600 truncate mt-1">{commit.message}</div>
						
						<!-- Linked nodes -->
						{#if commitLinks.has(commit.hash)}
							<div class="mt-2 flex flex-col gap-1">
								{#each commitLinks.get(commit.hash)! as link (link.nodeId)}
									<button 
										class="text-sm px-2 py-1 rounded flex items-center gap-2 transition-colors w-full text-left {link.type === 'pre-generate' ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}"
										onclick={(e) => { e.stopPropagation(); focusNode(link.nodeId); showVersionPopup = false; }}
									>
										<span class="font-medium truncate">{link.nodeName}</span>
										<span class="text-xs opacity-75 shrink-0">{link.type === 'pre-generate' ? 'pre generate' : 'generated'}</span>
										<svg class="w-3.5 h-3.5 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
										</svg>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

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

<!-- Loader Docs Input Handle - positioned at top center, flat bar style -->
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
		class="fixed z-10000 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg pointer-events-none whitespace-nowrap"
		style="left: {mousePos.x + 12}px; top: {mousePos.y + 12}px;"
	>
		mount to <span class="font-mono text-indigo-300">{hoveredFolderPath}</span>
	</div>
{/if}
