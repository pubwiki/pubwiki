<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { ArtifactListItem } from '@pubwiki/api';
	import { apiClient } from '$lib/api';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		artifact: ArtifactListItem;
		onclose: () => void;
		ondeleted: () => void;
	}

	let { artifact, onclose, ondeleted }: Props = $props();

	let isDeleting = $state(false);
	let errorMsg = $state('');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleDelete() {
		isDeleting = true;
		errorMsg = '';

		try {
			const { error } = await apiClient.DELETE('/artifacts', {
				params: { path: { artifactId: artifact.id } }
			});

			if (error) {
				errorMsg = (error as { error?: string }).error || m.me_artifact_delete_failed();
			} else {
				ondeleted();
			}
		} catch {
			errorMsg = m.me_artifact_delete_failed();
		} finally {
			isDeleting = false;
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" tabindex="-1" onkeydown={handleKeydown}>
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 bg-black/50" transition:fade={{ duration: 150 }} onclick={onclose} onkeydown={() => {}}></div>

	<!-- Modal Panel -->
	<div class="flex min-h-full items-center justify-center p-4">
		<div
			class="relative w-full max-w-md bg-white rounded-xl shadow-xl"
			transition:fly={{ y: 30, duration: 200 }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
				<h2 class="text-lg font-semibold text-red-600">{m.me_delete_artifact()}</h2>
				<button onclick={onclose} class="text-gray-400 hover:text-gray-600 transition" aria-label="Close">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body -->
			<div class="px-6 py-4">
				{#if errorMsg}
					<div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
						{errorMsg}
					</div>
				{/if}

				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex-shrink-0">
						<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
						</svg>
					</div>
					<p class="text-sm text-gray-600">
						{m.me_delete_artifact_confirm({ name: artifact.name })}
					</p>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
				<button
					type="button"
					onclick={onclose}
					class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
				>
					{m.common_cancel()}
				</button>
				<button
					type="button"
					onclick={handleDelete}
					disabled={isDeleting}
					class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
				>
					{isDeleting ? m.me_deleting() : m.common_delete()}
				</button>
			</div>
		</div>
	</div>
</div>
