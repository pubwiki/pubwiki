<script lang="ts">
	/**
	 * SandboxPreviewView - Floating panel for sandbox preview
	 * 
	 * This is the expanded view for sandbox preview, rendered as a portal.
	 * Supports custom services from connected Loader nodes via Lua VM bridge.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { SandboxConnection, ProjectConfig, ConsoleLogEntry } from '@pubwiki/sandbox-host';
	import { createSandboxConnection } from '@pubwiki/sandbox-host';
	import type { VersionedVfs } from '$lib/vfs';
	import type { LoaderNodeData } from '$lib/types';
	import { createLoaderServices } from '$lib/sandbox';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	/**
	 * Connected Loader node info (id + data)
	 * Note: registeredServices is now in LoaderNode local state, not persisted.
	 * Use LoaderInterface.listServices() to get services dynamically.
	 */
	interface LoaderNodeInfo {
		id: string;
		data: LoaderNodeData;
	}

	interface Props {
		vfs: VersionedVfs;
		projectConfig: ProjectConfig;
		sandboxOrigin: string;
		entryFile: string;
		name: string;
		loaderNodes?: LoaderNodeInfo[];
		onClose: () => void;
	}

	let {
		vfs,
		projectConfig,
		sandboxOrigin,
		entryFile,
		name,
		loaderNodes = [],
		onClose
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let sandboxConnection = $state<SandboxConnection | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isFullscreen = $state(false);
	
	// Console log state
	let showConsole = $state(false);
	let consoleLogs = $state<ConsoleLogEntry[]>([]);
	let hasNewErrors = $state(false);

	// ============================================================================
	// Derived
	// ============================================================================
	
	const errorCount = $derived(consoleLogs.filter(l => l.level === 'error').length);
	const warnCount = $derived(consoleLogs.filter(l => l.level === 'warn').length);

	const sandboxUrl = $derived(`${sandboxOrigin}/__sandbox.html`);

	// ============================================================================
	// Portal action
	// ============================================================================

	function portal(node: HTMLElement) {
		const target = document.body;
		target.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === target) {
					target.removeChild(node);
				}
			}
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	onMount(() => {
		// Start sandbox after iframe is mounted
		startSandbox();
	});

	onDestroy(() => {
		stopSandbox();
	});

	// ============================================================================
	// Console Log Handling
	// ============================================================================
	
	function handleLog(entry: ConsoleLogEntry) {
		consoleLogs = [...consoleLogs, entry];
		// Show indicator for new errors
		if (entry.level === 'error' && !showConsole) {
			hasNewErrors = true;
		}
	}
	
	function toggleConsole() {
		showConsole = !showConsole;
		if (showConsole) {
			hasNewErrors = false;
		}
	}
	
	function clearConsoleLogs() {
		consoleLogs = [];
		sandboxConnection?.clearLogs();
		hasNewErrors = false;
	}
	
	function getLogLevelColor(level: ConsoleLogEntry['level']): string {
		switch (level) {
			case 'error': return 'text-red-400';
			case 'warn': return 'text-yellow-400';
			case 'info': return 'text-blue-400';
			case 'debug': return 'text-gray-400';
			default: return 'text-gray-200';
		}
	}
	
	function getLogLevelIcon(level: ConsoleLogEntry['level']): string {
		switch (level) {
			case 'error': return '✕';
			case 'warn': return '⚠';
			case 'info': return 'ℹ';
			case 'debug': return '🐛';
			default: return '›';
		}
	}

	// ============================================================================
	// Sandbox Lifecycle
	// ============================================================================

	async function startSandbox() {
		if (!iframeRef) {
			error = 'Iframe not ready';
			isLoading = false;
			return;
		}

		try {
			isLoading = true;
			error = null;

			// Collect custom services from connected Loader nodes
			const loaderNodeIds = loaderNodes.map(l => l.id);
			const customServices = loaderNodeIds.length > 0 ? await createLoaderServices(loaderNodeIds) : undefined;

			// Create sandbox connection - it will auto-initialize when sandbox sends SANDBOX_READY
			sandboxConnection = createSandboxConnection({
				iframe: iframeRef,
				basePath: '/',
				projectConfig,
				targetOrigin: sandboxOrigin,
				entryFile,
				vfs,
				customServices,
				onLog: handleLog
			});

			// Wait for sandbox to be ready and initialized
			const success = await sandboxConnection.waitForReady();
			
			if (!success) {
				throw new Error('Failed to initialize sandbox connection');
			}
			
			// Load any existing logs
			consoleLogs = sandboxConnection.getLogs();

			console.log('[SandboxPreviewView] Sandbox started successfully');

		} catch (err) {
			console.error('[SandboxPreviewView] Failed to start sandbox:', err);
			error = err instanceof Error ? err.message : 'Failed to start sandbox';
			sandboxConnection?.disconnect();
			sandboxConnection = null;
		} finally {
			isLoading = false;
		}
	}

	function stopSandbox() {
		if (sandboxConnection) {
			sandboxConnection.disconnect();
			sandboxConnection = null;
		}
		console.log('[SandboxPreviewView] Sandbox stopped');
	}

	function reloadSandbox() {
		if (sandboxConnection) {
			sandboxConnection.reload();
			console.log('[SandboxPreviewView] Sandbox reloaded');
		}
	}

	function handleClose() {
		stopSandbox();
		onClose();
	}

	function toggleFullscreen() {
		isFullscreen = !isFullscreen;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isFullscreen) {
			event.preventDefault();
			isFullscreen = false;
		}
	}
</script>

<!-- Floating Preview Panel -->
<svelte:window onkeydown={handleKeydown} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	use:portal
	class="fixed inset-0 bg-black/40 z-9999 flex items-center justify-center"
	transition:fade={{ duration: 150 }}
	onclick={isFullscreen ? undefined : handleClose}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="bg-white shadow-2xl flex flex-col overflow-hidden transition-all duration-200"
		class:rounded-xl={!isFullscreen}
		class:inset-0={isFullscreen}
		class:fixed={isFullscreen}
		style={isFullscreen ? '' : 'width: 900px; height: 600px;'}
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header (hidden in fullscreen) -->
		{#if !isFullscreen}
		<div class="flex items-center justify-between px-4 py-3 bg-orange-500 text-white">
			<div class="flex items-center gap-3">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
				</svg>
				<span class="font-medium">{name || m.studio_node_sandbox_preview()}</span>
				{#if isLoading}
					<span class="text-xs bg-white/20 px-2 py-0.5 rounded">{m.studio_node_loading()}</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<!-- Fullscreen button -->
				<button
					class="p-1.5 hover:bg-white/20 rounded transition-colors"
					onclick={toggleFullscreen}
					title={m.studio_node_fullscreen()}
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
					</svg>
				</button>
				<!-- Reload button -->
				<button
					class="p-1.5 hover:bg-white/20 rounded transition-colors disabled:opacity-50"
					onclick={reloadSandbox}
					disabled={isLoading || !!error}
					title={m.studio_node_reload()}
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				</button>
				<!-- Console button -->
				<button
					class="p-1.5 hover:bg-white/20 rounded transition-colors relative"
					onclick={toggleConsole}
					title="Console"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
					</svg>
					{#if errorCount > 0}
						<span class="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
							{errorCount > 9 ? '9+' : errorCount}
						</span>
					{:else if warnCount > 0}
						<span class="absolute -top-1 -right-1 bg-yellow-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
							{warnCount > 9 ? '9+' : warnCount}
						</span>
					{:else if hasNewErrors}
						<span class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"></span>
					{/if}
				</button>
				<!-- Close button -->
				<button
					class="p-1.5 hover:bg-white/20 rounded transition-colors"
					onclick={handleClose}
					title={m.studio_node_close()}
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>
		{/if}

		<!-- Content -->
		<div class="flex-1 relative bg-gray-100">
			{#if isLoading}
				<!-- Loading state -->
				<div class="absolute inset-0 flex flex-col items-center justify-center bg-white">
					<svg class="w-10 h-10 animate-spin text-orange-500 mb-3" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="text-gray-600">{m.studio_node_starting_sandbox()}</p>
					<p class="text-sm text-gray-400 mt-1">{m.studio_node_entry({ entryFile })}</p>
				</div>
			{:else if error}
				<!-- Error state -->
				<div class="absolute inset-0 flex flex-col items-center justify-center bg-red-50">
					<svg class="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<p class="text-red-600 font-medium">{error}</p>
					<button
						class="mt-4 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
						onclick={startSandbox}
					>
						{m.studio_node_retry()}
					</button>
				</div>
			{/if}
			
			<!-- Sandbox iframe -->
			<iframe
				bind:this={iframeRef}
				src={sandboxUrl}
				class="absolute inset-0 w-full h-full border-0 {isLoading || error ? 'invisible' : 'visible'}"
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
				allow="clipboard-read; clipboard-write"
				title={m.studio_node_sandbox_preview()}
			></iframe>
		</div>

		<!-- Console Panel -->
		{#if showConsole}
		<div class="border-t border-gray-200 bg-gray-900 text-white flex flex-col" style="height: 200px; max-height: 50%;">
			<!-- Console Header -->
			<div class="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
				<div class="flex items-center gap-3 text-xs">
					<span class="font-medium">Console</span>
					{#if errorCount > 0}
						<span class="text-red-400">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
					{/if}
					{#if warnCount > 0}
						<span class="text-yellow-400">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>
					{/if}
				</div>
				<div class="flex items-center gap-1">
					<button
						class="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
						onclick={clearConsoleLogs}
						title="Clear console"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
						</svg>
					</button>
					<button
						class="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
						onclick={toggleConsole}
						title="Close console"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>
			<!-- Console Content -->
			<div class="flex-1 overflow-auto font-mono text-xs">
				{#if consoleLogs.length === 0}
					<div class="flex items-center justify-center h-full text-gray-500">
						No console output
					</div>
				{:else}
					{#each consoleLogs as entry, i (i)}
						<div class="px-3 py-1 border-b border-gray-800 hover:bg-gray-800/50 {getLogLevelColor(entry.level)}">
							<div class="flex items-start gap-2">
								<span class="flex-shrink-0 mt-0.5">{@html getLogLevelIcon(entry.level)}</span>
								<div class="flex-1 min-w-0">
									<pre class="whitespace-pre-wrap break-words">{entry.message}</pre>
									{#if entry.stack}
										<pre class="text-gray-500 text-[10px] mt-1 whitespace-pre-wrap break-words">{entry.stack}</pre>
									{/if}
								</div>
								<span class="flex-shrink-0 text-gray-600 text-[10px]">
									{new Date(entry.timestamp).toLocaleTimeString()}
								</span>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
		{/if}

		<!-- Footer (hidden in fullscreen) -->
		{#if !isFullscreen}
		<div class="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
			<span>{m.studio_node_entry({ entryFile })}</span>
			<span>{m.studio_node_origin({ origin: sandboxOrigin })}</span>
		</div>
		{/if}
	</div>
</div>
