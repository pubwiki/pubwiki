<script lang="ts">
	/**
	 * SavePanel - Combined local and cloud checkpoint management for State nodes
	 * 
	 * Features:
	 * - Local checkpoints: Always available, stored in IndexedDB via RDFStore
	 * - Cloud saves: Available when project is published, synced to backend
	 * 
	 * Cloud saves require:
	 * - Project to be published (has artifactId)
	 * - Artifact commit (fetched from backend)
	 * - STATE node commit (from nodeStore)
	 */
	import { onMount } from 'svelte';
	import type { StateNodeData } from '$lib/types';
	import type { SaveDetail, VisibilityType } from '@pubwiki/api';
	import { type Checkpoint as LocalCheckpoint } from '@pubwiki/rdfstore';
	import { getNodeRDFStore, type RDFStore } from '$lib/rdf';
	import { nodeStore } from '$lib/persistence';
	import { useAuth } from '@pubwiki/ui/stores';
	import {
		getArtifactContext,
		createSaveCheckpoint,
		restoreFromSave,
		fetchSaves,
		deleteSave,
		computeSaveCommit,
		type ArtifactContext
	} from '$lib/gamesave';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: StateNodeData;
		projectId: string;
	}

	let { nodeId, data, projectId }: Props = $props();

	const auth = useAuth();

	// Combined checkpoint entry (local or cloud)
	interface CheckpointEntry {
		id: string;
		title: string;
		description?: string;
		timestamp: number;
		quadCount: number;
		source: 'local' | 'cloud';
		visibility?: VisibilityType;
		commit?: string; // Only for cloud saves
	}

	// State
	let localCheckpoints = $state<CheckpointEntry[]>([]);
	let cloudSaves = $state<CheckpointEntry[]>([]);
	let isLoading = $state(false);
	let isApplying = $state(false);
	let isCreating = $state(false);
	let isUploading = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let store = $state<RDFStore | null>(null);
	let artifactContext = $state<ArtifactContext | null>(null);

	// Tab state: 'local' or 'cloud'
	let activeTab = $state<'local' | 'cloud'>('local');

	// Menu state for each checkpoint
	let openMenuId = $state<string | null>(null);

	// Create form state
	let showCreateForm = $state(false);
	let newCheckpointTitle = $state('');
	let newCheckpointDescription = $state('');
	let newCheckpointVisibility = $state<VisibilityType>('PRIVATE');

	// Derived: combined checkpoints based on active tab
	let checkpoints = $derived(activeTab === 'local' ? localCheckpoints : cloudSaves);

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

	// Get current node commit from nodeStore
	function getNodeCommit(): string | null {
		const nodeData = nodeStore.get(nodeId);
		return nodeData?.commit ?? null;
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

	// Refresh local checkpoints
	async function refreshLocalCheckpoints() {
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			const checkpoints = await store.listCheckpoints();
			localCheckpoints = checkpoints.map(cp => ({
				id: cp.id,
				title: cp.title,
				description: cp.description,
				timestamp: cp.timestamp,
				quadCount: cp.quadCount,
				source: 'local' as const
			})).sort((a, b) => b.timestamp - a.timestamp);
		} catch (e) {
			console.error('Failed to refresh local checkpoints:', e);
		}
	}

	// Refresh cloud saves
	async function refreshCloudSaves() {
		if (!artifactContext?.isPublished) {
			cloudSaves = [];
			return;
		}

		const nodeCommit = getNodeCommit();
		if (!nodeCommit) {
			cloudSaves = [];
			return;
		}

		try {
			const saves = await fetchSaves(nodeId, nodeCommit);
			cloudSaves = saves.map(s => ({
				id: s.commit, // Use commit as ID for cloud saves
				commit: s.commit,
				title: s.title ?? `存档 ${s.commit.slice(0, 8)}`,
				description: s.description ?? undefined,
				timestamp: new Date(s.createdAt).getTime(),
				quadCount: 0, // Not available from API
				source: 'cloud' as const,
				visibility: s.visibility
			})).sort((a, b) => b.timestamp - a.timestamp);
		} catch (e) {
			console.error('Failed to refresh cloud saves:', e);
			cloudSaves = [];
		}
	}

	// Refresh all
	async function refreshAll() {
		isLoading = true;
		error = null;

		try {
			await refreshArtifactContext();
			await Promise.all([
				refreshLocalCheckpoints(),
				refreshCloudSaves()
			]);
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
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			const checkpointId = crypto.randomUUID();
			await store.checkpoint({
				id: checkpointId,
				title: newCheckpointTitle.trim(),
				description: newCheckpointDescription.trim() || undefined
			});

			// Reset form
			newCheckpointTitle = '';
			newCheckpointDescription = '';
			showCreateForm = false;

			await refreshLocalCheckpoints();
			successMessage = '本地存档创建成功';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '创建存档失败';
			clearMessages();
		} finally {
			isCreating = false;
		}
	}

	// Create a cloud save
	async function createCloudSave() {
		if (!newCheckpointTitle.trim()) {
			error = '请输入存档标题';
			clearMessages();
			return;
		}

		if (!artifactContext?.isPublished || !artifactContext.artifactId || !artifactContext.artifactCommit) {
			error = '项目未发布，无法创建云存档';
			clearMessages();
			return;
		}

		if (!auth.user?.id) {
			error = '请先登录';
			clearMessages();
			return;
		}

		const nodeCommit = getNodeCommit();
		if (!nodeCommit) {
			error = '无法获取节点版本信息';
			clearMessages();
			return;
		}

		isCreating = true;
		error = null;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			// Compute save commit
			const commit = await computeSaveCommit(
				nodeId,
				nodeCommit,
				auth.user.id,
				artifactContext.artifactId,
				artifactContext.artifactCommit
			);

			// Compute content hash
			const quads = await store.getAllQuads();
			const quadsJson = JSON.stringify(quads);
			const contentHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quadsJson));
			const contentHashArray = Array.from(new Uint8Array(contentHashBuffer));
			const contentHash = contentHashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);

			// Create cloud save
			const result = await createSaveCheckpoint(store, {
				stateNodeId: nodeId,
				stateNodeCommit: nodeCommit,
				commit,
				sourceArtifactId: artifactContext.artifactId,
				sourceArtifactCommit: artifactContext.artifactCommit,
				contentHash,
				title: newCheckpointTitle.trim(),
				description: newCheckpointDescription.trim() || undefined,
				visibility: newCheckpointVisibility
			});

			if (!result.success) {
				throw new Error(result.error || '创建云存档失败');
			}

			// Reset form
			newCheckpointTitle = '';
			newCheckpointDescription = '';
			newCheckpointVisibility = 'PRIVATE';
			showCreateForm = false;

			await refreshCloudSaves();
			successMessage = '云存档创建成功';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '创建云存档失败';
			clearMessages();
		} finally {
			isCreating = false;
		}
	}

	// Create checkpoint based on active tab
	async function createCheckpoint() {
		if (activeTab === 'local') {
			await createLocalCheckpoint();
		} else {
			await createCloudSave();
		}
	}

	// Apply a local checkpoint
	async function applyLocalCheckpoint(checkpoint: CheckpointEntry) {
		isApplying = true;
		error = null;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			await store.loadCheckpoint(checkpoint.id);
			successMessage = `已应用本地存档: ${checkpoint.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '应用存档失败';
			clearMessages();
		} finally {
			isApplying = false;
		}
	}

	// Apply a cloud save
	async function applyCloudSave(checkpoint: CheckpointEntry) {
		if (!checkpoint.commit) {
			error = '无效的云存档';
			clearMessages();
			return;
		}

		isApplying = true;
		error = null;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			const success = await restoreFromSave(store, checkpoint.commit);
			if (!success) {
				throw new Error('恢复云存档失败');
			}

			successMessage = `已应用云存档: ${checkpoint.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '应用云存档失败';
			clearMessages();
		} finally {
			isApplying = false;
		}
	}

	// Apply checkpoint based on source
	async function applyCheckpoint(checkpoint: CheckpointEntry) {
		if (checkpoint.source === 'local') {
			await applyLocalCheckpoint(checkpoint);
		} else {
			await applyCloudSave(checkpoint);
		}
	}

	// Delete a local checkpoint
	async function deleteLocalCheckpoint(checkpoint: CheckpointEntry) {
		if (!confirm(`确定要删除本地存档 "${checkpoint.title}" 吗？`)) return;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			await store.deleteCheckpoint(checkpoint.id);
			await refreshLocalCheckpoints();
			successMessage = '本地存档已删除';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '删除失败';
			clearMessages();
		}
	}

	// Delete a cloud save
	async function deleteCloudSave(checkpoint: CheckpointEntry) {
		if (!checkpoint.commit) {
			error = '无效的云存档';
			clearMessages();
			return;
		}

		if (!confirm(`确定要删除云存档 "${checkpoint.title}" 吗？此操作不可恢复。`)) return;

		try {
			await deleteSave(checkpoint.commit);
			await refreshCloudSaves();
			successMessage = '云存档已删除';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '删除云存档失败';
			clearMessages();
		}
	}

	// Delete checkpoint based on source
	async function deleteCheckpoint(checkpoint: CheckpointEntry) {
		if (checkpoint.source === 'local') {
			await deleteLocalCheckpoint(checkpoint);
		} else {
			await deleteCloudSave(checkpoint);
		}
	}

	// Upload a local checkpoint to cloud
	async function uploadToCloud(checkpoint: CheckpointEntry) {
		if (!artifactContext?.isPublished || !artifactContext.artifactId || !artifactContext.artifactCommit) {
			error = '项目未发布，无法上传到云端';
			clearMessages();
			return;
		}

		if (!auth.user?.id) {
			error = '请先登录';
			clearMessages();
			return;
		}

		const nodeCommit = getNodeCommit();
		if (!nodeCommit) {
			error = '无法获取节点版本信息';
			clearMessages();
			return;
		}

		isUploading = true;
		error = null;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			// Load the checkpoint first
			await store.loadCheckpoint(checkpoint.id);

			// Compute save commit
			const commit = await computeSaveCommit(
				nodeId,
				nodeCommit,
				auth.user.id,
				artifactContext.artifactId,
				artifactContext.artifactCommit
			);

			// Compute content hash
			const quads = await store.getAllQuads();
			const quadsJson = JSON.stringify(quads);
			const contentHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quadsJson));
			const contentHashArray = Array.from(new Uint8Array(contentHashBuffer));
			const contentHash = contentHashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);

			// Create cloud save
			const result = await createSaveCheckpoint(store, {
				stateNodeId: nodeId,
				stateNodeCommit: nodeCommit,
				commit,
				sourceArtifactId: artifactContext.artifactId,
				sourceArtifactCommit: artifactContext.artifactCommit,
				contentHash,
				title: checkpoint.title,
				description: checkpoint.description,
				visibility: 'PRIVATE'
			});

			if (!result.success) {
				throw new Error(result.error || '上传失败');
			}

			await refreshCloudSaves();
			successMessage = `已上传到云端: ${checkpoint.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '上传到云端失败';
			clearMessages();
		} finally {
			isUploading = false;
		}
	}

	// Toggle menu for a checkpoint
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

	// Get visibility label
	function getVisibilityLabel(visibility: VisibilityType): string {
		switch (visibility) {
			case 'PUBLIC': return '公开';
			case 'PRIVATE': return '私有';
			case 'UNLISTED': return '不公开';
			default: return visibility;
		}
	}

	// Track if we've initialized
	let hasInitialized = $state(false);

	// Auto-load checkpoints on mount
	$effect(() => {
		const currentNodeId = nodeId;
		if (!hasInitialized && currentNodeId) {
			hasInitialized = true;
			refreshAll();
		}
	});

	// Reset when nodeId changes
	$effect(() => {
		const _nodeId = nodeId;
		return () => {
			hasInitialized = false;
			store = null;
			localCheckpoints = [];
			cloudSaves = [];
			artifactContext = null;
		};
	});
</script>

<div class="space-y-3">
	<!-- Header with tabs -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
			<button
				type="button"
				onclick={() => activeTab = 'local'}
				class="px-3 py-1 text-xs font-medium rounded-md transition-colors {activeTab === 'local' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}"
			>
				本地 ({localCheckpoints.length})
			</button>
			<button
				type="button"
				onclick={() => activeTab = 'cloud'}
				disabled={!canUseCloud}
				class="px-3 py-1 text-xs font-medium rounded-md transition-colors {activeTab === 'cloud' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'} disabled:text-gray-400 disabled:cursor-not-allowed"
				title={!canUseCloud ? (artifactContext?.isPublished ? '请先登录' : '项目未发布') : ''}
			>
				云端 ({cloudSaves.length})
			</button>
		</div>
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
				onclick={refreshAll}
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
			<span>登录后可使用云端存档</span>
		</div>
	{/if}

	<!-- Success message -->
	{#if successMessage}
		<div class="px-3 py-2 text-xs bg-green-50 text-green-600 rounded-lg border border-green-200">
			{successMessage}
		</div>
	{/if}

	<!-- Create checkpoint form -->
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
			{#if activeTab === 'cloud' && canUseCloud}
				<div>
					<label for="checkpoint-visibility" class="block text-xs font-medium text-gray-600 mb-1">可见性</label>
					<select
						id="checkpoint-visibility"
						bind:value={newCheckpointVisibility}
						class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
					>
						<option value="PRIVATE">私有 - 仅自己可见</option>
						<option value="UNLISTED">不公开 - 有链接可见</option>
						<option value="PUBLIC">公开 - 所有人可见</option>
					</select>
				</div>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					onclick={createCheckpoint}
					disabled={isCreating || !newCheckpointTitle.trim()}
					class="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors"
				>
					{#if isCreating}
						创建中...
					{:else}
						创建{activeTab === 'cloud' ? '云' : '本地'}存档
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

	<!-- Checkpoint list -->
	<div class="rounded-lg border border-gray-200">
		{#if checkpoints.length > 0}
			<div class="divide-y divide-gray-100">
				{#each checkpoints as checkpoint (checkpoint.id)}
					<div class="p-3 hover:bg-gray-50 transition-colors">
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-medium text-gray-800 truncate">
										{checkpoint.title}
									</span>
									{#if checkpoint.source === 'local'}
										<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">本地</span>
									{:else}
										<span class="px-1.5 py-0.5 text-xs bg-teal-100 text-teal-700 rounded">
											{checkpoint.visibility ? getVisibilityLabel(checkpoint.visibility) : '云端'}
										</span>
									{/if}
								</div>
								<div class="text-xs text-gray-500 mt-0.5">
									{formatDate(checkpoint.timestamp)}
									{#if checkpoint.source === 'local'}
										 · {checkpoint.quadCount} 条数据
									{/if}
								</div>
								{#if checkpoint.description}
									<p class="text-xs text-gray-500 mt-1 line-clamp-2">{checkpoint.description}</p>
								{/if}
							</div>
							<!-- Three-dot menu -->
							<div class="relative checkpoint-menu shrink-0">
								<button
									type="button"
									onclick={() => toggleMenu(checkpoint.id)}
									class="p-1.5 text-gray-500 hover:bg-gray-100 rounded transition-colors"
									title="更多操作"
								>
									<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
										<circle cx="12" cy="5" r="2" />
										<circle cx="12" cy="12" r="2" />
										<circle cx="12" cy="19" r="2" />
									</svg>
								</button>
								{#if openMenuId === checkpoint.id}
									<div class="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
										<button
											type="button"
											onclick={() => { openMenuId = null; applyCheckpoint(checkpoint); }}
											disabled={isApplying}
											class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 flex items-center gap-2"
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
											</svg>
											回退
										</button>
										{#if checkpoint.source === 'local' && canUseCloud}
											<button
												type="button"
												onclick={() => { openMenuId = null; uploadToCloud(checkpoint); }}
												disabled={isUploading}
												class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 flex items-center gap-2"
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
												</svg>
												上传云端
											</button>
										{/if}
										<button
											type="button"
											onclick={() => { openMenuId = null; deleteCheckpoint(checkpoint); }}
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
				{activeTab === 'local' ? '暂无本地存档' : '暂无云端存档'}
			</div>
		{:else}
			<div class="px-3 py-6 text-sm text-gray-400 text-center">
				加载中...
			</div>
		{/if}
	</div>
</div>
