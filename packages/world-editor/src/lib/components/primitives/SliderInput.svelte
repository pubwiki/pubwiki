<!--
  SliderInput — A range slider with numeric value display.
  Used for personality (OCEAN) and emotion (PAD) values, typically -100 to 100.
-->
<script lang="ts">
	interface Props {
		value: number;
		onchange: (value: number) => void;
		min?: number;
		max?: number;
		step?: number;
		label?: string;
	}

	let { value, onchange, min = -100, max = 100, step = 1, label }: Props = $props();
</script>

<div class="flex items-center gap-2">
	{#if label}
		<span class="w-24 text-xs text-gray-600 dark:text-gray-400">{label}</span>
	{/if}
	<input
		type="range"
		{value}
		{min}
		{max}
		{step}
		class="flex-1 accent-amber-500"
		oninput={(e) => onchange(Number(e.currentTarget.value))}
	/>
	<span class="w-10 text-right text-xs font-mono text-gray-500 dark:text-gray-400">{value}</span>
</div>
