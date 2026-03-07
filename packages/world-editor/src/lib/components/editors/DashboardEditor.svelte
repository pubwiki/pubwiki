<!--
  DashboardEditor — Overview dashboard showing stats about the world.
-->
<script lang="ts">
	import type { StateData } from '../../types/state-data.js';
	import type { TabType, ValidationError } from '../../types/editor.js';
	import { luaList } from '../../types/editor.js';

	interface Props {
		data: StateData;
		validationErrors?: ValidationError[];
		onNavigate: (tab: TabType) => void;
	}

	let { data, validationErrors = [], onNavigate }: Props = $props();

	let stats = $derived.by(() => {
		const creatures = luaList(data.Creatures);
		const regions = luaList(data.Regions);
		const organizations = luaList(data.Organizations);
		const skills = luaList(data.World?.Registry?.skills);
		const moves = luaList(data.World?.Registry?.moves);
		const items = luaList(data.World?.Registry?.items);
		const templates = luaList(data.World?.CustomComponentRegistry?.custom_components);
		const switchCount = Object.keys(data.World?.Switches?.flags || {}).length;
		const storyHistory = luaList(data.StoryHistory);

		// Count all documents
		let docCount = 0;
		docCount += (data.World?.BindSetting?.documents || []).length;
		creatures.forEach((c) => (docCount += (c.BindSetting?.documents || []).length));
		regions.forEach((r) => (docCount += (r.BindSetting?.documents || []).length));
		organizations.forEach((o) => (docCount += (o.BindSetting?.documents || []).length));

		const playerCreature = creatures.find((c) => c.IsPlayer);
		const gt = data.World?.GameTime;
		const gameTime = gt ? `Y${gt.year} M${gt.month} D${gt.day}` : '-';

		return {
			creatures,
			regions,
			organizations,
			skills,
			moves,
			items,
			templates,
			switchCount,
			storyHistory,
			docCount,
			gameTime,
			playerName: playerCreature?.CreatureAttributes?.name || '-'
		};
	});

	let errorCount = $derived(validationErrors.filter((e) => e.severity === 'error').length);
	let warningCount = $derived(validationErrors.filter((e) => e.severity === 'warning').length);

	interface StatCard {
		icon: string;
		label: string;
		value: number | string;
		tab?: TabType;
	}

	let cards: StatCard[] = $derived([
		{ icon: '⏰', label: 'Game Time', value: stats.gameTime },
		{ icon: '🎮', label: 'Player', value: stats.playerName },
		{ icon: '👥', label: 'Creatures', value: stats.creatures.length, tab: 'creatures' },
		{ icon: '🗺️', label: 'Regions', value: stats.regions.length, tab: 'regions' },
		{ icon: '🏛️', label: 'Organizations', value: stats.organizations.length, tab: 'organizations' },
		{ icon: '📝', label: 'Documents', value: stats.docCount, tab: 'settings' },
		{ icon: '⚔️', label: 'Skills', value: stats.skills.length, tab: 'world' },
		{ icon: '🎯', label: 'Moves', value: stats.moves.length, tab: 'world' },
		{ icon: '🎒', label: 'Items', value: stats.items.length, tab: 'world' },
		{ icon: '🧩', label: 'Components', value: stats.templates.length, tab: 'world' },
		{ icon: '🔀', label: 'Switches', value: stats.switchCount, tab: 'world' },
		{ icon: '📜', label: 'Story Turns', value: stats.storyHistory.length, tab: 'story-history' }
	]);
</script>

<div class="p-6">
	<div class="mb-6">
		<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">Dashboard</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">World overview and statistics</p>
	</div>

	<!-- Validation banner -->
	{#if errorCount > 0 || warningCount > 0}
		<div
			class="mb-4 rounded-lg border px-4 py-2 text-sm
				{errorCount > 0 ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400' : 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'}"
		>
			{#if errorCount > 0}
				<span>❌ {errorCount} error{errorCount > 1 ? 's' : ''}</span>
			{/if}
			{#if warningCount > 0}
				<span class="ml-2">⚠️ {warningCount} warning{warningCount > 1 ? 's' : ''}</span>
			{/if}
		</div>
	{/if}

	<!-- Stat cards grid -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each cards as card}
			<button
				type="button"
				class="flex flex-col rounded-lg border border-gray-200 bg-white p-3 text-left transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800
					{card.tab ? 'cursor-pointer' : 'cursor-default'}"
				onclick={() => card.tab && onNavigate(card.tab)}
			>
				<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
					<span>{card.icon}</span>
					<span>{card.label}</span>
				</div>
				<div class="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-200">
					{card.value}
				</div>
			</button>
		{/each}
	</div>
</div>
