<script lang="ts">
	/**
	 * SyncStatusIndicator - Shows cloud sync status in sidebar header
	 * 
	 * Displays:
	 * - Sync status (synced, syncing, unsynced, error, conflict/diverged)
	 * - Last sync time
	 * - Sync button
	 * - Divergence resolution options
	 */
	import type { DraftSyncState, SyncStatus } from '$lib/sync';
	import { formatRelativeSyncTime } from '$lib/sync';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		state: DraftSyncState;
		isAuthenticated: boolean;
		onSync: () => void;
		onEnable: () => void;
		/** Called when user chooses to accept cloud state (discard local changes) */
		onAcceptCloud?: () => void;
		/** Called when user chooses to force push local state to cloud */
		onForcePushLocal?: () => void;
	}

	let { state, isAuthenticated, onSync, onEnable, onAcceptCloud, onForcePushLocal }: Props = $props();

	// Combined dirty state: either node changes or VFS file changes
	let hasAnyChanges = $derived(state.hasUnsyncedChanges || state.hasVfsChanges);

	// Status display configuration
	function getStatusConfig(status: SyncStatus, hasChanges: boolean, enabled: boolean) {
		if (!enabled) {
			return {
				icon: 'cloud-off',
				color: 'text-gray-400',
				bgColor: 'bg-gray-100',
				label: m.sync_not_enabled()
			};
		}
		
		switch (status) {
			case 'syncing':
				return {
					icon: 'sync',
					color: 'text-blue-600',
					bgColor: 'bg-blue-50',
					label: m.sync_syncing()
				};
			case 'success':
				if (hasChanges) {
					return {
						icon: 'cloud-alert',
						color: 'text-amber-600',
						bgColor: 'bg-amber-50',
						label: m.sync_unsynced()
					};
				}
				return {
					icon: 'cloud-check',
					color: 'text-green-600',
					bgColor: 'bg-green-50',
					label: m.sync_synced()
				};
			case 'error':
				return {
					icon: 'cloud-error',
					color: 'text-red-600',
					bgColor: 'bg-red-50',
					label: m.sync_error()
				};
			case 'conflict':
				return {
					icon: 'cloud-conflict',
					color: 'text-orange-600',
					bgColor: 'bg-orange-50',
					label: m.sync_conflict()
				};
			default: // idle
				if (hasChanges) {
					return {
						icon: 'cloud-alert',
						color: 'text-amber-600',
						bgColor: 'bg-amber-50',
						label: m.sync_unsynced()
					};
				}
				return {
					icon: 'cloud-check',
					color: 'text-green-600',
					bgColor: 'bg-green-50',
					label: m.sync_synced()
				};
		}
	}

	let config = $derived(getStatusConfig(state.status, hasAnyChanges, state.enabled));
	let showSyncButton = $derived(
		state.enabled && 
		(hasAnyChanges || state.status === 'error' || state.status === 'conflict')
	);
	let isSyncing = $derived(state.status === 'syncing');
</script>

{#if !isAuthenticated}
	<!-- Not authenticated - show sign in prompt -->
	<div class="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg">
		<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
		</svg>
		<span>{m.sync_sign_in_required()}</span>
	</div>
{:else if !state.enabled}
	<!-- Sync not enabled - show enable button -->
	<button
		onclick={onEnable}
		class="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
	>
		<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
		</svg>
		<span>{m.sync_enable_cloud()}</span>
	</button>
{:else}
	<!-- Sync enabled - show status -->
	<div class="flex items-center gap-2">
		<!-- Status badge -->
		<div class="flex items-center gap-1.5 px-2 py-1 rounded-lg {config.bgColor}">
			<!-- Icon -->
			{#if config.icon === 'sync'}
				<svg class="w-3.5 h-3.5 {config.color} animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
			{:else if config.icon === 'cloud-check'}
				<svg class="w-3.5 h-3.5 {config.color}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4" />
				</svg>
			{:else if config.icon === 'cloud-alert'}
				<svg class="w-3.5 h-3.5 {config.color}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01" />
				</svg>
			{:else if config.icon === 'cloud-error'}
				<svg class="w-3.5 h-3.5 {config.color}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l4-4m0 4l-4-4" />
				</svg>
			{:else if config.icon === 'cloud-conflict'}
				<svg class="w-3.5 h-3.5 {config.color}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01" />
				</svg>
			{:else}
				<svg class="w-3.5 h-3.5 {config.color}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
				</svg>
			{/if}
			
			<!-- Status text -->
			<span class="text-xs font-medium {config.color}">{config.label}</span>
		</div>

		<!-- Last sync time -->
		{#if state.lastSyncedAt && state.status !== 'syncing'}
			<span class="text-xs text-gray-400">
				{formatRelativeSyncTime(state.lastSyncedAt)}
			</span>
		{/if}

		<!-- Sync button -->
		{#if showSyncButton}
			<button
				onclick={onSync}
				disabled={isSyncing}
				class="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{m.sync_now()}
			</button>
		{/if}
	</div>
{/if}

<!-- Error tooltip -->
{#if state.error && (state.status === 'error' || state.status === 'conflict')}
	<div class="mt-1 px-2 py-1 text-xs text-red-600 bg-red-50 rounded">
		{state.error}
	</div>
{/if}

<!-- Divergence resolution UI -->
{#if state.diverged && (onAcceptCloud || onForcePushLocal)}
	<div class="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
		<p class="text-xs text-orange-700 mb-2">
			Local and cloud histories have diverged. Choose how to resolve:
		</p>
		<div class="flex gap-2">
			{#if onAcceptCloud}
				<button
					onclick={onAcceptCloud}
					class="flex-1 px-2 py-1 text-xs font-medium text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 rounded transition-colors"
				>
					Use Cloud
				</button>
			{/if}
			{#if onForcePushLocal}
				<button
					onclick={onForcePushLocal}
					class="flex-1 px-2 py-1 text-xs font-medium text-orange-600 bg-white border border-orange-200 hover:bg-orange-50 rounded transition-colors"
				>
					Push Local
				</button>
			{/if}
		</div>
	</div>
{/if}
