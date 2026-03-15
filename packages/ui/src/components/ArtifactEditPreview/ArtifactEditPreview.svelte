<script lang="ts">
	/**
	 * ArtifactEditPreview - Combined editing form with live card preview.
	 *
	 * Wraps ArtifactEditForm and ArtifactCard together, passing the form's current
	 * values to the card for real-time preview.
	 */
	import ArtifactEditForm from '../ArtifactEditForm/ArtifactEditForm.svelte';
	import ArtifactCard from '../ArtifactCard/ArtifactCard.svelte';
	import type { ArtifactFormLabels } from '../ArtifactEditForm/types';

	interface Props {
		// Bindable form fields
		name: string;
		description: string;
		tags: string;
		isListed: boolean;
		isPrivate: boolean;
		thumbnailUrl: string;

		// Preview-only data (not editable)
		authorName?: string;
		stats?: { viewCount?: number; favCount?: number };

		// Layout
		layout?: 'horizontal' | 'vertical';

		// Passthrough to ArtifactEditForm
		visibleFields?: ('name' | 'description' | 'tags' | 'isListed' | 'isPrivate')[];
		labels?: ArtifactFormLabels;
		onNameChange?: (name: string) => void;

		// Thumbnail upload callback - receives a File, returns the uploaded URL
		onUploadThumbnail?: (file: File) => Promise<string | null>;

		// Card variant for the preview
		cardVariant?: 'marketplace' | 'compact';

		// Preview section label
		previewLabel?: string;
	}

	let {
		name = $bindable(),
		description = $bindable(),
		tags = $bindable(),
		isListed = $bindable(),
		isPrivate = $bindable(),
		thumbnailUrl = $bindable(),
		authorName,
		stats,
		layout = 'vertical',
		visibleFields,
		labels,
		onNameChange,
		onUploadThumbnail,
		cardVariant = 'marketplace',
		previewLabel = 'Preview',
	}: Props = $props();

	// Parse tags for card display
	let parsedTags = $derived(
		tags ? tags.split(',').map(t => t.trim()).filter(t => t.length > 0) : []
	);

	// Hidden file input for thumbnail upload
	let fileInputEl: HTMLInputElement | undefined = $state();
	let uploading = $state(false);

	function handleCoverClick() {
		if (!onUploadThumbnail || uploading) return;
		fileInputEl?.click();
	}

	async function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !onUploadThumbnail) return;

		uploading = true;
		try {
			const url = await onUploadThumbnail(file);
			if (url) {
				thumbnailUrl = url;
			}
		} finally {
			uploading = false;
			// Reset input so same file can be re-selected
			input.value = '';
		}
	}
</script>

{#if layout === 'horizontal'}
	<input bind:this={fileInputEl} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onchange={handleFileChange} />
	<div class="flex gap-6">
		<!-- Form -->
		<div class="flex-1 min-w-0">
			<ArtifactEditForm
				bind:name
				bind:description
				bind:tags
				bind:isListed
				bind:isPrivate
				bind:thumbnailUrl
				{visibleFields}
				{labels}
				{onNameChange}
			/>
		</div>
		<!-- Preview -->
		<div class="shrink-0 overflow-visible" style="width: 380px;">
			<div class="text-xs font-medium text-gray-400 mb-2">{previewLabel}</div>
			<div class="overflow-visible">
				<ArtifactCard
					{name}
					{thumbnailUrl}
					{authorName}
					{description}
					tags={parsedTags}
					variant={cardVariant}
					{stats}
					onCoverClick={onUploadThumbnail ? handleCoverClick : undefined}
				/>
			</div>
		</div>
	</div>
{:else}
	<input bind:this={fileInputEl} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onchange={handleFileChange} />
	<div class="space-y-4">
		<!-- Preview: outer frame with inner card at natural size -->
		<div>
			<div class="text-xs font-medium text-gray-400 mb-2">{previewLabel}</div>
			<div class="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50" style="padding: 1.5rem 1rem 1rem 1rem;">
				<ArtifactCard
					{name}
					{thumbnailUrl}
					{authorName}
					{description}
					tags={parsedTags}
					variant={cardVariant}
					{stats}
					onCoverClick={onUploadThumbnail ? handleCoverClick : undefined}
				/>
			</div>
		</div>
		<!-- Form -->
		<ArtifactEditForm
			bind:name
			bind:description
			bind:tags
			bind:isListed
			bind:isPrivate
			bind:thumbnailUrl
			{visibleFields}
			{labels}
			{onNameChange}
		/>
	</div>
{/if}
