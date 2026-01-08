<script lang="ts">
	/**
	 * BaseNode - Common wrapper for all node types
	 * 
	 * Provides:
	 * - Version history stack effect
	 * - Common border/shadow styling
	 * - Phantom/preview/used state banners
	 * - Header with type icon, name editing, version indicator
	 * - Slot for node-specific content
	 * - Handle positioning
	 * 
	 * Layer Separation: Business data comes from nodeStore, not props.
	 */
	import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
	import type { Snippet } from 'svelte';
	import type { FlowNodeData } from '../../types/flow';
	import { nodeStore } from '../../persistence';
	import type { StudioNodeData } from '../../types';
	import { hasVersionHistory, getVersionCount, type NodeRef } from '../../version';
	import { getStudioContext } from '../../state';
	import VersionGallery from '../VersionGallery.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		id: string;
		data?: FlowNodeData;  // Minimal flow data (id, type) - optional, we can use id directly
		selected: boolean;
		isConnectable: boolean;
		// Node type configuration
		nodeType: string;
		headerBgClass: string;
		handleBgClass: string;
		borderClass?: string;
		// Slots
		headerIcon?: Snippet;
		headerActions?: Snippet;
		children: Snippet;
		// Optional handles config
		showLeftHandle?: boolean;
		showRightHandle?: boolean;
		leftHandles?: Snippet;
		rightHandles?: Snippet;
	}

	let {
		id,
		data,
		selected,
		isConnectable,
		nodeType,
		headerBgClass,
		handleBgClass,
		borderClass: customBorderClass,
		headerIcon,
		headerActions,
		children,
		showLeftHandle = true,
		showRightHandle = true,
		leftHandles,
		rightHandles,
	}: Props = $props();

	// ============================================================================
	// Context and Store
	// ============================================================================

	const ctx = getStudioContext();
	
	// Get business data from nodeStore (reactive)
	const nodeData = $derived(nodeStore.get(id));

	// ============================================================================
	// Helpers
	// ============================================================================

	function getNodeTypeLabel(type: string): string {
		switch (type) {
			case 'PROMPT': return m.studio_node_header_prompt();
			case 'INPUT': return m.studio_node_header_input();
			case 'GENERATED': return m.studio_node_header_generated();
			case 'VFS': return m.studio_node_header_vfs();
			case 'SANDBOX': return m.studio_node_header_sandbox();
			case 'LOADER': return m.studio_node_header_loader();
			case 'STATE': return m.studio_node_header_state();
			default: return type;
		}
	}

	// ============================================================================
	// State
	// ============================================================================

	let showVersionGallery = $state(false);
	
	// Name editing state
	const isEditingName = $derived(ctx.editingNameNodeId === id);
	let editingNameValue = $state('');
	let nameInputRef: HTMLInputElement | null = $state(null);

	// ============================================================================
	// Derived
	// ============================================================================

	// Get content string for version gallery (uses polymorphic getText())
	const contentForVersionGallery = $derived(nodeData?.content.getText() ?? '');

	// Version control - adapted to use StudioNodeData shape
	const versionCount = $derived(nodeData ? getVersionCount(nodeData) : 0);
	const hasHistory = $derived(nodeData ? hasVersionHistory(nodeData) : false);
	
	// Preview state from context
	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	const isUsed = $derived(!!previewState?.isUsed);
	const displayCommit = $derived(previewState?.commit ?? nodeData?.commit ?? '');
	
	// Phantom node check (this flag is not in StudioNodeData, so we skip it for now)
	const isPhantom = $derived(false);
	
	// Calculate preview version number
	const previewVersionNumber = $derived.by(() => {
		if (!isPreviewing || !previewState?.commit || !nodeData) return null;
		const index = nodeData.snapshotRefs.findIndex(ref => ref.commit === previewState.commit);
		if (index >= 0) return index + 1;
		return null;
	});

	// Static mapping for selected border classes (Tailwind needs to see these statically)
	// prettier-ignore
	const selectedBorderMap: Record<string, string> = {
		'bg-purple-500': 'border-purple-500 ring-2 ring-purple-500/20',
		'bg-indigo-500': 'border-indigo-500 ring-2 ring-indigo-500/20',
		'bg-blue-500': 'border-blue-500 ring-2 ring-blue-500/20',
		'bg-teal-500': 'border-teal-500 ring-2 ring-teal-500/20',
		'bg-green-500': 'border-green-500 ring-2 ring-green-500/20',
		'bg-orange-500': 'border-orange-500 ring-2 ring-orange-500/20',
		'bg-cyan-500': 'border-cyan-500 ring-2 ring-cyan-500/20',
	};

	// Border class - combine custom class with state-based styling
	const computedBorderClass = $derived(
		customBorderClass ?? (
			isPhantom ? 'border-gray-400 ring-2 ring-gray-400/30' :
			isPreviewing ? 'border-amber-500 ring-2 ring-amber-500/30' :
			isUsed ? 'border-emerald-500 ring-2 ring-emerald-500/30' :
			selected ? (selectedBorderMap[headerBgClass] ?? 'border-gray-400 ring-2 ring-gray-400/20') :
			'border-gray-200'
		)
	);

	// ============================================================================
	// Effects
	// ============================================================================

	$effect(() => {
		if (ctx.editingNameNodeId === id) {
			editingNameValue = nodeData?.name || '';
			setTimeout(() => nameInputRef?.focus(), 0);
		}
	});

	// ============================================================================
	// Event Handlers
	// ============================================================================

	function handleVersionClick() {
		if (hasHistory) {
			showVersionGallery = !showVersionGallery;
		}
	}

	function handleRestore(snapshotRef: NodeRef) {
		ctx.onRestore(id, snapshotRef);
	}

	function handleNameInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveNameEdit();
		} else if (e.key === 'Escape') {
			cancelNameEdit();
		}
	}

	function saveNameEdit() {
		ctx.updateNodeData(id, (data) => ({
			...data,
			name: editingNameValue.trim()
		}));
		ctx.setEditingNameNodeId(null);
	}

	function cancelNameEdit() {
		ctx.setEditingNameNodeId(null);
		editingNameValue = '';
	}

	function handleWheel(e: WheelEvent) {
		const target = e.currentTarget as HTMLElement;
		const { scrollTop, scrollHeight, clientHeight } = target;
		const isScrollable = scrollHeight > clientHeight;
		
		if (isScrollable) {
			const isAtTop = scrollTop === 0 && e.deltaY < 0;
			const isAtBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
			if (!isAtTop && !isAtBottom) {
				e.stopPropagation();
			}
		}
	}
</script>

<div class="relative {isPhantom ? 'opacity-60' : ''}" style="overflow: visible;">
	<!-- Version history stack effect (poker card style) -->
	{#if hasHistory && !isPhantom}
		{#each {length: Math.min(versionCount - 1, 3)} as _, i}
			<div 
				class="absolute w-80 h-full rounded-lg border bg-white shadow-sm {computedBorderClass}"
				style="
					transform: translate({(3 - i) * 3}px, {(3 - i) * -3}px);
					z-index: {-3 + i};
					opacity: {0.6 - i * 0.15};
				"
			></div>
		{/each}
	{/if}
	
	<!-- Main node card -->
	<div class="relative w-80 rounded-lg border bg-white shadow-sm hover:shadow-md transition-all duration-300 group {computedBorderClass} overflow-hidden">
		<!-- Phantom node banner -->
		{#if isPhantom}
			<div class="bg-gray-200 px-3 py-1 text-xs text-gray-600 font-medium flex items-center gap-1 border-b border-gray-300">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
				</svg>
				{m.studio_node_deleted_historical()}
			</div>
		<!-- Preview indicator banner -->
		{:else if isPreviewing}
			<div class="bg-amber-100 px-3 py-1 text-xs text-amber-700 font-medium flex items-center gap-1 border-b border-amber-200">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				{m.studio_node_historical_version({ commit: displayCommit?.slice(0, 7) ?? '' })}
			</div>
		<!-- Used indicator banner -->
		{:else if isUsed}
			<div class="bg-emerald-100 px-3 py-1 text-xs text-emerald-700 font-medium flex items-center gap-1 border-b border-emerald-200">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				{m.studio_node_used_in_generation()}
			</div>
		{/if}
		
		<!-- Header -->
		<div class="{headerBgClass} px-3 py-2 border-b border-gray-200 flex items-center gap-2 transition-colors duration-300">
			<!-- Left: Type icon and label -->
			<div class="flex items-center gap-2 shrink-0">
				{#if headerIcon}
					{@render headerIcon()}
				{/if}
				<span class="text-xs font-bold text-gray-100 uppercase tracking-wider">{getNodeTypeLabel(nodeType)}</span>
				
				<!-- Historical version indicator -->
				{#if isPreviewing}
					<span
						class="px-1.5 py-0.5 text-xs bg-white/30 rounded text-white/90 flex items-center gap-1"
						title={m.studio_node_viewing_historical()}
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						v{previewVersionNumber ?? '?'}
					</span>
				{:else if hasHistory}
					<button
						class="nodrag px-1.5 py-0.5 text-xs bg-white/20 hover:bg-white/30 rounded text-white/90 transition-colors cursor-pointer"
						onclick={handleVersionClick}
						title={m.studio_node_view_history()}
					>
						v{versionCount}
					</button>
				{/if}
			</div>
			
			<!-- Center: Node Name -->
			<div class="flex-1 min-w-0 flex justify-center">
				{#if isEditingName}
					<input
						bind:this={nameInputRef}
						type="text"
						class="nodrag w-full max-w-32 px-1.5 py-0.5 text-xs bg-white/90 text-gray-800 rounded border-none outline-none text-center"
						placeholder={m.studio_node_name_placeholder()}
						bind:value={editingNameValue}
						onkeydown={handleNameInputKeydown}
						onblur={saveNameEdit}
					/>
				{:else if nodeData?.name}
					<span class="text-xs text-white/90 truncate max-w-32" title={nodeData.name}>
						{nodeData.name}
					</span>
				{/if}
			</div>
			
			<!-- Right: Action buttons -->
			<div class="flex items-center gap-2 shrink-0">
				{#if headerActions}
					{@render headerActions()}
				{/if}
			</div>
		</div>
		
		<!-- Content -->
		<div class="bg-white overflow-hidden rounded-b-lg {isPreviewing ? 'bg-amber-50/50' : ''}">
			{@render children()}
		</div>
	</div>

	<!-- Default Left Handle -->
	{#if leftHandles}
		{@render leftHandles()}
	{:else if showLeftHandle}
		<Handle type="target" position={Position.Left} {isConnectable} class="w-3! h-3! {handleBgClass} border-2! border-white!" />
	{/if}
	
	<!-- Default Right Handle -->
	{#if rightHandles}
		{@render rightHandles()}
	{:else if showRightHandle}
		<Handle type="source" position={Position.Right} {isConnectable} class="w-3! h-3! {handleBgClass} border-2! border-white!" />
	{/if}

	<!-- Version Gallery -->
	{#if showVersionGallery}
		<VersionGallery
			nodeId={id}
			currentContent={contentForVersionGallery}
			currentCommit={nodeData?.commit ?? ''}
			snapshotRefs={nodeData?.snapshotRefs ?? []}
			onRestore={handleRestore}
			onClose={() => showVersionGallery = false}
		/>
	{/if}
</div>

<style>
	/* Override xyflow default node wrapper styles */
	:global(.svelte-flow__node-prompt),
	:global(.svelte-flow__node-input),
	:global(.svelte-flow__node-generated),
	:global(.svelte-flow__node-vfs),
	:global(.svelte-flow__node-sandbox) {
		background: transparent !important;
		border: none !important;
		padding: 0 !important;
		border-radius: 0 !important;
		width: auto !important;
		box-shadow: none !important;
		outline: none !important;
	}
	
	/* Override selected state styles */
	:global(.svelte-flow__node-prompt.selected),
	:global(.svelte-flow__node-input.selected),
	:global(.svelte-flow__node-generated.selected),
	:global(.svelte-flow__node-vfs.selected),
	:global(.svelte-flow__node-sandbox.selected) {
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
		outline: none !important;
	}
</style>
