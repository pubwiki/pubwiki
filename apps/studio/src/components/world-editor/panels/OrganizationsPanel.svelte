<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { EntityCardGrid, EditModal, FormGroup, FormGrid } from '../shared';
	import {
		createDefaultOrganizationSnapshot,
		type OrganizationSnapshot, type StatusEffect, type Territory, type SettingDocument, type LogEntry, type InteractionOption
	} from '@pubwiki/world-editor';

	const ctx = getWorldEditorContext();

	let orgs = $derived(ctx.stateData.Organizations ?? []);
	let selectedId: string | null = $state(null);
	let selected = $derived(orgs.find((o) => o.organization_id === selectedId) ?? null);

	type ModalState = { section: 'territory'; index: number }
		| { section: 'status'; index: number }
		| { section: 'document'; index: number }
		| { section: 'interaction'; index: number };
	let editModal: ModalState | null = $state(null);
	let logInput = $state('');

	function orgIndex(id: string) { return orgs.findIndex((o) => o.organization_id === id); }

	function updateOrg(id: string, patch: Partial<OrganizationSnapshot>) {
		const idx = orgIndex(id);
		if (idx < 0) return;
		const old = orgs[idx];
		const updated: OrganizationSnapshot = { ...old, ...patch };
		const ops = ctx.translator.replaceOrganization(old, updated, idx);
		if (ops.length > 0) ctx.applyOps(ops);
	}

	function addOrg() {
		const snapshot = createDefaultOrganizationSnapshot();
		snapshot.organization.name = 'New Organization';
		const order = orgs.length;
		const triples = ctx.translator.translateCreateOrganization(snapshot, order);
		ctx.applyOps(triples.map((t) => ({ op: 'insert' as const, ...t })));
		selectedId = snapshot.organization_id;
	}

	function deleteOrg(id: string) {
		const ops = ctx.translator.translateDeleteEntity('organization', id);
		ctx.applyOps(ops);
		if (selectedId === id) selectedId = null;
	}

	let cardItems = $derived(orgs.map((o) => ({ id: o.organization_id, name: o.organization.name || '(unnamed)' })));

	const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

	function addTerritory() {
		if (!selected) return;
		const territories = [...(selected.organization.territories ?? []), { region_id: '', location_id: '' }];
		updateOrg(selected.organization_id, { organization: { ...selected.organization, territories } });
		editModal = { section: 'territory', index: territories.length - 1 };
	}

	function addStatus() {
		if (!selected) return;
		const effects = [...(selected.status_effects ?? []), { instance_id: crypto.randomUUID() }];
		updateOrg(selected.organization_id, { status_effects: effects });
		editModal = { section: 'status', index: effects.length - 1 };
	}

	function addDoc() {
		if (!selected) return;
		const docs = [...(selected.bind_setting?.documents ?? []), { name: '', content: '' }];
		updateOrg(selected.organization_id, { bind_setting: { documents: docs } });
		editModal = { section: 'document', index: docs.length - 1 };
	}

	function addInteraction() {
		if (!selected) return;
		const opts = [...(selected.interaction?.options ?? []), { id: crypto.randomUUID(), title: '', instruction: '' }];
		updateOrg(selected.organization_id, { interaction: { options: opts } });
		editModal = { section: 'interaction', index: opts.length - 1 };
	}

	function deleteFromModal() {
		if (!editModal || !selected) return;
		const { section, index } = editModal;
		if (section === 'territory') {
			const territories = (selected.organization.territories ?? []).filter((_: Territory, i: number) => i !== index);
			updateOrg(selected.organization_id, { organization: { ...selected.organization, territories } });
		} else if (section === 'status') {
			const effects = (selected.status_effects ?? []).filter((_: StatusEffect, i: number) => i !== index);
			updateOrg(selected.organization_id, { status_effects: effects });
		} else if (section === 'document') {
			const docs = (selected.bind_setting?.documents ?? []).filter((_: SettingDocument, i: number) => i !== index);
			updateOrg(selected.organization_id, { bind_setting: { documents: docs } });
		} else if (section === 'interaction') {
			const opts = (selected.interaction?.options ?? []).filter((_: InteractionOption, i: number) => i !== index);
			updateOrg(selected.organization_id, { interaction: { options: opts } });
		}
		editModal = null;
	}

	function addLogEntry() {
		if (!selected || !logInput.trim()) return;
		const entries = [...(selected.log ?? []), { timestamp: new Date().toISOString(), content: logInput.trim() }];
		updateOrg(selected.organization_id, { log: entries });
		logInput = '';
	}

	function deleteLogEntry(i: number) {
		if (!selected) return;
		updateOrg(selected.organization_id, { log: (selected.log ?? []).filter((_: LogEntry, idx: number) => idx !== i) });
	}
</script>

{#snippet card(item: { id: string; name: string }, _selected: boolean)}
	{@const org = orgs.find((o) => o.organization_id === item.id)}
	<div class="p-3 flex flex-col gap-1.5">
		<span class="text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full w-fit" style="background: color-mix(in srgb, var(--we-accent-plum) 12%, transparent); color: var(--we-accent-plum);">{m.we_tab_organizations()}</span>
		<span class="font-serif font-bold text-sm truncate" style="color: var(--we-text-primary);">{item.name}</span>
		{#if org?.organization.description}
			<p class="text-xs line-clamp-2" style="color: var(--we-text-tertiary);">{org.organization.description}</p>
		{/if}
		{#if (org?.organization.territories ?? []).length > 0}
			<span class="text-[10px] font-medium" style="color: var(--we-text-tertiary);">{(org?.organization.territories ?? []).length} territories</span>
		{/if}
	</div>
{/snippet}

<div class="flex h-full overflow-hidden">
	<div class="w-72 shrink-0 flex flex-col border-r" style="border-color: var(--we-border);">
		<EntityCardGrid
			title={m.we_organizations_title()}
			items={cardItems}
			{selectedId}
			{card}
			onSelect={(id) => (selectedId = id)}
			onAdd={addOrg}
			onDelete={deleteOrg}
			accentColor="var(--we-accent-plum)"
			compact
		/>
	</div>

	{#if selected}
		<div class="flex-1 overflow-y-auto p-5" style="background: var(--we-bg-base);">
			<!-- Header -->
			<div class="flex items-center gap-3 mb-4">
				<div class="p-1.5 rounded-md" style="background: color-mix(in srgb, var(--we-accent-plum) 12%, transparent);">
					<svg class="w-4 h-4" style="color: var(--we-accent-plum);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/>
					</svg>
				</div>
				<h3 class="font-serif font-bold text-base" style="color: var(--we-text-primary);">{selected.organization.name || '(unnamed)'}</h3>
			</div>

			<!-- Bento grid -->
			<div class="bento-grid">

				<!-- Profile (inline) -->
				<div class="bento-card" style="grid-area: profile;">
					<h4 class="bento-title">{m.we_org_name()}</h4>
					<FormGroup label={m.we_org_name()}>
						<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.organization.name}
							oninput={(e) => updateOrg(selected!.organization_id, { organization: { ...selected!.organization, name: e.currentTarget.value } })} />
					</FormGroup>
					<FormGroup label={m.we_org_description()}>
						<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
							value={selected.organization.description ?? ''}
							oninput={(e) => updateOrg(selected!.organization_id, { organization: { ...selected!.organization, description: e.currentTarget.value } })}
						></textarea>
					</FormGroup>
				</div>

				<!-- Territories (mini-cards) -->
				{#if true}
				{@const territories = selected.organization.territories ?? []}
				<div class="bento-card" style="grid-area: territories;">
					<div class="bento-list-header">
						<h4 class="bento-title">Territories ({territories.length})</h4>
						<button class="add-btn" onclick={addTerritory}>+ {m.we_common_add()}</button>
					</div>
					{#if territories.length === 0}
						<div class="bento-empty">{m.we_common_empty()}</div>
					{:else}
						<div class="mini-card-grid">
							{#each territories as terr, i (i)}
								<button class="mini-card" onclick={() => (editModal = { section: 'territory', index: i })}>
									<span class="mini-card-title">{terr.region_id || '?'}</span>
									{#if terr.location_id}<span class="mini-card-desc">{terr.location_id}</span>{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Status Effects (mini-cards) -->
				{#if true}
				{@const effects = selected.status_effects ?? []}
				<div class="bento-card" style="grid-area: statuses;">
					<div class="bento-list-header">
						<h4 class="bento-title">{m.we_org_status_effects()} ({effects.length})</h4>
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
						<h4 class="bento-title">{m.we_org_documents()} ({docs.length})</h4>
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
					<h4 class="bento-title">{m.we_org_log()} ({entries.length})</h4>
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
	<!-- Territory Modal -->
	{#if editModal.section === 'territory'}
		{#if true}
		{@const territories = selected.organization.territories ?? []}
		{@const terr = territories[editModal.index]}
		{#if terr}
		<EditModal title="Territory – {terr.region_id || '(unset)'}" size="normal" onClose={() => (editModal = null)}>
			<FormGroup label="Region ID">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={terr.region_id}
					oninput={(e) => {
						const updated = [...territories]; updated[editModal!.index] = { ...terr, region_id: e.currentTarget.value };
						updateOrg(selected!.organization_id, { organization: { ...selected!.organization, territories: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Location ID">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={terr.location_id}
					oninput={(e) => {
						const updated = [...territories]; updated[editModal!.index] = { ...terr, location_id: e.currentTarget.value };
						updateOrg(selected!.organization_id, { organization: { ...selected!.organization, territories: updated } });
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
						updateOrg(selected!.organization_id, { status_effects: updated });
					}} />
			</FormGroup>
			<FormGroup label="Remark">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={eff.remark ?? ''}
					oninput={(e) => {
						const updated = [...effects]; updated[editModal!.index] = { ...eff, remark: e.currentTarget.value || undefined };
						updateOrg(selected!.organization_id, { status_effects: updated });
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
						updateOrg(selected!.organization_id, { interaction: { options: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Usage">
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.usage ?? ''}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, usage: e.currentTarget.value || undefined };
						updateOrg(selected!.organization_id, { interaction: { options: updated } });
					}} />
			</FormGroup>
			<FormGroup label="Instruction">
				<textarea class="{INPUT_CLS} min-h-[80px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.instruction}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, instruction: e.currentTarget.value };
						updateOrg(selected!.organization_id, { interaction: { options: updated } });
					}}></textarea>
			</FormGroup>
			<FormGroup label="Memo">
				<textarea class="{INPUT_CLS} min-h-[60px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={opt.memo ?? ''}
					oninput={(e) => {
						const updated = [...opts]; updated[editModal!.index] = { ...opt, memo: e.currentTarget.value || undefined };
						updateOrg(selected!.organization_id, { interaction: { options: updated } });
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
		<EditModal title="{m.we_org_documents()} – {doc.name || '(untitled)'}" size="wide" onClose={() => (editModal = null)}>
			<FormGroup label={m.we_document_name()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.name}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, name: e.currentTarget.value };
						updateOrg(selected!.organization_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_priority()}>
				<input type="number" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.static_priority ?? 0}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, static_priority: Number(e.currentTarget.value) };
						updateOrg(selected!.organization_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<FormGroup label={m.we_document_condition()}>
				<input type="text" class={INPUT_CLS} style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.condition ?? ''}
					placeholder="e.g. When the player enters the forest"
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, condition: e.currentTarget.value || undefined };
						updateOrg(selected!.organization_id, { bind_setting: { documents: updated } });
					}} />
			</FormGroup>
			<div class="flex items-center gap-2">
				<input type="checkbox" checked={doc.disable ?? false}
					onchange={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, disable: e.currentTarget.checked || undefined };
						updateOrg(selected!.organization_id, { bind_setting: { documents: updated } });
					}} />
				<span class="text-sm" style="color: var(--we-text-primary);">{m.we_document_disabled()}</span>
			</div>
			<FormGroup label={m.we_document_content()}>
				<textarea class="{INPUT_CLS} min-h-[200px] resize-y" style="border-color: var(--we-border); color: var(--we-text-primary);"
					value={doc.content}
					oninput={(e) => {
						const updated = [...docs]; updated[editModal!.index] = { ...doc, content: e.currentTarget.value };
						updateOrg(selected!.organization_id, { bind_setting: { documents: updated } });
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
		grid-template-columns: repeat(2, 1fr);
		grid-template-areas:
			"profile        territories"
			"statuses       docs"
			"interactions   interactions"
			"log            log";
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
		background: color-mix(in srgb, var(--we-accent-plum) 12%, transparent);
		color: var(--we-accent-plum); border: none; cursor: pointer;
		transition: background 0.15s, transform 0.1s; white-space: nowrap;
	}
	.add-btn:hover { background: color-mix(in srgb, var(--we-accent-plum) 22%, transparent); transform: translateY(-1px); }
	.mini-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
	.mini-card {
		display: flex; flex-direction: column; gap: 3px; padding: 10px 12px;
		border-radius: 8px; border: 1px solid var(--we-border); background: var(--we-bg-secondary);
		cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s; text-align: left;
	}
	.mini-card:hover {
		border-color: var(--we-accent-plum);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--we-accent-plum) 18%, transparent);
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
