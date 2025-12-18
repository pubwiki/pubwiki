<script lang="ts">
	import { Handle, Position, useSvelteFlow, type NodeProps, type Node, useUpdateNodeInternals, useEdges } from '@xyflow/svelte';
	import type { StudioNodeData, BaseNodeData, NodeRef, SnapshotEdge } from '../utils/types';
	import { hasVersionHistory, getVersionCount } from '../utils/types';
	import { getStudioContext } from '../stores/context';
	import { getUniqueHashtagNames, getHashtagConnectionsFromSnapshotEdges } from '../utils/hashtag';
	import VersionGallery from './VersionGallery.svelte';
	import RichTextArea from './RichTextArea.svelte';
	import { marked } from 'marked';

	let { data, isConnectable, selected, id }: NodeProps<Node<StudioNodeData>> = $props();
	
	// Get studio context for operations
	const ctx = getStudioContext();
	const updateNodeInternals = useUpdateNodeInternals();
	
	let textareaRef: HTMLTextAreaElement | null = $state(null);
	let showVersionGallery = $state(false);
	
	// Version control state
	const versionCount = $derived(getVersionCount(data as BaseNodeData));
	const hasHistory = $derived(hasVersionHistory(data as BaseNodeData));
	
	// Preview state - from context
	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	const isUsed = $derived(!!previewState?.isUsed);
	const displayContent = $derived(previewState?.content ?? data.content);
	const displayCommit = $derived(previewState?.commit ?? data.commit);
	
	// Hashtag slots for PROMPT nodes - use displayContent for preview mode
	const hashtagNames = $derived(
		data.type === 'PROMPT' ? getUniqueHashtagNames(displayContent) : []
	);

	$effect(() => {
		// Trigger update when hashtags change so handles are registered
		hashtagNames;
		updateNodeInternals(id);
	});

	// Get hashtag connections - use historical edges in preview mode
	const currentEdges = useEdges()
	const hashtagConnections = $derived.by(() => {
		if (data.type !== 'PROMPT') return new Map<string, string>();
		
		// In preview mode, use historical incoming edges if available
		if (isPreviewing && previewState?.incomingEdges) {
			return getHashtagConnectionsFromSnapshotEdges(previewState.incomingEdges);
		}
		
		// Otherwise use current edges
		return getHashtagConnectionsFromSnapshotEdges(
			currentEdges.current
				.filter(e => e.target === id)
				.map(e => ({
					source: e.source,
					sourceHandle: e.sourceHandle,
					targetHandle: e.targetHandle
				}))
		);
	});
	
	// Calculate the version number being previewed (1-indexed, where current is versionCount)
	const previewVersionNumber = $derived.by(() => {
		if (!isPreviewing || !previewState?.commit) return null;
		const nodeData = data as BaseNodeData;
		// Find the index of this commit in snapshotRefs
		const index = nodeData.snapshotRefs.findIndex(ref => ref.commit === previewState.commit);
		if (index >= 0) {
			return index + 1; // 1-indexed
		}
		return null;
	});
	
	// Derived values for INPUT type
	const sourcePromptIds = $derived(data.type === 'INPUT' ? data.sourcePromptIds : []);
	
	// Phantom node check (deleted nodes shown in historical view)
	const isPhantom = $derived(!!(data as any).isPhantom);
	
	// Style config based on node type
	const isInput = $derived(data.type === 'INPUT');
	const isGenerated = $derived(data.type === 'GENERATED');
	const isStreaming = $derived(data.type === 'GENERATED' && data.isStreaming);
	const isEditing = $derived(data.type === 'PROMPT' && ctx.editingNodeId === id);
	
	// Header color - only phantom changes the header color
	const headerBgClass = $derived(
		isPhantom ? 'bg-gray-400' :
		isInput ? 'bg-purple-500' : 
		isGenerated ? 'bg-green-500' : 
		'bg-blue-500'
	);
	// Border color - used/previewing changes border only
	const borderClass = $derived(
		isPhantom ? 'border-gray-400 ring-2 ring-gray-400/30' :
		isPreviewing ? 'border-amber-500 ring-2 ring-amber-500/30' :
		isUsed ? 'border-emerald-500 ring-2 ring-emerald-500/30' :
		selected 
			? (isInput ? 'border-purple-500 ring-2 ring-purple-500/20' : 
			   isGenerated ? 'border-green-500 ring-2 ring-green-500/20' :
			   'border-blue-500 ring-2 ring-blue-500/20')
			: 'border-gray-200'
	);
	const handleBgClass = $derived(
		isInput ? 'bg-purple-400!' : 
		isGenerated ? 'bg-green-400!' :
		'bg-blue-400!'
	);
	
	// Event handlers - now using context directly
	function handleFocus() {
		ctx.setEditingNodeId(id);
	}
	
	function handleBlur() {
		if (ctx.editingNodeId === id) {
			ctx.setEditingNodeId(null);
		}
	}
	
	function handleGenerate() {
		ctx.onGenerate(id);
	}
	
	function handleRegenerate() {
		ctx.onRegenerate(id);
	}

	function handlePromptContentChange(newValue: string) {
		ctx.updateNode(id, (nodeData) => ({
			...nodeData,
			content: newValue
		}));
	}

	function handleVersionClick() {
		if (hasHistory) {
			showVersionGallery = !showVersionGallery;
		}
	}

	function handleRestore(snapshotRef: NodeRef) {
		ctx.onRestore(id, snapshotRef);
	}
	
	// Auto-resize textarea
	function autoResize() {
		if (textareaRef) {
			textareaRef.style.height = 'auto';
			textareaRef.style.height = Math.min(textareaRef.scrollHeight, 256) + 'px';
		}
	}
	
	// Handle wheel event to prevent canvas scroll when scrolling inside node
	function handleWheel(e: WheelEvent) {
		const target = e.currentTarget as HTMLElement;
		const { scrollTop, scrollHeight, clientHeight } = target;
		const isScrollable = scrollHeight > clientHeight;
		
		if (isScrollable) {
			const isAtTop = scrollTop === 0 && e.deltaY < 0;
			const isAtBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
			
			// Only stop propagation if we can scroll in the direction of the wheel
			if (!isAtTop && !isAtBottom) {
				e.stopPropagation();
			}
		}
	}
	
	// Register/unregister textarea ref for external focus control
	$effect(() => {
		if (textareaRef) {
			ctx.registerTextarea(id, textareaRef);
			// Initial resize
			autoResize();
		}
		return () => {
			ctx.unregisterTextarea(id);
		};
	});
</script>

<div class="relative {isPhantom ? 'opacity-60' : ''}" style="overflow: visible;">
	<!-- Version history stack effect (poker card style) -->
	{#if hasHistory && !isPhantom}
		{#each {length: Math.min(versionCount - 1, 3)} as _, i}
			<div 
				class="absolute w-80 h-full rounded-lg border bg-white shadow-sm {borderClass}"
				style="
					transform: translate({(3 - i) * 3}px, {(3 - i) * -3}px);
					z-index: {-3 + i};
					opacity: {0.6 - i * 0.15};
				"
			></div>
		{/each}
	{/if}
	
	<!-- Main node card -->
	<div class="relative w-80 rounded-lg border bg-white shadow-sm hover:shadow-md transition-all duration-300 group {borderClass} overflow-hidden">
		<!-- Phantom node banner -->
		{#if isPhantom}
			<div class="bg-gray-200 px-3 py-1 text-xs text-gray-600 font-medium flex items-center gap-1 border-b border-gray-300">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
				</svg>
				Deleted node (historical)
			</div>
		<!-- Preview indicator banner -->
		{:else if isPreviewing}
			<div class="bg-amber-100 px-3 py-1 text-xs text-amber-700 font-medium flex items-center gap-1 border-b border-amber-200">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				Historical version: {displayCommit?.slice(0, 7)}
			</div>
		<!-- Used indicator banner -->
		{:else if isUsed}
			<div class="bg-emerald-100 px-3 py-1 text-xs text-emerald-700 font-medium flex items-center gap-1 border-b border-emerald-200">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				Used in generation
			</div>
		{/if}
		
		<!-- Header -->
		<div class="{headerBgClass} px-3 py-2 border-b border-gray-200 flex items-center gap-2 transition-colors duration-300">
			{#if isInput}
				<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
				</svg>
			{:else if isGenerated}
				<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
				</svg>
				{#if isStreaming}
					<div class="w-2 h-2 rounded-full bg-yellow-300 animate-pulse"></div>
				{/if}
			{:else}
				<div class="w-2 h-2 rounded-full {isEditing ? 'bg-green-300 shadow-[0_0_8px_rgba(134,239,172,0.8)]' : 'bg-gray-50'} transition-colors duration-300"></div>
			{/if}
			<span class="text-xs font-bold text-gray-100 uppercase tracking-wider">{data.type || 'NODE'}</span>
			
			<!-- Historical version indicator -->
			{#if isPreviewing}
				<span
					class="px-1.5 py-0.5 text-xs bg-white/30 rounded text-white/90 flex items-center gap-1"
					title="Viewing historical version"
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
					title="View version history"
				>
					v{versionCount}
				</button>
			{/if}
			
			<div class="ml-auto flex items-center gap-2">
				{#if isInput && !isPreviewing}
					{#if sourcePromptIds.length > 0}
						<span class="text-xs text-purple-200">{sourcePromptIds.length} prompt{sourcePromptIds.length > 1 ? 's' : ''}</span>
					{/if}
					<!-- Generate button -->
					<button
						class="nodrag px-2 py-0.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded text-white transition-colors flex items-center gap-1"
						onclick={handleGenerate}
						title="Generate from this input"
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
						Generate
					</button>
				{/if}
				{#if isGenerated && !isPreviewing && !isStreaming}
					<!-- Regenerate button -->
					<button
						class="nodrag px-2 py-0.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded text-white transition-colors flex items-center gap-1"
						onclick={handleRegenerate}
						title="Regenerate using historical input"
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						Regenerate
					</button>
				{/if}
			</div>
		</div>
		
		<!-- Content -->
		<div class="bg-white overflow-hidden rounded-b-lg {isPreviewing ? 'bg-amber-50/50' : ''}">
			{#if data.type === 'PROMPT'}
				<RichTextArea
					value={displayContent}
					readonly={isPreviewing}
					placeholder="Enter prompt content..."
					class={isPreviewing ? 'bg-amber-50/30' : ''}
					onchange={handlePromptContentChange}
					onfocus={handleFocus}
					onblur={handleBlur}
				/>
			{:else if data.type === 'INPUT'}
				<RichTextArea
					value={displayContent}
					readonly={isPreviewing}
					placeholder="Enter your input"
					class={isPreviewing ? 'bg-amber-50/30' : ''}
					onchange={handlePromptContentChange}
					onfocus={handleFocus}
					onblur={handleBlur}
				/>
			{:else if data.type === 'GENERATED'}
				{#if isStreaming}
					<div 
						class="nodrag nowheel w-full min-h-20 max-h-64 p-3 text-sm text-gray-700 overflow-y-auto bg-yellow-50/50"
						onwheel={handleWheel}
					>
						<div class="prose prose-sm max-w-none">
							{@html marked.parse(displayContent || '')}
						</div>
						<span class="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5"></span>
					</div>
				{:else}
					<div 
						class="nodrag nowheel w-full min-h-20 max-h-64 p-3 text-sm text-gray-700 overflow-y-auto bg-green-50/30"
						onwheel={handleWheel}
					>
						<div class="prose prose-sm max-w-none text-left">
							{@html marked.parse(displayContent || '')}
						</div>
					</div>
				{/if}
			{:else}
				<div class="p-3 text-sm text-gray-500">
					Unknown node type
				</div>
			{/if}
		</div>
	</div>

	<!-- Default Handles -->
	{#if !(data.type === 'PROMPT')}
		<Handle type="target" position={Position.Left} {isConnectable} class="w-3! h-3! {handleBgClass} border-2! border-white!" />
	{/if}
	<Handle type="source" position={Position.Right} {isConnectable} class="w-3! h-3! {handleBgClass} border-2! border-white!" />
	
	<!-- Hashtag Sidebar (for PROMPT nodes with hashtags) - Behind the main node -->
	{#if data.type === 'PROMPT' && hashtagNames.length > 0}
		<div class="absolute right-[calc(100%-16px)] top-1/2 -translate-y-1/2 min-h-full flex items-stretch z-[-1]">
			<div class="bg-gray-50 border border-gray-200 rounded-lg flex flex-col justify-center py-2 pl-0 pr-5 gap-2 min-w-8">
				{#each hashtagNames as hashtagName, i (hashtagName)}
					{@const isConnected = hashtagConnections.has(hashtagName)}
					{@const tagBg = isConnected ? 'bg-blue-50' : 'bg-white'}
					{@const tagBorder = isConnected ? 'border-blue-300' : 'border-gray-300'}
					{@const tagText = isConnected ? 'text-blue-600' : 'text-gray-600'}
					{@const handleColor = isConnected ? 'bg-blue-500' : 'bg-gray-400'}
					
					<div class="relative flex items-center group">
						<!-- Left Tip (Triangle) - Protruding out -->
						<div class="absolute right-full top-0 h-full flex items-center justify-end pr-px z-20">
							<div class="relative w-2.5 h-5 overflow-hidden">
								<div class="absolute top-1/2 right-[-7px] w-3.5 h-3.5 {tagBg} border {tagBorder} transform -translate-y-1/2 rotate-45"></div>
                                
                                <Handle 
                                    type="target" 
                                    position={Position.Left} 
                                    id="hashtag-{hashtagName}"
                                    isConnectable={!isConnected} 
                                    class="w-1.5! h-1.5! {handleColor}! border-none! min-w-0! min-h-0! z-30"
                                    style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); left: auto;"
                                />
							</div>
						</div>

						<!-- Right Body (Inside Sidebar) -->
						<div class="{tagBg} border {tagBorder} border-l-0 rounded-r px-1.5 h-5 flex items-center text-[10px] font-medium {tagText} whitespace-nowrap z-10 relative -ml-px">
							#{hashtagName}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Version Gallery -->
	{#if showVersionGallery}
		<VersionGallery
			nodeId={data.id}
			currentContent={data.content}
			currentCommit={data.commit}
			snapshotRefs={data.snapshotRefs}
			onRestore={handleRestore}
			onClose={() => showVersionGallery = false}
		/>
	{/if}
</div>

<style>
	/* Override xyflow default node wrapper styles */
	:global(.svelte-flow__node-prompt),
	:global(.svelte-flow__node-input),
	:global(.svelte-flow__node-generated) {
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
	:global(.svelte-flow__node-generated.selected) {
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
		outline: none !important;
	}
	
	/* Hashtag highlight style */
	:global(.hashtag-highlight) {
		background-color: #e5e7eb;
		border-radius: 0.25rem;
		padding: 0.125rem 0.25rem;
		margin: -0.125rem 0;
	}
</style>
