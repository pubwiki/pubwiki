<!--
  BindSettingEditor — Edit an entity's setting documents (RAG data source).
-->
<script lang="ts">
	import type { SettingDocument } from '../../types/state-data.js';
	import FormField from '../primitives/FormField.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';
	import NumberInput from '../primitives/NumberInput.svelte';

	interface Props {
		documents: SettingDocument[];
		onChange: (documents: SettingDocument[]) => void;
	}

	let { documents, onChange }: Props = $props();

	function addDoc() {
		onChange([...documents, { name: '', content: '' }]);
	}

	function updateDoc(index: number, patch: Partial<SettingDocument>) {
		const updated = documents.map((d, i) => (i === index ? { ...d, ...patch } : d));
		onChange(updated);
	}

	function removeDoc(index: number) {
		onChange(documents.filter((_, i) => i !== index));
	}
</script>

<div class="space-y-3">
	{#each documents as doc, index}
		<div class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
			<div class="mb-2 flex items-center justify-between">
				<span class="text-xs font-medium text-gray-500">Document #{index + 1}</span>
				<div class="flex items-center gap-2">
					<label class="text-xs text-gray-500">
						<input
							type="checkbox"
							checked={doc.disable ?? false}
							onchange={(e) => updateDoc(index, { disable: e.currentTarget.checked })}
							class="mr-1 accent-amber-500"
						/>
						Disabled
					</label>
					<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeDoc(index)}>
						Remove
					</button>
				</div>
			</div>
			<FormField label="Name">
				<TextInput value={doc.name} onchange={(v) => updateDoc(index, { name: v })} placeholder="Document name..." />
			</FormField>
			<FormField label="Content">
				<TextArea value={doc.content} onchange={(v) => updateDoc(index, { content: v })} rows={4} placeholder="Setting content..." />
			</FormField>
			<div class="grid grid-cols-2 gap-2">
				<FormField label="Priority" hint="higher = more important">
					<NumberInput value={doc.static_priority ?? 0} onchange={(v) => updateDoc(index, { static_priority: v })} />
				</FormField>
				<FormField label="Condition" hint="natural language for LLM recall">
					<TextInput
						value={doc.condition ?? ''}
						onchange={(v) => updateDoc(index, { condition: v || undefined })}
						placeholder="When relevant to..."
					/>
				</FormField>
			</div>
		</div>
	{/each}

	<button
		type="button"
		class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
		onclick={addDoc}
	>
		+ Add Document
	</button>
</div>
