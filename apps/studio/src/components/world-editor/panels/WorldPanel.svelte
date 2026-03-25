<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { EditModal, FormGroup, FormGrid, TypeSchemaEditor } from '../shared';
	import type { WorldSnapshot, CreatureAttrField, CustomComponentDef, SettingDocument, LogEntry } from '@pubwiki/world-editor';

	const ctx = getWorldEditorContext();

	let world = $derived(ctx.stateData.World);
	let gameTime = $derived(world.game_time);
	let registry = $derived(world.registry ?? []);
	let customComponents = $derived(world.custom_component_registry ?? []);
	let documents = $derived(world.bind_setting?.documents ?? []);
	let log = $derived(world.log ?? []);

	type ModalState = { section: 'registry'; index: number }
		| { section: 'component'; index: number }
		| { section: 'document'; index: number };
	let editModal: ModalState | null = $state(null);
	let logInput = $state('');

	function updateWorld(patch: Partial<WorldSnapshot>) {
		const updated: WorldSnapshot = { ...world, ...patch };
		const ops = ctx.translator.replaceWorld(world, updated);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

	function addRegistryField() {
		const updated = [...registry, { field_name: '', hint: '' }];
		updateWorld({ registry: updated });
		editModal = { section: 'registry', index: updated.length - 1 };
	}

	function addComponent() {
		const updated = [...customComponents, { component_key: '', component_name: '', is_array: false }];
		updateWorld({ custom_component_registry: updated });
		editModal = { section: 'component', index: updated.length - 1 };
	}

	function addDoc() {
		const updated = [...documents, { name: '', content: '' }];
		updateWorld({ bind_setting: { documents: updated } });
		editModal = { section: 'document', index: updated.length - 1 };
	}

	function deleteFromModal() {
		if (!editModal) return;
		const { section, index } = editModal;
		if (section === 'registry') {
			updateWorld({ registry: registry.filter((_: CreatureAttrField, i: number) => i !== index) });
		} else if (section === 'component') {
			updateWorld({ custom_component_registry: customComponents.filter((_: CustomComponentDef, i: number) => i !== index) });
		} else if (section === 'document') {
			updateWorld({ bind_setting: { documents: documents.filter((_: SettingDocument, i: number) => i !== index) } });
		}
		editModal = null;
	}

	function addLogEntry() {
		if (!logInput.trim()) return;
		updateWorld({ log: [...log, { timestamp: new Date().toISOString(), content: logInput.trim() }] });
		logInput = '';
	}

	function deleteLogEntry(i: number) {
		updateWorld({ log: log.filter((_: LogEntry, idx: number) => idx !== i) });
	}
</script>

<div class="flex-1 overflow-y-auto p-6" style="background: var(--we-bg-base);">
	<!-- Header -->
	<div class="flex items-center gap-3 mb-6">
		<div class="p-2 rounded-md" style="background: color-mix(in srgb, var(--we-accent-ochre) 12%, transparent);">
			<svg class="w-5 h-5" style="color: var(--we-accent-ochre);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>
			</svg>
		</div>
		<h2 class="font-serif font-bold text-xl" style="color: var(--we-text-primary);">{m.we_world_title()}</h2>
	</div>

	<!-- Bento grid -->
	<div class="bento-grid">

		<!-- Game Time (inline) -->
		<div class="bento-card" style="grid-area: time;">
			<h4 class="bento-title">{m.we_world_game_time()}</h4>
			<FormGrid>
				<FormGroup label="Year">
					<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={gameTime?.year ?? 0}
						oninput={(e) => updateWorld({ game_time: { ...gameTime ?? { year: 0, month: 1, day: 1, hour: 0, minute: 0 }, year: Number(e.currentTarget.value) } })} />
				</FormGroup>
				<FormGroup label="Month">
					<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={gameTime?.month ?? 1}
						oninput={(e) => updateWorld({ game_time: { ...gameTime ?? { year: 0, month: 1, day: 1, hour: 0, minute: 0 }, month: Number(e.currentTarget.value) } })} />
				</FormGroup>
				<FormGroup label="Day">
					<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={gameTime?.day ?? 1}
						oninput={(e) => updateWorld({ game_time: { ...gameTime ?? { year: 0, month: 1, day: 1, hour: 0, minute: 0 }, day: Number(e.currentTarget.value) } })} />
				</FormGroup>
				<FormGroup label="Hour">
					<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={gameTime?.hour ?? 0}
						oninput={(e) => updateWorld({ game_time: { ...gameTime ?? { year: 0, month: 1, day: 1, hour: 0, minute: 0 }, hour: Number(e.currentTarget.value) } })} />
				</FormGroup>
				<FormGroup label="Minute">
					<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={gameTime?.minute ?? 0}
						oninput={(e) => updateWorld({ game_time: { ...gameTime ?? { year: 0, month: 1, day: 1, hour: 0, minute: 0 }, minute: Number(e.currentTarget.value) } })} />
				</FormGroup>
			</FormGrid>
		</div>

		<!-- Director Notes (inline) -->
		<div class="bento-card" style="grid-area: director;">
			<h4 class="bento-title">{m.we_world_director_notes()}</h4>
			<FormGroup label="Stage Goal">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={world.director_notes?.stage_goal ?? ''}
					oninput={(e) => updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, stage_goal: e.currentTarget.value || null } })} />
			</FormGroup>
			<!-- Notes sub-list -->
			{#if true}
			{@const notes = world.director_notes?.notes ?? []}
			<div class="mt-2">
				<div class="bento-list-header">
					<span class="text-xs font-semibold uppercase" style="color: var(--we-text-tertiary);">Notes ({notes.length})</span>
					<button class="add-btn" onclick={() => updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, notes: [...notes, ''] } })}>+ Add</button>
				</div>
				{#each notes as note, i (i)}
					<div class="flex items-center gap-2 mt-1">
						<input type="text" class="{INPUT_CLS} flex-1" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={note}
							oninput={(e) => {
								const updated = [...notes]; updated[i] = e.currentTarget.value;
								updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, notes: updated } });
							}} />
						<button class="shrink-0 p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600" style="border: none; background: none; cursor: pointer;" title={m.we_common_delete()}
							onclick={() => updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, notes: notes.filter((_: string, idx: number) => idx !== i) } })}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
						</button>
					</div>
				{/each}
			</div>
			{/if}
			<!-- Flags sub-list -->
			{#if true}
			{@const flags = world.director_notes?.flags ?? {}}
			{@const flagEntries = Object.entries(flags)}
			<div class="mt-3">
				<div class="bento-list-header">
					<span class="text-xs font-semibold uppercase" style="color: var(--we-text-tertiary);">Flags ({flagEntries.length})</span>
					<button class="add-btn" onclick={() => {
						const newKey = `flag_${Date.now()}`;
						updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, flags: { ...flags, [newKey]: { id: newKey, value: false } } } });
					}}>+ Add</button>
				</div>
				{#each flagEntries as [key, flag] (key)}
					<div class="flex items-center gap-2 mt-1">
						<span class="text-xs font-mono shrink-0 w-24 truncate" style="color: var(--we-text-tertiary);" title={key}>{key}</span>
						<input type="checkbox" checked={flag.value}
							onchange={(e) => {
								const updated = { ...flags, [key]: { ...flag, value: e.currentTarget.checked } };
								updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, flags: updated } });
							}} />
						<input type="text" class="{INPUT_CLS} flex-1 text-xs" style="border-color: var(--we-border); color: var(--we-text-primary);" placeholder="remark"
							value={flag.remark ?? ''}
							oninput={(e) => {
								const updated = { ...flags, [key]: { ...flag, remark: e.currentTarget.value || undefined } };
								updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, flags: updated } });
							}} />
						<button class="shrink-0 p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600" style="border: none; background: none; cursor: pointer;" title={m.we_common_delete()}
							onclick={() => {
								const updated = { ...flags }; delete updated[key];
								updateWorld({ director_notes: { ...world.director_notes ?? { notes: [], flags: {} }, flags: updated } });
							}}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
						</button>
					</div>
				{/each}
			</div>
			{/if}
		</div>

		<!-- Registry (mini-cards) -->
		<div class="bento-card" style="grid-area: registry;">
			<div class="bento-list-header">
				<h4 class="bento-title">{m.we_world_registry()} ({registry.length})</h4>
				<button class="add-btn" onclick={addRegistryField}>+ {m.we_common_add()}</button>
			</div>
			{#if registry.length === 0}
				<div class="bento-empty">{m.we_common_empty()}</div>
			{:else}
				<div class="mini-card-grid">
					{#each registry as field, i (i)}
						<button class="mini-card" onclick={() => (editModal = { section: 'registry', index: i })}>
							<span class="mini-card-title">{field.field_name || '(unnamed)'}</span>
							{#if field.hint}<span class="mini-card-desc">{field.hint}</span>{/if}
							{#if field.field_display_name}<span class="mini-card-meta">{field.field_display_name}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Custom Components (mini-cards) -->
		<div class="bento-card" style="grid-area: components;">
			<div class="bento-list-header">
				<h4 class="bento-title">{m.we_world_custom_components()} ({customComponents.length})</h4>
				<button class="add-btn" onclick={addComponent}>+ {m.we_common_add()}</button>
			</div>
			{#if customComponents.length === 0}
				<div class="bento-empty">{m.we_common_empty()}</div>
			{:else}
				<div class="mini-card-grid">
					{#each customComponents as comp, i (i)}
						<button class="mini-card" onclick={() => (editModal = { section: 'component', index: i })}>
							<span class="mini-card-title">{comp.component_name || '(unnamed)'}</span>
							<span class="mini-card-desc">{comp.component_key || '—'}</span>
							{#if comp.is_array}<span class="mini-card-meta">Array</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Documents (mini-cards) -->
		<div class="bento-card" style="grid-area: docs;">
			<div class="bento-list-header">
				<h4 class="bento-title">{m.we_world_documents()} ({documents.length})</h4>
				<button class="add-btn" onclick={addDoc}>+ {m.we_document_add()}</button>
			</div>
			{#if documents.length === 0}
				<div class="bento-empty">{m.we_common_empty()}</div>
			{:else}
				<div class="mini-card-grid">
					{#each documents as doc, i (i)}
						<button class="mini-card" onclick={() => (editModal = { section: 'document', index: i })}>
							<span class="mini-card-title">{doc.name || '(untitled)'}</span>
							<span class="mini-card-desc">{doc.content.slice(0, 60)}{doc.content.length > 60 ? '…' : ''}</span>
							{#if doc.static_priority}<span class="mini-card-meta">Priority: {doc.static_priority}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Log (inline) -->
		<div class="bento-card" style="grid-area: log;">
			<h4 class="bento-title">{m.we_world_log()} ({log.length})</h4>
			{#if log.length === 0}
				<div class="bento-empty">{m.we_common_empty()}</div>
			{:else}
				<div class="log-list">
					{#each log as entry, i (i)}
						<div class="log-item">
							<span class="log-time">{entry.timestamp}</span>
							<span class="log-content">{entry.content}</span>
							<button class="log-delete" title={m.we_common_delete()} onclick={() => deleteLogEntry(i)}>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex items-center gap-2 mt-3">
				<input type="text" class="flex-1 px-3 py-1.5 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					style="border-color: var(--we-border); color: var(--we-text-primary);"
					placeholder={m.we_log_content()} bind:value={logInput}
					onkeydown={(e) => { if (e.key === 'Enter') addLogEntry(); }} />
				<button class="add-btn" onclick={addLogEntry}>{m.we_log_add()}</button>
			</div>
		</div>

	</div><!-- /bento-grid -->
</div>

<!-- ========== Edit Modals ========== -->

{#if editModal}
	<!-- Registry Field Modal -->
	{#if editModal.section === 'registry'}
		{#if true}
		{@const field = registry[editModal.index]}
		{#if field}
		<EditModal title="{m.we_world_registry()} – {field.field_name || '(unnamed)'}" size="normal" onClose={() => (editModal = null)}>
			<FormGroup label="Field Name">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={field.field_name}
					oninput={(e) => {
						const updated = [...registry]; updated[editModal!.index] = { ...field, field_name: e.currentTarget.value };
						updateWorld({ registry: updated });
					}} />
			</FormGroup>
			<FormGroup label="Hint">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={field.hint}
					oninput={(e) => {
						const updated = [...registry]; updated[editModal!.index] = { ...field, hint: e.currentTarget.value };
						updateWorld({ registry: updated });
					}} />
			</FormGroup>
			<FormGroup label="Display Name">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={field.field_display_name ?? ''}
					oninput={(e) => {
						const updated = [...registry]; updated[editModal!.index] = { ...field, field_display_name: e.currentTarget.value || undefined };
						updateWorld({ registry: updated });
					}} />
			</FormGroup>
			{#snippet footer()}
				<button class="px-3 py-1.5 text-sm font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
					onclick={deleteFromModal}>
					{m.we_common_delete()}
				</button>
			{/snippet}
		</EditModal>
		{/if}
		{/if}
	{/if}

	<!-- Component Modal -->
	{#if editModal.section === 'component'}
		{#if true}
		{@const comp = customComponents[editModal.index]}
		{#if comp}
		<EditModal title="{m.we_world_custom_components()} – {comp.component_name || '(unnamed)'}" size="wide" onClose={() => (editModal = null)}>
			<FormGrid>
				<FormGroup label="Key">
					<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={comp.component_key} placeholder="e.g. skill_system"
						oninput={(e) => {
							const updated = [...customComponents]; updated[editModal!.index] = { ...comp, component_key: e.currentTarget.value };
							updateWorld({ custom_component_registry: updated });
						}} />
				</FormGroup>
				<FormGroup label={m.we_creature_name()}>
					<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={comp.component_name} placeholder="Display name"
						oninput={(e) => {
							const updated = [...customComponents]; updated[editModal!.index] = { ...comp, component_name: e.currentTarget.value };
							updateWorld({ custom_component_registry: updated });
						}} />
				</FormGroup>
			</FormGrid>
			<label class="inline-flex items-center gap-2 text-sm cursor-pointer mt-2" style="color: var(--we-text-secondary);">
				<input type="checkbox" checked={comp.is_array}
					onchange={(e) => {
						const updated = [...customComponents]; updated[editModal!.index] = { ...comp, is_array: e.currentTarget.checked };
						updateWorld({ custom_component_registry: updated });
					}} />
				Array (multiple instances per entity)
			</label>
			<div class="mt-3">
				<FormGroup label="Type Schema (JSON Schema)">
					<TypeSchemaEditor
						schema={comp.type_schema}
						onChange={(schema) => {
							const updated = [...customComponents]; updated[editModal!.index] = { ...comp, type_schema: schema };
							updateWorld({ custom_component_registry: updated });
						}}
					/>
				</FormGroup>
			</div>
			{#snippet footer()}
				<button class="px-3 py-1.5 text-sm font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
					onclick={deleteFromModal}>
					{m.we_common_delete()}
				</button>
			{/snippet}
		</EditModal>
		{/if}
		{/if}
	{/if}

	<!-- Document Modal -->
	{#if editModal.section === 'document'}
		{#if true}
		{@const doc = documents[editModal.index]}
		{#if doc}
		<EditModal title="{m.we_world_documents()} – {doc.name || '(untitled)'}" size="wide" onClose={() => (editModal = null)}>
			<FormGroup label={m.we_document_name()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.name}
					oninput={(e) => {
						const updated = [...documents]; updated[editModal!.index] = { ...doc, name: e.currentTarget.value };
						updateWorld({ bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_priority()}>
				<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.static_priority ?? 0}
					oninput={(e) => {
						const updated = [...documents]; updated[editModal!.index] = { ...doc, static_priority: Number(e.currentTarget.value) };
						updateWorld({ bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_content()}>
				<textarea class="{INPUT_CLS} min-h-[200px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.content}
					oninput={(e) => {
						const updated = [...documents]; updated[editModal!.index] = { ...doc, content: e.currentTarget.value };
						updateWorld({ bind_setting: { documents: updated } });
					}}></textarea>
			</FormGroup>
			{#snippet footer()}
				<button class="px-3 py-1.5 text-sm font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
					onclick={deleteFromModal}>
					{m.we_common_delete()}
				</button>
			{/snippet}
		</EditModal>
		{/if}
		{/if}
	{/if}
{/if}

<style>
	.bento-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-areas:
			"time       director    director"
			"registry   components  docs"
			"log        log         log";
		gap: 12px;
	}
	.bento-card {
		background: var(--we-bg-card);
		border: 1px solid var(--we-border);
		border-radius: 10px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		transition: box-shadow 0.15s ease;
	}
	.bento-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); }
	.bento-title {
		font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.04em; color: var(--we-text-tertiary); margin: 0 0 4px;
	}
	.bento-list-header { display: flex; align-items: center; justify-content: space-between; }
	.bento-empty {
		text-align: center; padding: 16px; font-size: 0.82rem;
		color: var(--we-text-tertiary); border: 2px dashed var(--we-border); border-radius: 8px;
	}
	.add-btn {
		font-size: 0.75rem; font-weight: 600; padding: 4px 12px; border-radius: 999px;
		background: color-mix(in srgb, var(--we-accent-ochre) 12%, transparent);
		color: var(--we-accent-ochre); border: none; cursor: pointer;
		transition: background 0.15s, transform 0.1s; white-space: nowrap;
	}
	.add-btn:hover { background: color-mix(in srgb, var(--we-accent-ochre) 22%, transparent); transform: translateY(-1px); }
	.mini-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
	.mini-card {
		display: flex; flex-direction: column; gap: 3px; padding: 10px 12px;
		border-radius: 8px; border: 1px solid var(--we-border); background: var(--we-bg-secondary);
		cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s; text-align: left;
	}
	.mini-card:hover {
		border-color: var(--we-accent-ochre);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--we-accent-ochre) 18%, transparent);
		transform: translateY(-2px);
	}
	.mini-card-title { font-size: 0.82rem; font-weight: 600; color: var(--we-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mini-card-desc { font-size: 0.75rem; color: var(--we-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mini-card-meta { font-size: 0.7rem; color: var(--we-text-tertiary); opacity: 0.8; }
	.log-list { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
	.log-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: 6px; background: var(--we-bg-secondary); }
	.log-time { font-size: 0.7rem; font-family: monospace; color: var(--we-text-tertiary); flex-shrink: 0; padding-top: 1px; }
	.log-content { font-size: 0.82rem; color: var(--we-text-primary); flex: 1; }
	.log-delete {
		flex-shrink: 0; padding: 2px; border-radius: 4px; color: var(--we-text-tertiary); opacity: 0.5;
		cursor: pointer; border: none; background: none; transition: opacity 0.15s, color 0.15s;
	}
	.log-delete:hover { opacity: 1; color: #ef4444; }
</style>
