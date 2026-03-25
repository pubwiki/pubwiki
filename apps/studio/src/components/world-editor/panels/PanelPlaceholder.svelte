<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface Props {
		title: string;
		icon: string;
	}

	let { title, icon }: Props = $props();
</script>

<div class="flex-1 flex items-center justify-center p-8">
	<div class="text-center max-w-sm">
		<div
			class="mx-auto w-14 h-14 rounded-xl bg-[var(--we-bg-card)] border-2 flex items-center justify-center mb-4"
			style="border-color: var(--we-border);"
		>
			{@html icon}
		</div>
		<h3 class="font-serif font-bold text-lg text-[var(--we-text-primary)] mb-1">{title}</h3>
		<p class="text-sm text-[var(--we-text-tertiary)]">{m.we_panel_placeholder_desc()}</p>
	</div>
</div>
