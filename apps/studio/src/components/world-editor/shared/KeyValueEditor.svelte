<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface Props {
		/** Key-value entries */
		entries: [string, string][];
		/** Called whenever entries change */
		onChange: (entries: [string, string][]) => void;
		/** Placeholder for key field */
		keyPlaceholder?: string;
		/** Placeholder for value field */
		valuePlaceholder?: string;
	}

	let { entries, onChange, keyPlaceholder, valuePlaceholder }: Props = $props();

	function add() {
		onChange([...entries, ['', '']]);
	}

	function remove(index: number) {
		onChange(entries.filter((_, i) => i !== index));
	}

	function updateKey(index: number, key: string) {
		const copy: [string, string][] = entries.map((e) => [...e]);
		copy[index][0] = key;
		onChange(copy);
	}

	function updateValue(index: number, value: string) {
		const copy: [string, string][] = entries.map((e) => [...e]);
		copy[index][1] = value;
		onChange(copy);
	}
</script>

<div class="flex flex-col gap-2">
	{#if entries.length > 0}
		<!-- Header labels -->
		<div class="flex items-center gap-1.5 px-0.5">
			<span class="flex-1 text-xs font-medium" style="color: var(--we-text-tertiary);">{m.we_common_key()}</span>
			<span class="flex-1 text-xs font-medium" style="color: var(--we-text-tertiary);">{m.we_common_value()}</span>
			<span class="w-8"></span>
		</div>
	{/if}

	{#each entries as [key, value], i}
		<div class="flex items-center gap-1.5">
			<input
				type="text"
				class="flex-1 px-3 py-1.5 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
				style="border-color: var(--we-border); color: var(--we-text-primary);"
				value={key}
				oninput={(e) => updateKey(i, e.currentTarget.value)}
				placeholder={keyPlaceholder}
			/>
			<input
				type="text"
				class="flex-1 px-3 py-1.5 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
				style="border-color: var(--we-border); color: var(--we-text-primary);"
				value={value}
				oninput={(e) => updateValue(i, e.currentTarget.value)}
				placeholder={valuePlaceholder}
			/>
			<button
				class="p-1 rounded transition-colors hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0"
				onclick={() => remove(i)}
				title={m.we_common_remove()}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/each}

	<button
		class="inline-flex items-center gap-1 self-start px-2.5 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
		onclick={add}
	>
		<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" />
		</svg>
		{m.we_common_add_entry()}
	</button>
</div>
