<script lang="ts">
	/**
	 * UploadCheckpointsForm - Shared batch upload checkpoints form component
	 * Labels passed via props to avoid i18n coupling.
	 */
	import { untrack } from 'svelte';
	import { Dropdown } from '../Dropdown';
	import type { UploadCheckpointsFormLabels } from './types';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
		labels?: UploadCheckpointsFormLabels;
	}

	type VisibilityOption = { value: string; label: string };

	let { initialValues, onValuesChange, labels }: Props = $props();

	const l = labels ?? {
		count: (count: number) => `Uploading ${count} checkpoints`,
		defaultVisibility: 'Default Visibility',
		visibilityPublic: 'Public',
		visibilityPrivate: 'Private',
		visibilityUnlisted: 'Unlisted',
		visibilityHint: 'Individual checkpoint visibility can override this default',
	};

	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PRIVATE', label: l.visibilityPrivate },
		{ value: 'UNLISTED', label: l.visibilityUnlisted },
		{ value: 'PUBLIC', label: l.visibilityPublic }
	];

	const initCount = untrack(() => (initialValues.count as number) ?? 0);
	const initNames = untrack(() => (initialValues.names as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PRIVATE');

	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);

	$effect(() => {
		onValuesChange({
			visibility: visibility.value
		});
	});
</script>

<div class="space-y-4">
	<div>
		<p class="text-sm text-gray-600 mb-2">
			{l.count(initCount)}
		</p>
		<p class="text-xs text-gray-500 truncate" title={initNames}>
			{initNames}
		</p>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{l.defaultVisibility}
		</label>
		<Dropdown
			items={visibilityOptions}
			bind:value={visibility}
			getLabel={(item: VisibilityOption) => item.label}
			getKey={(item: VisibilityOption) => item.value}
			size="md"
		/>
		<p class="text-xs text-gray-500 mt-1">
			{l.visibilityHint}
		</p>
	</div>
</div>
