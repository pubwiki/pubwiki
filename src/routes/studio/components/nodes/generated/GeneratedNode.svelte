<script lang="ts">
	/**
	 * GeneratedNode - AI-generated content node type
	 * 
	 * Features:
	 * - Displays markdown-rendered content
	 * - Streaming indicator during generation
	 * - Regenerate button
	 */
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { GeneratedNodeData } from '../../../utils/types';
	import { getStudioContext } from '../../../stores/context';
	import { marked } from 'marked';
	import BaseNode from '../BaseNode.svelte';
	import { regenerate } from './controller.svelte';

	// ============================================================================
	// Props
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<GeneratedNodeData, 'generated'>> = $props();

	// ============================================================================
	// Context
	// ============================================================================

	const ctx = getStudioContext();

	// ============================================================================
	// Derived
	// ============================================================================

	const isStreaming = $derived(data.isStreaming);
	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	const displayContent = $derived(previewState?.content ?? data.content);

	// ============================================================================
	// Event Handlers
	// ============================================================================

	async function handleRegenerate() {
		const callbacks = {
			updateNodes: ctx.updateNodes,
			updateEdges: ctx.updateEdges,
		};
		await regenerate(id, ctx.nodes, ctx.edges, callbacks);
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

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="GENERATED"
	headerBgClass="bg-green-500"
	handleBgClass="bg-green-400!"
>
	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
		</svg>
		{#if isStreaming}
			<div class="w-2 h-2 rounded-full bg-yellow-300 animate-pulse"></div>
		{/if}
	{/snippet}

	{#snippet headerActions()}
		{#if !isPreviewing && !isStreaming}
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
	{/snippet}

	{#snippet children()}
		{#if isStreaming}
			<div 
				class="nodrag nowheel generated-content w-full min-h-20 max-h-64 p-3 text-sm text-gray-700 overflow-y-auto bg-yellow-50/50"
				onwheel={handleWheel}
			>
				<div class="prose prose-sm max-w-none text-left select-text">
					{@html marked.parse(displayContent || '')}
				</div>
				<span class="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5"></span>
			</div>
		{:else}
			<div 
				class="nodrag nowheel generated-content w-full min-h-20 max-h-64 p-3 text-sm text-gray-700 overflow-y-auto bg-green-50/30"
				onwheel={handleWheel}
			>
				<div class="prose prose-sm max-w-none text-left select-text">
					{@html marked.parse(displayContent || '')}
				</div>
			</div>
		{/if}
	{/snippet}
</BaseNode>

<style>
	/* Generated content - enable text selection and wrap code blocks */
	.generated-content {
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	
	.generated-content :global(pre),
	.generated-content :global(code) {
		white-space: pre-wrap;
		word-wrap: break-word;
		word-break: break-all;
		overflow-wrap: break-word;
	}
</style>
