<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { onMount, onDestroy } from 'svelte';

	let { data, isConnectable, selected, id }: NodeProps = $props();
	let textareaRef: HTMLTextAreaElement | null = $state(null);
	
	function handleFocus() {
		(data.onEditStart as ((id: string) => void) | undefined)?.(id);
	}
	
	function handleBlur() {
		(data.onEditEnd as ((id: string) => void) | undefined)?.(id);
	}
	
	// Register/unregister textarea ref for external focus control
	$effect(() => {
		if (textareaRef) {
			(data.registerTextarea as ((id: string, el: HTMLTextAreaElement) => void) | undefined)?.(id, textareaRef);
		}
		return () => {
			(data.unregisterTextarea as ((id: string) => void) | undefined)?.(id);
		};
	});
</script>

<div class="w-80 rounded-lg border bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden group {selected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200'}">
	<!-- Header -->
	<div class="bg-blue-500 px-3 py-2 border-b border-gray-200 flex items-center gap-2">
		<div class="w-2 h-2 rounded-full {data.isEditing ? 'bg-green-300 shadow-[0_0_8px_rgba(134,239,172,0.8)]' : 'bg-gray-50'} transition-colors duration-300"></div>
		<span class="text-xs font-bold text-gray-100 uppercase tracking-wider">{data.type || 'NODE'}</span>
	</div>
	
	<!-- Content -->
	<div class="p-0 bg-white">
		{#if data.type === 'PROMPT'}
			<textarea
				bind:this={textareaRef}
				class="nodrag w-full h-32 p-3 text-sm text-gray-700 resize-none border-none focus:ring-0 focus:outline-none block placeholder:text-gray-400"
				placeholder="Enter prompt content..."
				bind:value={data.content}
				onfocus={handleFocus}
				onblur={handleBlur}
			></textarea>
		{:else}
			<div class="p-3 text-sm text-gray-500">
				Unknown node type
			</div>
		{/if}
	</div>

	<Handle type="target" position={Position.Left} {isConnectable} class="w-3! h-3! bg-blue-400! border-2! border-white!" />
	<Handle type="source" position={Position.Right} {isConnectable} class="w-3! h-3! bg-blue-400! border-2! border-white!" />
</div>
