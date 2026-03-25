<script lang="ts">
	/**
	 * StudioSidebar - Left side collapsible floating panel
	 * 
	 * Features:
	 * - Collapsible to a project name badge at the top
	 * - Three tabs: Overview, Properties, Project
	 * - Float above the flow editor
	 * - Project menu with settings, project list, etc.
	 * - Cloud sync status indicator
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { FlowNodeData } from '$lib/types/flow';
	import type { PublishMetadata } from '$lib/io';
	import type { UpdateMetadata } from './ProjectTab.svelte';
	import type { DraftSyncState } from '$lib/sync';
	import type { PublishStateService } from '$lib/state/publish-state.svelte';
	import OverviewTab from './OverviewTab.svelte';
	import PropertiesTab from './PropertiesTab.svelte';
	import ProjectTab from './ProjectTab.svelte';
	import ProjectMenu from './ProjectMenu.svelte';
	import ProjectListModal from './ProjectListModal.svelte';
	import SaveStatusIndicator from './SaveStatusIndicator.svelte';
	import { SettingsModal } from '../settings';
	import { persist } from '@pubwiki/ui/utils';
	import { getSaveStatus } from '$lib/persistence/save-tracker.svelte';
	import * as m from '$lib/paraglide/messages';

	export type EditorMode = 'expert' | 'simple';

	interface Props {
		nodes: Node<FlowNodeData>[];
		edges: Edge[];
		selectedNodes: Node<FlowNodeData>[];
		projectId: string;
		projectName: string;
		publishState: PublishStateService;
		isAuthenticated: boolean;
		onFocusNode: (node: Node<FlowNodeData>) => void;
		onPublish: (metadata: PublishMetadata, nodes: Node<FlowNodeData>[], edges: Edge[], buildCacheKey?: string) => Promise<void>;
		/** Called for incremental update (PATCH) of an already-published artifact */
		onUpdate: (metadata: UpdateMetadata, nodes: Node<FlowNodeData>[], edges: Edge[], buildCacheKey?: string) => Promise<void>;
		onOpenVfsFile?: (nodeId: string, filePath: string) => void;
		onNewProject: () => void;
		onExport: () => void;
		onImport: () => Promise<void>;
		// Sync props
		syncState?: DraftSyncState;
		onSync?: () => void;
		onEnableSync?: () => void;
		/** Called when user chooses to accept cloud state (discard local divergence) */
		onAcceptCloud?: () => void;
		/** Called when user chooses to force push local state to cloud */
		onForcePushLocal?: () => void;
		// Build cache
		selectedEntrypoint?: string | null;
		onEntrypointChange?: (sandboxNodeId: string | null) => void;
		// Copilot props
		/** Whether copilot panel is open */
		copilotOpen?: boolean;
		/** Callback to toggle copilot panel */
		onCopilotToggle?: () => void;
		/** Called when user edits the project name in ProjectTab */
		onNameChange?: (name: string) => void;
		// Editor mode
		/** Current editor mode */
		editorMode?: EditorMode;
		/** Called when user toggles editor mode */
		onModeChange?: (mode: EditorMode) => void;
	}

	let { 
		nodes, 
		edges, 
		selectedNodes, 
		projectId, 
		projectName,
		publishState,
		isAuthenticated,
		onFocusNode,
		onPublish,
		onUpdate,
		onOpenVfsFile,
		onNewProject,
		onExport,
		onImport,
		syncState,
		onSync,
		onEnableSync,
		onAcceptCloud: _onAcceptCloud,
		onForcePushLocal: _onForcePushLocal,
		selectedEntrypoint = null,
		onEntrypointChange,
		copilotOpen = false,
		onCopilotToggle,
		onNameChange,
		editorMode = 'expert',
		onModeChange,
	}: Props = $props();

	// Default sync state if not provided
	const defaultSyncState: DraftSyncState = {
		status: 'idle',
		hasUnsyncedChanges: false,
		hasVfsChanges: false,
		lastSyncedAt: null,
		lastSyncedCommit: null,
		error: null,
		enabled: false,
		backendValidated: false,
		diverged: undefined
	};
	
	let effectiveSyncState = $derived(syncState ?? defaultSyncState);

	// Collapsed ear status derivations
	let earLocalStatus = $derived(getSaveStatus());
	let earCloudStatus = $derived.by(() => {
		if (!isAuthenticated) return 'disabled' as const;
		if (!effectiveSyncState.enabled) return 'disabled' as const;
		if (effectiveSyncState.status === 'syncing') return 'syncing' as const;
		if (effectiveSyncState.status === 'error') return 'error' as const;
		if (effectiveSyncState.hasUnsyncedChanges || effectiveSyncState.hasVfsChanges) return 'unsynced' as const;
		return 'synced' as const;
	});

	// Sidebar state
	let collapsed = $state(false);
	let activeTab = $state<'overview' | 'properties' | 'project'>('overview');
	let sidebarEl: HTMLDivElement | undefined = $state();
	let showSettings = $state(false);
	let showProjectList = $state(false);

	// Resize state
	const MIN_WIDTH = 320;
	const MAX_WIDTH = 600;
	const DEFAULT_WIDTH = 360;
	const persistedWidth = persist<number>('studio-sidebar-width', DEFAULT_WIDTH);
	let isResizing = $state(false);

	// Getter/setter for sidebarWidth that syncs with persisted storage
	let sidebarWidth = $derived(persistedWidth.value);

	function startResize(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		isResizing = true;
		const startX = e.clientX;
		const startWidth = sidebarWidth;

		const target = e.target as HTMLElement;
		target.setPointerCapture(e.pointerId);

		function onPointerMove(e: PointerEvent) {
			const delta = e.clientX - startX;
			const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
			persistedWidth.value = newWidth;
		}

		function onPointerUp(e: PointerEvent) {
			isResizing = false;
			target.releasePointerCapture(e.pointerId);
			target.removeEventListener('pointermove', onPointerMove);
			target.removeEventListener('pointerup', onPointerUp);
		}

		target.addEventListener('pointermove', onPointerMove);
		target.addEventListener('pointerup', onPointerUp);
	}

	// Auto-switch to properties tab when selecting a single node
	$effect(() => {
		if (selectedNodes.length === 1) {
			activeTab = 'properties';
		}
	});

	function toggle() {
		collapsed = !collapsed;
	}

	function openSettings() {
		showSettings = true;
	}

	function closeSettings() {
		showSettings = false;
	}

	function openProjectList() {
		showProjectList = true;
	}

	function closeProjectList() {
		showProjectList = false;
	}

	const tabs = [
		{ id: 'overview' as const, label: m.studio_overview_tab(), icon: 'grid' },
		{ id: 'properties' as const, label: m.studio_properties_tab(), icon: 'settings' },
		{ id: 'project' as const, label: m.studio_project_tab(), icon: 'folder' }
	];

	// In simple mode, only show the Project tab
	let visibleTabs = $derived(
		editorMode === 'simple'
			? tabs.filter(t => t.id === 'project')
			: tabs
	);

	// When switching to simple mode, force activeTab to 'project'
	$effect(() => {
		if (editorMode === 'simple' && activeTab !== 'project') {
			activeTab = 'project';
		}
	});
</script>

<!-- Collapsed Ear (top-left page edge) -->
{#if collapsed}
	<div class="absolute left-0 top-4 z-30 flex flex-col items-center gap-2.5 py-3 px-1.5 bg-white border border-l-0 border-gray-200 rounded-r-xl shadow-md">
		<!-- Sync status indicators (vertical) -->
		<div class="flex flex-col items-center gap-2">
			<!-- Local save -->
			<span class="flex items-center justify-center w-5 h-5" title={earLocalStatus === 'saved' ? m.save_status_saved() : earLocalStatus === 'saving' ? m.save_status_saving() : m.save_status_unsaved()}>
				{#if earLocalStatus === 'saving'}
					<svg class="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else if earLocalStatus === 'unsaved'}
					<span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
				{:else}
					<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
					</svg>
				{/if}
			</span>
			<!-- Cloud sync -->
			<span class="flex items-center justify-center w-5 h-5" title={earCloudStatus === 'synced' ? m.sync_synced() : earCloudStatus === 'syncing' ? m.sync_syncing() : earCloudStatus === 'unsynced' ? m.sync_unsynced() : earCloudStatus === 'error' ? m.sync_error() : m.sync_not_enabled()}>
				{#if earCloudStatus === 'syncing'}
					<svg class="w-4 h-4 text-blue-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				{:else if earCloudStatus === 'synced'}
					<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4" />
					</svg>
				{:else if earCloudStatus === 'unsynced'}
					<svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01" />
					</svg>
				{:else if earCloudStatus === 'error'}
					<svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l4-4m0 4l-4-4" />
					</svg>
				{:else}
					<svg class="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
					</svg>
				{/if}
			</span>
		</div>

		<!-- Separator -->
		<div class="w-5 h-px bg-gray-200"></div>

		<!-- Copilot button -->
		{#if onCopilotToggle}
			<button
				class="p-1 rounded transition-colors {copilotOpen ? 'text-purple-600 bg-purple-50 hover:bg-purple-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}"
				onclick={onCopilotToggle}
				title="Copilot"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
				</svg>
			</button>
		{/if}

		<!-- Expand button -->
		<button
			class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
			onclick={toggle}
			title={m.studio_expand_panel()}
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
			</svg>
		</button>
	</div>
{/if}

<!-- Expanded Sidebar Panel -->
{#if !collapsed}
	<div 
		bind:this={sidebarEl}
		class="absolute top-4 left-4 bottom-4 z-20 bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col overflow-hidden"
		style="width: {sidebarWidth}px;"
		onpointerdown={(e) => {
			e.stopPropagation();
			// Only capture pointer for text selection (in textarea/input or text content)
			const target = e.target as HTMLElement;
			const isTextInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
			const isTextSelection = target.closest('.prose, .properties-textarea, [contenteditable]');
			if (sidebarEl && (isTextInput || isTextSelection)) {
				sidebarEl.setPointerCapture(e.pointerId);
			}
		}}
		onpointerup={(e) => {
			e.stopPropagation();
			if (sidebarEl && sidebarEl.hasPointerCapture(e.pointerId)) {
				sidebarEl.releasePointerCapture(e.pointerId);
			}
		}}
	>
		<!-- Resize Handle -->
		<div
			class="group absolute top-1/2 -translate-y-1/2 -right-1 w-2 h-12 cursor-ew-resize z-10 flex items-center justify-center"
			onpointerdown={startResize}
			role="separator"
			aria-orientation="vertical"
			aria-valuenow={sidebarWidth}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
		>
			<!-- Visual indicator line -->
			<div class="w-0.5 h-8 rounded-full transition-all duration-150 {isResizing ? 'bg-blue-500 h-10 opacity-100' : 'bg-gray-400 opacity-0 group-hover:opacity-100 group-hover:h-10'}"></div>
		</div>
		<!-- Header with project name, save status, and action buttons -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
			<div class="flex items-center gap-2 min-w-0">
				<svg class="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
				<span class="font-medium text-gray-700 truncate">{projectName || m.studio_untitled_project()}</span>
				{#if !publishState.state.isDraft}
					<span class="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">{m.studio_published()}</span>
				{/if}
				<SaveStatusIndicator
					syncState={effectiveSyncState}
					{isAuthenticated}
					{onSync}
					{onEnableSync}
				/>
			</div>
			<div class="flex items-center gap-1">
				<!-- Copilot button -->
				{#if onCopilotToggle}
					<button
						class="p-1 rounded transition-colors {copilotOpen ? 'text-purple-600 bg-purple-50 hover:bg-purple-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}"
						onclick={onCopilotToggle}
						title="Copilot"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					</button>
				{/if}
				<!-- Project Menu -->
				<ProjectMenu
					onNewProject={onNewProject}
					onOpenProjectList={openProjectList}
					onOpenSettings={openSettings}
					onExport={onExport}
					onImport={onImport}
					{editorMode}
					{onModeChange}
				/>
				<!-- Collapse button -->
				<button
					class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
					onclick={toggle}
					title={m.studio_collapse_panel()}
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Tab Navigation (hidden in simple mode since only Project tab exists) -->
		{#if editorMode !== 'simple'}
			<div class="flex border-b border-gray-200 bg-white">
				{#each visibleTabs as tab (tab.id)}
					<button
						class="flex-1 px-3 py-2.5 text-sm font-medium transition-colors relative
							{activeTab === tab.id 
								? 'text-blue-600' 
								: 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}"
						onclick={() => activeTab = tab.id}
					>
						{tab.label}
						{#if activeTab === tab.id}
							<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Tab Content -->
		<div class="flex-1 overflow-hidden">
			{#if activeTab === 'overview'}
				<OverviewTab {nodes} {edges} {onFocusNode} />
			{:else if activeTab === 'properties'}
				<PropertiesTab {selectedNodes} {projectId} {onOpenVfsFile} />
			{:else if activeTab === 'project'}
				<ProjectTab 
					{nodes} 
					{edges} 
					{projectId}
					{projectName}
					{publishState}
					{isAuthenticated}
					{onPublish}
					{onUpdate}
					{onNameChange}
					syncState={effectiveSyncState}
					{onSync}
					{onEnableSync}
					{selectedEntrypoint}
					{onEntrypointChange}
				/>
			{/if}
		</div>
	</div>
{/if}

<!-- Settings Modal -->
{#if showSettings}
	<SettingsModal onClose={closeSettings} />
{/if}

<!-- Project List Modal -->
{#if showProjectList}
	<ProjectListModal currentProjectId={projectId} onClose={closeProjectList} />
{/if}
