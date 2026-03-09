<script lang="ts">
	/**
	 * UploadArticleForm - 上传文章的自定义表单组件
	 *
	 * Includes title, visibility, and a Lexical-based content editor.
	 */
	import * as m from '$lib/paraglide/messages';
	import { untrack } from 'svelte';
	import { Dropdown } from '@pubwiki/ui/components';
	import { Editor } from '@pubwiki/reader';
	import type { ReaderContent } from '@pubwiki/api';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	type VisibilityOption = { value: string; label: string };

	let { initialValues, onValuesChange }: Props = $props();

	// Visibility options for dropdown
	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PUBLIC', label: m.studio_pubwiki_visibility_public() },
		{ value: 'PRIVATE', label: m.studio_pubwiki_visibility_private() },
		{ value: 'UNLISTED', label: m.studio_pubwiki_visibility_unlisted() }
	];

	// Capture initial values once (intentionally not reactive to props changes)
	const initTitle = untrack(() => (initialValues.title as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PUBLIC');
	const initContent = untrack(() => (initialValues.content as ReaderContent) ?? []);

	let title = $state(initTitle);
	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);
	let content = $state<ReaderContent>(initContent);

	// Notify parent when any value changes
	$effect(() => {
		onValuesChange({
			title,
			visibility: visibility.value,
			content
		});
	});

	function handleContentChange(newContent: ReaderContent) {
		content = newContent;
	}
</script>

<div class="space-y-4">
	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_title()} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={title}
			placeholder={m.studio_pubwiki_field_title_placeholder()}
		/>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_visibility()}
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
				{m.studio_pubwiki_field_content()}
			</label>
			<Editor content={initContent} onContentChange={handleContentChange} />
		</div>
	{/if}
</div>
