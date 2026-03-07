<!--
  EntityListSidebar — A searchable list of entities in a sidebar panel.
  Used for creatures, regions, organizations, etc.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface EntityItem {
		id: string;
		name: string;
		subtitle?: string;
		icon?: string;
	}

	interface Props {
		title: string;
		items: EntityItem[];
		selectedId: string | null;
		onSelect: (id: string) => void;
		onAdd: () => void;
		onRemove?: (id: string) => void;
		addLabel?: string;
	}

	let { title, items, selectedId, onSelect, onAdd, onRemove, addLabel = '+ Add' }: Props = $props();

	let search = $state('');

	let filteredItems = $derived(
		search
			? items.filter(
					(item) =>
						item.name.toLowerCase().includes(search.toLowerCase()) ||
						item.id.toLowerCase().includes(search.toLowerCase())
				)
			: items
	);
</script>

<div class="flex h-full w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
	<div class="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
		<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
			{title}
		</span>
		<span class="text-xs text-gray-400">{items.length}</span>
	</div>

	<!-- Search -->
	<div class="px-2 py-1.5">
		<input
			type="text"
			bind:value={search}
			placeholder="Search..."
			class="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
		/>
	</div>

	<!-- List -->
	<div class="flex-1 overflow-y-auto">
		{#each filteredItems as item (item.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors
					{selectedId === item.id
					? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
				onclick={() => onSelect(item.id)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
				role="option"
				aria-selected={selectedId === item.id}
				tabindex="0"
			>
				{#if item.icon}
					<span class="text-sm">{item.icon}</span>
				{/if}
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm font-medium">{item.name || '(unnamed)'}</div>
					{#if item.subtitle}
						<div class="truncate text-xs text-gray-400">{item.subtitle}</div>
					{/if}
				</div>
				{#if onRemove}
					<button
						type="button"
						class="opacity-0 group-hover:opacity-100 rounded p-0.5 text-xs text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
						onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove(item.id); }}
					>
						✕
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Add button -->
	<div class="border-t border-gray-200 p-2 dark:border-gray-700">
		<button
			type="button"
			class="w-full rounded bg-amber-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
			onclick={onAdd}
		>
			{addLabel}
		</button>
	</div>
</div>
