<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { TypeSchema } from '@pubwiki/world-editor';
	import Self from './TypeSchemaEditor.svelte';

	interface Props {
		schema: TypeSchema | undefined;
		onChange: (schema: TypeSchema | undefined) => void;
		depth?: number;
	}

	const MAX_DEPTH = 5;

	let { schema, onChange, depth = 0 }: Props = $props();

	const typeOptions: Array<{ value: string; label: string }> = [
		{ value: 'none', label: '—' },
		{ value: 'string', label: 'String' },
		{ value: 'number', label: 'Number' },
		{ value: 'integer', label: 'Integer' },
		{ value: 'boolean', label: 'Boolean' },
		{ value: 'object', label: 'Object' },
		{ value: 'array', label: 'Array' },
		{ value: 'null', label: 'Null' },
	];

	let currentType = $derived(schema?.type ?? 'none');

	function handleTypeChange(newType: string) {
		if (newType === 'none') {
			onChange(undefined);
			return;
		}

		const base: TypeSchema = { type: newType as TypeSchema['type'] };
		if (newType === 'object') {
			base.properties = {};
			base.required = [];
		} else if (newType === 'array') {
			base.items = { type: 'string' };
		}
		if (schema?.description) {
			base.description = schema.description;
		}
		onChange(base);
	}

	function addProperty() {
		const existing = Object.keys(schema?.properties ?? {});
		let idx = existing.length + 1;
		let newKey = `field_${idx}`;
		while (existing.includes(newKey)) { idx++; newKey = `field_${idx}`; }
		onChange({
			...schema,
			properties: { ...schema?.properties, [newKey]: { type: 'string' } },
		});
	}

	function removeProperty(key: string) {
		const newProps = { ...schema?.properties };
		delete newProps[key];
		const newRequired = schema?.required?.filter((r) => r !== key) ?? [];
		onChange({
			...schema,
			properties: newProps,
			required: newRequired.length > 0 ? newRequired : undefined,
		});
	}

	function renameProperty(oldKey: string, newKey: string) {
		if (oldKey === newKey || !newKey.trim()) return;
		if (schema?.properties?.[newKey]) return; // already exists
		const newProps: Record<string, TypeSchema> = {};
		for (const [k, v] of Object.entries(schema?.properties ?? {})) {
			newProps[k === oldKey ? newKey : k] = v;
		}
		const newRequired = schema?.required?.map((r) => (r === oldKey ? newKey : r)) ?? [];
		onChange({
			...schema,
			properties: newProps,
			required: newRequired.length > 0 ? newRequired : undefined,
		});
	}

	function updatePropertySchema(key: string, propSchema: TypeSchema | undefined) {
		onChange({
			...schema,
			properties: { ...schema?.properties, [key]: propSchema ?? { type: 'string' } },
		});
	}

	function toggleRequired(key: string) {
		const isRequired = schema?.required?.includes(key);
		const newRequired = isRequired
			? (schema?.required?.filter((r) => r !== key) ?? [])
			: [...(schema?.required ?? []), key];
		onChange({
			...schema,
			required: newRequired.length > 0 ? newRequired : undefined,
		});
	}

	function updateItemsSchema(itemsSchema: TypeSchema | undefined) {
		onChange({ ...schema, items: itemsSchema ?? { type: 'string' } });
	}

	const INPUT_CLS = 'px-2 py-1 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
</script>

{#if depth > MAX_DEPTH}
	<div class="text-xs italic px-2 py-1" style="color: var(--we-text-tertiary);">Max nesting depth reached</div>
{:else}
	<div class="flex flex-col gap-2" style="padding-left: {depth > 0 ? '12px' : '0'}; {depth > 0 ? 'border-left: 2px solid var(--we-border);' : ''}">
		<!-- Type selector + description -->
		<div class="flex items-center gap-2">
			<select
				class="{INPUT_CLS} w-28 shrink-0"
				style="border-color: var(--we-border); color: var(--we-text-primary);"
				value={currentType}
				onchange={(e) => handleTypeChange(e.currentTarget.value)}
			>
				{#each typeOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			{#if schema}
				<input
					type="text"
					class="{INPUT_CLS} flex-1"
					style="border-color: var(--we-border); color: var(--we-text-secondary);"
					value={schema.description ?? ''}
					placeholder="Description..."
					oninput={(e) => onChange({ ...schema!, description: e.currentTarget.value || undefined })}
				/>
			{/if}
		</div>

		<!-- Object properties -->
		{#if schema?.type === 'object'}
			<div class="flex flex-col gap-2 mt-1">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium uppercase tracking-wider" style="color: var(--we-text-tertiary);">Properties</span>
					<button
						type="button"
						class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
						onclick={addProperty}
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
						Add
					</button>
				</div>

				{#each Object.entries(schema.properties ?? {}) as [key, propSchema] (key)}
					<div class="rounded-md p-2" style="background: var(--we-bg-base); border: 1px solid var(--we-border);">
						<div class="flex items-center gap-2 mb-1.5">
							<!-- Property name (editable) -->
							<input
								type="text"
								class="{INPUT_CLS} flex-1 font-mono text-xs"
								style="border-color: var(--we-border); color: var(--we-text-primary);"
								value={key}
								onblur={(e) => {
									const newKey = e.currentTarget.value.trim();
									if (newKey && newKey !== key) renameProperty(key, newKey);
								}}
								onkeydown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
							/>
							<!-- Required toggle -->
							<label class="inline-flex items-center gap-1 text-[10px] shrink-0 cursor-pointer" style="color: var(--we-text-tertiary);">
								<input
									type="checkbox"
									checked={schema.required?.includes(key) ?? false}
									onchange={() => toggleRequired(key)}
								/>
								req
							</label>
							<!-- Remove -->
							<button
								type="button"
								class="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0"
								title={m.we_common_remove()}
								onclick={() => removeProperty(key)}
							>
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						<!-- Nested schema editor -->
						<Self
							schema={propSchema}
							onChange={(s: TypeSchema | undefined) => updatePropertySchema(key, s)}
							depth={depth + 1}
						/>
					</div>
				{/each}

				{#if Object.keys(schema.properties ?? {}).length === 0}
					<div class="text-xs italic text-center py-2" style="color: var(--we-text-tertiary);">No properties defined</div>
				{/if}
			</div>
		{/if}

		<!-- Array items schema -->
		{#if schema?.type === 'array'}
			<div class="flex flex-col gap-2 mt-1">
				<span class="text-xs font-medium uppercase tracking-wider" style="color: var(--we-text-tertiary);">Array Items</span>
				<Self
					schema={schema.items}
					onChange={updateItemsSchema}
					depth={depth + 1}
				/>
			</div>
		{/if}
	</div>
{/if}
