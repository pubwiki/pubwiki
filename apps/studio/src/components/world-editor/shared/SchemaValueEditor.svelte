<script lang="ts">
	import type { TypeSchema } from '@pubwiki/world-editor';

	interface Props {
		schema: TypeSchema | undefined;
		value: unknown;
		onChange: (value: unknown) => void;
		depth?: number;
	}

	const MAX_DEPTH = 5;

	let { schema, value, onChange, depth = 0 }: Props = $props();

	const INPUT_CLS = 'w-full px-2 py-1 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

	function getDefaultForSchema(s: TypeSchema | undefined): unknown {
		if (!s?.type) return undefined;
		switch (s.type) {
			case 'string': return '';
			case 'number': case 'integer': return 0;
			case 'boolean': return false;
			case 'object': return {};
			case 'array': return [];
			case 'null': return null;
			default: return undefined;
		}
	}
</script>

{#if depth > MAX_DEPTH}
	<div class="text-xs italic px-2 py-1" style="color: var(--we-text-tertiary);">Max nesting depth</div>
{:else if !schema || !schema.type}
	<!-- Fallback: free-text JSON input -->
	<input
		type="text"
		class={INPUT_CLS}
		style="border-color: var(--we-border); color: var(--we-text-primary);"
		value={value != null ? JSON.stringify(value) : ''}
		placeholder="Free-format data"
		onblur={(e) => {
			const raw = e.currentTarget.value.trim();
			if (!raw) { onChange(undefined); return; }
			try { onChange(JSON.parse(raw)); } catch { onChange(raw); }
		}}
	/>
{:else if schema.type === 'string'}
	{#if schema.description}
		<div class="text-[10px] mb-0.5" style="color: var(--we-text-tertiary);">{schema.description}</div>
	{/if}
	<input
		type="text"
		class={INPUT_CLS}
		style="border-color: var(--we-border); color: var(--we-text-primary);"
		value={(value as string) ?? ''}
		placeholder={schema.description ?? 'Enter text...'}
		oninput={(e) => onChange(e.currentTarget.value || undefined)}
	/>
{:else if schema.type === 'number' || schema.type === 'integer'}
	{#if schema.description}
		<div class="text-[10px] mb-0.5" style="color: var(--we-text-tertiary);">{schema.description}</div>
	{/if}
	<input
		type="number"
		class={INPUT_CLS}
		style="border-color: var(--we-border); color: var(--we-text-primary);"
		value={(value as number) ?? ''}
		step={schema.type === 'integer' ? 1 : 'any'}
		placeholder={schema.description ?? (schema.type === 'integer' ? 'Integer' : 'Number')}
		oninput={(e) => {
			const val = e.currentTarget.value;
			if (val === '') { onChange(undefined); return; }
			onChange(schema!.type === 'integer' ? parseInt(val) : parseFloat(val));
		}}
	/>
{:else if schema.type === 'boolean'}
	{#if schema.description}
		<div class="text-[10px] mb-0.5" style="color: var(--we-text-tertiary);">{schema.description}</div>
	{/if}
	<select
		class={INPUT_CLS}
		style="border-color: var(--we-border); color: var(--we-text-primary);"
		value={value === true ? 'true' : value === false ? 'false' : ''}
		onchange={(e) => {
			const val = e.currentTarget.value;
			onChange(val === 'true' ? true : val === 'false' ? false : undefined);
		}}
	>
		<option value="">—</option>
		<option value="true">true</option>
		<option value="false">false</option>
	</select>
{:else if schema.type === 'object'}
	{@const properties = schema.properties ?? {}}
	{@const currentObj = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? (value as Record<string, unknown>) : {}}
	{#if schema.description}
		<div class="text-[10px] mb-0.5" style="color: var(--we-text-tertiary);">{schema.description}</div>
	{/if}
	<div class="flex flex-col gap-2" style="padding-left: 12px; border-left: 2px solid var(--we-border);">
		{#each Object.entries(properties) as [key, propSchema] (key)}
			{@const isRequired = schema.required?.includes(key) ?? false}
			<div class="flex flex-col gap-0.5">
				<label class="text-xs font-medium" style="color: var(--we-text-secondary);">
					{key}{#if isRequired}<span class="text-red-500 ml-0.5">*</span>{/if}
					{#if propSchema.description}
						<span class="font-normal ml-1" style="color: var(--we-text-tertiary);" title={propSchema.description}>ⓘ</span>
					{/if}
				</label>
				<svelte:self
					schema={propSchema}
					value={currentObj[key]}
					onChange={(newVal: unknown) => {
						const newObj = { ...currentObj };
						if (newVal === undefined) { delete newObj[key]; }
						else { newObj[key] = newVal; }
						onChange(Object.keys(newObj).length > 0 ? newObj : undefined);
					}}
					depth={depth + 1}
				/>
			</div>
		{/each}
		{#if Object.keys(properties).length === 0}
			<div class="text-xs italic py-1" style="color: var(--we-text-tertiary);">No properties defined</div>
		{/if}
	</div>
{:else if schema.type === 'array'}
	{@const itemSchema = schema.items ?? { type: 'string' }}
	{@const currentArray = Array.isArray(value) ? (value as unknown[]) : []}
	{#if schema.description}
		<div class="text-[10px] mb-0.5" style="color: var(--we-text-tertiary);">{schema.description}</div>
	{/if}
	<div class="flex flex-col gap-2" style="padding-left: 12px; border-left: 2px solid var(--we-border);">
		{#each currentArray as item, index (index)}
			<div class="flex items-start gap-1">
				<span class="text-[10px] font-mono shrink-0 pt-1" style="color: var(--we-text-tertiary);">#{index + 1}</span>
				<div class="flex-1">
					<svelte:self
						schema={itemSchema}
						value={item}
						onChange={(newVal: unknown) => {
							const newArr = [...currentArray];
							newArr[index] = newVal;
							onChange(newArr);
						}}
						depth={depth + 1}
					/>
				</div>
				<button
					type="button"
					class="p-0.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0 mt-0.5"
					onclick={() => {
						const newArr = currentArray.filter((_, i) => i !== index);
						onChange(newArr.length > 0 ? newArr : undefined);
					}}
				>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		{/each}
		<button
			type="button"
			class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors self-start"
			onclick={() => onChange([...currentArray, getDefaultForSchema(itemSchema)])}
		>
			<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
			Add
		</button>
	</div>
{:else if schema.type === 'null'}
	<span class="text-xs italic" style="color: var(--we-text-tertiary);">null</span>
{/if}
