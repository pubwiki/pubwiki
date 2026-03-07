<!--
  NumberInput — A styled number input with optional min/max.
-->
<script lang="ts">
	interface Props {
		value: number;
		onchange: (value: number) => void;
		min?: number;
		max?: number;
		step?: number;
		class?: string;
	}

	let { value, onchange, min, max, step = 1, class: className = '' }: Props = $props();
</script>

<input
	type="number"
	{value}
	{min}
	{max}
	{step}
	class="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 {className}"
	oninput={(e) => {
		const num = Number(e.currentTarget.value);
		if (!isNaN(num)) onchange(num);
	}}
/>
