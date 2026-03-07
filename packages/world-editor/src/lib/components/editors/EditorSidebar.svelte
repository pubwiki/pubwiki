<!--
  EditorSidebar — Left navigation sidebar with grouped tabs.
-->
<script lang="ts">
	import type { TabType } from '../../types/editor.js';

	interface NavItem {
		key: TabType;
		label: string;
		icon: string;
	}

	interface NavGroup {
		label: string;
		items: NavItem[];
	}

	interface Props {
		activeTab: TabType;
		onTabChange: (tab: TabType) => void;
	}

	let { activeTab, onTabChange }: Props = $props();

	const navGroups: NavGroup[] = [
		{
			label: 'Overview',
			items: [{ key: 'dashboard', label: 'Dashboard', icon: '📊' }]
		},
		{
			label: 'World Building',
			items: [
				{ key: 'world', label: 'World', icon: '🌍' },
				{ key: 'creatures', label: 'Creatures', icon: '👥' },
				{ key: 'regions', label: 'Regions', icon: '🗺️' },
				{ key: 'organizations', label: 'Organizations', icon: '🏛️' }
			]
		},
		{
			label: 'Content',
			items: [
				{ key: 'settings', label: 'Setting Docs', icon: '📝' }
			]
		},
		{
			label: 'Story',
			items: [
				{ key: 'initial-story', label: 'Initial Story', icon: '🎬' },
				{ key: 'story-history', label: 'Story History', icon: '📜' }
			]
		},
		{
			label: 'App',
			items: [{ key: 'app-info', label: 'App Info', icon: '📱' }]
		}
	];
</script>

<nav class="flex h-full w-48 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
	<div class="flex-1 overflow-y-auto py-2">
		{#each navGroups as group}
			<div class="mb-2 px-3">
				<div class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
					{group.label}
				</div>
				{#each group.items as item}
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors
							{activeTab === item.key
							? 'bg-amber-50 text-amber-700 font-medium dark:bg-amber-900/20 dark:text-amber-400'
							: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}"
						onclick={() => onTabChange(item.key)}
					>
						<span class="text-sm">{item.icon}</span>
						<span>{item.label}</span>
					</button>
				{/each}
			</div>
		{/each}
	</div>
</nav>
