<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { EntityCardGrid, EditModal, FormGroup, FormGrid } from '../shared';
	import {
		createDefaultRegionSnapshot,
		type RegionSnapshot, type RegionPath, type Location, type Metadata, type StatusEffect, type SettingDocument, type LogEntry, type InteractionOption
	} from '@pubwiki/world-editor';

	const ctx = getWorldEditorContext();

	let regions = $derived(ctx.stateData.Regions ?? []);
	let selectedId: string | null = $state(null);
	let selected = $derived(regions.find((r) => r.region_id === selectedId) ?? null);

	function regionIndex(id: string) { return regions.findIndex((r) => r.region_id === id); }

	function updateRegion(id: string, patch: Partial<RegionSnapshot>) {
		const idx = regionIndex(id);
		if (idx < 0) return;
		const old = regions[idx];
		const updated: RegionSnapshot = { ...old, ...patch };
		const ops = ctx.translator.replaceRegion(old, updated, idx);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	function addRegion() {
		const snapshot = createDefaultRegionSnapshot();
		snapshot.region.name = 'New Region';
		const order = regions.length;
		const triples = ctx.translator.translateCreateRegion(snapshot, order);
		ctx.applyOps(triples.map((t) => ({ op: 'insert' as const, ...t })));
		selectedId = snapshot.region_id;
	}

	function deleteRegion(id: string) {
		const ops = ctx.translator.translateDeleteEntity('region', id);
		ctx.applyOps(ops);
		if (selectedId === id) selectedId = null;
	}

	let cardItems = $derived(regions.map((r) => ({ id: r.region_id, name: r.region.name || '(unnamed)' })));

	const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

	// ── Modal editing state ────────────────────────────────────────────────
	type ModalState =
		| { section: 'location'; index: number }
		| { section: 'path'; index: number }
		| { section: 'status'; index: number }
		| { section: 'document'; index: number }
		| { section: 'interaction'; index: number };

	let editModal: ModalState | null = $state(null);
	let logInput = $state('');

	function addLocation() {
		if (!selected) return;
		const locs = [...(selected.region.locations ?? []), { id: crypto.randomUUID(), name: 'New Location', description: '' }];
		updateRegion(selected.region_id, { region: { ...selected.region, locations: locs } });
		editModal = { section: 'location', index: locs.length - 1 };
	}

	function addPath() {
		if (!selected) return;
		const paths = [...(selected.region.paths ?? []), { src_location: '', src_region: '', discovered: false, to_region: '', to_location: '', description: '' }];
		updateRegion(selected.region_id, { region: { ...selected.region, paths: paths } });
		editModal = { section: 'path', index: paths.length - 1 };
	}

	function addStatus() {
		if (!selected) return;
		const effects = [...(selected.status_effects ?? []), { instance_id: crypto.randomUUID() }];
		updateRegion(selected.region_id, { status_effects: effects });
		editModal = { section: 'status', index: effects.length - 1 };
	}

	function addDoc() {
		if (!selected) return;
		const docs = [...(selected.bind_setting?.documents ?? []), { name: 'New Document', content: '' }];
		updateRegion(selected.region_id, { bind_setting: { documents: docs } });
		editModal = { section: 'document', index: docs.length - 1 };
	}

	function addInteraction() {
		if (!selected) return;
		const opts = [...(selected.interaction?.options ?? []), { id: crypto.randomUUID(), title: '', instruction: '' }];
		updateRegion(selected.region_id, { interaction: { options: opts } });
		editModal = { section: 'interaction', index: opts.length - 1 };
	}

	function deleteFromModal() {
		if (!editModal || !selected) return;
		const i = editModal.index;
		const id = selected.region_id;
		if (editModal.section === 'location') {
			updateRegion(id, { region: { ...selected.region, locations: (selected.region.locations ?? []).filter((_: Location, idx: number) => idx !== i) } });
		} else if (editModal.section === 'path') {
			updateRegion(id, { region: { ...selected.region, paths: (selected.region.paths ?? []).filter((_: RegionPath, idx: number) => idx !== i) } });
		} else if (editModal.section === 'status') {
			updateRegion(id, { status_effects: (selected.status_effects ?? []).filter((_: StatusEffect, idx: number) => idx !== i) });
		} else if (editModal.section === 'document') {
			updateRegion(id, { bind_setting: { documents: (selected.bind_setting?.documents ?? []).filter((_: SettingDocument, idx: number) => idx !== i) } });
		} else if (editModal.section === 'interaction') {
			const opts = (selected.interaction?.options ?? []).filter((_: InteractionOption, idx: number) => idx !== i);
			updateRegion(id, { interaction: { options: opts } });
		}
		editModal = null;
	}

	function addLogEntry() {
		if (!selected || !logInput.trim()) return;
		const entry: LogEntry = { timestamp: new Date().toISOString(), content: logInput.trim() };
		updateRegion(selected.region_id, { log: [...(selected.log ?? []), entry] });
		logInput = '';
	}

	function deleteLogEntry(i: number) {
		if (!selected) return;
		updateRegion(selected.region_id, { log: (selected.log ?? []).filter((_: LogEntry, idx: number) => idx !== i) });
	}
</script>

{#snippet card(item: { id: string; name: string }, _selected: boolean)}
	{@const region = regions.find((r) => r.region_id === item.id)}
	<div class="p-3 flex flex-col gap-1.5">
		<span class="text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full w-fit" style="background: color-mix(in srgb, var(--we-accent-olive) 12%, transparent); color: var(--we-accent-olive);">{m.we_tab_regions()}</span>
		<span class="font-serif font-bold text-sm truncate" style="color: var(--we-text-primary);">{item.name}</span>
		{#if region?.region.description}
			<p class="text-xs line-clamp-2" style="color: var(--we-text-tertiary);">{region.region.description}</p>
		{/if}
		<div class="flex items-center gap-2 mt-0.5">
			{#if (region?.region.locations ?? []).length > 0}
				<span class="text-[10px] font-medium" style="color: var(--we-text-tertiary);">{(region?.region.locations ?? []).length} locations</span>
			{/if}
			{#if (region?.region.paths ?? []).length > 0}
				<span class="text-[10px] font-medium" style="color: var(--we-text-tertiary);">{(region?.region.paths ?? []).length} paths</span>
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex h-full overflow-hidden">
	<div class="w-72 shrink-0 flex flex-col border-r" style="border-color: var(--we-border);">
		<EntityCardGrid
			title={m.we_regions_title()}
			items={cardItems}
			{selectedId}
			{card}
			onSelect={(id) => (selectedId = id)}
			onAdd={addRegion}
			onDelete={deleteRegion}
			accentColor="var(--we-accent-olive)"
			compact
		/>
	</div>

	{#if selected}
		<div class="flex-1 overflow-y-auto p-5" style="background: var(--we-bg-base);">
			<!-- Header -->
			<div class="flex items-center gap-3 mb-4">
				<div class="p-1.5 rounded-md" style="background: color-mix(in srgb, var(--we-accent-olive) 12%, transparent);">
					<svg class="w-4 h-4" style="color: var(--we-accent-olive);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>
					</svg>
				</div>
				<h3 class="font-serif font-bold text-base" style="color: var(--we-text-primary);">{selected.region.name || '(unnamed)'}</h3>
			</div>

			<!-- Bento grid -->
			<div class="bento-grid">

				<!-- Profile (inline) -->
				<div class="bento-card" style="grid-area: profile;">
					<h4 class="bento-title">{m.we_region_name()}</h4>
					<FormGroup label={m.we_region_name()}>
						<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.region.name}
							oninput={(e) => updateRegion(selected!.region_id, { region: { ...selected!.region, name: e.currentTarget.value } })} />
					</FormGroup>
					<FormGroup label={m.we_region_description()}>
						<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.region.description ?? ''}
							oninput={(e) => updateRegion(selected!.region_id, { region: { ...selected!.region, description: e.currentTarget.value } })}
						></textarea>
					</FormGroup>
				</div>

				<!-- Locations (mini-cards) -->
				{#if true}
				{@const locations = selected.region.locations ?? []}
				<div class="bento-card" style="grid-area: locations;">
					<div class="bento-list-header">
						<h4 class="bento-title">Locations ({locations.length})</h4>
						<button class="add-btn" onclick={addLocation}>+ {m.we_common_add()}</button>
					</div>
					{#if locations.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each locations as loc, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'location', index: i })}>
									<span class="mini-card-title">{loc.name || '(unnamed)'}</span>
									{#if loc.description}<span class="mini-card-desc">{loc.description}</span>{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Paths (mini-cards) -->
				{#if true}
				{@const paths = selected.region.paths ?? []}
				<div class="bento-card" style="grid-area: paths;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_region_paths()} ({paths.length})</h4>
						<button class="add-btn" onclick={addPath}>+ {m.we_common_add()}</button>
					</div>
					{#if paths.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each paths as path, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'path', index: i })}>
									<span class="mini-card-title">{path.src_region || '?'} → {path.to_region || '?'}</span>
									{#if path.description}<span class="mini-card-desc">{path.description}</span>{/if}
									<span class="mini-card-meta">{path.discovered ? 'Discovered' : 'Hidden'}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Metadata (inline) -->
				<div class="bento-card" style="grid-area: metadata;">
					<h4 class="bento-title">{m.we_region_metadata()}</h4>
					<FormGroup label="Name">
						<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.metadata?.name ?? ''}
							oninput={(e) => updateRegion(selected!.region_id, { metadata: { ...selected!.metadata ?? { name: '', desc: '' }, name: e.currentTarget.value } })} />
					</FormGroup>
					<FormGroup label="Description">
						<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.metadata?.desc ?? ''}
							oninput={(e) => updateRegion(selected!.region_id, { metadata: { ...selected!.metadata ?? { name: '', desc: '' }, desc: e.currentTarget.value } })}
						></textarea>
					</FormGroup>
				</div>

				<!-- Status Effects (mini-cards) -->
				{#if true}
				{@const effects = selected.status_effects ?? []}
				<div class="bento-card" style="grid-area: statuses;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_region_status_effects()} ({effects.length})</h4>
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

				<!-- Documents (mini-cards) -->
				{#if true}
				{@const docs = selected.bind_setting?.documents ?? []}
				<div class="bento-card" style="grid-area: docs;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_region_documents()} ({docs.length})</h4>
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

				<!-- Interactions (mini-cards) -->
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
									<span class="mini-card-desc">{opt.instruction?.slice(0, 50) || ''}{(opt.instruction?.length ?? 0) > 50 ? '…' : ''}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Log (inline) -->
				{#if true}
				{@const entries = selected.log ?? []}
				<div class="bento-card" style="grid-area: log;">
					<h4 class="bento-title">{m.we_region_log()} ({entries.length})</h4>
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
		</div>
	{:else}
		<div class="flex-1 flex items-center justify-center" style="background: var(--we-bg-base); color: var(--we-text-tertiary);">
			<p class="text-sm">{m.we_common_empty()}</p>
		</div>
	{/if}
</div>

<!-- ========== Edit Modals ========== -->

{#if editModal && selected}
	<!-- Location Modal -->
	{#if editModal.section === 'location'}
		{#if true}
		{@const locations = selected.region.locations ?? []}
		{@const loc = locations[editModal.index]}
		{#if loc}
		<EditModal title="Location – {loc.name || '(unnamed)'}" size="normal" onClose={() => (editModal = null)}>
			<FormGroup label="ID">
				<input type="text" class="{INPUT_CLS} font-mono text-xs" style="border-color: var(--we-border); color: var(--we-text-tertiary);"
					value={loc.id} readonly />
			</FormGroup>
			<FormGroup label="Name">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={loc.name}
					oninput={(e) => {
						const updated = [...locations]; updated[editModal!.index] = { ...loc, name: e.currentTarget.value };
						updateRegion(selected!.region_id, { region: { ...selected!.region, locations: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Description">
				<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={loc.description}
					oninput={(e) => {
						const updated = [...locations]; updated[editModal!.index] = { ...loc, description: e.currentTarget.value };
						updateRegion(selected!.region_id, { region: { ...selected!.region, locations: updated } });
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

	<!-- Path Modal -->
	{#if editModal.section === 'path'}
		{#if true}
		{@const paths = selected.region.paths ?? []}
		{@const path = paths[editModal.index]}
		{#if path}
		<EditModal title="{m.we_region_paths()} – {path.src_region || '?'} → {path.to_region || '?'}" size="wide" onClose={() => (editModal = null)}>
			<FormGrid cols={2}>
				<FormGroup label="Source Region">
					<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={path.src_region}
						oninput={(e) => {
							const updated = [...paths]; updated[editModal!.index] = { ...path, src_region: e.currentTarget.value };
							updateRegion(selected!.region_id, { region: { ...selected!.region, paths: updated } });
						}} />
				</FormGroup>
				<FormGroup label="Source Location">
					<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={path.src_location}
						oninput={(e) => {
							const updated = [...paths]; updated[editModal!.index] = { ...path, src_location: e.currentTarget.value };
							updateRegion(selected!.region_id, { region: { ...selected!.region, paths: updated } });
						}} />
				</FormGroup>
				<FormGroup label="To Region">
					<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={path.to_region}
						oninput={(e) => {
							const updated = [...paths]; updated[editModal!.index] = { ...path, to_region: e.currentTarget.value };
							updateRegion(selected!.region_id, { region: { ...selected!.region, paths: updated } });
						}} />
				</FormGroup>
				<FormGroup label="To Location">
					<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
						value={path.to_location}
						oninput={(e) => {
							const updated = [...paths]; updated[editModal!.index] = { ...path, to_location: e.currentTarget.value };
							updateRegion(selected!.region_id, { region: { ...selected!.region, paths: updated } });
						}} />
				</FormGroup>
			</FormGrid>
			<FormGroup label="Description">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={path.description}
					oninput={(e) => {
						const updated = [...paths]; updated[editModal!.index] = { ...path, description: e.currentTarget.value };
						updateRegion(selected!.region_id, { region: { ...selected!.region, paths: updated } });
					}}></textarea>
			</FormGroup>
			<div class="flex items-center gap-2 mt-2">
				<input type="checkbox" checked={path.discovered}
					onchange={(e) => {
						const updated = [...paths]; updated[editModal!.index] = { ...path, discovered: e.currentTarget.checked };
						updateRegion(selected!.region_id, { region: { ...selected!.region, paths: updated } });
					}} />
				<span class="text-sm" style="color: var(--we-text-primary);">Discovered</span>
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
						updateRegion(selected!.region_id, { status_effects: updated });
					}} />
			</FormGroup>
			<FormGroup label="Remark">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={eff.remark ?? ''}
					oninput={(e) => {
						const updated = [...effects]; updated[editModal!.index] = { ...eff, remark: e.currentTarget.value || undefined };
						updateRegion(selected!.region_id, { status_effects: updated });
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
						updateRegion(selected!.region_id, { interaction: { options: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Usage">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.usage ?? ''}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, usage: e.currentTarget.value || undefined };
						updateRegion(selected!.region_id, { interaction: { options: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Instruction">
				<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.instruction}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, instruction: e.currentTarget.value };
						updateRegion(selected!.region_id, { interaction: { options: updated } });
					}}></textarea>
			</FormGroup>
			<FormGroup label="Memo">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.memo ?? ''}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, memo: e.currentTarget.value || undefined };
						updateRegion(selected!.region_id, { interaction: { options: updated } });
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
		<EditModal title="{m.we_region_documents()} – {doc.name || '(untitled)'}" size="wide" onClose={() => (editModal = null)}>
			<FormGroup label={m.we_document_name()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.name}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, name: e.currentTarget.value };
						updateRegion(selected!.region_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_priority()}>
				<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.static_priority ?? 0}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, static_priority: Number(e.currentTarget.value) };
						updateRegion(selected!.region_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_condition()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.condition ?? ''}
					placeholder="e.g. When the player enters the forest"
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, condition: e.currentTarget.value || undefined };
						updateRegion(selected!.region_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<div class="flex items-center gap-2">
				<input type="checkbox" checked={doc.disable ?? false}
					onchange={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, disable: e.currentTarget.checked || undefined };
						updateRegion(selected!.region_id, { bind_setting: { documents: updated } });
					}} />
				<span class="text-sm" style="color: var(--we-text-primary);">{m.we_document_disabled()}</span>
			</div>
			<FormGroup label={m.we_document_content()}>
				<textarea class="{INPUT_CLS} min-h-[200px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.content}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, content: e.currentTarget.value };
						updateRegion(selected!.region_id, { bind_setting: { documents: updated } });
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
			"profile    locations    paths"
			"metadata   statuses     docs"
			"interactions interactions interactions"
			"log        log          log";
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
		background: color-mix(in srgb, var(--we-accent-olive) 12%, transparent);
		color: var(--we-accent-olive); border: none; cursor: pointer;
		transition: background 0.15s, transform 0.1s; white-space: nowrap;
	}
	.add-btn:hover { background: color-mix(in srgb, var(--we-accent-olive) 22%, transparent); transform: translateY(-1px); }
	.mini-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
	.mini-card {
		display: flex; flex-direction: column; gap: 3px; padding: 10px 12px;
		border-radius: 8px; border: 1px solid var(--we-border); background: var(--we-bg-secondary);
		cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s; text-align: left;
	}
	.mini-card:hover {
		border-color: var(--we-accent-olive);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--we-accent-olive) 18%, transparent);
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
