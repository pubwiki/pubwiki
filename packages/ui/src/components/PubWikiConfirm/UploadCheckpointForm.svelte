<script lang="ts">
	/**
	 * UploadCheckpointForm - Shared upload checkpoint form component
	 * Labels passed via props to avoid i18n coupling.
	 */
	import { untrack } from 'svelte';
	import { Dropdown } from '../Dropdown';
	import type { UploadCheckpointFormLabels } from './types';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
		labels?: UploadCheckpointFormLabels;
	}

	type VisibilityOption = { value: string; label: string };

	let { initialValues, onValuesChange, labels }: Props = $props();

	const l = $derived(labels ?? {
		name: 'Checkpoint Name',
		namePlaceholder: 'Enter checkpoint name',
		description: 'Description',
		descriptionPlaceholder: 'Optional description for this checkpoint',
		visibility: 'Visibility',
		visibilityPublic: 'Public',
		visibilityPrivate: 'Private',
		visibilityUnlisted: 'Unlisted',
	});

	const visibilityOptions: VisibilityOption[] = $derived([
		{ value: 'PRIVATE', label: l.visibilityPrivate },
		{ value: 'UNLISTED', label: l.visibilityUnlisted },
		{ value: 'PUBLIC', label: l.visibilityPublic }
	]);

	const initName = untrack(() => (initialValues.name as string) ?? '');
	const initDescription = untrack(() => (initialValues.description as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PRIVATE');

	let name = $state(initName);
	let description = $state(initDescription);
	let visibility = $state<VisibilityOption>(
		untrack(() => visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0])
	);

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
			{l.name} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={name}
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
			bind:value={description}
			placeholder={l.descriptionPlaceholder}
			rows="3"
		></textarea>
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
