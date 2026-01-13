<script lang="ts">
	/**
	 * GeneratedNode - AI-generated content node type
	 * 
	 * Features:
	 * - Displays markdown-rendered content
	 * - Streaming indicator during generation
	 * - Tool call display during streaming (inline with content)
	 * - Regenerate button
	 * 
	 * Runtime state (isStreaming) is component-local, managed via event callbacks.
	 */
	import { onMount } from 'svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { GeneratedNodeData, FlowNodeData } from '../../../types';
	import type { MessageBlock } from '@pubwiki/chat';
	import { blocksToContent } from '@pubwiki/chat';
	import { getStudioContext } from '../../../state';
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import { nodeStore } from '../../../persistence';
	import { onStreamingChange, regenerate, abortGeneration } from './controller.svelte';
	import { marked } from 'marked';
	import BaseNode from '../BaseNode.svelte';
	import ToolCallDisplay from './ToolCallDisplay.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	let { isConnectable, selected, id }: NodeProps<Node<FlowNodeData, 'generated'>> = $props();

	// ============================================================================
	// Context
	// ============================================================================

	const ctx = getStudioContext();
	const settings = getSettingsStore();

	// ============================================================================
	// Node Data
	// ============================================================================

	const nodeData = $derived(nodeStore.get(id) as GeneratedNodeData | undefined);

	// ============================================================================
	// Local State
	// ============================================================================

	let isStreaming = $state(false);

	// Subscribe to streaming events on mount
	onMount(() => {
		return onStreamingChange(id, (streaming) => {
			isStreaming = streaming;
		});
	});

	// ============================================================================
	// Derived
	// ============================================================================

	const blocks = $derived(nodeData?.content?.blocks || []);
	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	// For preview, use historical content blocks; otherwise render current blocks
	const displayContent = $derived(
		isPreviewing && previewState?.content && 'blocks' in previewState.content
			? blocksToContent(previewState.content.blocks as MessageBlock[])
			: blocksToContent(blocks)
	);

	// ============================================================================
	// Event Handlers
	// ============================================================================

	async function handleRegenerate() {
		const callbacks = {
			updateNodeData: ctx.updateNodeData,
			updateEdges: ctx.updateEdges,
		};
		const config = {
			apiKey: settings.api.apiKey,
			model: settings.api.selectedModel,
			baseUrl: settings.effectiveBaseUrl
		};
		await regenerate(config, id, ctx.nodes, ctx.edges, callbacks);
	}

	function handleAbort() {
		abortGeneration(id);
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

	// Convert a MessageBlock to a tool call state for ToolCallDisplay
	function blockToToolCall(block: MessageBlock) {
		return {
			id: block.toolCallId || block.id,
			name: block.toolName || '',
			args: block.toolArgs,
			status: block.toolStatus || 'pending',
			result: undefined,
			error: undefined
		};
	}
</script>

<BaseNode
	{id}
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
		{#if isStreaming}
			<button
				class="nodrag px-2 py-0.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded text-white transition-colors flex items-center gap-1"
				onclick={handleAbort}
				title={m.studio_node_abort_generation()}
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
				{m.common_cancel()}
			</button>
		{:else if !isPreviewing}
			<button
				class="nodrag px-2 py-0.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded text-white transition-colors flex items-center gap-1"
				onclick={handleRegenerate}
				title={m.studio_node_regenerate_historical()}
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				{m.studio_properties_regenerate()}
			</button>
		{/if}
	{/snippet}

	{#snippet children()}
		<div 
			class="nodrag nowheel generated-content w-full min-h-20 max-h-64 p-3 text-sm text-gray-700 overflow-y-auto transition-colors duration-300 {isStreaming ? 'bg-yellow-50/50' : 'bg-green-50/30'}"
			onwheel={handleWheel}
		>
			{#if isPreviewing}
				<!-- Preview mode: show content as before -->
				<div class="prose prose-sm max-w-none text-left select-text">
					{@html marked.parse(displayContent || '')}
				</div>
			{:else}
				<!-- Normal mode: render blocks in order -->
				{#each blocks as block (block.id)}
					{#if block.type === 'markdown' || block.type === 'text'}
						<div class="prose prose-sm max-w-none text-left select-text">
							{@html marked.parse(block.content || '')}
						</div>
					{:else if block.type === 'tool_call'}
						<div class="my-1">
							<ToolCallDisplay toolCall={blockToToolCall(block)} />
						</div>
					{:else if block.type === 'tool_result'}
						<!-- Tool results are typically hidden or shown within tool call display -->
					{/if}
				{/each}
				{#if isStreaming}
					<span class="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5"></span>
				{/if}
			{/if}
		</div>
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
