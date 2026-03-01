<script lang="ts">
	/**
	 * SaveStatusIndicator - Compact local + cloud save status badges
	 *
	 * Displays inline next to the project name in the sidebar header.
	 * Shows two small badges with smooth fade transitions:
	 * 1. Local save status: reads from global SaveTracker (no prop needed)
	 * 2. Cloud sync status: clickable — opens a tooltip popover to enable/sync
	 */
	import { fade } from 'svelte/transition';
	import type { DraftSyncState } from '$lib/sync';
	import { getSaveStatus } from '$lib/persistence/save-tracker.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		syncState: DraftSyncState;
		isAuthenticated: boolean;
		onSync?: () => void;
		onEnableSync?: () => void;
	}

	let { syncState, isAuthenticated, onSync, onEnableSync }: Props = $props();

	// Local save status: from global tracker
	let localStatus = $derived(getSaveStatus());

	// Cloud status derived from sync state
	let cloudStatus = $derived.by(() => {
		if (!isAuthenticated) return 'disabled' as const;
		if (!syncState.enabled) return 'disabled' as const;
		if (syncState.status === 'syncing') return 'syncing' as const;
		if (syncState.status === 'error') return 'error' as const;
		if (syncState.status === 'conflict') return 'conflict' as const;
		if (syncState.hasUnsyncedChanges || syncState.hasVfsChanges) return 'unsynced' as const;
		return 'synced' as const;
	});

	// Tooltip text
	let localTooltip = $derived(
		localStatus === 'saved' ? m.save_status_saved()
		: localStatus === 'saving' ? m.save_status_saving()
		: m.save_status_unsaved()
	);

	let cloudTooltip = $derived.by(() => {
		if (!isAuthenticated) return m.sync_sign_in_required();
		if (!syncState.enabled) return m.sync_not_enabled();
		switch (cloudStatus) {
			case 'syncing': return m.sync_syncing();
			case 'error': return m.sync_error();
			case 'conflict': return m.sync_conflict();
			case 'unsynced': return m.sync_unsynced();
			case 'synced': return m.sync_synced();
			default: return m.sync_not_enabled();
		}
	});

	const FADE_MS = 150;

	// Popover state for cloud icon
	let popoverOpen = $state(false);
	let popoverAnchor: HTMLElement | undefined = $state();

	function handleCloudClick(e: MouseEvent) {
		e.stopPropagation();
		if (!isAuthenticated) return;

		// If sync is enabled and there are changes, directly sync
		if (syncState.enabled && (syncState.hasUnsyncedChanges || syncState.hasVfsChanges || syncState.status === 'error')) {
			onSync?.();
			return;
		}

		// Otherwise toggle popover
		popoverOpen = !popoverOpen;
	}

	function handleEnableClick() {
		popoverOpen = false;
		onEnableSync?.();
	}

	// Close popover on outside click
	function handleWindowClick() {
		if (popoverOpen) popoverOpen = false;
	}
</script>

<svelte:window onclick={handleWindowClick} />

<div class="flex items-center gap-1.5">
	<!-- Local save status -->
	<span class="relative flex items-center justify-center w-3 h-3" title={localTooltip}>
		{#key localStatus}
			<span class="absolute inset-0 flex items-center justify-center" in:fade={{ duration: FADE_MS, delay: FADE_MS }} out:fade={{ duration: FADE_MS }}>
				{#if localStatus === 'saving'}
					<svg class="w-3 h-3 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else if localStatus === 'unsaved'}
					<span class="w-2 h-2 rounded-full" style="background-color: rgb(245 158 11);"></span>
				{:else}
					<svg class="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
					</svg>
				{/if}
			</span>
		{/key}
	</span>

	<!-- Separator -->
	<span class="w-px h-3" style="background-color: rgb(209 213 219);"></span>

	<!-- Cloud sync status (clickable) -->
	<div class="relative" bind:this={popoverAnchor}>
		<button
			class="flex items-center justify-center w-3.5 h-3.5 {isAuthenticated ? 'cursor-pointer' : ''} bg-transparent border-0 p-0"
			title={cloudTooltip}
			onclick={handleCloudClick}
			type="button"
			disabled={!isAuthenticated}
		>
			{#key cloudStatus}
				<span class="absolute inset-0 flex items-center justify-center" in:fade={{ duration: FADE_MS, delay: FADE_MS }} out:fade={{ duration: FADE_MS }}>
					{#if cloudStatus === 'syncing'}
						<svg class="w-3.5 h-3.5 text-blue-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					{:else if cloudStatus === 'synced'}
						<svg class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4" />
						</svg>
					{:else if cloudStatus === 'unsynced'}
						<svg class="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01" />
						</svg>
					{:else if cloudStatus === 'error'}
						<svg class="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l4-4m0 4l-4-4" />
						</svg>
					{:else if cloudStatus === 'conflict'}
						<svg class="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01" />
						</svg>
					{:else}
						<svg class="w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
						</svg>
					{/if}
				</span>
			{/key}
		</button>

		<!-- Tooltip popover -->
		{#if popoverOpen}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => { if (e.key === 'Escape') popoverOpen = false; }}
				transition:fade={{ duration: 100 }}
			>
				<!-- Arrow -->
				<div class="w-2 h-2 bg-white border-l border-t border-gray-200 rotate-45 absolute -top-1 left-1/2 -translate-x-1/2"></div>
				<!-- Content -->
				<div class="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden whitespace-nowrap">
					{#if !syncState.enabled}
						<button
							class="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2"
							onclick={handleEnableClick}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
							</svg>
							{m.sync_enable_cloud()}
						</button>
					{:else}
						<button
							class="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2"
							onclick={() => { popoverOpen = false; onSync?.(); }}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							{m.sync_now()}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
