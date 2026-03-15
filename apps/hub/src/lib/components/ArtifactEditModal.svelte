<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { ArtifactListItem } from '@pubwiki/api';
	import { ArtifactEditPreview } from '@pubwiki/ui/components';
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
	let isPrivate = $state(false);
	// svelte-ignore state_referenced_locally
	let tagsInput = $state(artifact.tags?.map(t => t.slug).join(', ') || '');
	// svelte-ignore state_referenced_locally
	let thumbnailUrl = $state(artifact.thumbnailUrl || '');
	let isSaving = $state(false);
	let errorMsg = $state('');

	let authorName = $derived(
		artifact.author.displayName || artifact.author.username || 'Unknown'
	);

	const labels = $derived({
		name: m.me_artifact_name(),
		namePlaceholder: m.me_artifact_name(),
		description: m.me_artifact_description(),
		descriptionPlaceholder: m.me_artifact_description_placeholder(),
		tags: m.me_artifact_tags(),
		tagsPlaceholder: m.me_artifact_tags_placeholder(),
		listed: m.me_artifact_listed(),
		listedDescription: m.me_artifact_listed_description(),
		private: m.me_artifact_private(),
		privateDescription: m.me_artifact_private_description(),
		thumbnailUrl: m.me_artifact_thumbnail(),
		thumbnailUrlPlaceholder: m.me_artifact_thumbnail_placeholder(),
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleSave(e: Event) {
		e.preventDefault();
		isSaving = true;
		errorMsg = '';

		try {
			const parsedTags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
			const { error } = await apiClient.PUT('/artifacts/{artifactId}/metadata', {
				params: { path: { artifactId: artifact.id } },
				body: {
					name,
					description: description || undefined,
					isListed,
					isPrivate,
					tags: parsedTags.length > 0 ? parsedTags : undefined,
					thumbnailUrl: thumbnailUrl || undefined,
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
			class="relative w-full max-w-4xl bg-white rounded-xl shadow-xl"
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

				<ArtifactEditPreview
					bind:name
					bind:description
					bind:tags={tagsInput}
					bind:isListed
					bind:isPrivate
					bind:thumbnailUrl
					{authorName}
					layout="horizontal"
					{labels}
					previewLabel={m.me_artifact_preview()}
				/>

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
