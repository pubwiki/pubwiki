<script lang="ts">
	/**
	 * PublishForm - 发布项目的自定义表单组件
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

	// Visibility options for dropdown - must be defined before use
	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PUBLIC', label: m.studio_pubwiki_visibility_public() },
		{ value: 'PRIVATE', label: m.studio_pubwiki_visibility_private() },
		{ value: 'UNLISTED', label: m.studio_pubwiki_visibility_unlisted() }
	];

	// Capture initial values once (intentionally not reactive to props changes)
	const initName = untrack(() => (initialValues.name as string) ?? '');
	const initSlug = untrack(() => (initialValues.slug as string) ?? '');
	const initDescription = untrack(() => (initialValues.description as string) ?? '');
	const initVersion = untrack(() => (initialValues.version as string) ?? '1.0.0');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PUBLIC');
	const initHomepage = untrack(() => (initialValues.homepage as string) ?? '');

	let name = $state(initName);
	let slug = $state(initSlug);
	let description = $state(initDescription);
	let version = $state(initVersion);
	let visibility = $state<VisibilityOption>(
		visibilityOptions.find(o => o.value === initVisibility) ?? visibilityOptions[0]
	);
	let homepage = $state(initHomepage);

	// Notify parent when any value changes
	$effect(() => {
		onValuesChange({
			name,
			slug,
			description,
			version,
			visibility: visibility.value,
			homepage
		});
	});

	// 根据名称自动生成 slug
	function generateSlug(nameStr: string): string {
		return nameStr
			.toLowerCase()
			.trim()
			.replace(/[^\w\s-]/g, '')
			.replace(/[\s_-]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	function handleNameChange(e: Event) {
		const target = e.target as HTMLInputElement;
		name = target.value;
		// 如果 slug 为空或者是自动生成的，就自动更新
		if (!slug || slug === generateSlug(initName)) {
			slug = generateSlug(target.value);
		}
	}
</script>

<div class="space-y-4">
	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_name()} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			value={name}
			oninput={handleNameChange}
			placeholder={m.studio_pubwiki_field_name_placeholder()}
		/>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_slug()} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={slug}
			placeholder={m.studio_pubwiki_field_slug_placeholder()}
		/>
		<p class="mt-1 text-xs text-gray-500">{m.studio_pubwiki_field_slug_help()}</p>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_description()}
		</label>
		<textarea
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			rows="2"
			bind:value={description}
			placeholder={m.studio_pubwiki_field_description_placeholder()}
		></textarea>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<div>
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="block text-sm font-medium text-gray-700 mb-1">
				{m.studio_pubwiki_field_version()}
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

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_homepage()}
		</label>
		<textarea
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
			rows="4"
			bind:value={homepage}
			placeholder={m.studio_pubwiki_field_homepage_placeholder()}
		></textarea>
		<p class="mt-1 text-xs text-gray-500">{m.studio_pubwiki_field_homepage_help()}</p>
	</div>
</div>
