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
	import type { DraftSyncState } from '$lib/sync';
	import OverviewTab from './OverviewTab.svelte';
	import PropertiesTab from './PropertiesTab.svelte';
	import ProjectTab from './ProjectTab.svelte';
	import ProjectMenu from './ProjectMenu.svelte';
	import ProjectListModal from './ProjectListModal.svelte';
	import SyncStatusIndicator from './SyncStatusIndicator.svelte';
	import { SettingsModal } from '../settings';
	import { persist } from '@pubwiki/ui/utils';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodes: Node<FlowNodeData>[];
		edges: Edge[];
		selectedNodes: Node<FlowNodeData>[];
		projectId: string;
		projectName: string;
		isDraft: boolean;
		isAuthenticated: boolean;
		/** Last cloud commit hash for version lineage tracking */
		lastCloudCommit?: string;
		onFocusNode: (node: Node<FlowNodeData>) => void;
		onPublish: (metadata: PublishMetadata, nodes: Node<FlowNodeData>[], edges: Edge[]) => Promise<void>;
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
		// Copilot props
		/** Whether copilot panel is open */
		copilotOpen?: boolean;
		/** Callback to toggle copilot panel */
		onCopilotToggle?: () => void;
	}

	let { 
		nodes, 
		edges, 
		selectedNodes, 
		projectId, 
		projectName,
		isDraft,
		isAuthenticated,
		lastCloudCommit,
		onFocusNode,
		onPublish,
		onOpenVfsFile,
		onNewProject,
		onExport,
		onImport,
		syncState,
		onSync,
		onEnableSync,
		onAcceptCloud,
		onForcePushLocal,
		copilotOpen = false,
		onCopilotToggle
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
</script>

<!-- Collapsed Badge (shown at top when collapsed) -->
{#if collapsed}
	<button
		class="absolute top-4 left-4 z-30 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
		onclick={toggle}
		title={m.studio_expand_panel()}
	>
		<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
		</svg>
		<span class="max-w-32 truncate">{projectName || m.studio_untitled_project()}</span>
		<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
		</svg>
	</button>
{/if}

<!-- Expanded Sidebar Panel -->
{#if !collapsed}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
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
		<!-- Header with project name, settings button, and collapse button -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
			<div class="flex items-center gap-2 min-w-0">
				<svg class="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
				<span class="font-medium text-gray-700 truncate">{projectName || m.studio_untitled_project()}</span>
				{#if !isDraft}
					<span class="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">{m.studio_published()}</span>
				{/if}
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

		<!-- Sync Status Indicator -->
		<div class="px-4 py-2 border-b border-gray-100 bg-white">
			<SyncStatusIndicator
				state={effectiveSyncState}
				{isAuthenticated}
				onSync={() => onSync?.()}
				onEnable={() => onEnableSync?.()}
				onAcceptCloud={onAcceptCloud ? () => onAcceptCloud?.() : undefined}
				onForcePushLocal={onForcePushLocal ? () => onForcePushLocal?.() : undefined}
			/>
		</div>

		<!-- Tab Navigation -->
		<div class="flex border-b border-gray-200 bg-white">
			{#each tabs as tab}
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
					{isDraft}
					{isAuthenticated}
					{lastCloudCommit}
					{onPublish}
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
