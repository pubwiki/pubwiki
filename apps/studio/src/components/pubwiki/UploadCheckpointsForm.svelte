<script lang="ts">
	/**
	 * UploadCheckpointsForm - 批量上传存档点的自定义表单组件
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
	const initCount = untrack(() => (initialValues.count as number) ?? 0);
	const initNames = untrack(() => (initialValues.names as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PRIVATE');

	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);

	// Notify parent when any value changes
	$effect(() => {
		onValuesChange({
			visibility: visibility.value
		});
	});
</script>

<div class="space-y-4">
	<div>
		<p class="text-sm text-gray-600 mb-2">
			{m.studio_pubwiki_checkpoints_count({ count: initCount })}
		</p>
		<p class="text-xs text-gray-500 truncate" title={initNames}>
			{initNames}
		</p>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_checkpoints_default_visibility()}
		</label>
		<Dropdown
			items={visibilityOptions}
			bind:value={visibility}
			getLabel={(item: VisibilityOption) => item.label}
			getKey={(item: VisibilityOption) => item.value}
			size="md"
		/>
		<p class="text-xs text-gray-500 mt-1">
			{m.studio_pubwiki_checkpoints_visibility_hint()}
		</p>
	</div>
</div>
