<script lang="ts">
	/**
	 * UploadArticleForm - Shared upload article form component
	 * Labels passed via props to avoid i18n coupling.
	 */
	import { untrack } from 'svelte';
	import { Dropdown } from '../Dropdown';
	import type { UploadArticleFormLabels } from './types';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
		labels?: UploadArticleFormLabels;
		/** Optional editor component for rich content editing */
		EditorComponent?: import('svelte').Component<{ content: unknown[]; onContentChange: (content: unknown[]) => void }>;
	}

	type VisibilityOption = { value: string; label: string };

	let { initialValues, onValuesChange, labels, EditorComponent }: Props = $props();

	const l = labels ?? {
		title: 'Title',
		titlePlaceholder: 'Article title',
		visibility: 'Visibility',
		visibilityPublic: 'Public',
		visibilityPrivate: 'Private',
		visibilityUnlisted: 'Unlisted',
		content: 'Content',
	};

	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PUBLIC', label: l.visibilityPublic },
		{ value: 'PRIVATE', label: l.visibilityPrivate },
		{ value: 'UNLISTED', label: l.visibilityUnlisted }
	];

	const initTitle = untrack(() => (initialValues.title as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PUBLIC');
	const initContent = untrack(() => (initialValues.content as unknown[]) ?? []);

	let title = $state(initTitle);
	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);
	let content = $state<unknown[]>(initContent);

	$effect(() => {
		onValuesChange({
			title,
			visibility: visibility.value,
			content
		});
	});

	function handleContentChange(newContent: unknown[]) {
		content = newContent;
	}
</script>

<div class="space-y-4">
	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{l.title} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={title}
			placeholder={l.titlePlaceholder}
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

	{#if initContent.length > 0}
		<div>
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="block text-sm font-medium text-gray-700 mb-1">
				{l.content}
			</label>
			{#if EditorComponent}
				<EditorComponent content={initContent} onContentChange={handleContentChange} />
			{:else}
				<div class="text-sm text-gray-500 italic p-3 bg-gray-100 rounded-lg">
					{initContent.length} content block(s)
				</div>
			{/if}
		</div>
	{/if}
</div>
