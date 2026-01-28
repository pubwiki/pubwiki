<script lang="ts">
	/**
	 * UploadCheckpointForm - 上传存档点的自定义表单组件
	 */
	import * as m from '$lib/paraglide/messages';
	import { untrack } from 'svelte';
	import { Dropdown } from '@pubwiki/ui/components';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	type VisibilityOption = { value: string; label: string };

	let { initialValues, onValuesChange }: Props = $props();

	// Visibility options for dropdown
	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PRIVATE', label: m.studio_pubwiki_visibility_private() },
		{ value: 'UNLISTED', label: m.studio_pubwiki_visibility_unlisted() },
		{ value: 'PUBLIC', label: m.studio_pubwiki_visibility_public() }
	];

	// Capture initial values once (intentionally not reactive to props changes)
	const initName = untrack(() => (initialValues.name as string) ?? '');
	const initDescription = untrack(() => (initialValues.description as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PRIVATE');

	let name = $state(initName);
	let description = $state(initDescription);
	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);

	// Notify parent when any value changes
	$effect(() => {
		onValuesChange({
			name,
			description,
			visibility: visibility.value
		});
	});
</script>

<div class="space-y-4">
	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_checkpoint_name()} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={name}
			placeholder={m.studio_pubwiki_checkpoint_name_placeholder()}
		/>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_checkpoint_description()}
		</label>
		<textarea
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={description}
			placeholder={m.studio_pubwiki_checkpoint_description_placeholder()}
			rows="3"
		></textarea>
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
</div>
