<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data, isConnectable, selected, id }: NodeProps = $props();
	let textareaRef: HTMLTextAreaElement | null = $state(null);
	
	// Derived values for INPUT type
	const sourcePromptIds = $derived((data.sourcePromptIds as string[] | undefined) || []);
	
	// Style config based on node type
	const isInput = $derived(data.type === 'INPUT');
	const headerBgClass = $derived(isInput ? 'bg-purple-500' : 'bg-blue-500');
	const borderClass = $derived(
		selected 
			? (isInput ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-blue-500 ring-2 ring-blue-500/20')
			: 'border-gray-200'
	);
	const handleBgClass = $derived(isInput ? 'bg-purple-400!' : 'bg-blue-400!');
	
	function handleFocus() {
		(data.onEditStart as ((id: string) => void) | undefined)?.(id);
	}
	
	function handleBlur() {
		(data.onEditEnd as ((id: string) => void) | undefined)?.(id);
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
			(data.registerTextarea as ((id: string, el: HTMLTextAreaElement) => void) | undefined)?.(id, textareaRef);
			// Initial resize
			autoResize();
		}
		return () => {
			(data.unregisterTextarea as ((id: string) => void) | undefined)?.(id);
		};
	});
</script>

<div class="w-80 rounded-lg border bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden group {borderClass}">
	<!-- Header -->
	<div class="{headerBgClass} px-3 py-2 border-b border-gray-200 flex items-center gap-2">
		{#if isInput}
			<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
			</svg>
		{:else}
			<div class="w-2 h-2 rounded-full {data.isEditing ? 'bg-green-300 shadow-[0_0_8px_rgba(134,239,172,0.8)]' : 'bg-gray-50'} transition-colors duration-300"></div>
		{/if}
		<span class="text-xs font-bold text-gray-100 uppercase tracking-wider">{data.type || 'NODE'}</span>
		{#if isInput && sourcePromptIds.length > 0}
			<span class="ml-auto text-xs text-purple-200">{sourcePromptIds.length} prompt{sourcePromptIds.length > 1 ? 's' : ''}</span>
		{/if}
	</div>
	
	<!-- Content -->
	<div class="bg-white {isInput ? 'p-3 bg-gray-50' : 'p-0'}">
		{#if data.type === 'PROMPT'}
			<textarea
				bind:this={textareaRef}
				class="nodrag nowheel w-full min-h-[80px] max-h-42 p-3 text-sm text-gray-700 resize-none border-none focus:ring-0 focus:outline-none block placeholder:text-gray-400 text-left overflow-y-auto"
				placeholder="Enter prompt content..."
				bind:value={data.content}
				onfocus={handleFocus}
				onblur={handleBlur}
				oninput={autoResize}
				onwheel={handleWheel}
			></textarea>
		{:else if data.type === 'INPUT'}
			<div 
				class="nodrag nowheel text-sm text-gray-700 whitespace-pre-wrap break-words max-h-64 overflow-y-auto text-left"
				onwheel={handleWheel}
			>
				{data.content || 'No content'}
			</div>
		{:else}
			<div class="p-3 text-sm text-gray-500">
				Unknown node type
			</div>
		{/if}
	</div>

	<Handle type="target" position={Position.Left} {isConnectable} class="w-3! h-3! {handleBgClass} border-2! border-white!" />
	<Handle type="source" position={Position.Right} {isConnectable} class="w-3! h-3! {handleBgClass} border-2! border-white!" />
</div>

<style>
	/* Override xyflow default node wrapper styles */
	:global(.svelte-flow__node-prompt),
	:global(.svelte-flow__node-input) {
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
	:global(.svelte-flow__node-input.selected) {
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
		outline: none !important;
	}
</style>
