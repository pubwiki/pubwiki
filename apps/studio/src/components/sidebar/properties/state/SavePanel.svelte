<script lang="ts">
	/**
	 * SavePanel - Unified save management for State nodes
	 * 
	 * Shows a single list of saves with sync status badges:
	 * - local-only: Only in IndexedDB
	 * - synced: Both local and cloud
	 * - cloud-only: Only on server (can be downloaded)
	 */
	import { onMount } from 'svelte';
	import type { StateNodeData } from '$lib/types';
	import { getNodeRDFStore, type RDFStore } from '$lib/rdf';
	import { useAuth } from '@pubwiki/ui/stores';
	import {
		getArtifactContext,
		listUnifiedSaves,
		uploadSaveToCloud,
		pullSaveFromCloud,
		restoreFromSave,
		deleteSave,
		fetchSaves,
		type ArtifactContext,
		type UnifiedSave,
		type SyncStatus,
	} from '$lib/gamesave';

	interface Props {
		nodeId: string;
		data: StateNodeData;
		projectId: string;
	}

	let { nodeId, data, projectId }: Props = $props();

	const auth = useAuth();

	// State
	let saves = $state<UnifiedSave[]>([]);
	let isLoading = $state(false);
	let isApplying = $state(false);
	let isCreating = $state(false);
	let isSyncing = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let store = $state<RDFStore | null>(null);
	let artifactContext = $state<ArtifactContext | null>(null);

	// Menu state for each save
	let openMenuId = $state<string | null>(null);

	// Create form state
	let showCreateForm = $state(false);
	let newCheckpointTitle = $state('');
	let newCheckpointDescription = $state('');

	// Derived: can use cloud saves?
	let canUseCloud = $derived(artifactContext?.isPublished && auth.isAuthenticated);

	// Clear success message after timeout
	function clearMessages() {
		setTimeout(() => {
			successMessage = null;
		}, 3000);
	}

	// Clear error manually
	function clearError() {
		error = null;
	}

	// Refresh artifact context
	async function refreshArtifactContext() {
		try {
			artifactContext = await getArtifactContext(projectId);
		} catch (e) {
			console.error('Failed to get artifact context:', e);
			artifactContext = { isPublished: false };
		}
	}

	async function ensureStore(): Promise<RDFStore> {
		if (!store) {
			store = await getNodeRDFStore(nodeId);
		}
		return store;
	}

	// Refresh saves using unified merge logic
	async function refreshSaves() {
		isLoading = true;
		error = null;

		try {
			await refreshArtifactContext();
			const s = await ensureStore();
			saves = await listUnifiedSaves(s, nodeId);
		} catch (e) {
			error = e instanceof Error ? e.message : '获取存档失败';
			clearMessages();
		} finally {
			isLoading = false;
		}
	}

	// Create a new local checkpoint
	async function createLocalCheckpoint() {
		if (!newCheckpointTitle.trim()) {
			error = '请输入存档标题';
			clearMessages();
			return;
		}

		isCreating = true;
		error = null;

		try {
			const s = await ensureStore();
			await s.checkpoint({
				title: newCheckpointTitle.trim(),
				description: newCheckpointDescription.trim() || undefined,
			});

			// Reset form
			newCheckpointTitle = '';
			newCheckpointDescription = '';
			showCreateForm = false;

			await refreshSaves();
			successMessage = '本地存档创建成功';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '创建存档失败';
			clearMessages();
		} finally {
			isCreating = false;
		}
	}

	// Apply a save (local or cloud)
	async function applySave(save: UnifiedSave) {
		isApplying = true;
		error = null;

		try {
			const s = await ensureStore();

			if (save.syncStatus === 'cloud-only' && save.cloudCommit) {
				// Download and restore from cloud
				const success = await restoreFromSave(s, save.cloudCommit);
				if (!success) throw new Error('恢复云存档失败');
			} else {
				// Load from local checkpoint
				await s.loadCheckpoint(save.id);
			}

			successMessage = `已应用存档: ${save.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '应用存档失败';
			clearMessages();
		} finally {
			isApplying = false;
		}
	}

	// Delete a save
	async function handleDelete(save: UnifiedSave) {
		const confirmMsg = save.syncStatus === 'cloud-only'
			? `确定要删除云存档 "${save.title}" 吗？此操作不可恢复。`
			: `确定要删除存档 "${save.title}" 吗？`;
		if (!confirm(confirmMsg)) return;

		try {
			const s = await ensureStore();

			// Delete local checkpoint if exists
			if (save.syncStatus !== 'cloud-only') {
				await s.deleteCheckpoint(save.id);
			}

			// Delete cloud save if exists
			if (save.cloudCommit) {
				try {
					await deleteSave(save.cloudCommit);
				} catch {
					// Cloud delete may fail if not authorized — still remove locally
				}
			}

			await refreshSaves();
			successMessage = '存档已删除';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '删除失败';
			clearMessages();
		}
	}

	// Upload a local-only save to cloud
	async function handleUpload(save: UnifiedSave) {
		if (!artifactContext?.isPublished || !artifactContext.artifactId || !artifactContext.artifactCommit) {
			error = '项目未发布，无法上传到云端';
			clearMessages();
			return;
		}

		isSyncing = true;
		error = null;

		try {
			const s = await ensureStore();
			await uploadSaveToCloud(s, save.id, {
				stateNodeId: nodeId,
				artifactId: artifactContext.artifactId,
				artifactCommit: artifactContext.artifactCommit,
			});

			await refreshSaves();
			successMessage = `已上传到云端: ${save.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '上传到云端失败';
			clearMessages();
		} finally {
			isSyncing = false;
		}
	}

	// Download a cloud-only save to local
	async function handleDownload(save: UnifiedSave) {
		if (!save.cloudCommit) return;

		isSyncing = true;
		error = null;

		try {
			const s = await ensureStore();
			// Fetch the full SaveDetail for pull
			const cloudSaves = await fetchSaves(nodeId);
			const detail = cloudSaves.find(cs => cs.commit === save.cloudCommit);
			if (!detail) throw new Error('云存档未找到');

			await pullSaveFromCloud(s, detail);

			await refreshSaves();
			successMessage = `已下载到本地: ${save.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '下载失败';
			clearMessages();
		} finally {
			isSyncing = false;
		}
	}

	// Toggle menu for a save
	function toggleMenu(id: string) {
		openMenuId = openMenuId === id ? null : id;
	}

	// Close menu when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if (openMenuId && !(event.target as Element).closest('.checkpoint-menu')) {
			openMenuId = null;
		}
	}

	// Setup click outside listener
	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	// Format timestamp to readable date
	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString('zh-CN', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Sync status badge config
	function getBadge(status: SyncStatus): { label: string; classes: string } {
		switch (status) {
			case 'synced':
				return { label: '已同步', classes: 'bg-green-100 text-green-700' };
			case 'local-only':
				return { label: '仅本地', classes: 'bg-gray-100 text-gray-600' };
			case 'cloud-only':
				return { label: '仅云端', classes: 'bg-blue-100 text-blue-700' };
		}
	}

	// Track if we've initialized
	let hasInitialized = $state(false);

	// Auto-load on mount
	$effect(() => {
		const currentNodeId = nodeId;
		if (!hasInitialized && currentNodeId) {
			hasInitialized = true;
			refreshSaves();
		}
	});

	// Reset when nodeId changes
	$effect(() => {
		const _nodeId = nodeId;
		return () => {
			hasInitialized = false;
			store = null;
			saves = [];
			artifactContext = null;
		};
	});
</script>

<div class="space-y-3">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<span class="text-xs font-medium text-gray-500">存档 ({saves.length})</span>
		<div class="flex items-center gap-2">
			{#if !showCreateForm}
				<button
					type="button"
					onclick={() => showCreateForm = true}
					class="text-sm text-teal-600 hover:text-teal-700 flex items-center gap-1"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
					</svg>
					创建
				</button>
			{/if}
			<button
				type="button"
				onclick={refreshSaves}
				disabled={isLoading}
				class="text-sm text-teal-600 hover:text-teal-700 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
			>
				{#if isLoading}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				{/if}
			</button>
		</div>
	</div>

	<!-- Status indicator -->
	{#if !artifactContext?.isPublished}
		<div class="px-3 py-2 text-xs bg-amber-50 text-amber-700 rounded-lg border border-amber-200 flex items-center gap-2">
			<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>项目未发布，仅可使用本地存档</span>
		</div>
	{:else if !auth.isAuthenticated}
		<div class="px-3 py-2 text-xs bg-blue-50 text-blue-700 rounded-lg border border-blue-200 flex items-center gap-2">
			<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>登录后可使用云端同步</span>
		</div>
	{/if}

	<!-- Success message -->
	{#if successMessage}
		<div class="px-3 py-2 text-xs bg-green-50 text-green-600 rounded-lg border border-green-200">
			{successMessage}
		</div>
	{/if}

	<!-- Create form -->
	{#if showCreateForm}
		<div class="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
			<div>
				<label for="checkpoint-title" class="block text-xs font-medium text-gray-600 mb-1">标题</label>
				<input
					id="checkpoint-title"
					type="text"
					bind:value={newCheckpointTitle}
					placeholder="存档标题"
					class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
				/>
			</div>
			<div>
				<label for="checkpoint-description" class="block text-xs font-medium text-gray-600 mb-1">描述（可选）</label>
				<textarea
					id="checkpoint-description"
					bind:value={newCheckpointDescription}
					placeholder="存档描述..."
					rows="2"
					class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
				></textarea>
			</div>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={createLocalCheckpoint}
					disabled={isCreating || !newCheckpointTitle.trim()}
					class="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors"
				>
					{#if isCreating}
						创建中...
					{:else}
						创建存档
					{/if}
				</button>
				<button
					type="button"
					onclick={() => { showCreateForm = false; newCheckpointTitle = ''; newCheckpointDescription = ''; }}
					class="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
				>
					取消
				</button>
			</div>
		</div>
	{/if}

	<!-- Error message -->
	{#if error}
		<div class="px-3 py-2 text-xs bg-red-50 text-red-600 rounded-lg border border-red-200 flex items-start justify-between gap-2">
			<span class="flex-1">{error}</span>
			<button
				type="button"
				onclick={clearError}
				class="shrink-0 p-0.5 hover:bg-red-100 rounded transition-colors"
				title="关闭"
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/if}

	<!-- Unified save list -->
	<div class="rounded-lg border border-gray-200">
		{#if saves.length > 0}
			<div class="divide-y divide-gray-100">
				{#each saves as save (save.id)}
					{@const badge = getBadge(save.syncStatus)}
					<div class="p-3 hover:bg-gray-50 transition-colors">
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-medium text-gray-800 truncate">
										{save.title}
									</span>
									<span class="px-1.5 py-0.5 text-xs rounded {badge.classes}">
										{badge.label}
									</span>
								</div>
								<div class="text-xs text-gray-500 mt-0.5">
									{formatDate(save.timestamp)}
									{#if save.quadCount > 0}
										 · {save.quadCount} 条数据
									{/if}
								</div>
								{#if save.description}
									<p class="text-xs text-gray-500 mt-1 line-clamp-2">{save.description}</p>
								{/if}
							</div>
							<!-- Three-dot menu -->
							<div class="relative checkpoint-menu shrink-0">
								<button
									type="button"
									onclick={() => toggleMenu(save.id)}
									class="p-1.5 text-gray-500 hover:bg-gray-100 rounded transition-colors"
									title="更多操作"
								>
									<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
										<circle cx="12" cy="5" r="2" />
										<circle cx="12" cy="12" r="2" />
										<circle cx="12" cy="19" r="2" />
									</svg>
								</button>
								{#if openMenuId === save.id}
									<div class="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
										<button
											type="button"
											onclick={() => { openMenuId = null; applySave(save); }}
											disabled={isApplying}
											class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 flex items-center gap-2"
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
											</svg>
											回退
										</button>
										{#if save.syncStatus === 'local-only' && canUseCloud}
											<button
												type="button"
												onclick={() => { openMenuId = null; handleUpload(save); }}
												disabled={isSyncing}
												class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 flex items-center gap-2"
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
												</svg>
												上传云端
											</button>
										{/if}
										{#if save.syncStatus === 'cloud-only'}
											<button
												type="button"
												onclick={() => { openMenuId = null; handleDownload(save); }}
												disabled={isSyncing}
												class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 flex items-center gap-2"
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
												</svg>
												下载到本地
											</button>
										{/if}
										<button
											type="button"
											onclick={() => { openMenuId = null; handleDelete(save); }}
											class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
											删除
										</button>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if !isLoading}
			<div class="px-3 py-6 text-sm text-gray-400 text-center">
				暂无存档
			</div>
		{:else}
			<div class="px-3 py-6 text-sm text-gray-400 text-center">
				加载中...
			</div>
		{/if}
	</div>
</div>
