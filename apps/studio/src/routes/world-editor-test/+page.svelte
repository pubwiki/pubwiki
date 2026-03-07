<script lang="ts">
	import { StateDataEditor, createEmptyStateData } from '@pubwiki/world-editor';
	import type { StateData } from '@pubwiki/world-editor';

	// Build the initial data as a plain object, then wrap in $state
	function buildSampleData(): StateData {
		const d = createEmptyStateData();

		d.Creatures = [
			{
				entity_id: 1,
				CreatureAttributes: {
					creature_id: 'alice',
					name: 'Alice',
					organization_id: 'adventurers_guild',
					titles: ['Hero', 'Wanderer'],
					appearance: {
						body: 'Tall with silver hair and blue eyes.',
						clothing: 'Leather armor with a flowing cloak.'
					},
					personality: { openness: 70, conscientiousness: 50, extraversion: 30, agreeableness: 60, neuroticism: -20 },
					emotion: { pleasure: 40, arousal: 20, dominance: 10 },
					skills: {},
					attrs: {}
				},
				IsPlayer: {},
				BindSetting: {
					documents: [{ name: 'Background', content: 'A brave adventurer from the northern lands.' }]
				}
			}
		];

		d.Regions = [
			{
				entity_id: 2,
				Metadata: { name: 'Elderwood Forest', desc: 'A mystical ancient forest.' },
				LocationsAndPaths: {
					region_id: 'elderwood',
					region_name: 'Elderwood Forest',
					description: 'An ancient forest full of secrets.',
					locations: [
						{ id: 'clearing', name: 'Forest Clearing', description: 'A peaceful clearing bathed in sunlight.' },
						{ id: 'cave', name: 'Hidden Cave', description: 'A dark cave behind a waterfall.' }
					],
					paths: [
						{ src_region: 'elderwood', src_location: 'clearing', to_region: 'elderwood', to_location: 'cave', discovered: true, description: 'A narrow trail through thick underbrush.' }
					]
				}
			}
		];

		d.Organizations = [
			{
				entity_id: 3,
				Organization: {
					organization_id: 'adventurers_guild',
					name: 'Adventurers Guild',
					description: 'A guild of brave adventurers.',
					territories: [{ region_id: 'elderwood', location_id: 'clearing' }]
				}
			}
		];

		d.World.GameTime = { year: 1023, month: 6, day: 15, hour: 14, minute: 30 };
		d.World.Switches = { flags: { day_night_cycle: true, weather_system: false } };

		d.GameInitialStory = {
			background: 'In a world where magic and technology intertwine, the ancient forests of Elderwood hold secrets that have been forgotten for centuries.',
			start_story: 'You awaken in a sunlit clearing, the sound of birdsong filling the air. A weathered signpost points deeper into the forest.'
		};

		d.AppInfo = {
			name: 'Elderwood Chronicles',
			slug: 'elderwood-chronicles',
			version: '0.1.0',
			visibility: 'PRIVATE',
			tags: ['fantasy', 'adventure', 'rpg'],
			publish_type: 'GALGAME'
		};

		return d;
	}

	let data: StateData = $state(buildSampleData());
	let showJson = $state(false);
</script>

<svelte:head>
	<title>World Editor Test | Studio</title>
</svelte:head>

<div class="flex h-screen flex-col bg-gray-100 dark:bg-gray-900">
	<!-- Toolbar -->
	<div class="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
		<h1 class="text-base font-semibold text-gray-700 dark:text-gray-200">
			🧪 World Editor Test Page
		</h1>
		<div class="flex items-center gap-2">
			<button
				class="rounded px-3 py-1 text-sm {showJson ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}"
				onclick={() => (showJson = !showJson)}
			>
				{showJson ? 'Hide' : 'Show'} JSON
			</button>
		</div>
	</div>

	<!-- Main content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Editor -->
		<div class={`flex-1 overflow-hidden p-4 ${showJson ? 'w-1/2' : ''}`}>
			<StateDataEditor bind:data />
		</div>

		<!-- JSON viewer -->
		{#if showJson}
			<div class="w-1/2 overflow-auto border-l border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
				<pre class="whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400">{JSON.stringify(data, null, 2)}</pre>
			</div>
		{/if}
	</div>
</div>
