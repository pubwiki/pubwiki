<!--
  StringArrayEditor — Edit an array of strings with add/remove.
-->
<script lang="ts">
	import { generateUniqueId } from '../../types/editor.js';

	interface Props {
		values: string[];
		onChange: (values: string[]) => void;
		placeholder?: string;
		addLabel?: string;
	}

	let { values, onChange, placeholder = '', addLabel = '+ Add' }: Props = $props();

	function handleAdd() {
		onChange([...values, '']);
	}

	function handleRemove(index: number) {
		onChange(values.filter((_, i) => i !== index));
	}

	function handleChange(index: number, value: string) {
		const next = [...values];
		next[index] = value;
		onChange(next);
	}
</script>

<div class="flex flex-col gap-1.5">
	{#each values as value, index (index)}
		<div class="flex items-center gap-1.5">
			<input
				type="text"
				class="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
				{value}
				{placeholder}
				oninput={(e) => handleChange(index, e.currentTarget.value)}
			/>
			<button
				type="button"
				class="rounded px-1.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
				onclick={() => handleRemove(index)}
			>
				✕
			</button>
		</div>
	{/each}
	<button
		type="button"
		class="self-start rounded px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
		onclick={handleAdd}
	>
		{addLabel}
	</button>
</div>
