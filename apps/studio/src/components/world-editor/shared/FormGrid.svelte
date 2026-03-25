<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Number of columns at sm+ breakpoint */
		cols?: 2 | 3;
		children: Snippet;
	}

	let { cols = 2, children }: Props = $props();

	let colClass = $derived(cols === 3
		? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'
		: 'grid grid-cols-1 sm:grid-cols-2 gap-3');
</script>

<div class={colClass}>
	{@render children()}
</div>
