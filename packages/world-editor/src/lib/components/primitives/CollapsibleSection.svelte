<!--
  CollapsibleSection — A section header that can be expanded/collapsed.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		icon?: string;
		expanded?: boolean;
		onToggle?: (expanded: boolean) => void;
		/** data-outline-id for outline panel integration */
		outlineId?: string;
		children: Snippet;
		badge?: string | number;
	}

	let { title, icon = '', expanded = $bindable(true), onToggle, outlineId, children, badge }: Props = $props();

	function toggle() {
		expanded = !expanded;
		onToggle?.(expanded);
	}
</script>

<section class="mb-3 rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
	data-outline-id={outlineId}
>
	<button
		type="button"
		class="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
		onclick={toggle}
	>
		<span class="transition-transform {expanded ? 'rotate-90' : ''} text-xs text-gray-400">▶</span>
		{#if icon}
			<span>{icon}</span>
		{/if}
		<span class="flex-1">{title}</span>
		{#if badge !== undefined}
			<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
				{badge}
			</span>
		{/if}
	</button>
	{#if expanded}
		<div class="border-t border-gray-100 px-4 py-3 dark:border-gray-700">
			{@render children()}
		</div>
	{/if}
</section>
