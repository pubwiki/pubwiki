<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { EditModal, FormGroup } from '../shared';
	import type { StoryHistoryEntry, GameInitialStory } from '@pubwiki/world-editor';

	const ctx = getWorldEditorContext();

	let initialStory = $derived(ctx.stateData.GameInitialStory);
	let history = $derived(ctx.stateData.StoryHistory ?? []);

	type Section = 'background' | 'history' | null;
	let openSection: Section = $state(null);

	function updateInitialStory(patch: Partial<GameInitialStory>) {
		const old = initialStory;
		const updated: GameInitialStory = { background: old?.background ?? '', start_story: old?.start_story ?? '', ...old, ...patch };
		const ops = ctx.translator.replaceInitialStory(old, updated);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	function updateHistory(newEntries: StoryHistoryEntry[]) {
		const ops = ctx.translator.replaceStoryHistory(history, newEntries);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	function addEntry() {
		updateHistory([...history, { turn_id: crypto.randomUUID(), story: { content: '' } }]);
	}

	function removeEntry(index: number) {
		updateHistory(history.filter((_: StoryHistoryEntry, i: number) => i !== index));
	}

	function patchEntry(index: number, patch: Partial<StoryHistoryEntry>) {
		const updated = [...history];
		updated[index] = { ...updated[index], ...patch };
		updateHistory(updated);
	}

	const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

	const ICON = {
		book: '<path stroke-width="2" d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path stroke-width="2" d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
		clock: '<circle cx="12" cy="12" r="10" stroke-width="2"/><polyline points="12 6 12 12 16 14" stroke-width="2"/>',
	};

	let creatures = $derived(ctx.stateData.Creatures ?? []);

	function storyContentString(content: unknown): string {
		if (typeof content === 'string') return content;
		if (content == null) return '';
		return JSON.stringify(content, null, 2);
	}
</script>

<div class="flex flex-col h-full overflow-y-auto p-6 gap-6" style="background: var(--we-bg-base);">
	<!-- Header -->
	<div class="flex items-center gap-3">
		<div class="p-2 rounded-md" style="background: color-mix(in srgb, var(--we-text-secondary) 10%, transparent);">
			<svg class="w-5 h-5" style="color: var(--we-text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				{@html ICON.book}
			</svg>
		</div>
		<h2 class="font-serif font-bold text-xl" style="color: var(--we-text-primary);">{m.we_story_title()}</h2>
	</div>

	<!-- Background Story Card (full width, prominent) -->
	<button
		class="w-full text-left p-5 rounded-lg border-2 transition-all cursor-pointer hover:scale-[1.005]"
		style="background: var(--we-bg-card); border-color: var(--we-border); box-shadow: var(--we-shadow-sm);"
		onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--we-border-hover)'; e.currentTarget.style.boxShadow = 'var(--we-shadow-md)'; }}
		onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--we-border)'; e.currentTarget.style.boxShadow = 'var(--we-shadow-sm)'; }}
		onclick={() => (openSection = 'background')}
	>
		<div class="flex items-center gap-2 mb-3">
			<svg class="w-4 h-4 shrink-0" style="color: var(--we-accent-ochre);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				{@html ICON.book}
			</svg>
			<span class="text-sm font-semibold" style="color: var(--we-text-primary);">{m.we_story_background()}</span>
		</div>
		{#if initialStory?.background}
			<p class="text-sm leading-relaxed line-clamp-4" style="color: var(--we-text-secondary);">{initialStory.background}</p>
		{:else}
			<p class="text-sm italic" style="color: var(--we-text-tertiary);">{m.we_story_background_hint()}</p>
		{/if}
	</button>

	<!-- Story History Section -->
	<div>
		<div class="flex items-center justify-between mb-3">
			<div class="flex items-center gap-2">
				<svg class="w-4 h-4" style="color: var(--we-text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{@html ICON.clock}
				</svg>
				<span class="text-sm font-semibold" style="color: var(--we-text-primary);">{m.we_story_history()}</span>
				<span class="text-xs px-1.5 py-0.5 rounded-full font-medium" style="background: var(--we-bg-secondary); color: var(--we-text-tertiary);">{history.length}</span>
			</div>
			<button
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
				onclick={() => (openSection = 'history')}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
				{m.we_common_edit()}
			</button>
		</div>

		{#if history.length === 0}
			<div class="flex flex-col items-center py-10 border-2 border-dashed rounded-lg" style="border-color: var(--we-border); background: var(--we-bg-card); color: var(--we-text-tertiary);">
				<svg class="w-10 h-10 mb-2 opacity-25" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					{@html ICON.clock}
				</svg>
				<span class="text-sm">{m.we_story_history_empty()}</span>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each history.slice(0, 5) as entry, i (entry.turn_id)}
					<div class="p-3 rounded-md border-2" style="background: var(--we-bg-card); border-color: var(--we-border); box-shadow: var(--we-shadow-sm);">
						<div class="flex items-center gap-2 mb-1">
							<span class="text-[10px] font-mono" style="color: var(--we-text-tertiary);">Turn #{i + 1}</span>
							{#if entry.story.checkpoint_id}
								<span class="text-[10px] font-medium ml-auto px-1.5 py-0.5 rounded-full" style="background: color-mix(in srgb, var(--we-accent-ochre) 12%, transparent); color: var(--we-accent-ochre);">checkpoint</span>
							{/if}
						</div>
						<p class="text-sm line-clamp-2" style="color: var(--we-text-secondary);">{storyContentString(entry.story.content) || '(empty)'}</p>
					</div>
				{/each}
				{#if history.length > 5}
					<button
						class="text-sm text-center py-2 rounded-md transition-colors cursor-pointer"
						style="color: var(--we-text-tertiary);"
						onclick={() => (openSection = 'history')}
					>
						+{history.length - 5} more entries...
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- ================================================================ -->
<!-- Background Story Modal                                          -->
<!-- ================================================================ -->

{#if openSection === 'background'}
	<EditModal title={m.we_story_background()} onClose={() => (openSection = null)}>
		<FormGroup label="Background">
			<p class="text-xs mb-1" style="color: var(--we-text-tertiary);">{m.we_story_background_hint()}</p>
			<textarea class="{INPUT_CLS} min-h-[180px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
				value={initialStory?.background ?? ''}
				oninput={(e) => updateInitialStory({ background: e.currentTarget.value })}
			></textarea>
		</FormGroup>
		<div class="mt-3">
			<FormGroup label="Start Story">
				<p class="text-xs mb-1" style="color: var(--we-text-tertiary);">The opening scene or narration.</p>
				<textarea class="{INPUT_CLS} min-h-[120px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={initialStory?.start_story ?? ''}
					oninput={(e) => updateInitialStory({ start_story: e.currentTarget.value })}
				></textarea>
			</FormGroup>
		</div>
	</EditModal>
{/if}

<!-- ================================================================ -->
<!-- Story History Modal                                              -->
<!-- ================================================================ -->

{#if openSection === 'history'}
	<EditModal title={m.we_story_history()} size="wide" onClose={() => (openSection = null)}>
		{#if history.length === 0}
			<div class="text-center py-6 text-sm border-2 border-dashed rounded-md" style="color: var(--we-text-tertiary); border-color: var(--we-border);">
				{m.we_story_history_empty()}
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each history as entry, i (entry.turn_id)}
					<div class="border rounded-md p-3" style="border-color: var(--we-border); background: var(--we-bg-base);">
						<div class="flex items-center justify-between mb-2">
							<span class="text-xs font-mono" style="color: var(--we-text-tertiary);">
								Turn #{i + 1}
							</span>
							<button class="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0" title={m.we_common_delete()}
								onclick={() => removeEntry(i)}>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						<FormGroup label={m.we_story_entry_content()}>
							<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
								value={storyContentString(entry.story.content)}
								oninput={(e) => patchEntry(i, { story: { ...entry.story, content: e.currentTarget.value } })}
							></textarea>
						</FormGroup>
						<div class="mt-2">
							<FormGroup label="Checkpoint ID">
								<input type="text" class="{INPUT_CLS} font-mono text-xs" style="border-color: var(--we-border); color: var(--we-text-primary);"
									value={entry.story.checkpoint_id ?? ''}
									oninput={(e) => patchEntry(i, { story: { ...entry.story, checkpoint_id: e.currentTarget.value || undefined } })} />
							</FormGroup>
						</div>
					</div>
				{/each}
			</div>
		{/if}
		<button class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
			onclick={addEntry}>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
			{m.we_story_add_entry()}
		</button>
	</EditModal>
{/if}
