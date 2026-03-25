<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		/** Minimum card width in px for auto-fill grid */
		minWidth?: number;
	}

	let { children, minWidth = 180 }: Props = $props();
</script>

<div
	class="grid gap-3"
	style="grid-template-columns: repeat(auto-fill, minmax({minWidth}px, 1fr));"
>
	{@render children()}
</div>
