<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface ValidationError {
		path: string;
		message: string;
	}

	interface Props {
		errors: ValidationError[];
	}

	let { errors }: Props = $props();
</script>

{#if errors.length === 0}
	<div class="bg-green-50 border border-green-200 rounded-md p-3">
		<div class="flex items-center gap-2">
			<svg class="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span class="text-sm font-medium text-green-700">{m.we_validation_no_errors()}</span>
		</div>
	</div>
{:else}
	<div class="bg-red-50 border border-red-200 rounded-md p-3">
		<div class="flex items-center gap-2 mb-2">
			<svg class="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			<span class="text-sm font-semibold text-red-700">{m.we_validation_error_count({ count: errors.length })}</span>
		</div>
		<ul class="text-xs text-red-600 space-y-1 ml-6 list-disc">
			{#each errors as error}
				<li><span class="font-mono">{error.path}</span>: {error.message}</li>
			{/each}
		</ul>
	</div>
{/if}
