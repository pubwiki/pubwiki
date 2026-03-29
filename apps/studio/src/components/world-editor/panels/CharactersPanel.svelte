<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { FormGroup, FormGrid, EditModal, EntityCardGrid } from '../shared';
	import {
		createDefaultCreatureSnapshot,
		type CreatureSnapshot, type InventoryItem, type InteractionOption,
		type StatusEffect, type SettingDocument, type LogEntry,
		type CustomComponentInstance
	} from '@pubwiki/world-editor';
	import { SchemaValueEditor } from '../shared';

	const ctx = getWorldEditorContext();

	let creatures = $derived(ctx.stateData.Creatures ?? []);
	let selectedId: string | null = $state(null);
	let selected = $derived(creatures.find((c) => c.creature_id === selectedId) ?? null);

	function creatureIndex(id: string) { return creatures.findIndex((c) => c.creature_id === id); }

	function updateCreature(id: string, patch: Partial<CreatureSnapshot>) {
		const idx = creatureIndex(id);
		if (idx < 0) return;
		const old = creatures[idx];
		const updated: CreatureSnapshot = { ...old, ...patch };
		const ops = ctx.translator.replaceCreature(old, updated, idx);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	function addCreature() {
		const snapshot = createDefaultCreatureSnapshot();
		snapshot.creature.name = 'New Character';
		const order = creatures.length;
		const triples = ctx.translator.translateCreateCreature(snapshot, order);
		ctx.applyOps(triples.map((t) => ({ op: 'insert' as const, ...t })));
		selectedId = snapshot.creature_id;
	}

	function deleteCreature(id: string) {
		const ops = ctx.translator.translateDeleteEntity('creature', id);
		ctx.applyOps(ops);
		if (selectedId === id) selectedId = null;
	}

	let cardItems = $derived(creatures.map((c) => ({ id: c.creature_id, name: c.creature.name || '(unnamed)' })));

	const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

	// ── Modal editing state ────────────────────────────────────────────────
	type ModalState =
		| { section: 'inventory'; index: number }
		| { section: 'status'; index: number }
		| { section: 'relationship'; index: number }
		| { section: 'document'; index: number }
		| { section: 'interaction'; index: number };;

	let editModal: ModalState | null = $state(null);
	let logInput = $state('');

	// Add new items (persists immediately, then opens modal to edit details)
	function addInv() {
		if (!selected) return;
		const newItem: InventoryItem = { id: crypto.randomUUID(), name: 'New Item', count: 1 };
		const inv = [...(selected.inventory ?? []), newItem];
		updateCreature(selected.creature_id, { inventory: inv });
		editModal = { section: 'inventory', index: inv.length - 1 };
	}

	function addStatus() {
		if (!selected) return;
		const newEff: StatusEffect = { instance_id: crypto.randomUUID() };
		const effects = [...(selected.status_effects ?? []), newEff];
		updateCreature(selected.creature_id, { status_effects: effects });
		editModal = { section: 'status', index: effects.length - 1 };
	}

	function addInteraction() {
		if (!selected) return;
		const newOpt: InteractionOption = { id: crypto.randomUUID(), title: '', instruction: '' };
		const opts = [...(selected.interaction?.options ?? []), newOpt];
		updateCreature(selected.creature_id, { interaction: { options: opts } });
		editModal = { section: 'interaction', index: opts.length - 1 };
	}

	function addDoc() {
		if (!selected) return;
		const newDoc: SettingDocument = { name: 'New Document', content: '' };
		const docs = [...(selected.bind_setting?.documents ?? []), newDoc];
		updateCreature(selected.creature_id, { bind_setting: { documents: docs } });
		editModal = { section: 'document', index: docs.length - 1 };
	}

	function deleteFromModal() {
		if (!editModal || !selected) return;
		const i = editModal.index;
		const id = selected.creature_id;
		if (editModal.section === 'inventory') {
			updateCreature(id, { inventory: (selected.inventory ?? []).filter((_: InventoryItem, idx: number) => idx !== i) });
		} else if (editModal.section === 'status') {
			updateCreature(id, { status_effects: (selected.status_effects ?? []).filter((_: StatusEffect, idx: number) => idx !== i) });
		} else if (editModal.section === 'interaction') {
			const opts = (selected.interaction?.options ?? []).filter((_: InteractionOption, idx: number) => idx !== i);
			updateCreature(id, { interaction: { options: opts } });
		} else if (editModal.section === 'document') {
			updateCreature(id, { bind_setting: { documents: (selected.bind_setting?.documents ?? []).filter((_: SettingDocument, idx: number) => idx !== i) } });
		}
		editModal = null;
	}

	function addLogEntry() {
		if (!selected || !logInput.trim()) return;
		const entry: LogEntry = { timestamp: new Date().toISOString(), content: logInput.trim() };
		updateCreature(selected.creature_id, { log: [...(selected.log ?? []), entry] });
		logInput = '';
	}

	function deleteLogEntry(i: number) {
		if (!selected) return;
		updateCreature(selected.creature_id, { log: (selected.log ?? []).filter((_: LogEntry, idx: number) => idx !== i) });
	}
</script>

{#snippet card(item: { id: string; name: string }, isSelected: boolean)}
	{@const creature = creatures.find((c) => c.creature_id === item.id)}
	<div class="p-3 flex flex-col gap-1.5">
		<div class="flex items-center gap-1.5 flex-wrap">
			<span class="text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full w-fit" style="background: color-mix(in srgb, var(--we-accent) 12%, transparent); color: var(--we-accent);">{m.we_tab_characters()}</span>
			{#if creature?.is_player}
				<span class="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Player</span>
			{/if}
		</div>
		<span class="font-serif font-bold text-sm truncate" style="color: var(--we-text-primary);">{item.name}</span>
		{#if creature?.creature.race || creature?.creature.gender || creature?.creature.emotion}
			<p class="text-xs truncate" style="color: var(--we-text-tertiary);">
				{[creature?.creature.race, creature?.creature.gender, creature?.creature.emotion].filter(Boolean).join(' · ')}
			</p>
		{/if}
	</div>
{/snippet}

<!-- Left-Right Layout -->
<div class="flex h-full overflow-hidden">
	<!-- Left: Card list -->
	<div class="w-72 shrink-0 flex flex-col border-r" style="border-color: var(--we-border);">
		<EntityCardGrid
			title={m.we_characters_title()}
			items={cardItems}
			{selectedId}
			{card}
			onSelect={(id) => (selectedId = id)}
			onAdd={addCreature}
			onDelete={deleteCreature}
			accentColor="var(--we-accent)"
			compact
		/>
	</div>

	<!-- Right: Detail pane (bento grid) -->
	<div class="flex-1 overflow-y-auto p-5" style="background: var(--we-bg-base);">
		{#if selected}
			<!-- Header -->
			<div class="flex items-center gap-3 mb-5">
				<div class="p-1.5 rounded-md" style="background: color-mix(in srgb, var(--we-accent) 12%, transparent);">
					<svg class="w-5 h-5" style="color: var(--we-accent);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
					</svg>
				</div>
				<h3 class="font-serif font-bold text-lg" style="color: var(--we-text-primary);">{selected.creature.name || '(unnamed)'}</h3>
				{#if selected.is_player}
					<span class="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Player</span>
				{/if}
			</div>

			<!-- Bento grid -->
			<div class="bento-grid">

				<!-- Basic Info -->
				<div class="bento-card" style="grid-area: basic;">
					<h4 class="bento-title">Basic Info</h4>
					<FormGrid>
						<FormGroup label={m.we_creature_name()}>
							<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
								value={selected.creature.name}
								oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, name: e.currentTarget.value } })} />
						</FormGroup>
						<FormGroup label={m.we_creature_gender()}>
							<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
								value={selected.creature.gender ?? ''}
								oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, gender: e.currentTarget.value } })} />
						</FormGroup>
						<FormGroup label={m.we_creature_race()}>
							<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
								value={selected.creature.race ?? ''}
								oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, race: e.currentTarget.value } })} />
						</FormGroup>
						<FormGroup label="Emotion">
							<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
								value={selected.creature.emotion ?? ''}
								oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, emotion: e.currentTarget.value || undefined } })} />
						</FormGroup>
					</FormGrid>
					<div class="mt-3 flex items-center gap-2">
						<input type="checkbox" id="is-player-check"
							checked={selected.is_player ?? false}
							onchange={(e) => updateCreature(selected!.creature_id, { is_player: e.currentTarget.checked })} />
						<label for="is-player-check" class="text-sm" style="color: var(--we-text-primary);">{m.we_creature_is_player()}</label>
					</div>
				</div>

				<!-- Appearance -->
				{#if true}
				{@const app = selected.creature.appearance ?? {}}
				<div class="bento-card" style="grid-area: appearance;">
					<h4 class="bento-title">{m.we_creature_appearance()}</h4>
					<FormGroup label={m.we_creature_appearance_body()}>
						<textarea class="{INPUT_CLS} min-h-[50px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={app.body ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, appearance: { ...app, body: e.currentTarget.value } } })}
						></textarea>
					</FormGroup>
					<FormGroup label={m.we_creature_appearance_clothing()}>
						<textarea class="{INPUT_CLS} min-h-[50px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={app.clothing ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, appearance: { ...app, clothing: e.currentTarget.value } } })}
						></textarea>
					</FormGroup>
					<FormGroup label={m.we_creature_appearance_features()}>
						<textarea class="{INPUT_CLS} min-h-[50px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={app.features ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, appearance: { ...app, features: e.currentTarget.value } } })}
						></textarea>
					</FormGroup>
				</div>
				{/if}

				<!-- Profile -->
				<div class="bento-card" style="grid-area: profile;">
					<h4 class="bento-title">{m.we_creature_profile()}</h4>
					<FormGroup label={m.we_creature_personality()}>
						<textarea class="{INPUT_CLS} min-h-[50px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.creature.personality ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, personality: e.currentTarget.value } })}
						></textarea>
					</FormGroup>
					<FormGroup label={m.we_creature_description()}>
						<textarea class="{INPUT_CLS} min-h-[50px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.creature.description ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, description: e.currentTarget.value } })}
						></textarea>
					</FormGroup>
					<FormGroup label="Goal">
						<textarea class="{INPUT_CLS} min-h-[40px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.creature.goal ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, goal: e.currentTarget.value || undefined } })}
						></textarea>
					</FormGroup>
					<!-- Known Infos -->
					{#if true}
					{@const infos = selected.creature.known_infos ?? []}
					<div class="mt-1">
						<div class="bento-list-header">
							<span class="text-xs font-semibold uppercase" style="color: var(--we-text-tertiary);">Known Infos ({infos.length})</span>
							<button class="add-btn" onclick={() => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, known_infos: [...infos, ''] } })}>+ {m.we_common_add()}</button>
						</div>
						{#each infos as info, i (i)}
							<div class="flex items-center gap-2 mt-1">
								<input type="text" class="{INPUT_CLS} flex-1" style="border-color: var(--we-border); color: var(--we-text-primary);"
									value={info}
									oninput={(e) => {
										const updated = [...infos]; updated[i] = e.currentTarget.value;
										updateCreature(selected!.creature_id, { creature: { ...selected!.creature, known_infos: updated } });
									}} />
								<button class="shrink-0 p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600" style="border: none; background: none; cursor: pointer;" title={m.we_common_delete()}
									onclick={() => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, known_infos: infos.filter((_: string, idx: number) => idx !== i) } })}>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
								</button>
							</div>
						{/each}
					</div>
					{/if}

					<FormGroup label="Organization">
						<select class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.creature.organization_id ?? ''}
							onchange={(e) => updateCreature(selected!.creature_id, { creature: { ...selected!.creature, organization_id: e.currentTarget.value || undefined } })}>
							<option value="">—</option>
							{#each ctx.stateData.Organizations ?? [] as org}
								<option value={org.organization_id}>{org.organization.name || org.organization_id}</option>
							{/each}
						</select>
					</FormGroup>
				</div>

				<!-- Location -->
				<div class="bento-card" style="grid-area: location;">
					<h4 class="bento-title">{m.we_creature_location()}</h4>
					<FormGroup label={m.we_creature_location_region()}>
						<select class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.location?.region_id ?? ''}
							onchange={(e) => updateCreature(selected!.creature_id, { location: { ...selected!.location, region_id: e.currentTarget.value } })}>
							<option value="">—</option>
							{#each ctx.stateData.Regions ?? [] as region}
								<option value={region.region_id}>{region.region.name || region.region_id}</option>
							{/each}
						</select>
					</FormGroup>
					<FormGroup label={m.we_creature_location_point()}>
						<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.location?.point ?? ''}
							oninput={(e) => updateCreature(selected!.creature_id, { location: { ...selected!.location, point: e.currentTarget.value } })} />
					</FormGroup>
				</div>

				<!-- Inventory -->
				{#if true}
				{@const inv = selected.inventory ?? []}
				<div class="bento-card" style="grid-area: inventory;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_creature_inventory()} ({inv.length})</h4>
						<button class="add-btn" onclick={addInv}>+ {m.we_common_add()}</button>
					</div>
					{#if inv.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each inv as item, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'inventory', index: i })}>
									<span class="mini-card-title">{item.name || '(unnamed)'}</span>
									<span class="mini-card-meta">x{item.count}{item.equipped ? ' · Equipped' : ''}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Status Effects -->
				{#if true}
				{@const effects = selected.status_effects ?? []}
				<div class="bento-card" style="grid-area: statuses;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_creature_status_effects()} ({effects.length})</h4>
						<button class="add-btn" onclick={addStatus}>+ {m.we_status_effect_add()}</button>
					</div>
					{#if effects.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each effects as eff, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'status', index: i })}>
									<span class="mini-card-title">{eff.display_name || eff.instance_id.slice(0, 8)}</span>
									{#if eff.remark}<span class="mini-card-desc">{eff.remark}</span>{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Documents -->
				{#if true}
				{@const docs = selected.bind_setting?.documents ?? []}
				<div class="bento-card" style="grid-area: docs;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_creature_documents()} ({docs.length})</h4>
						<button class="add-btn" onclick={addDoc}>+ {m.we_document_add()}</button>
					</div>
					{#if docs.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each docs as doc, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'document', index: i })}>
						<span class="mini-card-title">{doc.name || '(untitled)'}{#if doc.disable} <span class="text-xs opacity-50">({m.we_document_disabled()})</span>{/if}</span>
						<span class="mini-card-desc">{doc.content.slice(0, 60)}{doc.content.length > 60 ? '…' : ''}</span>
						{#if doc.static_priority}<span class="mini-card-meta">Priority: {doc.static_priority}</span>{/if}
						{#if doc.condition}<span class="mini-card-meta">{m.we_document_condition()}: {doc.condition.slice(0, 40)}{doc.condition.length > 40 ? '…' : ''}</span>{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Interactions -->
				{#if true}
				{@const opts = selected.interaction?.options ?? []}
				<div class="bento-card" style="grid-area: interactions;">
					<div class="bento-list-header">
						<h4 class="bento-title">Interactions ({opts.length})</h4>
						<button class="add-btn" onclick={addInteraction}>+ {m.we_common_add()}</button>
					</div>
					{#if opts.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each opts as opt, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'interaction', index: i })}>
									<span class="mini-card-title">{opt.title || '(unnamed)'}</span>
									<span class="mini-card-meta">{opt.instruction?.substring(0, 40) || ''}{opt.instruction?.length > 40 ? '...' : ''}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Custom Components -->
				{#if true}
				{@const registry = ctx.stateData.World?.custom_component_registry ?? []}
				{#if registry.length > 0}
				<div class="bento-card" style="grid-area: custom;">
					<h4 class="bento-title">Custom Components</h4>
					{#each registry as def (def.component_key)}
						{@const instances = selected.custom_components ?? []}
						{@const instance = instances.find((c: CustomComponentInstance) => c.component_key === def.component_key)}
						<div class="custom-comp-section">
							<div class="flex items-center justify-between mb-1">
								<span class="text-xs font-semibold" style="color: var(--we-text-secondary);">{def.component_name || def.component_key}</span>
								{#if !instance}
									<button class="add-btn" onclick={() => {
										const newInst: CustomComponentInstance = { component_key: def.component_key, data: def.is_array ? [] : (def.type_schema?.type === 'object' ? {} : undefined) };
										updateCreature(selected!.creature_id, { custom_components: [...instances, newInst] });
									}}>+ Add</button>
								{:else}
									<button class="shrink-0 p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600" style="border: none; background: none; cursor: pointer;" title="Remove"
										onclick={() => {
											updateCreature(selected!.creature_id, { custom_components: instances.filter((c: CustomComponentInstance) => c.component_key !== def.component_key) });
										}}>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
									</button>
								{/if}
							</div>
							{#if instance}
								<SchemaValueEditor
									schema={def.type_schema}
									value={instance.data}
									onChange={(newVal) => {
										const updated = instances.map((c: CustomComponentInstance) =>
											c.component_key === def.component_key ? { ...c, data: newVal } : c
										);
										updateCreature(selected!.creature_id, { custom_components: updated });
									}}
								/>
							{/if}
						</div>
					{/each}
				</div>
				{/if}
				{/if}

				<!-- Log -->
				{#if true}
				{@const entries = selected.log ?? []}
				<div class="bento-card" style="grid-area: log;">
					<h4 class="bento-title">{m.we_creature_log()} ({entries.length})</h4>
					{#if entries.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="log-list">
							{#each entries as entry, i (i)}
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
				{/if}

			</div><!-- /bento-grid -->

		{:else}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center h-full text-center px-8">
				<svg class="w-16 h-16 mb-4 opacity-20" style="color: var(--we-text-tertiary);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
					<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
				</svg>
				<p class="text-sm" style="color: var(--we-text-tertiary);">Select a character to edit</p>
			</div>
		{/if}
	</div>
</div>

<!-- ========== Edit Modals ========== -->

{#if editModal && selected}
	<!-- Inventory Modal -->
	{#if editModal.section === 'inventory'}
		{#if true}
		{@const inv = selected.inventory ?? []}
		{@const item = inv[editModal.index]}
		{#if item}
		<EditModal title="{m.we_creature_inventory()} – {item.name || '(unnamed)'}" size="normal" onClose={() => (editModal = null)}>
			<FormGroup label={m.we_creature_inventory_item_name()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={item.name}
					oninput={(e) => {
						const updated = [...inv]; updated[editModal!.index] = { ...item, name: e.currentTarget.value };
						updateCreature(selected!.creature_id, { inventory: updated });
					}} />
			</FormGroup>
			<FormGroup label={m.we_creature_inventory_count()}>
				<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={item.count}
					oninput={(e) => {
						const updated = [...inv]; updated[editModal!.index] = { ...item, count: Number(e.currentTarget.value) };
						updateCreature(selected!.creature_id, { inventory: updated });
					}} />
			</FormGroup>
			<FormGroup label="Description">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={item.description ?? ''}
					oninput={(e) => {
						const updated = [...inv]; updated[editModal!.index] = { ...item, description: e.currentTarget.value || undefined };
						updateCreature(selected!.creature_id, { inventory: updated });
					}}></textarea>
			</FormGroup>
			<div class="flex items-center gap-2 mt-2">
				<input type="checkbox" checked={item.equipped ?? false}
					onchange={(e) => {
						const updated = [...inv]; updated[editModal!.index] = { ...item, equipped: e.currentTarget.checked };
						updateCreature(selected!.creature_id, { inventory: updated });
					}} />
				<span class="text-sm" style="color: var(--we-text-primary);">{m.we_creature_inventory_equipped()}</span>
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

	<!-- Status Effect Modal -->
	{#if editModal.section === 'status'}
		{#if true}
		{@const effects = selected.status_effects ?? []}
		{@const eff = effects[editModal.index]}
		{#if eff}
		<EditModal title="Status Effect – {eff.display_name || eff.instance_id.slice(0, 8)}" size="normal" onClose={() => (editModal = null)}>
			<FormGroup label="Instance ID">
				<input type="text" class="{INPUT_CLS} font-mono text-xs" style="border-color: var(--we-border); color: var(--we-text-tertiary);"
					value={eff.instance_id} readonly />
			</FormGroup>
			<FormGroup label="Display Name">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={eff.display_name ?? ''}
					oninput={(e) => {
						const updated = [...effects]; updated[editModal!.index] = { ...eff, display_name: e.currentTarget.value || undefined };
						updateCreature(selected!.creature_id, { status_effects: updated });
					}} />
			</FormGroup>
			<FormGroup label="Remark">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={eff.remark ?? ''}
					oninput={(e) => {
						const updated = [...effects]; updated[editModal!.index] = { ...eff, remark: e.currentTarget.value || undefined };
						updateCreature(selected!.creature_id, { status_effects: updated });
					}}></textarea>
			</FormGroup>
			<FormGroup label="Data">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y font-mono text-xs" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={eff.data != null ? JSON.stringify(eff.data, null, 2) : ''}
					placeholder="Free-form JSON data"
					onblur={(e) => {
						const raw = e.currentTarget.value.trim();
						const updated = [...effects];
						if (!raw) {
							updated[editModal!.index] = { ...eff, data: undefined };
						} else {
							try { updated[editModal!.index] = { ...eff, data: JSON.parse(raw) }; }
							catch { updated[editModal!.index] = { ...eff, data: raw }; }
						}
						updateCreature(selected!.creature_id, { status_effects: updated });
					}}></textarea>
			</FormGroup>
			<FormGrid>
				<FormGroup label="Added At">
					<input type="text" class="{INPUT_CLS} text-xs" style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={eff.add_at ?? ''}
						placeholder="e.g. 2024-01-01"
						oninput={(e) => {
							const updated = [...effects]; updated[editModal!.index] = { ...eff, add_at: e.currentTarget.value || undefined };
							updateCreature(selected!.creature_id, { status_effects: updated });
						}} />
				</FormGroup>
				<FormGroup label="Last Updated At">
					<input type="text" class="{INPUT_CLS} text-xs" style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={eff.last_update_at ?? ''}
						placeholder="e.g. 2024-01-15"
						oninput={(e) => {
							const updated = [...effects]; updated[editModal!.index] = { ...eff, last_update_at: e.currentTarget.value || undefined };
							updateCreature(selected!.creature_id, { status_effects: updated });
						}} />
				</FormGroup>
			</FormGrid>
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

	<!-- Interaction Modal -->
	{#if editModal.section === 'interaction'}
		{#if true}
		{@const opts = selected.interaction?.options ?? []}
		{@const opt = opts[editModal.index]}
		{#if opt}
		<EditModal title="Interaction – {opt.title || '(unnamed)'}" size="normal" onClose={() => (editModal = null)}>
			<FormGroup label="Title">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.title}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, title: e.currentTarget.value };
						updateCreature(selected!.creature_id, { interaction: { options: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Usage">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.usage ?? ''}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, usage: e.currentTarget.value || undefined };
						updateCreature(selected!.creature_id, { interaction: { options: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Instruction">
				<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.instruction}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, instruction: e.currentTarget.value };
						updateCreature(selected!.creature_id, { interaction: { options: updated } });
					}}></textarea>
			</FormGroup>
			<FormGroup label="Memo">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.memo ?? ''}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, memo: e.currentTarget.value || undefined };
						updateCreature(selected!.creature_id, { interaction: { options: updated } });
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

	<!-- Document Modal -->
	{#if editModal.section === 'document'}
		{#if true}
		{@const docs = selected.bind_setting?.documents ?? []}
		{@const doc = docs[editModal.index]}
		{#if doc}
		<EditModal title="{m.we_creature_documents()} – {doc.name || '(untitled)'}" size="wide" onClose={() => (editModal = null)}>
			<FormGroup label={m.we_document_name()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.name}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, name: e.currentTarget.value };
						updateCreature(selected!.creature_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_priority()}>
				<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.static_priority ?? 0}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, static_priority: Number(e.currentTarget.value) };
						updateCreature(selected!.creature_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_condition()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.condition ?? ''}
					placeholder="e.g. When the player enters the forest"
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, condition: e.currentTarget.value || undefined };
						updateCreature(selected!.creature_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<div class="flex items-center gap-2">
				<input type="checkbox" checked={doc.disable ?? false}
					onchange={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, disable: e.currentTarget.checked || undefined };
						updateCreature(selected!.creature_id, { bind_setting: { documents: updated } });
					}} />
				<span class="text-sm" style="color: var(--we-text-primary);">{m.we_document_disabled()}</span>
			</div>
			<FormGroup label={m.we_document_content()}>
				<textarea class="{INPUT_CLS} min-h-[200px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.content}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, content: e.currentTarget.value };
						updateCreature(selected!.creature_id, { bind_setting: { documents: updated } });
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
			"basic      appearance  profile"
			"location   statuses    docs"
			"inventory  interactions interactions"
			"custom     custom      custom"
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

	.bento-card:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.bento-title {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--we-text-tertiary);
		margin: 0 0 4px;
	}

	.bento-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.bento-empty {
		text-align: center;
		padding: 16px;
		font-size: 0.82rem;
		color: var(--we-text-tertiary);
		border: 2px dashed var(--we-border);
		border-radius: 8px;
	}

	.add-btn {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 4px 12px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--we-accent) 12%, transparent);
		color: var(--we-accent);
		border: none;
		cursor: pointer;
		transition: background 0.15s, transform 0.1s;
		white-space: nowrap;
	}

	.add-btn:hover {
		background: color-mix(in srgb, var(--we-accent) 22%, transparent);
		transform: translateY(-1px);
	}

	.mini-card-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px;
	}

	.mini-card {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 12px;
		border-radius: 8px;
		border: 1px solid var(--we-border);
		background: var(--we-bg-secondary);
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
		text-align: left;
	}

	.mini-card:hover {
		border-color: var(--we-accent);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--we-accent) 18%, transparent);
		transform: translateY(-2px);
	}

	.mini-card-title {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--we-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mini-card-desc {
		font-size: 0.75rem;
		color: var(--we-text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mini-card-meta {
		font-size: 0.7rem;
		color: var(--we-text-tertiary);
		opacity: 0.8;
	}

	.log-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 300px;
		overflow-y: auto;
	}

	.log-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		background: var(--we-bg-secondary);
	}

	.log-time {
		font-size: 0.7rem;
		font-family: monospace;
		color: var(--we-text-tertiary);
		flex-shrink: 0;
		padding-top: 1px;
	}

	.log-content {
		font-size: 0.82rem;
		color: var(--we-text-primary);
		flex: 1;
	}

	.log-delete {
		flex-shrink: 0;
		padding: 2px;
		border-radius: 4px;
		color: var(--we-text-tertiary);
		opacity: 0.5;
		cursor: pointer;
		border: none;
		background: none;
		transition: opacity 0.15s, color 0.15s;
	}

	.log-delete:hover {
		opacity: 1;
		color: #ef4444;
	}

	.custom-comp-section {
		padding: 10px;
		border: 1px solid var(--we-border);
		border-radius: 8px;
		background: var(--we-bg-secondary);
	}

	.custom-comp-section + .custom-comp-section {
		margin-top: 8px;
	}
</style>
