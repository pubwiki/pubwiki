<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { TripleStore } from '@pubwiki/rdfstore';
	import {
		TripleTranslator,
		StateDataView,
		createDefaultStateData,
		type StateData
	} from '@pubwiki/world-editor';
	import {
		setWorldEditorContext,
		applyOperationsToStore,
		type WorldEditorContext
	} from './state/context';
	import type { TripleOperation } from '@pubwiki/world-editor';

	import EditorTabs from './EditorTabs.svelte';
	import DashboardPanel from './panels/DashboardPanel.svelte';
	import WorldPanel from './panels/WorldPanel.svelte';
	import CharactersPanel from './panels/CharactersPanel.svelte';
	import RegionsPanel from './panels/RegionsPanel.svelte';
	import OrganizationsPanel from './panels/OrganizationsPanel.svelte';
	import StoryPanel from './panels/StoryPanel.svelte';
	import WikiPanel from './panels/WikiPanel.svelte';
	import { WorldEditorCopilotPanel } from './copilot';

	interface Props {
		projectId: string;
		store: TripleStore;
		copilotCollapsed?: boolean;
	}

	let { projectId: _projectId, store: tripleStore, copilotCollapsed = $bindable(true) }: Props = $props();

	// Capture the store reference once — it does not change over the component lifetime
	const store = untrack(() => tripleStore);

	// --- TripleStore setup ---
	const translator = new TripleTranslator();
	const view = new StateDataView();

	// If the store is empty (first time), initialize with default data
	if (store.getAll().length === 0) {
		const defaultState = createDefaultStateData();
		const initialTriples = translator.stateDataToTriples(defaultState);
		store.batchInsert(initialTriples);
	}

	// Reactive materialized view
	let stateData: StateData = $state(view.materializeAndSubscribe(store));

	view.onChange = (newState: StateData) => {
		stateData = newState;
	};

	onDestroy(() => {
		view.dispose();
		// Do NOT close the store — its lifecycle is managed by the bridge
	});

	// --- UI state ---
	let activeTab: string = $state('dashboard');

	function applyOps(ops: TripleOperation[]) {
		applyOperationsToStore(store, ops);
	}

	function navigateTab(tab: string) {
		activeTab = tab;
	}

	// --- Context ---
	const ctx: WorldEditorContext = {
		get projectId() {
			return _projectId;
		},
		get store() {
			return store;
		},
		get translator() {
			return translator;
		},
		get view() {
			return view;
		},
		get stateData() {
			return stateData;
		},
		applyOps,
		navigateTab
	};
	setWorldEditorContext(ctx);
</script>

<div class="world-editor flex-1 h-full flex flex-col overflow-hidden relative">
	<EditorTabs {activeTab} onTabChange={navigateTab} />

	<div class="flex-1 overflow-hidden flex flex-col pl-14 pr-14">
		{#if activeTab === 'dashboard'}
			<DashboardPanel />
		{:else if activeTab === 'world'}
			<WorldPanel />
		{:else if activeTab === 'characters'}
			<CharactersPanel />
		{:else if activeTab === 'regions'}
			<RegionsPanel />
		{:else if activeTab === 'organizations'}
			<OrganizationsPanel />
		{:else if activeTab === 'story'}
			<StoryPanel />
		{:else if activeTab === 'wiki'}
			<WikiPanel />
		{/if}
	</div>

	<WorldEditorCopilotPanel bind:collapsed={copilotCollapsed} hideCollapsedButton={true} />
</div>
