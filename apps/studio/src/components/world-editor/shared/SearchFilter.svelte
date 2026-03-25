<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface Props {
		value: string;
		onInput: (value: string) => void;
		placeholder?: string;
	}

	let { value, onInput, placeholder }: Props = $props();
</script>

<div class="relative">
	<svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--we-text-tertiary)] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<circle cx="11" cy="11" r="8" stroke-width="2" />
		<path stroke-linecap="round" stroke-width="2" d="m21 21-4.35-4.35" />
	</svg>
	<input
		type="text"
		class="w-full pl-8 pr-3 py-1.5 text-sm bg-white border rounded placeholder:text-[var(--we-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
		style="border-color: var(--we-border); color: var(--we-text-primary);"
		{value}
		oninput={(e) => onInput(e.currentTarget.value)}
		placeholder={placeholder ?? m.we_common_search()}
	/>
</div>
