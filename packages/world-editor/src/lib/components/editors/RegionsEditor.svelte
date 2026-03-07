<!--
  RegionsEditor — Edit region entities with locations and paths.
  3-column layout: left sidebar list, center form.
-->
<script lang="ts">
	import type { RegionSnapshot, Location, Path } from '../../types/state-data.js';
	import { luaList, generateUniqueId } from '../../types/editor.js';
	import EntityListSidebar from '../primitives/EntityListSidebar.svelte';
	import CollapsibleSection from '../primitives/CollapsibleSection.svelte';
	import FormField from '../primitives/FormField.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';
	import BindSettingEditor from './BindSettingEditor.svelte';

	interface Props {
		regions: RegionSnapshot[];
		onChange: (regions: RegionSnapshot[]) => void;
	}

	let { regions, onChange }: Props = $props();
	let selectedId = $state<string | null>(null);

	let listItems = $derived(
		regions.map((r) => ({
			id: r.LocationsAndPaths?.region_id || `entity-${r.entity_id}`,
			name: r.LocationsAndPaths?.region_name || r.Metadata?.name || '(unnamed)',
			subtitle: `${luaList(r.LocationsAndPaths?.locations).length} locations`,
			icon: '🗺️'
		}))
	);

	let selectedIndex = $derived(
		selectedId ? regions.findIndex((r) => (r.LocationsAndPaths?.region_id || `entity-${r.entity_id}`) === selectedId) : -1
	);
	let selected = $derived(selectedIndex >= 0 ? regions[selectedIndex] : null);
	let lap = $derived(selected?.LocationsAndPaths);

	function updateRegion(index: number, patch: Partial<RegionSnapshot>) {
		const updated = regions.map((r, i) => (i === index ? { ...r, ...patch } : r));
		onChange(updated);
	}

	function updateLAP(patch: Partial<RegionSnapshot['LocationsAndPaths']>) {
		if (selectedIndex < 0 || !lap) return;
		updateRegion(selectedIndex, { LocationsAndPaths: { ...lap, ...patch } as RegionSnapshot['LocationsAndPaths'] });
	}

	function addRegion() {
		const id = generateUniqueId('region');
		const newRegion: RegionSnapshot = {
			entity_id: Date.now(),
			LocationsAndPaths: {
				region_id: id,
				region_name: '',
				description: '',
				locations: [],
				paths: []
			},
			Log: { entries: [] }
		};
		onChange([...regions, newRegion]);
		selectedId = id;
	}

	function removeRegion(id: string) {
		const updated = regions.filter(
			(r) => (r.LocationsAndPaths?.region_id || `entity-${r.entity_id}`) !== id
		);
		onChange(updated);
		if (selectedId === id) selectedId = null;
	}

	// Location helpers
	let locations = $derived(luaList<Location>(lap?.locations));

	function addLocation() {
		const id = generateUniqueId('loc');
		updateLAP({ locations: [...locations, { id, name: '', description: '' }] });
	}

	function updateLocation(index: number, patch: Partial<Location>) {
		const updated = locations.map((l, i) => (i === index ? { ...l, ...patch } : l));
		updateLAP({ locations: updated });
	}

	function removeLocation(index: number) {
		updateLAP({ locations: locations.filter((_, i) => i !== index) });
	}

	// Path helpers
	let paths = $derived(luaList<Path>(lap?.paths));

	function addPath() {
		updateLAP({
			paths: [
				...paths,
				{
					src_location: '',
					src_region: lap?.region_id || '',
					discovered: true,
					to_region: '',
					to_location: '',
					description: ''
				}
			]
		});
	}

	function updatePath(index: number, patch: Partial<Path>) {
		const updated = paths.map((p, i) => (i === index ? { ...p, ...patch } : p));
		updateLAP({ paths: updated });
	}

	function removePath(index: number) {
		updateLAP({ paths: paths.filter((_, i) => i !== index) });
	}
</script>

<div class="flex h-full">
	<EntityListSidebar
		title="Regions"
		items={listItems}
		{selectedId}
		onSelect={(id) => (selectedId = id)}
		onAdd={addRegion}
		onRemove={removeRegion}
		addLabel="+ Add Region"
	/>

	<div class="flex-1 overflow-y-auto">
		{#if selected && lap}
			<div class="space-y-2 p-4">
				<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">
					{lap.region_name || '(unnamed)'}
				</h2>

				<!-- Basic Info -->
				<CollapsibleSection title="Basic Info" icon="📋" outlineId="region-basic">
					<div class="grid grid-cols-2 gap-3">
						<FormField label="Region ID">
							<TextInput value={lap.region_id} onchange={(v) => updateLAP({ region_id: v })} />
						</FormField>
						<FormField label="Name">
							<TextInput value={lap.region_name} onchange={(v) => updateLAP({ region_name: v })} />
						</FormField>
					</div>
					<FormField label="Description">
						<TextArea value={lap.description} onchange={(v) => updateLAP({ description: v })} rows={3} placeholder="Region description..." />
					</FormField>
				</CollapsibleSection>

				<!-- Locations -->
				<CollapsibleSection title="Locations" icon="📍" badge={locations.length} outlineId="locations">
					{#each locations as loc, index (loc.id)}
						<div class="mb-2 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
							<div class="mb-2 flex items-center justify-between">
								<span class="text-xs font-mono text-gray-400">{loc.id}</span>
								<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeLocation(index)}>Remove</button>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<FormField label="ID">
									<TextInput value={loc.id} onchange={(v) => updateLocation(index, { id: v })} />
								</FormField>
								<FormField label="Name">
									<TextInput value={loc.name} onchange={(v) => updateLocation(index, { name: v })} />
								</FormField>
							</div>
							<FormField label="Description">
								<TextArea value={loc.description} onchange={(v) => updateLocation(index, { description: v })} rows={2} />
							</FormField>
						</div>
					{/each}
					<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addLocation}>
						+ Add Location
					</button>
				</CollapsibleSection>

				<!-- Paths -->
				<CollapsibleSection title="Paths" icon="🛤️" badge={paths.length} outlineId="paths">
					{#each paths as path, index}
						<div class="mb-2 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
							<div class="mb-2 flex items-center justify-between">
								<span class="text-xs text-gray-400">Path #{index + 1}</span>
								<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removePath(index)}>Remove</button>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<FormField label="From Region">
									<TextInput value={path.src_region} onchange={(v) => updatePath(index, { src_region: v })} />
								</FormField>
								<FormField label="From Location">
									<TextInput value={path.src_location} onchange={(v) => updatePath(index, { src_location: v })} />
								</FormField>
								<FormField label="To Region">
									<TextInput value={path.to_region} onchange={(v) => updatePath(index, { to_region: v })} />
								</FormField>
								<FormField label="To Location">
									<TextInput value={path.to_location} onchange={(v) => updatePath(index, { to_location: v })} />
								</FormField>
							</div>
							<FormField label="Description">
								<TextArea value={path.description} onchange={(v) => updatePath(index, { description: v })} rows={2} />
							</FormField>
							<label class="text-xs text-gray-600 dark:text-gray-400">
								<input type="checkbox" checked={path.discovered} onchange={(e) => updatePath(index, { discovered: e.currentTarget.checked })} class="mr-1 accent-amber-500" />
								Discovered
							</label>
						</div>
					{/each}
					<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addPath}>
						+ Add Path
					</button>
				</CollapsibleSection>

				<!-- Setting Documents -->
				<CollapsibleSection title="Setting Documents" icon="📝" outlineId="region-settings">
					<BindSettingEditor
						documents={selected.BindSetting?.documents || []}
						onChange={(docs) => updateRegion(selectedIndex, { BindSetting: { documents: docs } })}
					/>
				</CollapsibleSection>
			</div>
		{:else}
			<div class="flex h-full items-center justify-center text-gray-400">
				<p>Select a region or create a new one</p>
			</div>
		{/if}
	</div>
</div>
