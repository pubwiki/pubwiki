<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface Props {
		/** The array of strings to edit */
		items: string[];
		/** Called whenever the array changes */
		onChange: (items: string[]) => void;
		/** Placeholder text for new item input */
		placeholder?: string;
	}

	let { items, onChange, placeholder = '' }: Props = $props();

	let newValue = $state('');

	function add() {
		const v = newValue.trim();
		if (!v) return;
		onChange([...items, v]);
		newValue = '';
	}

	function remove(index: number) {
		onChange(items.filter((_, i) => i !== index));
	}

	function moveUp(index: number) {
		if (index <= 0) return;
		const copy = [...items];
		[copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
		onChange(copy);
	}

	function moveDown(index: number) {
		if (index >= items.length - 1) return;
		const copy = [...items];
		[copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
		onChange(copy);
	}

	function update(index: number, value: string) {
		const copy = [...items];
		copy[index] = value;
		onChange(copy);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			add();
		}
	}
</script>

<div class="flex flex-col gap-2">
	{#each items as item, i}
		<div class="flex items-center gap-1.5">
			<input
				type="text"
				class="flex-1 px-3 py-1.5 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
				style="border-color: var(--we-border); color: var(--we-text-primary);"
				value={item}
				oninput={(e) => update(i, e.currentTarget.value)}
			/>
			<button
				class="p-1 rounded transition-colors hover:bg-black/5 disabled:opacity-30"
				style="color: var(--we-text-tertiary);"
				onclick={() => moveUp(i)}
				disabled={i === 0}
				title={m.we_common_move_up()}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
				</svg>
			</button>
			<button
				class="p-1 rounded transition-colors hover:bg-black/5 disabled:opacity-30"
				style="color: var(--we-text-tertiary);"
				onclick={() => moveDown(i)}
				disabled={i === items.length - 1}
				title={m.we_common_move_down()}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			<button
				class="p-1 rounded transition-colors hover:bg-red-50 text-red-400 hover:text-red-600"
				onclick={() => remove(i)}
				title={m.we_common_remove()}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/each}

	<!-- Add new item row -->
	<div class="flex items-center gap-1.5">
		<input
			type="text"
			class="flex-1 px-3 py-1.5 text-sm bg-white border rounded placeholder:text-[var(--we-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
			style="border-color: var(--we-border); color: var(--we-text-primary);"
			bind:value={newValue}
			onkeydown={handleKeydown}
			{placeholder}
		/>
		<button
			class="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
			onclick={add}
			disabled={!newValue.trim()}
		>
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" />
			</svg>
			{m.we_common_add_item()}
		</button>
	</div>
</div>
