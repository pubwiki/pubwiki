<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { ArtifactListItem } from '@pubwiki/api';
	import { apiClient } from '$lib/api';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		artifact: ArtifactListItem;
		onclose: () => void;
		onupdated: () => void;
	}

	let { artifact, onclose, onupdated }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(artifact.name);
	// svelte-ignore state_referenced_locally
	let description = $state(artifact.description || '');
	// svelte-ignore state_referenced_locally
	let isListed = $state(artifact.isListed);
	let isSaving = $state(false);
	let errorMsg = $state('');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleSave(e: Event) {
		e.preventDefault();
		isSaving = true;
		errorMsg = '';

		try {
			const { error } = await apiClient.PUT('/artifacts/{artifactId}/metadata', {
				params: { path: { artifactId: artifact.id } },
				body: {
					name,
					description: description || undefined,
					isListed
				}
			});

			if (error) {
				errorMsg = (error as { error?: string }).error || m.me_artifact_update_failed();
			} else {
				onupdated();
			}
		} catch {
			errorMsg = m.me_artifact_update_failed();
		} finally {
			isSaving = false;
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
			class="relative w-full max-w-lg bg-white rounded-xl shadow-xl"
			transition:fly={{ y: 30, duration: 200 }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
				<h2 class="text-lg font-semibold text-gray-900">{m.me_edit_artifact()}</h2>
				<button onclick={onclose} class="text-gray-400 hover:text-gray-600 transition" aria-label="Close">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body -->
			<form onsubmit={handleSave} class="px-6 py-4 space-y-4">
				{#if errorMsg}
					<div class="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
						{errorMsg}
					</div>
				{/if}

				<!-- Name -->
				<div>
					<label for="artifact-name" class="block text-sm font-medium text-gray-700 mb-1">
						{m.me_artifact_name()}
					</label>
					<input
						type="text"
						id="artifact-name"
						bind:value={name}
						required
						maxlength={100}
						class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-[#0969da] focus:border-[#0969da] shadow-sm"
					/>
				</div>

				<!-- Description -->
				<div>
					<label for="artifact-description" class="block text-sm font-medium text-gray-700 mb-1">
						{m.me_artifact_description()}
					</label>
					<textarea
						id="artifact-description"
						bind:value={description}
						rows="3"
						placeholder={m.me_artifact_description_placeholder()}
						class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-[#0969da] focus:border-[#0969da] shadow-sm"
					></textarea>
				</div>

				<!-- Listed toggle -->
				<div class="flex items-center gap-3">
					<input
						type="checkbox"
						id="artifact-listed"
						bind:checked={isListed}
						class="h-4 w-4 text-[#0969da] border-gray-300 rounded focus:ring-[#0969da]"
					/>
					<label for="artifact-listed" class="text-sm text-gray-700">
						{m.me_artifact_listed()}
					</label>
				</div>

				<!-- Footer -->
				<div class="flex justify-end gap-3 pt-2">
					<button
						type="button"
						onclick={onclose}
						class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
					>
						{m.common_cancel()}
					</button>
					<button
						type="submit"
						disabled={isSaving || !name.trim()}
						class="px-4 py-2 text-sm font-medium text-white bg-[#2da44e] rounded-lg hover:bg-[#2c974b] transition disabled:opacity-50"
					>
						{isSaving ? m.me_saving() : m.common_save()}
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
