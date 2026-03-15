<script lang="ts">
	/**
	 * ArtifactEditForm - Reusable artifact metadata editing form.
	 *
	 * Pure form component with bindable fields. Does NOT handle saving, API calls,
	 * or persistence — that's the caller's responsibility.
	 *
	 * Labels are passed via props to avoid coupling with any specific i18n library.
	 */
	import { Toggle } from '../Toggle';
	import type { ArtifactFormLabels } from './types';

	interface Props {
		/** Artifact name (required) */
		name: string;
		/** Artifact description */
		description: string;
		/** Comma-separated tags */
		tags: string;
		/** Whether the artifact is listed in search */
		isListed: boolean;
		/** Whether the artifact is private */
		isPrivate: boolean;
		/** Thumbnail URL */
		thumbnailUrl: string;
		/** Which fields to show (defaults to all) */
		visibleFields?: ('name' | 'description' | 'tags' | 'isListed' | 'isPrivate')[];
		/** Labels for form fields */
		labels?: ArtifactFormLabels;
		/** Called when name changes (for external side-effects like syncing sidebar header) */
		onNameChange?: (name: string) => void;
	}

	const defaultLabels: Required<ArtifactFormLabels> = {
		name: 'Name',
		namePlaceholder: 'Artifact name',
		description: 'Description',
		descriptionPlaceholder: 'Describe your artifact...',
		tags: 'Tags',
		tagsPlaceholder: 'tag1, tag2, tag3',
		listed: 'Listed in search',
		listedDescription: 'Anyone can discover this artifact',
		private: 'Private',
		privateDescription: 'Only you and authorized users can access',

	};

	let {
		name = $bindable(),
		description = $bindable(),
		tags = $bindable(),
		isListed = $bindable(),
		isPrivate = $bindable(),
		thumbnailUrl = $bindable(),
		visibleFields,
		labels,
		onNameChange,
	}: Props = $props();

	let resolvedLabels = $derived({ ...defaultLabels, ...labels });

	function isVisible(field: string): boolean {
		if (!visibleFields) return true;
		return visibleFields.includes(field as Props['visibleFields'] extends (infer T)[] ? T : never);
	}

	function handleNameInput(e: Event) {
		const target = e.target as HTMLInputElement;
		name = target.value;
		onNameChange?.(name);
	}
</script>

<div class="space-y-3">
	{#if isVisible('name')}
		<div>
			<label for="artifact-edit-name" class="block text-xs font-medium text-gray-500 mb-1">
				{resolvedLabels.name} <span class="text-red-500">*</span>
			</label>
			<input
				id="artifact-edit-name"
				type="text"
				value={name}
				oninput={handleNameInput}
				required
				maxlength={100}
				placeholder={resolvedLabels.namePlaceholder}
				class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
			/>
		</div>
	{/if}

	{#if isVisible('isListed') || isVisible('isPrivate')}
		<div class="space-y-2 rounded-lg border border-gray-200 p-3">
			{#if isVisible('isPrivate')}
				<Toggle
					bind:checked={isPrivate}
					label={resolvedLabels.private}
					description={resolvedLabels.privateDescription}
					size="sm"
				/>
			{/if}
			{#if isVisible('isListed') && isVisible('isPrivate')}
				<div class="border-t border-gray-100"></div>
			{/if}
			{#if isVisible('isListed')}
				{@const isUnlisted = !isListed}
				<Toggle
					checked={isUnlisted}
					onchange={(checked) => { isListed = !checked; }}
					label={resolvedLabels.listed}
					description={resolvedLabels.listedDescription}
					size="sm"
				/>
			{/if}
		</div>
	{/if}

	{#if isVisible('description')}
		<div>
			<label for="artifact-edit-description" class="block text-xs font-medium text-gray-500 mb-1">
				{resolvedLabels.description}
			</label>
			<textarea
				id="artifact-edit-description"
				bind:value={description}
				placeholder={resolvedLabels.descriptionPlaceholder}
				rows="3"
				class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
			></textarea>
		</div>
	{/if}

	{#if isVisible('tags')}
		<div>
			<label for="artifact-edit-tags" class="block text-xs font-medium text-gray-500 mb-1">
				{resolvedLabels.tags}
			</label>
			<input
				id="artifact-edit-tags"
				type="text"
				bind:value={tags}
				placeholder={resolvedLabels.tagsPlaceholder}
				class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
			/>
		</div>
	{/if}


</div>
