<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fade } from 'svelte/transition';
	import type { Snippet } from 'svelte';

	export type ModalSize = 'normal' | 'wide' | 'full';

	interface Props {
		/** Modal title */
		title: string;
		/** Size variant */
		size?: ModalSize;
		/** Content snippet */
		children: Snippet;
		/** Optional footer snippet */
		footer?: Snippet;
		/** Close callback */
		onClose: () => void;
	}

	let { title, size = 'normal', children, footer, onClose }: Props = $props();

	const sizeClasses: Record<ModalSize, string> = {
		normal: 'max-w-xl',
		wide: 'max-w-3xl',
		full: 'max-w-6xl'
	};

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
	onclick={handleBackdropClick}
	transition:fade={{ duration: 150 }}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="w-full {sizeClasses[size]} max-h-[85vh] overflow-y-auto rounded-xl p-6"
		style="background: var(--we-bg-card); box-shadow: var(--we-shadow-lg);"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<div class="flex items-center justify-between mb-4">
			<h3 class="font-serif font-bold text-lg" style="color: var(--we-text-primary);">{title}</h3>
			<button
				class="p-1 rounded transition-colors hover:bg-black/5"
				onclick={onClose}
				title={m.we_common_close()}
			>
				<svg class="w-5 h-5" style="color: var(--we-text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Content -->
		{@render children()}

		<!-- Footer -->
		{#if footer}
			<div class="flex justify-end gap-2 mt-6 pt-4 border-t" style="border-color: var(--we-border);">
				{@render footer()}
			</div>
		{/if}
	</div>
</div>
