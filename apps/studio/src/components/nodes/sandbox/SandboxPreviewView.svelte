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
	import { createSandboxConnection, computeSandboxId, getSandboxOrigin } from '@pubwiki/sandbox-host';
	import { createBuildAwareVfs, getOpfsBuildCacheStorage } from '@pubwiki/bundler';
	import { computeBuildCacheKey } from '@pubwiki/api';
	import type { Vfs } from '@pubwiki/vfs';
	import type { NodeVfs } from '$lib/vfs';
	import type { LoaderNodeData } from '$lib/types';
	import { computeVfsContentHash } from '$lib/io';
	import { createLoaderServices } from '$lib/sandbox';
	import { ConsoleLogStore, createLogSession, formatLogFile, downloadLogFile } from '$lib/sandbox/console-log-db';
	import { page } from '$app/state';
	import { PUBLIC_SANDBOX_SITE_URL } from '$env/static/public';
	import VirtualConsoleList from './VirtualConsoleList.svelte';
	import * as Sentry from '@sentry/sveltekit';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	import type { SandboxConnectionLike } from '@pubwiki/world-editor';
	
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
		vfs: NodeVfs;
		projectConfig: ProjectConfig;
		entryFile: string;
		name: string;
		loaderNodes?: LoaderNodeInfo[];
		onClose: () => void;
		/** Project ID for build cache key computation (enables L1 OPFS cache) */
		projectId?: string;
		/** Connected VFS node ID for build cache key computation */
		vfsNodeId?: string;
		/** Callback when sandbox connection wrapper is established/disconnected */
		onSandboxConnection?: (connection: SandboxConnectionLike | null) => void;
	}

	let {
		vfs,
		projectConfig,
		entryFile,
		name,
		loaderNodes = [],
		onClose,
		projectId,
		vfsNodeId,
		onSandboxConnection,
	}: Props = $props();

	// ============================================================================
	// Constants
	// ============================================================================
	
	const DEFAULT_WIDTH = 900;
	const DEFAULT_HEIGHT = 600;
	const MIN_WIDTH = 400;
	const MIN_HEIGHT = 300;
	const MINIMIZED_WIDTH = 280;
	const MINIMIZED_HEIGHT = 28;
	const VIEWPORT_PADDING = 32;
	
	// Mobile breakpoint - force fullscreen below this width
	const MOBILE_BREAKPOINT = 768;

	// Clamp initial size to viewport
	function getInitialSize() {
		if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
		const maxW = window.innerWidth - VIEWPORT_PADDING * 2;
		const maxH = window.innerHeight - VIEWPORT_PADDING * 2;
		return {
			w: Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, maxW)),
			h: Math.max(MIN_HEIGHT, Math.min(DEFAULT_HEIGHT, maxH)),
		};
	}

	const initialSize = getInitialSize();

	// ============================================================================
	// State
	// ============================================================================

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let sandboxConnection = $state<SandboxConnection | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isFullscreen = $state(false);
	
	// Mobile view: force fullscreen, disable window controls
	let isMobileView = $state(false);
	
	// Console log state
	let showConsole = $state(false);
	let logStore = $state<ConsoleLogStore | null>(null);
	let consoleLogs = $state<ConsoleLogEntry[]>([]);
	let hasNewErrors = $state(false);
	
	// Build progress state
	let compilingMessage = $state<string | null>(null);
	let isCompiling = $derived(compilingMessage !== null);
	
	// BuildAwareVfs instance (manages build cache + compilation)
	let buildAwareVfs: (Vfs & { warmup(): Promise<void> }) | null = null;
	
	// Window state
	let isMinimized = $state(false);
	let windowWidth = $state(initialSize.w);
	let windowHeight = $state(initialSize.h);
	let windowX = $state((typeof window !== 'undefined' ? window.innerWidth : 1920) / 2 - initialSize.w / 2);
	let windowY = $state((typeof window !== 'undefined' ? window.innerHeight : 1080) / 2 - initialSize.h / 2);
	
	// Drag state
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let dragStartWindowX = 0;
	let dragStartWindowY = 0;
	
	// Resize state
	let isResizing = $state(false);
	let resizeDirection = '';
	let resizeStartX = 0;
	let resizeStartY = 0;
	let resizeStartWidth = 0;
	let resizeStartHeight = 0;
	let resizeStartWindowX = 0;
	let resizeStartWindowY = 0;

	// ============================================================================
	// Derived
	// ============================================================================
	
	const errorCount = $derived(logStore?.errorCount ?? 0);
	const warnCount = $derived(logStore?.warnCount ?? 0);

	// Deferred: set AFTER createSandboxConnection to avoid missing SANDBOX_READY
	let iframeSrc = $state<string | undefined>(undefined);

	// Track current sandbox path for restart recovery
	let currentSandboxPath = $state<string | undefined>(undefined);

	// Resolved sandbox origin (computed at start time)
	let resolvedSandboxOrigin = $state<string>('');

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
		// Check for mobile view
		isMobileView = window.innerWidth < MOBILE_BREAKPOINT;
		if (isMobileView) {
			isFullscreen = true;
		}
		
		// Start sandbox after iframe is mounted
		startSandbox();
	});

	onDestroy(() => {
		stopSandbox();
	});

	// ============================================================================
	// Console Log Handling
	// ============================================================================
	
	// Subscribers for live log events (used by verify_frontend tool)
	let logSubscribers = new Set<(entry: ConsoleLogEntry) => void>();
	// Subscribers for build error events
	let buildErrorSubscribers = new Set<(errors: string[]) => void>();
	// Last build errors for replay to late subscribers (set during warmup failure or onRebuild)
	let lastBuildErrors: string[] | null = null;
	
	function handleLog(entry: ConsoleLogEntry) {
		if (logStore) {
			logStore.push(entry);
			// Trigger Svelte reactivity by re-assigning the snapshot
			consoleLogs = logStore.logs as ConsoleLogEntry[];
		}
		// Show indicator for new errors
		if (entry.level === 'error' && !showConsole) {
			hasNewErrors = true;
		}
		// Notify subscribers
		for (const cb of logSubscribers) {
			try { cb(entry); } catch { /* ignore */ }
		}
	}
	
	function notifyBuildErrors(errors: string[]) {
		console.log(`[SandboxPreviewView] notifyBuildErrors called, ${errors.length} error(s), ${buildErrorSubscribers.size} subscriber(s)`);
		lastBuildErrors = errors;
		for (const cb of buildErrorSubscribers) {
			try { cb(errors); } catch { /* ignore */ }
		}
	}
	
	function clearBuildErrors() {
		console.log(`[SandboxPreviewView] clearBuildErrors called (had errors: ${!!lastBuildErrors})`);
		lastBuildErrors = null;
	}
	
	/** Create a SandboxConnectionLike wrapper that includes log/build subscriptions */
	function createConnectionWrapper(conn: SandboxConnection): SandboxConnectionLike {
		return {
			getLogs: () => conn.getLogs(),
			clearLogs: () => {
				conn.clearLogs();
				if (logStore) {
					logStore.clear();
					consoleLogs = [];
				}
			},
			reload: () => {
				console.log(`[SandboxPreviewView] ConnectionWrapper.reload() called`);
				clearBuildErrors();
				conn.reload();
			},
			onLog: (callback) => {
				logSubscribers.add(callback);
				return () => { logSubscribers.delete(callback); };
			},
			onBuildError: (callback) => {
				console.log(`[SandboxPreviewView] onBuildError subscribed, total subscribers=${buildErrorSubscribers.size + 1}`);
				buildErrorSubscribers.add(callback);
				return () => { buildErrorSubscribers.delete(callback); };
			},
			takeScreenshot: () => conn.takeScreenshot(),
		};
	}
	
	function toggleConsole() {
		showConsole = !showConsole;
		if (showConsole) {
			hasNewErrors = false;
		}
	}
	
	async function clearConsoleLogs() {
		if (logStore) {
			await logStore.clear();
			consoleLogs = [];
		}
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

	function downloadLogs() {
		if (consoleLogs.length === 0) return;
		const content = formatLogFile(consoleLogs);
		const filename = `sandbox-${name || 'console'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
		downloadLogFile(content, filename);
	}

	// ============================================================================
	// Sentry Upload
	// ============================================================================

	let showSentryConfirm = $state(false);
	let sentryUploading = $state(false);
	let sentryUploadDone = $state(false);

	function requestSentryUpload() {
		if (consoleLogs.length === 0) return;
		showSentryConfirm = true;
		sentryUploadDone = false;
	}

	async function confirmSentryUpload() {
		sentryUploading = true;
		try {
			const logContent = formatLogFile(consoleLogs);
			Sentry.withScope((scope) => {
				scope.addAttachment({
					filename: `sandbox-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`,
					data: logContent,
					contentType: 'text/plain',
				});
				Sentry.captureMessage('User uploaded sandbox console logs', 'info');
			});
			sentryUploadDone = true;
		} catch (err) {
			console.error('[SandboxPreview] Failed to upload logs to Sentry:', err);
			Sentry.captureException(err);
		} finally {
			sentryUploading = false;
		}
	}

	function closeSentryConfirm() {
		showSentryConfirm = false;
		sentryUploadDone = false;
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

			// Create a new log session for this sandbox instance
			const sessionName = new Date().toISOString().slice(0, 19).replace('T', ' ');
			const sessionId = await createLogSession(sessionName, page.params.id ?? '');
			logStore = new ConsoleLogStore(sessionId);
			consoleLogs = [];

			// Collect custom services from connected Loader nodes
			const loaderNodeIds = loaderNodes.map(l => l.id);
			const customServices = loaderNodeIds.length > 0 ? await createLoaderServices(loaderNodeIds) : undefined;

			// Compute buildCacheKey + contentHash so L1 (OPFS) cache is consulted
			let buildCacheKeyValue: string | undefined;
			let contentHashValue: string | undefined;
			if (projectId && vfsNodeId) {
				try {
					const contentHash = await computeVfsContentHash(projectId, vfsNodeId);
					contentHashValue = contentHash;
					buildCacheKeyValue = await computeBuildCacheKey({
						filesHash: contentHash,
						entryFiles: projectConfig.entryFiles,
					});
				} catch (err) {
					console.warn('[SandboxPreviewView] Failed to compute build cache key, L1 cache disabled:', err);
				}
			}

			// Create BuildAwareVfs with OPFS cache + transparent compilation
			const buildCacheStorage = getOpfsBuildCacheStorage();
			buildAwareVfs = createBuildAwareVfs({
				sourceVfs: vfs,
				projectConfig,
				buildCacheStorage,
				buildCacheKey: buildCacheKeyValue,
				filesHash: contentHashValue,
				// Development mode: dev CDN builds + NODE_ENV='development'
				bundleOptions: { development: true },
				// HMR: on file change, trigger sandbox reload
				onFileChange: (changedPath: string) => {
					console.log(`[SandboxPreviewView] File changed: ${changedPath}`);
					sandboxConnection?.reload();
				},
				// HMR: on rebuild, trigger sandbox reload so it picks up new files
				onRebuild: (result) => {
					if (!result.success) {
						sandboxConnection?.reload();
					}
				},
				// Build progress indicator
				onBuildProgress: (event) => {
					if (event.type === 'start') {
						compilingMessage = event.message || m.studio_sandbox_compiling_short();
					} else if (event.type === 'progress') {
						compilingMessage = event.message || compilingMessage;
					} else if (event.type === 'complete') {
						compilingMessage = null;
						// On-demand builds (triggered by reload) don't go through onRebuild.
						// Catch their failures here via the progress event.
						if (event.result && !event.result.success) {
							const allErrors = Array.from(event.result.outputs.values())
								.flatMap(output => output.errors);
							const errorMessages = allErrors.map(e => {
								const loc = e.file ? `${e.file}:${e.line}:${e.column}` : '';
								return loc ? `${loc}: ${e.message}` : e.message;
							});
							console.error(`[SandboxPreviewView] Build failed (via progress event) with ${allErrors.length} error(s)`);
							notifyBuildErrors(errorMessages);
						} else if (event.result?.success) {
							clearBuildErrors();
						}
					} else if (event.type === 'error') {
						compilingMessage = null;
					}
				},
			});

			// Compute per-instance sandbox origin for storage isolation
			const sandboxId = await computeSandboxId(projectId ?? 'dev', entryFile);
			resolvedSandboxOrigin = getSandboxOrigin(sandboxId, PUBLIC_SANDBOX_SITE_URL || undefined);

			// Create sandbox connection with BuildAwareVfs (transparent build output)
			sandboxConnection = createSandboxConnection({
				iframe: iframeRef,
				basePath: '/',
				projectConfig,
				targetOrigin: resolvedSandboxOrigin,
				entryFile,
				initialPath: currentSandboxPath,
				vfs: buildAwareVfs,
				customServices,
				onLog: handleLog,
				onUrlChange: (path) => {
					currentSandboxPath = path;
				}
			});

			// Warm up the build cache before opening the iframe so the SW can serve
			// compiled files instantly. Without this, the first module fetch would
			// block for the full esbuild compile duration (~25s), which causes
			// Chrome 130 to silently abort the module script request.
			// If warmup fails (build error), continue anyway — the sandbox connection
			// can still establish and the build error will be surfaced on reload
			// via onRebuild → notifyBuildErrors.
			try {
				await buildAwareVfs.warmup();
			} catch (warmupErr) {
				console.warn('[SandboxPreviewView] Build warmup failed (will retry on reload):', warmupErr);
				// Store the error so verify_frontend can see it immediately on subscription
				const errMsg = warmupErr instanceof Error ? warmupErr.message : String(warmupErr);
				notifyBuildErrors([errMsg]);
			}

			// Set iframe src AFTER createSandboxConnection to avoid missing SANDBOX_READY message
			iframeSrc = `${resolvedSandboxOrigin}/__sandbox.html`;

			// Wait for sandbox to be ready and initialized
			const success = await sandboxConnection.waitForReady();
			
			if (!success) {
				throw new Error('Failed to initialize sandbox connection');
			}
			
			// handleLog callback already captured all logs during initialization,
			// so no need to load from HMR service again.
			consoleLogs = logStore ? (logStore.logs as ConsoleLogEntry[]) : [];

			console.log('[SandboxPreviewView] Sandbox started successfully');
			onSandboxConnection?.(createConnectionWrapper(sandboxConnection));

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
		// Dispose BuildAwareVfs (releases BundlerService, watch, event forwarding)
		if (buildAwareVfs) {
			buildAwareVfs.dispose().catch((err: unknown) => {
				console.warn('[SandboxPreviewView] BuildAwareVfs dispose error:', err);
			});
			buildAwareVfs = null;
		}
		
		// Flush remaining logs to IndexedDB
		if (logStore) {
			logStore.dispose();
			logStore = null;
		}
		
		if (sandboxConnection) {
			sandboxConnection.disconnect();
			sandboxConnection = null;
			onSandboxConnection?.(null);
		}
		iframeSrc = undefined;
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
		// On mobile, always stay in fullscreen
		if (isMobileView) return;
		isFullscreen = !isFullscreen;
	}
	
	function toggleMinimize() {
		// On mobile, minimize is disabled
		if (isMobileView) return;
		isMinimized = !isMinimized;
	}

	function handleKeydown(event: KeyboardEvent) {
		// On mobile, don't allow ESC to exit fullscreen
		if (event.key === 'Escape' && isFullscreen && !isMobileView) {
			event.preventDefault();
			isFullscreen = false;
		}
	}
	
	// ============================================================================
	// Drag Handling
	// ============================================================================
	
	let dragTarget: HTMLElement | null = null;
	
	function startDrag(event: PointerEvent) {
		// Disable drag on mobile or fullscreen
		if (isFullscreen || isMobileView) return;
		
		// Only start drag on left mouse button and ignore if clicking buttons
		if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
		
		event.preventDefault();
		isDragging = true;
		dragStartX = event.clientX;
		dragStartY = event.clientY;
		dragStartWindowX = windowX;
		dragStartWindowY = windowY;
		
		dragTarget = event.currentTarget as HTMLElement;
		dragTarget.setPointerCapture(event.pointerId);
	}
	
	function handleDrag(event: PointerEvent) {
		if (!isDragging) return;
		
		const deltaX = event.clientX - dragStartX;
		const deltaY = event.clientY - dragStartY;
		
		const currentWidth = isMinimized ? MINIMIZED_WIDTH : windowWidth;
		const currentHeight = isMinimized ? MINIMIZED_HEIGHT : windowHeight;
		
		windowX = Math.max(0, Math.min(window.innerWidth - currentWidth, dragStartWindowX + deltaX));
		windowY = Math.max(0, Math.min(window.innerHeight - currentHeight, dragStartWindowY + deltaY));
	}
	
	function stopDrag(event: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		if (dragTarget) {
			dragTarget.releasePointerCapture(event.pointerId);
			dragTarget = null;
		}
	}
	
	// ============================================================================
	// Resize Handling
	// ============================================================================
	
	let resizeTarget: HTMLElement | null = null;
	
	function startResize(event: PointerEvent, direction: string) {
		// Disable resize on mobile, fullscreen, or minimized
		if (isFullscreen || isMinimized || isMobileView) return;
		
		event.preventDefault();
		event.stopPropagation();
		isResizing = true;
		resizeDirection = direction;
		resizeStartX = event.clientX;
		resizeStartY = event.clientY;
		resizeStartWidth = windowWidth;
		resizeStartHeight = windowHeight;
		resizeStartWindowX = windowX;
		resizeStartWindowY = windowY;
		
		resizeTarget = event.currentTarget as HTMLElement;
		resizeTarget.setPointerCapture(event.pointerId);
	}
	
	function handleResize(event: PointerEvent) {
		if (!isResizing) return;
		
		const deltaX = event.clientX - resizeStartX;
		const deltaY = event.clientY - resizeStartY;
		
		let newWidth = resizeStartWidth;
		let newHeight = resizeStartHeight;
		let newX = resizeStartWindowX;
		let newY = resizeStartWindowY;
		
		// Handle horizontal resize
		if (resizeDirection.includes('e')) {
			newWidth = Math.max(MIN_WIDTH, resizeStartWidth + deltaX);
		} else if (resizeDirection.includes('w')) {
			const maxDelta = resizeStartWidth - MIN_WIDTH;
			const actualDelta = Math.min(deltaX, maxDelta);
			newWidth = resizeStartWidth - actualDelta;
			newX = resizeStartWindowX + actualDelta;
		}
		
		// Handle vertical resize
		if (resizeDirection.includes('s')) {
			newHeight = Math.max(MIN_HEIGHT, resizeStartHeight + deltaY);
		} else if (resizeDirection.includes('n')) {
			const maxDelta = resizeStartHeight - MIN_HEIGHT;
			const actualDelta = Math.min(deltaY, maxDelta);
			newHeight = resizeStartHeight - actualDelta;
			newY = resizeStartWindowY + actualDelta;
		}
		
		// Constrain to viewport
		newX = Math.max(0, newX);
		newY = Math.max(0, newY);
		
		windowWidth = newWidth;
		windowHeight = newHeight;
		windowX = newX;
		windowY = newY;
	}
	
	function stopResize(event: PointerEvent) {
		if (!isResizing) return;
		isResizing = false;
		resizeDirection = '';
		if (resizeTarget) {
			resizeTarget.releasePointerCapture(event.pointerId);
			resizeTarget = null;
		}
	}
</script>

<!-- Floating Preview Panel -->
<svelte:window onkeydown={handleKeydown} />

<div
	use:portal
	class="fixed z-9999"
	class:inset-0={isFullscreen}
	class:rounded-lg={isMinimized}
	class:shadow-lg={isMinimized}
	class:overflow-hidden={isMinimized}
	style={isFullscreen ? '' : isMinimized 
		? `left: ${windowX}px; top: ${windowY}px; width: ${MINIMIZED_WIDTH}px;`
		: `left: ${windowX}px; top: ${windowY}px; width: ${windowWidth}px; height: ${windowHeight}px;`}
	transition:fade={{ duration: 150 }}
>
	<div
		class="bg-white shadow-2xl flex flex-col overflow-hidden h-full w-full"
		class:rounded-xl={!isFullscreen && !isMinimized}
	>
		<!-- Header (always visible) -->
		<div 
			class="flex items-center justify-between bg-orange-500 text-white select-none touch-none"
			class:px-2={isMinimized}
			class:py-1={isMinimized}
			class:px-3={!isMinimized}
			class:py-1.5={!isMinimized}
			class:cursor-move={!isDragging && !isFullscreen && !isMobileView}
			class:cursor-grabbing={isDragging}
			onpointerdown={startDrag}
			onpointermove={handleDrag}
			onpointerup={stopDrag}
			onpointercancel={stopDrag}
		>
			<div class="flex items-center gap-1.5 min-w-0" class:gap-2={!isMinimized}>
				<svg class="shrink-0" class:w-3.5={isMinimized} class:h-3.5={isMinimized} class:w-4={!isMinimized} class:h-4={!isMinimized} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
				</svg>
				<span class="font-medium truncate text-sm" class:text-xs={isMinimized}>{name || m.studio_node_sandbox_preview()}</span>
				{#if isCompiling}
					{#if isMinimized}
						<svg class="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
					<span class="text-xs bg-white/20 px-2 py-0.5 rounded flex items-center gap-1 max-w-48 truncate" title={compilingMessage ?? ''}>
						<svg class="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						{compilingMessage || m.studio_sandbox_compiling_short()}
						</span>
					{/if}
				{:else if isLoading && !isMinimized}
					<span class="text-xs bg-white/20 px-2 py-0.5 rounded">{m.studio_node_loading()}</span>
				{/if}
			</div>
			<div class="flex items-center shrink-0" class:gap-0.5={isMinimized} class:gap-1={!isMinimized}>
				{#if isMinimized}
					<!-- Restore button -->
					<button
						class="p-0.5 hover:bg-white/20 rounded transition-colors"
						onclick={toggleMinimize}
						title={m.studio_node_restore()}
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
						</svg>
					</button>
				{:else if isFullscreen}
					<!-- Exit fullscreen button (hidden on mobile) -->
					{#if !isMobileView}
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors"
						onclick={toggleFullscreen}
						title={m.studio_node_exit_fullscreen()}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
						</svg>
					</button>
					{/if}
					<!-- Reload button -->
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors disabled:opacity-50"
						onclick={reloadSandbox}
						disabled={isLoading || !!error}
						title={m.studio_node_reload()}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					</button>
					<!-- Console button -->
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors relative"
						onclick={toggleConsole}
						title="Console"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
				{:else}
					<!-- Minimize button -->
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors"
						onclick={toggleMinimize}
						title={m.studio_node_minimize()}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" />
						</svg>
					</button>
					<!-- Fullscreen button -->
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors"
						onclick={toggleFullscreen}
						title={m.studio_node_fullscreen()}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
						</svg>
					</button>
					<!-- Reload button -->
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors disabled:opacity-50"
						onclick={reloadSandbox}
						disabled={isLoading || !!error}
						title={m.studio_node_reload()}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					</button>
					<!-- Console button -->
					<button
						class="p-1 hover:bg-white/20 rounded transition-colors relative"
						onclick={toggleConsole}
						title="Console"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
				{/if}
				<!-- Close button -->
				<button
					class="hover:bg-white/20 rounded transition-colors"
					class:p-0.5={isMinimized}
					class:p-1={!isMinimized}
					onclick={handleClose}
					title={m.studio_node_close()}
				>
					<svg class:w-3.5={isMinimized} class:h-3.5={isMinimized} class:w-4={!isMinimized} class:h-4={!isMinimized} fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Content (hidden when minimized via CSS, not removed from DOM) -->
		<div class="flex-1 relative bg-gray-100" class:hidden={isMinimized}>
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
				src={iframeSrc}
				class="absolute inset-0 w-full h-full border-0 {isLoading || error ? 'invisible' : 'visible'}"
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
				allow="clipboard-read; clipboard-write"
				title={m.studio_node_sandbox_preview()}
			></iframe>
		</div>

		<!-- Console Panel (hidden when minimized) -->
		{#if showConsole && !isMinimized}
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
						class="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
						onclick={requestSentryUpload}
						disabled={consoleLogs.length === 0}
						title="Report to Sentry"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.07 19h13.86c1.1 0 1.79-1.19 1.24-2.14l-6.93-12c-.55-.95-1.92-.95-2.48 0l-6.93 12C3.28 17.81 3.97 19 5.07 19z" />
						</svg>
					</button>
					<button
						class="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
						onclick={downloadLogs}
						disabled={consoleLogs.length === 0}
						title="Download logs"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
						</svg>
					</button>
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
			<!-- Console Content (virtualized) -->
			<VirtualConsoleList
				logs={consoleLogs}
				{getLogLevelColor}
				{getLogLevelIcon}
			/>
		</div>
		{/if}

		<!-- Footer (hidden in fullscreen and minimized) -->
		{#if !isFullscreen && !isMinimized}
		<div class="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
			<span>{m.studio_node_entry({ entryFile })}</span>
			<span>{m.studio_node_origin({ origin: resolvedSandboxOrigin })}</span>
		</div>
		{/if}
		
		<!-- Resize Handles (hidden in fullscreen and minimized) -->
		{#if !isFullscreen && !isMinimized}
			<!-- Edge handles -->
			<div class="absolute top-0 left-2 right-2 h-1 cursor-ns-resize hover:bg-orange-500/20 touch-none" onpointerdown={(e) => startResize(e, 'n')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<div class="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize hover:bg-orange-500/20 touch-none" onpointerdown={(e) => startResize(e, 's')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<div class="absolute left-0 top-2 bottom-2 w-1 cursor-ew-resize hover:bg-orange-500/20 touch-none" onpointerdown={(e) => startResize(e, 'w')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<div class="absolute right-0 top-2 bottom-2 w-1 cursor-ew-resize hover:bg-orange-500/20 touch-none" onpointerdown={(e) => startResize(e, 'e')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<!-- Corner handles -->
			<div class="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize touch-none" onpointerdown={(e) => startResize(e, 'nw')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<div class="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize touch-none" onpointerdown={(e) => startResize(e, 'ne')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<div class="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize touch-none" onpointerdown={(e) => startResize(e, 'sw')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
			<div class="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize touch-none" onpointerdown={(e) => startResize(e, 'se')} onpointermove={handleResize} onpointerup={stopResize} onpointercancel={stopResize}></div>
		{/if}
	</div>
</div>

<!-- Sentry Upload Confirmation Modal -->
{#if showSentryConfirm}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div use:portal class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50" onclick={closeSentryConfirm}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
			onclick={(e) => e.stopPropagation()}
		>
			{#if sentryUploadDone}
				<!-- Success state -->
				<div class="text-center">
					<div class="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
						<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
					</div>
					<h3 class="text-lg font-semibold text-gray-800 mb-1">Report Sent</h3>
					<p class="text-sm text-gray-500 mb-4">Logs have been uploaded to Sentry. Thank you!</p>
					<button
						class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
						onclick={closeSentryConfirm}
					>
						Close
					</button>
				</div>
			{:else}
				<!-- Confirmation state -->
				<div class="flex items-start gap-3 mb-4">
					<div class="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
						<svg class="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.07 19h13.86c1.1 0 1.79-1.19 1.24-2.14l-6.93-12c-.55-.95-1.92-.95-2.48 0l-6.93 12C3.28 17.81 3.97 19 5.07 19z" />
						</svg>
					</div>
					<div>
						<h3 class="text-lg font-semibold text-gray-800">Report to Sentry</h3>
						<p class="text-sm text-gray-500 mt-1">
							All saves and chat history will be collected to help diagnose issues. Are you sure you want to continue?
						</p>
					</div>
				</div>
				<div class="flex justify-end gap-2">
					<button
						class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
						onclick={closeSentryConfirm}
						disabled={sentryUploading}
					>
						Cancel
					</button>
					<button
						class="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
						onclick={confirmSentryUpload}
						disabled={sentryUploading}
					>
						{#if sentryUploading}
							Uploading...
						{:else}
							Confirm & Upload
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
