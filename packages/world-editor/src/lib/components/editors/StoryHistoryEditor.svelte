<!--
  StoryHistoryEditor — View & edit story history entries.
  Each entry has a turn_id and a story object with free-form content.
-->
<script lang="ts">
	import type { StoryHistoryEntry } from '../../types/state-data.js';
	import { generateUniqueId } from '../../types/editor.js';
	import CollapsibleSection from '../primitives/CollapsibleSection.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';

	interface Props {
		entries: StoryHistoryEntry[];
		onChange: (entries: StoryHistoryEntry[]) => void;
	}

	let { entries, onChange }: Props = $props();

	function updateEntry(idx: number, patch: Partial<StoryHistoryEntry>) {
		const updated = entries.map((e, i) => (i === idx ? { ...e, ...patch } : e));
		onChange(updated);
	}

	function removeEntry(idx: number) {
		onChange(entries.filter((_, i) => i !== idx));
	}

	function addEntry() {
		onChange([...entries, { turn_id: generateUniqueId('turn'), story: { content: '' } }]);
	}

	/** Serialize content for editing — support string or JSON */
	function contentToString(content: unknown): string {
		if (typeof content === 'string') return content;
		if (content == null) return '';
		try { return JSON.stringify(content, null, 2); } catch { return String(content); }
	}

	/** Parse a string back into content — try JSON first, fall back to raw string */
	function parseContent(text: string): unknown {
		try { return JSON.parse(text); } catch { return text; }
	}
</script>

<div class="p-6">
	<div class="mb-4 flex items-center justify-between">
		<div>
			<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">📖 Story History</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400">{entries.length} turn(s) recorded.</p>
		</div>
		<button
			class="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
			onclick={addEntry}
		>
			+ Add Turn
		</button>
	</div>

	{#if entries.length === 0}
		<div class="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-600 dark:text-gray-500">
			No story history yet. Add a turn to get started.
		</div>
	{:else}
		<div class="space-y-3">
			{#each entries as entry, idx (idx)}
				<CollapsibleSection title="Turn {entry.turn_id}" icon="💬" badge="#{idx + 1}">
					<div class="space-y-3">
						<div>
							<label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Turn ID</label>
							<TextInput
								value={entry.turn_id}
								onchange={(v) => updateEntry(idx, { turn_id: v })}
								placeholder="Turn identifier..."
							/>
						</div>

						<div>
							<label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Story Content</label>
							<TextArea
								value={contentToString(entry.story.content)}
								onchange={(v) => updateEntry(idx, { story: { ...entry.story, content: parseContent(v) } })}
								rows={6}
								placeholder="Story content (text or JSON)..."
							/>
						</div>

						{#if entry.story.checkpoint_id}
							<div class="text-xs text-gray-400">
								Checkpoint: <code class="rounded bg-gray-100 px-1 dark:bg-gray-700">{entry.story.checkpoint_id}</code>
							</div>
						{/if}

						<div class="flex justify-end">
							<button
								class="text-xs text-red-500 hover:text-red-600"
								onclick={() => removeEntry(idx)}
							>
								Remove Turn
							</button>
						</div>
					</div>
				</CollapsibleSection>
			{/each}
		</div>
	{/if}
</div>
