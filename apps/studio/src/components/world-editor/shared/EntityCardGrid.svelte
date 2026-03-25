<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import SearchFilter from './SearchFilter.svelte';
	import SortDropdown, { type SortOrder } from './SortDropdown.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		/** Title displayed in toolbar */
		title: string;
		/** Items to render as cards */
		items: { id: string; name: string }[];
		/** Currently selected item id */
		selectedId: string | null;
		/** Card rendering snippet — receives (item, selected) */
		card: Snippet<[item: { id: string; name: string }, selected: boolean]>;
		/** Called when user clicks a card */
		onSelect: (id: string) => void;
		/** Called when user clicks the Add button */
		onAdd: () => void;
		/** Called when user clicks delete on a selected item */
		onDelete: (id: string) => void;
		/** Type badge accent color (CSS value) */
		accentColor?: string;
		/** Compact sidebar mode: single-column cards, stacked toolbar */
		compact?: boolean;
	}

	let {
		title,
		items,
		selectedId,
		card,
		onSelect,
		onAdd,
		onDelete,
		accentColor = 'var(--we-accent)',
		compact = false
	}: Props = $props();

	let search = $state('');
	let sortOrder: SortOrder = $state('original');

	let filtered = $derived.by(() => {
		let list = items;
		if (search.trim()) {
			const q = search.trim().toLowerCase();
			list = list.filter((item) => item.name.toLowerCase().includes(q));
		}
		if (sortOrder === 'az') {
			list = [...list].sort((a, b) => a.name.localeCompare(b.name));
		} else if (sortOrder === 'za') {
			list = [...list].sort((a, b) => b.name.localeCompare(a.name));
		}
		return list;
	});
</script>

<div class="flex flex-col h-full overflow-hidden">
	<!-- Toolbar -->
	{#if compact}
		<div class="flex flex-col gap-2 px-3 py-2.5 border-b" style="border-color: var(--we-border);">
			<div class="flex items-center gap-2">
				<h2 class="font-serif font-bold text-base flex-1 truncate" style="color: var(--we-text-primary);">{title}</h2>
				<button
					class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors shrink-0"
					onclick={onAdd}
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" />
					</svg>
					{m.we_common_add()}
				</button>
				{#if selectedId}
					<button
						class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0"					title={m.we_common_delete()}						onclick={() => selectedId && onDelete(selectedId)}
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
						</svg>
					</button>
				{/if}
			</div>
			<SearchFilter value={search} onInput={(v) => (search = v)} />
		</div>
	{:else}
	<div class="flex items-center gap-2 px-4 py-3 border-b" style="border-color: var(--we-border);">
		<h2 class="font-serif font-bold text-lg shrink-0" style="color: var(--we-text-primary);">{title}</h2>
		<div class="flex-1"></div>
		<div class="w-48">
			<SearchFilter value={search} onInput={(v) => (search = v)} />
		</div>
		<SortDropdown value={sortOrder} onChange={(v) => (sortOrder = v)} />
		<button
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors shrink-0"
			onclick={onAdd}
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" />
			</svg>
			{m.we_common_add()}
		</button>
		{#if selectedId}
			<button
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0"
				onclick={() => selectedId && onDelete(selectedId)}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
				</svg>
				{m.we_common_delete()}
			</button>
		{/if}
	</div>
	{/if}

	<!-- Card Grid -->
	<div class="flex-1 overflow-y-auto p-4" style="background: var(--we-bg-base);">
		{#if filtered.length === 0}
			<div
				class="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg"
				style="color: var(--we-text-tertiary); background: var(--we-bg-card); border-color: var(--we-border);"
			>
				<svg class="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					{#if search.trim()}
						<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
					{:else}
						<path d="M12 5v14m-7-7h14"/>
					{/if}
				</svg>
				<span class="text-sm font-medium">{search.trim() ? m.we_common_no_results() : m.we_common_empty()}</span>
				{#if !search.trim()}
					<button
						class="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
						onclick={onAdd}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
						{m.we_common_add()}
					</button>
				{/if}
			</div>
		{:else}
			<div class="{compact ? 'flex flex-col' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'} gap-3">
				{#each filtered as item (item.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="rounded-md border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:-translate-y-0.5 group relative"
						style="background: var(--we-bg-card); border-color: {selectedId === item.id ? accentColor : 'var(--we-border)'}; box-shadow: {selectedId === item.id ? 'var(--we-shadow-md)' : 'var(--we-shadow-sm)'};"
						onclick={() => onSelect(item.id)}
						onmouseenter={(e) => { if (selectedId !== item.id) e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.boxShadow = 'var(--we-shadow-md)'; }}
						onmouseleave={(e) => { if (selectedId !== item.id) e.currentTarget.style.borderColor = 'var(--we-border)'; e.currentTarget.style.boxShadow = selectedId === item.id ? 'var(--we-shadow-md)' : 'var(--we-shadow-sm)'; }}
					>
						{@render card(item, selectedId === item.id)}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
