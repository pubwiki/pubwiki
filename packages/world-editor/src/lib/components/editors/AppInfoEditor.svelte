<!--
  AppInfoEditor — Edit the top-level AppInfo metadata.
-->
<script lang="ts">
	import type { AppInfo } from '../../types/state-data.js';
	import FormField from '../primitives/FormField.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';
	import StringArrayEditor from '../primitives/StringArrayEditor.svelte';

	interface Props {
		info: AppInfo | undefined;
		onChange: (info: AppInfo) => void;
	}

	let { info, onChange }: Props = $props();

	let current = $derived(
		info || {
			name: '',
			slug: '',
			version: '0.1.0',
			visibility: 'PRIVATE' as const,
			tags: [],
			publish_type: 'GALGAME' as const
		}
	);

	function update(patch: Partial<AppInfo>) {
		onChange({ ...current, ...patch });
	}
</script>

<div class="p-6">
	<div class="mb-4">
		<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">📱 App Info</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">Application metadata and publishing settings.</p>
	</div>

	<div class="space-y-4">
		<FormField label="Name" hint="display name of the game">
			<TextInput value={current.name} onchange={(v) => update({ name: v })} placeholder="My AVG Game" />
		</FormField>

		<FormField label="Slug" hint="URL-safe identifier">
			<TextInput value={current.slug} onchange={(v) => update({ slug: v })} placeholder="my-avg-game" />
		</FormField>

		<FormField label="Version">
			<TextInput value={current.version ?? ''} onchange={(v) => update({ version: v })} placeholder="0.1.0" />
		</FormField>

		<FormField label="Homepage URL">
			<TextInput value={current.homepage ?? ''} onchange={(v) => update({ homepage: v || undefined })} placeholder="https://..." />
		</FormField>

		<FormField label="Visibility">
			<select
				class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
				value={current.visibility}
				onchange={(e) => update({ visibility: e.currentTarget.value as AppInfo['visibility'] })}
			>
				<option value="PUBLIC">Public</option>
				<option value="PRIVATE">Private</option>
				<option value="UNLISTED">Unlisted</option>
			</select>
		</FormField>

		<FormField label="Publish Type">
			<select
				class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
				value={current.publish_type}
				onchange={(e) => update({ publish_type: e.currentTarget.value as AppInfo['publish_type'] })}
			>
				<option value="EDITOR">Editor</option>
				<option value="NOVEL">Novel</option>
				<option value="INK">Ink</option>
				<option value="TEST">Test</option>
				<option value="CUSTOM">Custom</option>
				<option value="GALGAME">Galgame</option>
			</select>
		</FormField>

		<FormField label="Tags">
			<StringArrayEditor
				values={current.tags ?? []}
				onChange={(tags) => update({ tags })}
				placeholder="Add tag..."
			/>
		</FormField>
	</div>
</div>
