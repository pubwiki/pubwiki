<!--
  OrganizationsEditor — Edit organization entities.
-->
<script lang="ts">
	import type { OrganizationSnapshot, Organization } from '../../types/state-data.js';
	import { luaList, generateUniqueId } from '../../types/editor.js';
	import EntityListSidebar from '../primitives/EntityListSidebar.svelte';
	import CollapsibleSection from '../primitives/CollapsibleSection.svelte';
	import FormField from '../primitives/FormField.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';
	import BindSettingEditor from './BindSettingEditor.svelte';

	interface Props {
		organizations: OrganizationSnapshot[];
		onChange: (organizations: OrganizationSnapshot[]) => void;
	}

	let { organizations, onChange }: Props = $props();
	let selectedId = $state<string | null>(null);

	let listItems = $derived(
		organizations.map((o) => ({
			id: o.Organization?.organization_id || `entity-${o.entity_id}`,
			name: o.Organization?.name || '(unnamed)',
			subtitle: `${(o.Organization?.territories || []).length} territories`,
			icon: '🏛️'
		}))
	);

	let selectedIndex = $derived(
		selectedId ? organizations.findIndex((o) => (o.Organization?.organization_id || `entity-${o.entity_id}`) === selectedId) : -1
	);
	let selected = $derived(selectedIndex >= 0 ? organizations[selectedIndex] : null);
	let org = $derived(selected?.Organization);

	function updateOrg(index: number, patch: Partial<OrganizationSnapshot>) {
		const updated = organizations.map((o, i) => (i === index ? { ...o, ...patch } : o));
		onChange(updated);
	}

	function updateOrgData(patch: Partial<Organization>) {
		if (selectedIndex < 0 || !org) return;
		updateOrg(selectedIndex, { Organization: { ...org, ...patch } });
	}

	function addOrganization() {
		const id = generateUniqueId('org');
		const newOrg: OrganizationSnapshot = {
			entity_id: Date.now(),
			Organization: {
				organization_id: id,
				name: '',
				description: '',
				territories: []
			},
			Log: { entries: [] }
		};
		onChange([...organizations, newOrg]);
		selectedId = id;
	}

	function removeOrganization(id: string) {
		const updated = organizations.filter(
			(o) => (o.Organization?.organization_id || `entity-${o.entity_id}`) !== id
		);
		onChange(updated);
		if (selectedId === id) selectedId = null;
	}

	// Territory helpers
	let territories = $derived(org?.territories || []);

	function addTerritory() {
		updateOrgData({ territories: [...territories, { region_id: '', location_id: '' }] });
	}

	function updateTerritory(index: number, patch: Partial<{ region_id: string; location_id: string }>) {
		const updated = territories.map((t, i) => (i === index ? { ...t, ...patch } : t));
		updateOrgData({ territories: updated });
	}

	function removeTerritory(index: number) {
		updateOrgData({ territories: territories.filter((_, i) => i !== index) });
	}
</script>

<div class="flex h-full">
	<EntityListSidebar
		title="Organizations"
		items={listItems}
		{selectedId}
		onSelect={(id) => (selectedId = id)}
		onAdd={addOrganization}
		onRemove={removeOrganization}
		addLabel="+ Add Organization"
	/>

	<div class="flex-1 overflow-y-auto">
		{#if selected && org}
			<div class="space-y-2 p-4">
				<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">
					{org.name || '(unnamed)'}
				</h2>

				<CollapsibleSection title="Basic Info" icon="📋" outlineId="org-basic">
					<div class="grid grid-cols-2 gap-3">
						<FormField label="Organization ID">
							<TextInput value={org.organization_id} onchange={(v) => updateOrgData({ organization_id: v })} />
						</FormField>
						<FormField label="Name">
							<TextInput value={org.name} onchange={(v) => updateOrgData({ name: v })} />
						</FormField>
					</div>
					<FormField label="Description">
						<TextArea value={org.description} onchange={(v) => updateOrgData({ description: v })} rows={3} placeholder="Organization description..." />
					</FormField>
				</CollapsibleSection>

				<CollapsibleSection title="Territories" icon="🗺️" badge={territories.length} outlineId="territories">
					{#each territories as territory, index}
						<div class="mb-2 flex items-center gap-2">
							<div class="grid flex-1 grid-cols-2 gap-2">
								<TextInput value={territory.region_id} onchange={(v) => updateTerritory(index, { region_id: v })} placeholder="Region ID" />
								<TextInput value={territory.location_id} onchange={(v) => updateTerritory(index, { location_id: v })} placeholder="Location ID" />
							</div>
							<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeTerritory(index)}>✕</button>
						</div>
					{/each}
					<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addTerritory}>
						+ Add Territory
					</button>
				</CollapsibleSection>

				<CollapsibleSection title="Setting Documents" icon="📝" outlineId="org-settings">
					<BindSettingEditor
						documents={selected.BindSetting?.documents || []}
						onChange={(docs) => updateOrg(selectedIndex, { BindSetting: { documents: docs } })}
					/>
				</CollapsibleSection>
			</div>
		{:else}
			<div class="flex h-full items-center justify-center text-gray-400">
				<p>Select an organization or create a new one</p>
			</div>
		{/if}
	</div>
</div>
