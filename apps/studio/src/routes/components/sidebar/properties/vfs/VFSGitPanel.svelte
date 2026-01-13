<script lang="ts">
	/**
	 * VFSGitPanel - Git version control panel for VFS nodes
	 * Shows changed files, commit input, and commit history
	 */
	import { onDestroy } from 'svelte';
	import type { VFSNodeData } from '../../../../types';
	import { getNodeVfs, type VersionedVfs } from '../../../../vfs';
	import type { VfsCommit } from '@pubwiki/vfs';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		nodeId: string;
		data: VFSNodeData;
	}

	let { nodeId, data }: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let vfs: VersionedVfs | null = $state(null);
	let changedFiles = $state<Array<{
		path: string;
		status: 'added' | 'modified' | 'deleted' | 'untracked';
		staged: boolean;
	}>>([]);
	let commits = $state<VfsCommit[]>([]);
	let commitMessage = $state('');
	let isLoading = $state(true);
	let isCommitting = $state(false);
	let isResetting = $state(false);
	let error = $state<string | null>(null);
	
	// UI state
	let expandedCommits = $state<Set<string>>(new Set());
	let resetConfirmHash = $state<string | null>(null);

	// Event unsubscribe functions
	let eventUnsubscribers: (() => void)[] = [];

	// ============================================================================
	// Derived
	// ============================================================================

	const hasChanges = $derived(changedFiles.length > 0);
	const canCommit = $derived(hasChanges && commitMessage.trim().length > 0 && !isCommitting);

	// ============================================================================
	// Initialization
	// ============================================================================

	async function initializeVfs() {
		// Clean up previous event listeners
		for (const unsubscribe of eventUnsubscribers) {
			unsubscribe();
		}
		eventUnsubscribers = [];

		// Reset state
		isLoading = true;
		error = null;
		changedFiles = [];
		commits = [];
		commitMessage = '';

		try {
			vfs = await getNodeVfs(data.content.projectId, nodeId);
			await refreshStatus();
			await refreshHistory();
			setupVfsEventListeners();
			isLoading = false;
		} catch (err) {
			console.error('Failed to initialize VFS for git panel:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize';
			isLoading = false;
		}
	}

	// Re-initialize when nodeId changes
	$effect(() => {
		const currentNodeId = nodeId;
		initializeVfs();
	});

	onDestroy(() => {
		for (const unsubscribe of eventUnsubscribers) {
			unsubscribe();
		}
		eventUnsubscribers = [];
	});

	function setupVfsEventListeners() {
		if (!vfs) return;

		const events = vfs.events;
		// Refresh status on any file change
		eventUnsubscribers.push(
			events.on('file:created', () => refreshStatus()),
			events.on('file:updated', () => refreshStatus()),
			events.on('file:deleted', () => refreshStatus()),
			events.on('file:moved', () => refreshStatus()),
			events.on('folder:created', () => refreshStatus()),
			events.on('folder:deleted', () => refreshStatus()),
			events.on('folder:moved', () => refreshStatus()),
			events.on('version:commit', () => {
				refreshStatus();
				refreshHistory();
			}),
			events.on('version:checkout', () => {
				refreshStatus();
				refreshHistory();
			})
		);
	}

	// ============================================================================
	// Data Fetching
	// ============================================================================

	async function refreshStatus() {
		if (!vfs) return;
		try {
			changedFiles = await vfs.getStatus();
		} catch (err) {
			console.error('Failed to get git status:', err);
		}
	}

	async function refreshHistory() {
		if (!vfs) return;
		try {
			commits = await vfs.getHistory({ depth: 20 });
		} catch (err) {
			console.error('Failed to get git history:', err);
		}
	}

	// ============================================================================
	// Actions
	// ============================================================================

	async function handleCommit() {
		if (!vfs || !canCommit) return;

		isCommitting = true;
		try {
			await vfs.commit(commitMessage.trim());
			commitMessage = '';
			await refreshStatus();
			await refreshHistory();
		} catch (err) {
			console.error('Failed to commit:', err);
			error = err instanceof Error ? err.message : 'Commit failed';
		} finally {
			isCommitting = false;
		}
	}

	async function handleReset(hash: string) {
		if (!vfs || isResetting) return;

		isResetting = true;
		try {
			await vfs.revert(hash);
			resetConfirmHash = null;
			expandedCommits = new Set();
			await refreshStatus();
			await refreshHistory();
		} catch (err) {
			console.error('Failed to reset:', err);
			error = err instanceof Error ? err.message : 'Reset failed';
		} finally {
			isResetting = false;
		}
	}

	function toggleCommitExpand(hash: string) {
		const newSet = new Set(expandedCommits);
		if (newSet.has(hash)) {
			newSet.delete(hash);
		} else {
			newSet.add(hash);
		}
		expandedCommits = newSet;
	}

	function showResetConfirm(hash: string, event: MouseEvent) {
		event.stopPropagation();
		resetConfirmHash = hash;
	}

	function cancelReset() {
		resetConfirmHash = null;
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	function getStatusColor(status: string): string {
		switch (status) {
			case 'added':
				return 'text-green-600 bg-green-50';
			case 'modified':
				return 'text-yellow-600 bg-yellow-50';
			case 'deleted':
				return 'text-red-600 bg-red-50';
			case 'untracked':
				return 'text-gray-500 bg-gray-50';
			default:
				return 'text-gray-500 bg-gray-50';
		}
	}

	function getStatusLabel(status: string): string {
		switch (status) {
			case 'added':
				return m.studio_vfs_git_added();
			case 'modified':
				return m.studio_vfs_git_modified();
			case 'deleted':
				return m.studio_vfs_git_deleted();
			case 'untracked':
				return m.studio_vfs_git_untracked();
			default:
				return status;
		}
	}

	function getStatusIcon(status: string): string {
		switch (status) {
			case 'added':
				return 'M12 6v6m0 0v6m0-6h6m-6 0H6';
			case 'modified':
				return 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z';
			case 'deleted':
				return 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';
			case 'untracked':
				return 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
			default:
				return 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
		}
	}

	function formatDate(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	}
</script>

<div class="flex flex-col gap-4">
	{#if isLoading}
		<div class="flex items-center justify-center py-4 text-gray-400 text-xs">
			{m.studio_vfs_loading()}
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-4 text-red-500 text-xs px-3">
			{error}
		</div>
	{:else}
		<!-- Changed Files Section (only show if there are changes) -->
		{#if hasChanges}
			<div class="flex flex-col">
				<div class="flex items-center justify-between mb-2">
					<span class="text-xs font-medium text-gray-500">{m.studio_vfs_git_changes()}</span>
					<span class="text-xs text-gray-400">{m.studio_vfs_git_files_changed({ count: changedFiles.length })}</span>
				</div>

				<div class="rounded-lg border border-gray-200 bg-gray-50 max-h-40 overflow-y-auto">
					<ul class="divide-y divide-gray-100">
						{#each changedFiles as file}
							<li class="flex items-center gap-2 px-2 py-1.5 text-xs">
								<span class="px-1.5 py-0.5 rounded text-[10px] font-medium {getStatusColor(file.status)}">
									<svg class="w-3 h-3 inline-block mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={getStatusIcon(file.status)} />
									</svg>
									{getStatusLabel(file.status)}
								</span>
								<span class="flex-1 truncate text-gray-600 font-mono" title={file.path}>
									{file.path}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}

		<!-- Commit Section (only show if there are changes) -->
		{#if hasChanges}
			<div class="flex flex-col gap-2">
				<textarea
					bind:value={commitMessage}
					placeholder={m.studio_vfs_git_commit_message()}
					rows="2"
					class="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
				></textarea>
				<button
					onclick={handleCommit}
					disabled={!canCommit}
					class="w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors
						{canCommit
							? 'bg-indigo-500 hover:bg-indigo-600 text-white'
							: 'bg-gray-100 text-gray-400 cursor-not-allowed'}"
				>
				{#if isCommitting}
					<svg class="w-3 h-3 inline-block mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else}
					<svg class="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
				{/if}
				{m.studio_vfs_git_commit()}
				</button>
			</div>
		{/if}

		<!-- Commit History Section -->
		<div class="flex flex-col">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs font-medium text-gray-500">{m.studio_vfs_git_history()}</span>
			</div>

			<div class="rounded-lg border border-gray-200 bg-gray-50 max-h-64 overflow-y-auto">
				{#if commits.length > 0}
					<ul class="divide-y divide-gray-100">
						{#each commits as commit, index}
							{@const isExpanded = expandedCommits.has(commit.hash)}
							{@const isConfirmingReset = resetConfirmHash === commit.hash}
							<li class="transition-colors">
								<!-- Commit Header (entire row is clickable for expand) -->
								<div 
									class="w-full px-2 py-2 hover:bg-gray-100 transition-colors cursor-pointer"
									onclick={() => toggleCommitExpand(commit.hash)}
									onkeydown={(e) => e.key === 'Enter' && toggleCommitExpand(commit.hash)}
									role="button"
									tabindex="0"
								>
									<div class="flex items-start gap-2">
										<!-- Expand/collapse icon -->
										<svg
											class="w-3 h-3 mt-1 text-gray-400 transition-transform shrink-0 {isExpanded ? 'rotate-90' : ''}"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
										</svg>
										<!-- Commit dot -->
										<div class="mt-1.5 w-2 h-2 rounded-full bg-indigo-400 shrink-0"></div>
										<div class="flex-1 min-w-0">
											<p class="text-xs text-gray-700 font-medium truncate" title={commit.message}>
												{commit.message}
											</p>
											<div class="flex items-center gap-2 mt-0.5">
												<span class="text-[10px] text-gray-400 font-mono">{commit.hash.slice(0, 7)}</span>
												<span class="text-[10px] text-gray-400">{formatDate(commit.timestamp)}</span>
												{#if commit.changes && commit.changes.length > 0}
													<span class="text-[10px] text-gray-400">
														{commit.changes.length} file{commit.changes.length !== 1 ? 's' : ''}
													</span>
												{/if}
											</div>
										</div>
										<!-- Reset button (not for the first/latest commit) -->
										{#if index > 0}
											<button
												type="button"
												onclick={(e) => showResetConfirm(commit.hash, e)}
												class="px-1.5 py-0.5 text-[10px] font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors shrink-0"
												title={m.studio_vfs_git_reset()}
											>
												<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
												</svg>
											</button>
										{/if}
									</div>
								</div>

								<!-- Reset Confirmation Dialog -->
								{#if isConfirmingReset}
									<div class="px-2 pb-2">
										<div class="bg-red-50 border border-red-200 rounded-lg p-2">
											<p class="text-xs font-medium text-red-700 mb-1">{m.studio_vfs_git_reset_confirm_title()}</p>
											<p class="text-[10px] text-red-600 mb-2">{m.studio_vfs_git_reset_confirm_message()}</p>
											<div class="flex gap-2">
												<button
													type="button"
													onclick={cancelReset}
													class="flex-1 px-2 py-1 text-[10px] font-medium text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
												>
													{m.studio_vfs_git_reset_cancel()}
												</button>
												<button
													type="button"
													onclick={() => handleReset(commit.hash)}
													disabled={isResetting}
													class="flex-1 px-2 py-1 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors disabled:opacity-50"
												>
													{#if isResetting}
														<svg class="w-3 h-3 inline-block mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
															<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
															<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
														</svg>
													{/if}
													{m.studio_vfs_git_reset_confirm()}
												</button>
											</div>
										</div>
									</div>
								{/if}

								<!-- Expanded: Affected files tree -->
								{#if isExpanded && commit.changes && commit.changes.length > 0}
									<div class="px-2 pb-2">
										<div class="ml-7 pl-2 border-l-2 border-gray-200">
											<p class="text-[10px] font-medium text-gray-500 mb-1">{m.studio_vfs_git_affected_files()}</p>
											<ul class="space-y-0.5">
												{#each commit.changes as change}
													<li class="flex items-center gap-1.5 text-[10px]">
														<span class="w-1.5 h-1.5 rounded-full shrink-0 {change.type === 'added' ? 'bg-green-400' : change.type === 'deleted' ? 'bg-red-400' : 'bg-yellow-400'}"></span>
														<span class="font-mono text-gray-600 truncate" title={change.path}>{change.path}</span>
													</li>
												{/each}
											</ul>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<div class="flex items-center justify-center py-4 text-gray-400 text-xs">
						{m.studio_vfs_git_no_commits()}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
