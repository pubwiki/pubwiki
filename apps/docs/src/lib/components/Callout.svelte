<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		type?: 'info' | 'warning' | 'error' | 'tip';
		title?: string;
		children: Snippet;
	}

	let { type = 'info', title, children }: Props = $props();

	const styles = {
		info: {
			bg: 'bg-blue-50',
			border: 'border-blue-200',
			icon: 'text-blue-500',
			title: 'text-blue-800'
		},
		warning: {
			bg: 'bg-amber-50',
			border: 'border-amber-200',
			icon: 'text-amber-500',
			title: 'text-amber-800'
		},
		error: {
			bg: 'bg-red-50',
			border: 'border-red-200',
			icon: 'text-red-500',
			title: 'text-red-800'
		},
		tip: {
			bg: 'bg-green-50',
			border: 'border-green-200',
			icon: 'text-green-500',
			title: 'text-green-800'
		}
	};

	const icons = {
		info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
		warning:
			'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
		error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
		tip: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'
	};

	const defaultTitles = {
		info: 'Info',
		warning: 'Warning',
		error: 'Error',
		tip: 'Tip'
	};

	let style = $derived(styles[type]);
	let icon = $derived(icons[type]);
	let displayTitle = $derived(title ?? defaultTitles[type]);
</script>

<div class="my-4 rounded-lg border {style.bg} {style.border} p-4 not-prose">
	<div class="flex items-start gap-3">
		<svg
			class="w-5 h-5 mt-0.5 shrink-0 {style.icon}"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={icon} />
		</svg>
		<div class="flex-1">
			{#if displayTitle}
				<p class="font-semibold {style.title} mb-1">{displayTitle}</p>
			{/if}
			<div class="text-sm text-[#24292f]">
				{@render children()}
			</div>
		</div>
	</div>
</div>
