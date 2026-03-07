<!--
  SettingDocsEditor — Overview of all setting documents across all entities.
-->
<script lang="ts">
	import type { StateData, SettingDocument } from '../../types/state-data.js';
	import { luaList } from '../../types/editor.js';

	interface Props {
		data: StateData;
	}

	let { data }: Props = $props();

	interface DocEntry {
		entityType: string;
		entityName: string;
		doc: SettingDocument;
	}

	let allDocs = $derived.by(() => {
		const entries: DocEntry[] = [];

		(data.World?.BindSetting?.documents || []).forEach((doc) =>
			entries.push({ entityType: 'World', entityName: 'World', doc })
		);

		luaList(data.Creatures).forEach((c) =>
			(c.BindSetting?.documents || []).forEach((doc) =>
				entries.push({
					entityType: 'Creature',
					entityName: c.CreatureAttributes?.name || c.CreatureAttributes?.creature_id || '?',
					doc
				})
			)
		);

		luaList(data.Regions).forEach((r) =>
			(r.BindSetting?.documents || []).forEach((doc) =>
				entries.push({
					entityType: 'Region',
					entityName: r.LocationsAndPaths?.region_name || r.LocationsAndPaths?.region_id || '?',
					doc
				})
			)
		);

		luaList(data.Organizations).forEach((o) =>
			(o.BindSetting?.documents || []).forEach((doc) =>
				entries.push({
					entityType: 'Organization',
					entityName: o.Organization?.name || o.Organization?.organization_id || '?',
					doc
				})
			)
		);

		return entries;
	});
</script>

<div class="p-6">
	<div class="mb-4">
		<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">📝 Setting Documents</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			All setting documents across entities ({allDocs.length} total). Edit them on each entity's page.
		</p>
	</div>

	{#if allDocs.length === 0}
		<p class="text-sm text-gray-400">No setting documents yet. Add them to entities.</p>
	{:else}
		<div class="space-y-2">
			{#each allDocs as entry, index}
				<div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
					<div class="mb-1 flex items-center gap-2">
						<span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
							{entry.entityType}
						</span>
						<span class="text-xs text-gray-500 dark:text-gray-400">{entry.entityName}</span>
						<span class="text-sm font-medium text-gray-700 dark:text-gray-200">{entry.doc.name}</span>
						{#if entry.doc.disable}
							<span class="text-[10px] text-red-400">disabled</span>
						{/if}
						{#if entry.doc.static_priority}
							<span class="text-[10px] text-amber-500">P{entry.doc.static_priority}</span>
						{/if}
					</div>
					<p class="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{entry.doc.content}</p>
					{#if entry.doc.condition}
						<p class="mt-1 text-[10px] italic text-gray-400">Condition: {entry.doc.condition}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
