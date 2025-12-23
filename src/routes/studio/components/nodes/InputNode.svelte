<script lang="ts">
	/**
	 * InputNode - User input node type
	 * 
	 * Features:
	 * - Editable text content
	 * - Two input handles: Prompts (STRING, 0-N) and VFS (0-1)
	 * - Generate button to trigger LLM generation
	 */
	import { Handle, Position, useEdges } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { InputNodeData } from '../../utils/types';
	import { getStudioContext } from '../../stores/context';
	import { HandleId } from '../../utils/connection';
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
	const allEdges = useEdges();

	// ============================================================================
	// Derived
	// ============================================================================

	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	const displayContent = $derived(previewState?.content ?? data.content);

	/** Count of connected prompt nodes */
	const connectedPromptCount = $derived.by(() => {
		return allEdges.current.filter(e => 
			e.target === id && e.targetHandle === HandleId.PROMPT_INPUT
		).length;
	});

	/** Whether a VFS node is connected */
	const hasVfsConnection = $derived.by(() => {
		return allEdges.current.some(e => 
			e.target === id && e.targetHandle === HandleId.VFS_INPUT
		);
	});

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
	showLeftHandle={false}
>
	{#snippet leftHandles()}
		<!-- Prompt Input Handle (top) -->
		<Handle 
			type="target" 
			id={HandleId.PROMPT_INPUT}
			position={Position.Left} 
			style="top: 30%;"
			{isConnectable}
			class="w-3! h-3! bg-blue-400! border-2! border-white!"
		/>
		<!-- VFS Input Handle (bottom) -->
		<Handle 
			type="target" 
			id={HandleId.VFS_INPUT}
			position={Position.Left} 
			style="top: 70%;"
			isConnectable={isConnectable && !hasVfsConnection}
			class="w-3! h-3! bg-indigo-400! border-2! border-white!"
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if !isPreviewing}
			{#if connectedPromptCount > 0}
				<span class="text-xs text-purple-200">{connectedPromptCount} prompt{connectedPromptCount > 1 ? 's' : ''}</span>
			{/if}
			{#if hasVfsConnection}
				<span class="text-xs text-indigo-200 flex items-center gap-0.5">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
					</svg>
					VFS
				</span>
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
