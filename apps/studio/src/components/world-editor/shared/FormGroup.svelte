<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Label text */
		label: string;
		/** Optional hint/description below the input */
		hint?: string;
		/** Optional error message */
		error?: string;
		/** Form control snippet */
		children: Snippet;
	}

	let { label, hint, error, children }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
	<!-- svelte-ignore a11y_label_has_associated_control -->
	<label class="text-sm font-medium" style="color: var(--we-text-primary);">{label}</label>
	{@render children()}
	{#if error}
		<span class="text-xs text-red-500">{error}</span>
	{:else if hint}
		<span class="text-xs" style="color: var(--we-text-tertiary);">{hint}</span>
	{/if}
</div>
