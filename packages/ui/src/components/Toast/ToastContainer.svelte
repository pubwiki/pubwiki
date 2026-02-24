<script lang="ts">
	import { toastStore, type Toast } from '../../stores/toast.svelte';

	const typeStyles: Record<Toast['type'], string> = {
		info: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-700',
		warning:
			'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700',
		error:
			'bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200 dark:border-red-700',
		success:
			'bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-200 dark:border-green-700'
	};

	const typeIcons: Record<Toast['type'], string> = {
		info: 'ℹ',
		warning: '⚠',
		error: '✕',
		success: '✓'
	};
</script>

{#if toastStore.toasts.length > 0}
	<div class="fixed right-4 top-4 z-[9999] flex flex-col gap-2" role="status" aria-live="polite">
		{#each toastStore.toasts as toast (toast.id)}
			<div
				class="flex min-w-[300px] max-w-[420px] items-start gap-3 rounded-lg border px-4 py-3 shadow-lg {typeStyles[
					toast.type
				]}"
			>
				<span class="mt-0.5 text-lg leading-none">{typeIcons[toast.type]}</span>
				<p class="flex-1 text-sm">{toast.message}</p>
				<button
					class="ml-2 opacity-60 transition-opacity hover:opacity-100"
					onclick={() => toastStore.remove(toast.id)}
					aria-label="关闭"
				>
					✕
				</button>
			</div>
		{/each}
	</div>
{/if}