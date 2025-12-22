<script lang="ts">
	/**
	 * SandboxPreviewView - Floating panel for sandbox preview
	 * 
	 * This is the expanded view for sandbox preview, rendered as a portal.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { SandboxConnection, ProjectConfig } from '@pubwiki/sandbox-host';
	import { createSandboxConnection } from '@pubwiki/sandbox-host';
	import type { VersionedVfs } from '../../stores/vfs';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		vfs: VersionedVfs;
		projectConfig: ProjectConfig;
		sandboxOrigin: string;
		entryFile: string;
		name: string;
		onClose: () => void;
	}

	let {
		vfs,
		projectConfig,
		sandboxOrigin,
		entryFile,
		name,
		onClose
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let sandboxConnection = $state<SandboxConnection | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// ============================================================================
	// Derived
	// ============================================================================

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

			// Create sandbox connection - it will auto-initialize when sandbox sends SANDBOX_READY
			sandboxConnection = createSandboxConnection({
				iframe: iframeRef,
				basePath: '/',
				projectConfig,
				targetOrigin: sandboxOrigin,
				entryFile,
				vfs
			});

			// Wait for sandbox to be ready and initialized
			const success = await sandboxConnection.waitForReady();
			
			if (!success) {
				throw new Error('Failed to initialize sandbox connection');
			}

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
</script>

<!-- Floating Preview Panel -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	use:portal
	class="fixed inset-0 bg-black/40 z-9999 flex items-center justify-center"
	transition:fade={{ duration: 150 }}
	onclick={handleClose}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
		style="width: 900px; height: 600px;"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 bg-orange-500 text-white">
			<div class="flex items-center gap-3">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
				</svg>
				<span class="font-medium">{name || 'Sandbox Preview'}</span>
				{#if isLoading}
					<span class="text-xs bg-white/20 px-2 py-0.5 rounded">Loading...</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<!-- Reload button -->
				<button
					class="p-1.5 hover:bg-white/20 rounded transition-colors disabled:opacity-50"
					onclick={reloadSandbox}
					disabled={isLoading || !!error}
					title="Reload"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				</button>
				<!-- Close button -->
				<button
					class="p-1.5 hover:bg-white/20 rounded transition-colors"
					onclick={handleClose}
					title="Close"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Content -->
		<div class="flex-1 relative bg-gray-100">
			{#if isLoading}
				<!-- Loading state -->
				<div class="absolute inset-0 flex flex-col items-center justify-center bg-white">
					<svg class="w-10 h-10 animate-spin text-orange-500 mb-3" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="text-gray-600">Starting sandbox...</p>
					<p class="text-sm text-gray-400 mt-1">Entry: {entryFile}</p>
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
						Retry
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
				title="Sandbox Preview"
			></iframe>
		</div>

		<!-- Footer -->
		<div class="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
			<span>Entry: {entryFile}</span>
			<span>Origin: {sandboxOrigin}</span>
		</div>
	</div>
</div>
