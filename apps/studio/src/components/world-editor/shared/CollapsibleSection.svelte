<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Section title */
		title: string;
		/** Whether initially open */
		open?: boolean;
		children: Snippet;
	}

	let { title, open = true, children }: Props = $props();

	let expanded = $state(false);
	$effect(() => { expanded = open; });
</script>

<div class="border-2 rounded-md overflow-hidden" style="border-color: var(--we-border);">
	<button
		class="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-black/5 cursor-pointer"
		style="background: var(--we-bg-card);"
		onclick={() => (expanded = !expanded)}
	>
		<span class="text-sm font-semibold" style="color: var(--we-text-primary);">{title}</span>
		<svg
			class="w-4 h-4 transition-transform duration-200"
			class:rotate-180={expanded}
			style="color: var(--we-text-secondary);"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
		</svg>
	</button>
	{#if expanded}
		<div class="px-4 py-3 border-t" style="border-color: var(--we-border);">
			{@render children()}
		</div>
	{/if}
</div>
