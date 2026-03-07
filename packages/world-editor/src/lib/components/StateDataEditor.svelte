<!--
  StateDataEditor — Top-level orchestrator that combines the sidebar
  navigation with all sub-editors.  This is the primary public component
  exported by @pubwiki/world-editor.
-->
<script lang="ts">
	import type { StateData, WorldSnapshot, GameInitialStory, StoryHistoryEntry, AppInfo } from '../types/state-data.js';
	import type { TabType } from '../types/editor.js';

	import EditorSidebar from './editors/EditorSidebar.svelte';
	import DashboardEditor from './editors/DashboardEditor.svelte';
	import WorldEditor from './editors/WorldEditor.svelte';
	import CreaturesEditor from './editors/CreaturesEditor.svelte';
	import RegionsEditor from './editors/RegionsEditor.svelte';
	import OrganizationsEditor from './editors/OrganizationsEditor.svelte';
	import SettingDocsEditor from './editors/SettingDocsEditor.svelte';
	import InitialStoryEditor from './editors/InitialStoryEditor.svelte';
	import StoryHistoryEditor from './editors/StoryHistoryEditor.svelte';
	import AppInfoEditor from './editors/AppInfoEditor.svelte';

	interface Props {
		/** The full StateData object to edit. Bind to this to receive updates. */
		data: StateData;
		/** Called whenever any field changes. */
		onChange?: (data: StateData) => void;
	}

	let { data = $bindable(), onChange }: Props = $props();

	let activeTab: TabType = $state('dashboard');

	// ---- Undo / Redo ----
	const MAX_HISTORY = 50;
	let undoStack: StateData[] = $state([]);
	let redoStack: StateData[] = $state([]);

	function pushChange(next: StateData) {
		undoStack = [...undoStack.slice(-MAX_HISTORY + 1), data];
		redoStack = [];
		data = next;
		onChange?.(next);
	}

	function undo() {
		if (undoStack.length === 0) return;
		redoStack = [...redoStack, data];
		data = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
		onChange?.(data);
	}

	function redo() {
		if (redoStack.length === 0) return;
		undoStack = [...undoStack, data];
		data = redoStack[redoStack.length - 1];
		redoStack = redoStack.slice(0, -1);
		onChange?.(data);
	}

	// ---- Keyboard shortcuts ----
	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			redo();
		}
	}

	// ---- Patchers ----
	function patchWorld(patch: Partial<StateData['World']>) {
		pushChange({ ...data, World: { ...data.World, ...patch } });
	}

	function patchCreatures(creatures: NonNullable<StateData['Creatures']>) {
		pushChange({ ...data, Creatures: creatures });
	}

	function patchRegions(regions: NonNullable<StateData['Regions']>) {
		pushChange({ ...data, Regions: regions });
	}

	function patchOrganizations(organizations: NonNullable<StateData['Organizations']>) {
		pushChange({ ...data, Organizations: organizations });
	}

	function setTab(t: TabType) {
		activeTab = t;
	}

	function handleWorldChange(w: WorldSnapshot) {
		pushChange({ ...data, World: w });
	}

	function handleInitialStoryChange(s: GameInitialStory) {
		pushChange({ ...data, GameInitialStory: s });
	}

	function handleStoryHistoryChange(entries: StoryHistoryEntry[]) {
		pushChange({ ...data, StoryHistory: entries });
	}

	function handleAppInfoChange(info: AppInfo) {
		pushChange({ ...data, AppInfo: info });
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
	<!-- Sidebar -->
	<EditorSidebar {activeTab} onTabChange={setTab} />

	<!-- Main content area -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<!-- Top bar with undo/redo -->
		<header class="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
			<h1 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
				World Editor
			</h1>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
					disabled={undoStack.length === 0}
					onclick={undo}
					title="Undo (Ctrl+Z)"
				>
					↩ Undo
				</button>
				<button
					type="button"
					class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
					disabled={redoStack.length === 0}
					onclick={redo}
					title="Redo (Ctrl+Y)"
				>
					Redo ↪
				</button>
			</div>
		</header>

		<!-- Editor panel -->
		<div class="flex-1 overflow-y-auto">
			{#if activeTab === 'dashboard'}
				<DashboardEditor {data} onNavigate={setTab} />
			{:else if activeTab === 'world'}
				<WorldEditor
					world={data.World}
					onChange={handleWorldChange}
				/>
			{:else if activeTab === 'creatures'}
				<CreaturesEditor
					creatures={data.Creatures ?? []}
					onChange={patchCreatures}
				/>
			{:else if activeTab === 'regions'}
				<RegionsEditor
					regions={data.Regions ?? []}
					onChange={patchRegions}
				/>
			{:else if activeTab === 'organizations'}
				<OrganizationsEditor
					organizations={data.Organizations ?? []}
					onChange={patchOrganizations}
				/>
			{:else if activeTab === 'settings'}
				<SettingDocsEditor {data} />
			{:else if activeTab === 'initial-story'}
				<InitialStoryEditor
					story={data.GameInitialStory}
					onChange={handleInitialStoryChange}
				/>
			{:else if activeTab === 'story-history'}
				<StoryHistoryEditor
					entries={data.StoryHistory ?? []}
					onChange={handleStoryHistoryChange}
				/>
			{:else if activeTab === 'app-info'}
				<AppInfoEditor
					info={data.AppInfo}
					onChange={handleAppInfoChange}
				/>
			{:else}
				<div class="flex h-full items-center justify-center text-gray-400">
					Select a section from the sidebar.
				</div>
			{/if}
		</div>
	</div>
</div>
