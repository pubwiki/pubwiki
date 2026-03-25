<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	export type SortOrder = 'original' | 'az' | 'za';

	interface Props {
		value: SortOrder;
		onChange: (value: SortOrder) => void;
	}

	let { value, onChange }: Props = $props();

	const options: { value: SortOrder; label: () => string }[] = [
		{ value: 'original', label: m.we_common_sort_original },
		{ value: 'az', label: m.we_common_sort_az },
		{ value: 'za', label: m.we_common_sort_za }
	];
</script>

<div class="relative inline-flex items-center gap-1.5">
	<svg class="w-4 h-4 text-[var(--we-text-tertiary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18M3 12h12M3 18h6" />
	</svg>
	<select
		class="text-sm bg-transparent border-none py-1 pr-5 pl-0 cursor-pointer focus:outline-none focus:ring-0"
		style="color: var(--we-text-secondary);"
		onchange={(e) => onChange(e.currentTarget.value as SortOrder)}
	>
		{#each options as opt}
			<option value={opt.value} selected={value === opt.value}>{opt.label()}</option>
		{/each}
	</select>
</div>
