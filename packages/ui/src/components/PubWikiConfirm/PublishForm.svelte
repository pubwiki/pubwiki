<script lang="ts">
	/**
	 * PublishForm - Shared publish form component
	 * Labels passed via props to avoid i18n coupling.
	 */
	import { untrack } from 'svelte';
	import { Dropdown } from '../Dropdown';
	import ArtifactCard from '../ArtifactCard/ArtifactCard.svelte';
	import type { PublishFormLabels } from './types';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
		labels?: PublishFormLabels;
		/** Author name for the card preview */
		authorName?: string;
		/** Thumbnail upload callback — receives a File, returns the uploaded URL */
		onUploadThumbnail?: (file: File) => Promise<string | null>;
	}

	type VisibilityOption = { value: string; label: string };

	let { initialValues, onValuesChange, labels, authorName, onUploadThumbnail }: Props = $props();

	const l = labels ?? {
		name: 'Name',
		namePlaceholder: 'Project name',
		description: 'Description',
		descriptionPlaceholder: 'Brief description of your project',
		version: 'Version',
		visibility: 'Visibility',
		visibilityPublic: 'Public',
		visibilityPrivate: 'Private',
		visibilityUnlisted: 'Unlisted',
		homepage: 'Homepage (Markdown)',
		homepagePlaceholder: '# Welcome\n\nDescribe your project here...',
		homepageHelp: 'Markdown content for the project homepage',
		preview: 'Preview',
	};

	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PUBLIC', label: l.visibilityPublic },
		{ value: 'PRIVATE', label: l.visibilityPrivate },
		{ value: 'UNLISTED', label: l.visibilityUnlisted }
	];

	const initName = untrack(() => (initialValues.name as string) ?? '');
	const initDescription = untrack(() => (initialValues.description as string) ?? '');
	const initVersion = untrack(() => (initialValues.version as string) ?? '1.0.0');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PUBLIC');
	const initHomepage = untrack(() => (initialValues.homepage as string) ?? '');
	const initThumbnailUrl = untrack(() => (initialValues.thumbnailUrl as string) ?? '');

	let name = $state(initName);
	let description = $state(initDescription);
	let version = $state(initVersion);
	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);
	let homepage = $state(initHomepage);
	let thumbnailUrl = $state(initThumbnailUrl);

	// Thumbnail upload
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
			input.value = '';
		}
	}

	function generateRandomSlug(nameStr: string): string {
		const prefix = nameStr
			.toLowerCase()
			.trim()
			.replace(/[^\w\s-]/g, '')
			.replace(/[\s_-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 30);
		const randomSuffix = crypto.randomUUID().slice(0, 8);
		return prefix ? `${prefix}-${randomSuffix}` : randomSuffix;
	}

	$effect(() => {
		onValuesChange({
			name,
			slug: generateRandomSlug(name),
			description,
			version,
			visibility: visibility.value,
			homepage,
			thumbnailUrl
		});
	});

	function handleNameChange(e: Event) {
		const target = e.target as HTMLInputElement;
		name = target.value;
	}
</script>

<input bind:this={fileInputEl} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onchange={handleFileChange} />
<div class="flex gap-6">
	<!-- Form -->
	<div class="flex-1 min-w-0 space-y-4">
	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{l.name} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			value={name}
			oninput={handleNameChange}
			placeholder={l.namePlaceholder}
		/>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{l.description}
		</label>
		<textarea
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			rows="2"
			bind:value={description}
			placeholder={l.descriptionPlaceholder}
		></textarea>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<div>
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="block text-sm font-medium text-gray-700 mb-1">
				{l.version}
			</label>
			<input
				type="text"
				class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				bind:value={version}
				placeholder="1.0.0"
			/>
		</div>

		<div>
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="block text-sm font-medium text-gray-700 mb-1">
				{l.visibility}
			</label>
			<Dropdown
				items={visibilityOptions}
				bind:value={visibility}
				getLabel={(item: VisibilityOption) => item.label}
				getKey={(item: VisibilityOption) => item.value}
				size="md"
			/>
		</div>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{l.homepage}
		</label>
		<textarea
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
			rows="4"
			bind:value={homepage}
			placeholder={l.homepagePlaceholder}
		></textarea>
		<p class="mt-1 text-xs text-gray-500">{l.homepageHelp}</p>
	</div>
	</div>

	<!-- Preview -->
	<div class="shrink-0 overflow-visible" style="width: 280px;">
		<div class="text-xs font-medium text-gray-400 mb-2">{l.preview}</div>
		<div class="overflow-visible">
			<ArtifactCard
				{name}
				{description}
				{thumbnailUrl}
				{authorName}
				variant="marketplace"
				onCoverClick={onUploadThumbnail ? handleCoverClick : undefined}
			/>
		</div>
	</div>
</div>
