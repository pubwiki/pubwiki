<script lang="ts">
	/**
	 * ProjectMenu - Dropdown menu for project management
	 * 
	 * Features:
	 * - New Project
	 * - Project List (opens modal)
	 * - Export to local file
	 * - Import from local file
	 * - Settings
	 */
	import { onMount, onDestroy } from 'svelte';
	import type { EditorMode } from './StudioSidebar.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		onNewProject: () => void;
		onOpenProjectList: () => void;
		onOpenSettings: () => void;
		onExport: () => void;
		onImport: () => void;
		editorMode?: EditorMode;
		onModeChange?: (mode: EditorMode) => void;
	}

	let { onNewProject, onOpenProjectList, onOpenSettings, onExport, onImport, editorMode = 'expert', onModeChange }: Props = $props();

	let isOpen = $state(false);
	let menuRef: HTMLDivElement | undefined = $state();
	let buttonRef: HTMLButtonElement | undefined = $state();

	function toggle() {
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	function handleClickOutside(event: MouseEvent) {
		if (menuRef && buttonRef && !menuRef.contains(event.target as Node) && !buttonRef.contains(event.target as Node)) {
			close();
		}
	}

	function handleNewProject() {
		onNewProject();
		close();
	}

	function handleProjectList() {
		onOpenProjectList();
		close();
	}

	function handleExport() {
		onExport();
		close();
	}

	function handleImport() {
		onImport();
		close();
	}

	function handleSettings() {
		onOpenSettings();
		close();
	}

	function handleModeSwitch() {
		onModeChange?.(editorMode === 'expert' ? 'simple' : 'expert');
		close();
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('click', handleClickOutside);
		}
	});
</script>

<div class="relative">
	<!-- Menu Button -->
	<button
		bind:this={buttonRef}
		class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
		onclick={toggle}
		title={m.studio_menu_project_list()}
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
		</svg>
	</button>

	<!-- Dropdown Menu -->
	{#if isOpen}
		<div
			bind:this={menuRef}
			class="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50"
		>
			<!-- New Project -->
			<button
				class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
				onclick={handleNewProject}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
				{m.studio_menu_new_project()}
			</button>

			<!-- Project List -->
			<button
				class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
				onclick={handleProjectList}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
				{m.studio_menu_project_list()}
			</button>

			<div class="border-t border-gray-200 my-1"></div>

			<!-- Export -->
			<button
				class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
				onclick={handleExport}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
				</svg>
				{m.studio_menu_export()}
			</button>

			<!-- Import -->
			<button
				class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
				onclick={handleImport}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
				</svg>
				{m.studio_menu_import()}
			</button>

			<div class="border-t border-gray-200 my-1"></div>

			<!-- Settings -->
			<button
				class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
				onclick={handleSettings}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				{m.studio_menu_settings()}
			</button>

			<!-- Mode Switch -->
			{#if onModeChange}
				<div class="border-t border-gray-200 my-1"></div>
				<button
					class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
					onclick={handleModeSwitch}
				>
					<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
					</svg>
					{editorMode === 'expert' ? m.studio_menu_switch_to_simple() : m.studio_menu_switch_to_expert()}
				</button>
			{/if}
		</div>
	{/if}
</div>
