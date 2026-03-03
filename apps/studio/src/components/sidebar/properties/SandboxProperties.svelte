<script lang="ts">
	/**
	 * SandboxProperties - Sidebar properties for Sandbox nodes
	 *
	 * Shows a list of persisted log sessions (buckets). Users can:
	 * - Open a session's logs in a read-only Monaco editor modal
	 * - Download logs as a .log file
	 * - Delete a session
	 */
	import { onMount } from 'svelte';
	import SimpleMonacoEditor from '$components/monaco/SimpleMonacoEditor.svelte';
	import {
		listLogSessions,
		deleteLogSession,
		deleteAllLogSessions,
		getFormattedSessionLogs,
		downloadLogFile,
		type StoredLogSession
	} from '$lib/sandbox/console-log-db';

	interface Props {
		nodeId: string;
		projectId: string;
	}

	let { nodeId, projectId }: Props = $props();
	// svelte-ignore state_referenced_locally
	void nodeId; // For future use (filter sessions per node)

	// ============================================================================
	// State
	// ============================================================================

	let sessions = $state<StoredLogSession[]>([]);
	let isLoading = $state(true);

	// Log viewer state
	let viewerOpen = $state(false);
	let viewerSessionName = $state('');
	let viewerContent = $state('');
	let viewerLoading = $state(false);



	// ============================================================================
	// Data Loading
	// ============================================================================

	async function loadSessions() {
		isLoading = true;
		try {
			sessions = await listLogSessions(projectId);
		} catch (err) {
			console.error('[SandboxProperties] Failed to load log sessions:', err);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadSessions();
	});



	// ============================================================================
	// Actions
	// ============================================================================

	async function handleOpen(session: StoredLogSession) {
		viewerSessionName = session.name;
		viewerLoading = true;
		viewerOpen = true;

		try {
			viewerContent = await getFormattedSessionLogs(session.id);
		} catch (err) {
			console.error('[SandboxProperties] Failed to load session logs:', err);
			viewerContent = '// Failed to load logs';
		} finally {
			viewerLoading = false;
		}


	}

	async function handleDownload(session: StoredLogSession) {
		try {
			const content = await getFormattedSessionLogs(session.id);
			const ts = new Date(session.createdAt).toISOString().slice(0, 19).replace(/:/g, '-');
			downloadLogFile(content, `${session.name}-${ts}.log`);
		} catch (err) {
			console.error('[SandboxProperties] Failed to download logs:', err);
		}
	}

	async function handleDelete(session: StoredLogSession) {
		try {
			await deleteLogSession(session.id);
			sessions = sessions.filter((s) => s.id !== session.id);
		} catch (err) {
			console.error('[SandboxProperties] Failed to delete session:', err);
		}
	}

	async function handleDeleteAll() {
		if (sessions.length === 0) return;
		try {
			await deleteAllLogSessions(projectId);
			sessions = [];
		} catch (err) {
			console.error('[SandboxProperties] Failed to delete all sessions:', err);
		}
	}

	function closeViewer() {
		viewerOpen = false;
		viewerContent = '';
		viewerSessionName = '';
	}



	// ============================================================================
	// Helpers
	// ============================================================================

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleString();
	}

	function formatRelative(ts: number): string {
		const diff = Date.now() - ts;
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

<!-- Log Sessions List -->
<div>
	<div class="flex items-center justify-between mb-2">
		<span class="text-xs font-medium text-gray-500">Log Sessions</span>
		<div class="flex items-center gap-1">
			<button
				class="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
				onclick={handleDeleteAll}
				disabled={sessions.length === 0}
				title="Delete all sessions"
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
					/>
				</svg>
			</button>
			<button
				class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
				onclick={loadSessions}
				title="Refresh"
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
			</button>
		</div>
	</div>

	{#if isLoading}
		<div class="text-xs text-gray-400 text-center py-4">Loading...</div>
	{:else if sessions.length === 0}
		<div class="text-xs text-gray-400 text-center py-4">No log sessions yet</div>
	{:else}
		<div class="space-y-1.5">
			{#each sessions as session (session.id)}
				<div
					class="group border border-gray-200 rounded-lg p-2.5 hover:border-orange-300 hover:bg-orange-50/30 transition-colors"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="text-xs font-medium text-gray-700 truncate">{session.name}</div>
							<div class="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
								<span title={formatDate(session.createdAt)}>{formatRelative(session.createdAt)}</span>
								<span>·</span>
								<span>{session.logCount} entries</span>
							</div>
						</div>
						<!-- Actions -->
						<div
							class="flex items-center gap-0.5 shrink-0"
						>
							<!-- Open -->
							<button
								class="p-1 rounded hover:bg-orange-100 text-gray-400 hover:text-orange-600 transition-colors"
								title="View logs"
								onclick={() => handleOpen(session)}
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							</button>
							<!-- Download -->
							<button
								class="p-1 rounded hover:bg-orange-100 text-gray-400 hover:text-orange-600 transition-colors"
								title="Download .log"
								onclick={() => handleDownload(session)}
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
									/>
								</svg>
							</button>
							<!-- Delete -->
							<button
								class="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
								title="Delete session"
								onclick={() => handleDelete(session)}
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
									/>
								</svg>
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Log Viewer Modal (portal to body) -->
{#if viewerOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onclick={closeViewer}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200"
			style="width: 80vw; height: 70vh; max-width: 1200px; max-height: 800px;"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
				<div class="flex items-center gap-2 text-sm text-gray-800">
					<svg class="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/>
					</svg>
					<span class="font-medium">{viewerSessionName}</span>
					<span class="text-xs text-gray-400">(read-only)</span>
				</div>
				<button
					class="p-1 hover:bg-gray-200 rounded transition-colors text-gray-400 hover:text-gray-700"
					onclick={closeViewer}
					title="Close"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			<!-- Editor -->
			<div class="flex-1 relative">
				{#if viewerLoading}
					<div class="absolute inset-0 flex items-center justify-center text-gray-400">
						<svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
					</div>
				{/if}
				<SimpleMonacoEditor value={viewerContent} language="log" theme="light-plus" class="absolute inset-0" />
			</div>
		</div>
	</div>
{/if}
