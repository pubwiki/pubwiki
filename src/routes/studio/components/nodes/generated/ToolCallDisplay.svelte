<script lang="ts">
	/**
	 * ToolCallDisplay - Simplified tool call display for GeneratedNode
	 * 
	 * Displays tool call status during streaming generation.
	 * Based on packages/svelte-chat/src/lib/blocks/ToolCallBlock.svelte
	 */
	import type { ToolCallState } from '../../../utils/types';

	interface Props {
		toolCall: ToolCallState;
		class?: string;
	}

	let { toolCall, class: className = '' }: Props = $props();

	let expanded = $state(false);

	// Format tool arguments for display
	let formattedArgs = $derived.by(() => {
		const args = toolCall.args;
		if (!args) return '';
		if (typeof args === 'string') {
			try {
				return JSON.stringify(JSON.parse(args), null, 2);
			} catch {
				return args;
			}
		}
		return JSON.stringify(args, null, 2);
	});

	// Format tool result for display
	let formattedResult = $derived.by(() => {
		if (!toolCall.result) return '';
		if (typeof toolCall.result === 'string') {
			try {
				return JSON.stringify(JSON.parse(toolCall.result), null, 2);
			} catch {
				return toolCall.result;
			}
		}
		return JSON.stringify(toolCall.result, null, 2);
	});

	// Status states
	let isLoading = $derived(toolCall.status === 'running' || toolCall.status === 'pending');
	let isError = $derived(toolCall.status === 'error');
	let isCompleted = $derived(toolCall.status === 'completed');
</script>

<div 
	class="tool-call my-1 overflow-hidden rounded-lg border transition-all {className}
		{isError ? 'border-red-400/50 bg-red-50/50' : ''}
		{isLoading ? 'border-blue-400/50 bg-blue-50/50' : ''}
		{!isError && !isLoading ? 'border-gray-200 bg-gray-50/50' : ''}"
>
	<!-- Header -->
	<button
		type="button"
		onclick={() => expanded = !expanded}
		class="nodrag flex w-full items-center justify-between px-2 py-1.5 text-left transition-opacity hover:opacity-70"
	>
		<div class="flex items-center gap-2">
			<!-- Icon Container -->
			<div 
				class="flex items-center justify-center rounded p-1
					{isError ? 'bg-red-500' : 'bg-blue-500'}"
			>
				{#if isLoading}
					<svg class="h-3 w-3 animate-spin text-white" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else if isError}
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				{:else}
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
				{/if}
			</div>

			<!-- Tool Name -->
			<span class="text-xs font-medium text-gray-700">
				{toolCall.name}
			</span>

			<!-- Status Badge -->
			{#if isCompleted}
				<div class="flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5">
					<svg class="h-2.5 w-2.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					<span class="text-[10px] text-green-600">Done</span>
				</div>
			{/if}
			{#if isLoading}
				<div class="flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5">
					<svg class="h-2.5 w-2.5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span class="text-[10px] text-blue-600">Running</span>
				</div>
			{/if}
			{#if isError}
				<div class="flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5">
					<svg class="h-2.5 w-2.5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
					<span class="text-[10px] text-red-600">Error</span>
				</div>
			{/if}
		</div>

		<!-- Expand/Collapse Icon -->
		<div class="flex items-center gap-1">
			<span class="text-[10px] text-gray-400">
				{expanded ? 'Hide' : 'Details'}
			</span>
			<svg
				class="h-3 w-3 text-gray-400 transition-transform {expanded ? '' : '-rotate-90'}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</div>
	</button>

	<!-- Expanded content -->
	{#if expanded}
		<div class="space-y-2 border-t border-gray-200/50 px-2 py-2">
			<!-- Arguments -->
			{#if formattedArgs}
				<div>
					<div class="mb-1 text-[10px] font-semibold text-gray-500">
						Arguments
					</div>
					<pre class="max-h-24 overflow-auto rounded border border-gray-200/50 bg-white/50 p-1.5 text-[10px] text-gray-700"><code>{formattedArgs}</code></pre>
				</div>
			{/if}

			<!-- Error Message -->
			{#if isError && toolCall.error}
				<div>
					<div class="mb-1 text-[10px] font-semibold text-red-600">
						Error
					</div>
					<pre class="max-h-24 overflow-auto rounded border border-red-200/50 bg-red-50/50 p-1.5 text-[10px] text-red-700"><code>{toolCall.error}</code></pre>
				</div>
			{/if}

			<!-- Result -->
			{#if isCompleted && toolCall.result}
				<div>
					<div class="mb-1 text-[10px] font-semibold text-green-600">
						Result
					</div>
					<pre class="max-h-32 overflow-auto rounded border border-green-200/50 bg-green-50/50 p-1.5 text-[10px] text-gray-700"><code>{formattedResult}</code></pre>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-call pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.tool-call code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	}
</style>
