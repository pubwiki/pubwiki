<script lang="ts">
	/**
	 * InputNode - User input node type
	 * 
	 * Features:
	 * - Editable text content
	 * - Shows connected prompt count
	 * - Generate button to trigger LLM generation
	 */
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { InputNodeData } from '../../utils/types';
	import { getStudioContext } from '../../stores/context';
	import BaseNode from './BaseNode.svelte';
	import RichTextArea from '../RichTextArea.svelte';

	// ============================================================================
	// Props
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<InputNodeData, 'input'>> = $props();

	// ============================================================================
	// Context
	// ============================================================================

	const ctx = getStudioContext();

	// ============================================================================
	// Derived
	// ============================================================================

	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	const displayContent = $derived(previewState?.content ?? data.content);
	const sourcePromptIds = $derived(data.sourcePromptIds);

	// ============================================================================
	// Event Handlers
	// ============================================================================

	function handleFocus() {
		ctx.setEditingNodeId(id);
	}

	function handleBlur() {
		if (ctx.editingNodeId === id) {
			ctx.setEditingNodeId(null);
		}
	}

	function handleContentChange(newValue: string) {
		ctx.updateNode(id, (nodeData) => ({
			...nodeData,
			content: newValue
		}));
	}

	function handleGenerate() {
		ctx.onGenerate(id);
	}
</script>

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="INPUT"
	headerBgClass="bg-purple-500"
	handleBgClass="bg-purple-400!"
>
	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if !isPreviewing}
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
	{/snippet}

	{#snippet children()}
		<RichTextArea
			value={displayContent}
			readonly={isPreviewing}
			placeholder="Enter your input"
			class={isPreviewing ? 'bg-amber-50/30' : ''}
			onchange={handleContentChange}
			onfocus={handleFocus}
			onblur={handleBlur}
		/>
	{/snippet}
</BaseNode>
