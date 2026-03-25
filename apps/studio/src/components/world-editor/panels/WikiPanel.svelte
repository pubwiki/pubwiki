<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { EditModal, FormGroup } from '../shared';
	import type { GameWikiEntry } from '@pubwiki/world-editor';

	const ctx = getWorldEditorContext();

	let wiki = $derived(ctx.stateData.GameWikiEntry);
	let entries = $derived(wiki ?? []);
	let selectedIdx: number | null = $state(null);

	type WikiItem = { title: string; content: string };

	function updateWiki(newEntries: WikiItem[]) {
		const oldWiki = wiki;
		const newWiki: GameWikiEntry = newEntries;
		const ops = ctx.translator.replaceWiki(oldWiki, newWiki);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	function addEntry() {
		updateWiki([...entries, { title: '', content: '' }]);
		selectedIdx = entries.length; // select the newly added one
	}

	function removeEntry(index: number) {
		updateWiki(entries.filter((_: WikiItem, i: number) => i !== index));
		if (selectedIdx === index) selectedIdx = null;
		else if (selectedIdx !== null && selectedIdx > index) selectedIdx--;
	}

	function patchEntry(index: number, patch: Partial<WikiItem>) {
		const updated = [...entries];
		updated[index] = { ...updated[index], ...patch };
		updateWiki(updated);
	}

	const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

</script>

<div class="flex flex-col h-full overflow-y-auto p-6 gap-6" style="background: var(--we-bg-base);">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-md" style="background: color-mix(in srgb, var(--we-accent-ochre) 12%, transparent);">
				<svg class="w-5 h-5" style="color: var(--we-accent-ochre);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
				</svg>
			</div>
			<h2 class="font-serif font-bold text-xl" style="color: var(--we-text-primary);">{m.we_wiki_title()}</h2>
			<span class="text-xs px-1.5 py-0.5 rounded-full font-medium" style="background: var(--we-bg-secondary); color: var(--we-text-tertiary);">{entries.length}</span>
		</div>
		<button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
			onclick={addEntry}>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
			{m.we_wiki_add()}
		</button>
	</div>

	{#if entries.length === 0}
		<div class="flex flex-col items-center py-12 border-2 border-dashed rounded-lg" style="border-color: var(--we-border); background: var(--we-bg-card);">
			<svg class="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--we-text-primary);">
				<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
			</svg>
			<span class="text-sm mb-3" style="color: var(--we-text-tertiary);">{m.we_wiki_empty()}</span>
			<button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
				onclick={addEntry}>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
				{m.we_wiki_add()}
			</button>
		</div>
	{:else}
		<!-- Entry list as cards -->
		<div class="flex flex-col gap-2">
			{#each entries as entry, i (i)}
				<div
					class="w-full text-left p-4 rounded-lg border-2 transition-all cursor-pointer hover:scale-[1.003]"
					style="border-color: {selectedIdx === i ? 'var(--we-accent-ochre)' : 'var(--we-border)'}; background: var(--we-bg-card); box-shadow: var(--we-shadow-sm);"
					role="button"
					tabindex="0"
					onclick={() => (selectedIdx = selectedIdx === i ? null : i)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedIdx = selectedIdx === i ? null : i; } }}>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 min-w-0">
							<span class="font-serif font-semibold truncate" style="color: var(--we-text-primary);">
								{entry.title || '(untitled)'}
							</span>

						</div>
						<button class="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0" title={m.we_common_delete()}
							onclick={(e) => { e.stopPropagation(); removeEntry(i); }}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					{#if entry.content}
						<p class="text-sm mt-1.5 line-clamp-2 leading-relaxed" style="color: var(--we-text-secondary);">{entry.content}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- ================================================================ -->
<!-- Entry Edit Modal                                                 -->
<!-- ================================================================ -->

{#if selectedIdx !== null && entries[selectedIdx]}
	{@const entry = entries[selectedIdx]}
	{@const idx = selectedIdx}
	<EditModal title={entry.title || '(untitled)'} size="wide" onClose={() => (selectedIdx = null)}>
		<FormGroup label={m.we_wiki_entry_title()}>
			<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
				value={entry.title}
				oninput={(e) => patchEntry(idx, { title: e.currentTarget.value })} />
		</FormGroup>
		<div class="mt-3">
			<FormGroup label={m.we_wiki_entry_content()}>
				<textarea class="{INPUT_CLS} min-h-[200px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={entry.content}
					oninput={(e) => patchEntry(idx, { content: e.currentTarget.value })}
				></textarea>
			</FormGroup>
		</div>
	</EditModal>
{/if}
