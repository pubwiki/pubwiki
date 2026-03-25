<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface TabDef {
		id: string;
		label: string;
		icon: string;
	}

	interface Props {
		activeTab: string;
		onTabChange: (tab: string) => void;
		/** Dynamic left padding in px */
		leftPad?: number;
		/** Dynamic right padding in px */
		rightPad?: number;
	}

	let { activeTab, onTabChange, leftPad = 56, rightPad = 56 }: Props = $props();

	const worldBuildingTabs: TabDef[] = [
		{ id: 'dashboard', label: 'we_tab_dashboard', icon: 'layout-dashboard' },
		{ id: 'world', label: 'we_tab_world', icon: 'globe' },
		{ id: 'characters', label: 'we_tab_characters', icon: 'users' },
		{ id: 'regions', label: 'we_tab_regions', icon: 'map' },
		{ id: 'organizations', label: 'we_tab_organizations', icon: 'building' }
	];

	const storyTabs: TabDef[] = [
		{ id: 'story', label: 'we_tab_story', icon: 'book-open' },
		{ id: 'wiki', label: 'we_tab_wiki', icon: 'scroll' }
	];

	const tabLabels: Record<string, () => string> = {
		we_tab_dashboard: m.we_tab_dashboard,
		we_tab_world: m.we_tab_world,
		we_tab_characters: m.we_tab_characters,
		we_tab_regions: m.we_tab_regions,
		we_tab_organizations: m.we_tab_organizations,
		we_tab_story: m.we_tab_story,
		we_tab_wiki: m.we_tab_wiki
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex items-center gap-1 py-2 bg-[var(--we-bg-secondary)] border-b overflow-x-auto scrollbar-none transition-[padding] duration-200 ease-out"
	style="border-color: var(--we-border); padding-left: {leftPad}px; padding-right: {rightPad}px;"
>
	{#each worldBuildingTabs as tab}
		<button
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-full border-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer
				{activeTab === tab.id
				? 'bg-[var(--we-bg-base)] text-[var(--we-text-primary)] border-[var(--we-text-primary)] font-bold'
				: 'border-transparent text-[var(--we-text-secondary)] hover:bg-black/5 hover:text-[var(--we-text-primary)]'}"
			onclick={() => onTabChange(tab.id)}
		>
			{@html getTabIcon(tab.icon)}
			{tabLabels[tab.label]?.() ?? tab.id}
		</button>
	{/each}

	<!-- Group separator -->
	<div class="w-px h-5 bg-black/15 mx-1 shrink-0"></div>

	{#each storyTabs as tab}
		<button
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-full border-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer
				{activeTab === tab.id
				? 'bg-[var(--we-bg-base)] text-[var(--we-text-primary)] border-[var(--we-text-primary)] font-bold'
				: 'border-transparent text-[var(--we-text-secondary)] hover:bg-black/5 hover:text-[var(--we-text-primary)]'}"
			onclick={() => onTabChange(tab.id)}
		>
			{@html getTabIcon(tab.icon)}
			{tabLabels[tab.label]?.() ?? tab.id}
		</button>
	{/each}
</div>

<script lang="ts" module>
	// Inline SVG icons (Lucide-style, 24x24 viewBox, stroke-based)
	const ICONS: Record<string, string> = {
		'layout-dashboard': '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
		globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
		users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
		map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
		building:
			'<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
		'book-open':
			'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
		scroll:
			'<path d="M10 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/><path d="M14 3h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M14 3v4h6"/><path d="M10 7v10h4"/>'
	};

	function getTabIcon(name: string): string {
		const path = ICONS[name] ?? '';
		return `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
	}
</script>
