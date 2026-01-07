<script lang="ts">
	/**
	 * GraphNode - Unified node component that routes to specific node types
	 * 
	 * This component handles PROMPT, INPUT, and GENERATED node types.
	 * VFS nodes are handled separately by VFSNode component.
	 */
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { StudioNodeData, PromptNodeData, InputNodeData, GeneratedNodeData } from '../../types';
	import { PromptNode } from './prompt';
	import { InputNode } from './input';
	import { GeneratedNode } from './generated';

	let props: NodeProps<Node<StudioNodeData>> = $props();

	const nodeType = $derived(props.data.type);
</script>

{#if nodeType === 'PROMPT'}
	<PromptNode {...props as NodeProps<Node<PromptNodeData, 'prompt'>>} />
{:else if nodeType === 'INPUT'}
	<InputNode {...props as NodeProps<Node<InputNodeData, 'input'>>} />
{:else if nodeType === 'GENERATED'}
	<GeneratedNode {...props as NodeProps<Node<GeneratedNodeData, 'generated'>>} />
{:else}
	<div class="p-3 text-sm text-gray-500 bg-white rounded-lg border border-gray-200">
		Unknown node type: {nodeType}
	</div>
{/if}
