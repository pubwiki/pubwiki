<script lang="ts">
	/**
	 * PromptNode - Prompt/system prompt node type
	 * 
	 * Features:
	 * - Editable rich text content
	 * - RefTag handles for connecting to other nodes
	 * - Version history support
	 */
	import { Handle, Position, useUpdateNodeInternals, useEdges } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { PromptNodeData, SnapshotEdge } from '../../utils/types';
	import { getStudioContext } from '../../stores/context';
	import { getUniqueRefTagNames, getRefTagConnectionsFromSnapshotEdges, REFTAG_HANDLE_PREFIX } from '../../utils/reftag';
	import BaseNode from './BaseNode.svelte';
	import RichTextArea from '../RichTextArea.svelte';

	// ============================================================================
	// Props
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<PromptNodeData, 'prompt'>> = $props();

	// ============================================================================
	// Context
	// ============================================================================

	const ctx = getStudioContext();
	const updateNodeInternals = useUpdateNodeInternals();
	const currentEdges = useEdges();

	// ============================================================================
	// Derived
	// ============================================================================

	const isEditing = $derived(ctx.editingNodeId === id);
	
	// Preview state
	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	const displayContent = $derived(previewState?.content ?? data.content);
	
	// RefTag slots - use displayContent for preview mode
	const refTagNames = $derived(getUniqueRefTagNames(displayContent));
	
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

	function handleContentChange(newValue: string) {
		ctx.updateNode(id, (nodeData) => ({
			...nodeData,
			content: newValue
		}));
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
		<RichTextArea
			value={displayContent}
			readonly={isPreviewing}
			placeholder="Enter prompt content..."
			class={isPreviewing ? 'bg-amber-50/30' : ''}
			onchange={handleContentChange}
			onfocus={handleFocus}
			onblur={handleBlur}
		/>
	{/snippet}

	{#snippet leftHandles()}
		<!-- No default left handle - we use reftag handles instead -->
	{/snippet}

	{#snippet rightHandles()}
		<Handle type="source" position={Position.Right} {isConnectable} class="w-3! h-3! bg-blue-400! border-2! border-white!" />
		
		<!-- RefTag sidebar -->
		{#if refTagNames.length > 0}
			<div class="absolute right-[calc(100%-16px)] top-1/2 -translate-y-1/2 min-h-full flex items-stretch z-[-1]">
				<div class="bg-gray-50 border border-gray-200 rounded-lg flex flex-col justify-center py-2 pl-0 pr-5 gap-2 min-w-8">
					{#each refTagNames as refTagName, i (refTagName)}
						{@const isConnected = refTagConnections.has(refTagName)}
						{@const tagBg = isConnected ? 'bg-blue-50' : 'bg-white'}
						{@const tagBorder = isConnected ? 'border-blue-300' : 'border-gray-300'}
						{@const tagText = isConnected ? 'text-blue-600' : 'text-gray-600'}
						{@const handleColor = isConnected ? 'bg-blue-500' : 'bg-gray-400'}
						
						<div class="relative flex items-center group">
							<!-- Left Tip (Triangle) -->
							<div class="absolute right-full top-0 h-full flex items-center justify-end pr-px z-20">
								<div class="relative w-2.5 h-5 overflow-hidden">
									<div class="absolute top-1/2 right-[-7px] w-3.5 h-3.5 {tagBg} border {tagBorder} transform -translate-y-1/2 rotate-45"></div>
									
									<Handle 
										type="target" 
										position={Position.Left} 
										id="{REFTAG_HANDLE_PREFIX}{refTagName}"
										isConnectable={!isConnected} 
										class="w-1.5! h-1.5! {handleColor}! border-none! min-w-0! min-h-0! z-30"
										style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); left: auto;"
									/>
								</div>
							</div>

							<!-- Right Body -->
							<div class="{tagBg} border {tagBorder} border-l-0 rounded-r px-1.5 h-5 flex items-center text-[10px] font-medium {tagText} whitespace-nowrap z-10 relative -ml-px">
								{refTagName}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
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
