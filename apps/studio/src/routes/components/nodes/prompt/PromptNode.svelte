<script lang="ts">
	/**
	 * PromptNode - Prompt/system prompt node type
	 * 
	 * Features:
	 * - Editable rich text content with Lexical editor
	 * - RefTag handles for connecting to other nodes
	 * - Version history support
	 * 
	 * Layer Separation: Business data comes from nodeStore, not props.
	 */
	import { Handle, Position, useUpdateNodeInternals, useEdges } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { FlowNodeData } from '../../../types/flow';
	import { PromptContent, type PromptNodeData, type ContentBlock, getRefTagNamesFromBlocks } from '../../../types';
	import { nodeStore } from '../../../persistence';
	import { getStudioContext } from '../../../state';
	import { getRefTagConnectionsFromSnapshotEdges } from '../../../graph';
	import { createRefTagHandleId } from '../../../graph';
	import BaseNode from '../BaseNode.svelte';
	import { RefTagEditor } from '../../editor';
	import TaggedHandlePanel from '../TaggedHandlePanel.svelte';
	import type { TaggedHandle } from '../TaggedHandlePanel.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props (Minimal - just for SvelteFlow)
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<FlowNodeData, 'PROMPT'>> = $props();

	// ============================================================================
	// Context and Stores
	// ============================================================================

	const ctx = getStudioContext();
	const updateNodeInternals = useUpdateNodeInternals();
	const currentEdges = useEdges();
	
	// Get business data from nodeStore (reactive)
	const nodeData = $derived(nodeStore.get(id));
	const content = $derived(nodeData?.content as PromptContent | undefined);

	// ============================================================================
	// Derived
	// ============================================================================

	const isEditing = $derived(ctx.editingNodeId === id);
	
	// Preview state
	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	
	// displayBlocks: in preview mode use historical content, otherwise use current content.blocks
	const displayBlocks = $derived<ContentBlock[]>(
		isPreviewing && previewState?.content 
			? [{ type: 'text', value: previewState.content }] // Preview content is string, wrap as text block
			: content?.blocks ?? []
	);
	
	// RefTag slots - extract from blocks
	const refTagNames = $derived(getRefTagNamesFromBlocks(displayBlocks));
	
	// Collect all existing reftag names for autocomplete suggestions
	const allRefTagSuggestions = $derived.by(() => {
		const names = new Set<string>();
		for (const node of nodeStore.getAll()) {
			if (node.type === 'PROMPT' && node.content instanceof PromptContent) {
				for (const block of node.content.blocks) {
					if (block.type === 'reftag') {
						names.add(block.name);
					}
				}
			}
		}
		return [...names];
	});
	
	// Get reftag connections
	const refTagConnections = $derived.by(() => {
		// In preview mode, use historical incoming edges if available
		if (isPreviewing && previewState?.incomingEdges) {
			return getRefTagConnectionsFromSnapshotEdges(previewState.incomingEdges);
		}
		
		// Otherwise use current edges
		return getRefTagConnectionsFromSnapshotEdges(
			currentEdges.current
				.filter(e => e.target === id)
				.map(e => ({
					source: e.source,
					sourceHandle: e.sourceHandle,
					targetHandle: e.targetHandle
				}))
		);
	});

	// Convert refTagNames to TaggedHandle format
	const taggedHandles = $derived<TaggedHandle[]>(
		refTagNames.map(name => ({
			id: createRefTagHandleId(name),
			label: name,
			isConnected: refTagConnections.has(name)
		}))
	);

	// ============================================================================
	// Effects
	// ============================================================================

	$effect(() => {
		// Trigger update when reftags change so handles are registered
		refTagNames;
		updateNodeInternals(id);
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

	function handleContentChange(newBlocks: ContentBlock[]) {
		ctx.updateNodeData(id, (data) => {
			const promptData = data as PromptNodeData;
			return {
				...promptData,
				content: promptData.content.withBlocks(newBlocks)
			};
		});
	}
</script>

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="PROMPT"
	headerBgClass="bg-blue-500"
	handleBgClass="bg-blue-400!"
	showLeftHandle={false}
>
	{#snippet headerIcon()}
		<div class="w-2 h-2 rounded-full {isEditing ? 'bg-green-300 shadow-[0_0_8px_rgba(134,239,172,0.8)]' : 'bg-gray-50'} transition-colors duration-300"></div>
	{/snippet}

	{#snippet children()}
		<RefTagEditor
			value={displayBlocks}
			readonly={isPreviewing}
			placeholder={m.studio_node_enter_prompt()}
			class={isPreviewing ? 'bg-amber-50/30' : ''}
			suggestions={allRefTagSuggestions}
			onchange={handleContentChange}
			onfocus={handleFocus}
			onblur={handleBlur}
		/>
	{/snippet}

	{#snippet leftHandles()}
		<!-- No default left handle - we use reftag handles instead -->
	{/snippet}

	{#snippet rightHandles()}
		<Handle type="source" position={Position.Right} {isConnectable} class="w-3! h-3! bg-blue-400! border-2! border-white! z-10!" />
		
		<!-- RefTag panel using the reusable component -->
		<TaggedHandlePanel 
			handles={taggedHandles}
			{isConnectable}
			nodeOverlap={24}
		/>
	{/snippet}
</BaseNode>

<style>
	:global(.reftag-highlight) {
		background-color: #e5e7eb;
		border-radius: 0.25rem;
		padding: 0.125rem 0.25rem;
		margin: -0.125rem 0;
	}
</style>
