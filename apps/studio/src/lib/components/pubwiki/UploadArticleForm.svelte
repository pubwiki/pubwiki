<script lang="ts">
	/**
	 * UploadArticleForm - 上传文章的自定义表单组件
	 */
	import * as m from '$lib/paraglide/messages';
	import { untrack } from 'svelte';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	let { initialValues, onValuesChange }: Props = $props();

	// Capture initial values once (intentionally not reactive to props changes)
	const initTitle = untrack(() => (initialValues.title as string) ?? '');
	const initSandboxNodeId = untrack(() => (initialValues.sandboxNodeId as string) ?? '');
	const initVisibility = untrack(() => (initialValues.visibility as string) ?? 'PUBLIC');

	let title = $state(initTitle);
	let sandboxNodeId = $state(initSandboxNodeId);
	let visibility = $state(initVisibility);

	// Notify parent when any value changes
	$effect(() => {
		onValuesChange({
			title,
			sandboxNodeId,
			visibility
		});
	});
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
			{m.studio_pubwiki_field_sandbox_node()} <span class="text-red-500">*</span>
		</label>
		<input
			type="text"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={sandboxNodeId}
			readonly
		/>
		<p class="mt-1 text-xs text-gray-500">{m.studio_pubwiki_field_sandbox_node_help()}</p>
	</div>

	<div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="block text-sm font-medium text-gray-700 mb-1">
			{m.studio_pubwiki_field_visibility()}
		</label>
		<select
			class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			bind:value={visibility}
		>
			<option value="PUBLIC">{m.studio_pubwiki_visibility_public()}</option>
			<option value="PRIVATE">{m.studio_pubwiki_visibility_private()}</option>
			<option value="UNLISTED">{m.studio_pubwiki_visibility_unlisted()}</option>
		</select>
	</div>
</div>
