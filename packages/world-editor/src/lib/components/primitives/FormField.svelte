<!--
  FormField — A labeled form field wrapper.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		hint?: string;
		children: Snippet;
	}

	let { label, hint, children }: Props = $props();
</script>

<div class="mb-2">
	<label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
		{label}
		{#if hint}
			<span class="ml-1 font-normal text-gray-400 dark:text-gray-500">({hint})</span>
		{/if}
	</label>
	{@render children()}
</div>
