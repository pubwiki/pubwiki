<script lang="ts">
	/**
	 * SavePanel - Local and cloud save management for State nodes
	 * Displays local checkpoints and shows sync status with cloud
	 */
	import { onMount } from 'svelte';
	import type { StateNodeData } from '$lib/types';
	import type { CheckpointInfo } from '@pubwiki/api';
	import { type Checkpoint as LocalCheckpoint } from '@pubwiki/rdfstore';
	import { Dropdown } from '@pubwiki/ui/components';
	import { nodeStore } from '$lib/persistence';
	import { getNodeRDFStore, type RDFStore } from '$lib/rdf';
	import {
		fetchCloudCheckpoints,
		cloudSaveExists,
		createCloudSave,
		uploadCheckpointToCloud,
		createCloudCheckpoint,
		deleteCloudCheckpoint,
		buildSyncOperations,
		syncOperationsToCloud,
		getSaveIdByStateNode
	} from '$lib/gamesave/checkpoint';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: StateNodeData;
	}

	let { nodeId, data }: Props = $props();

	// Merged checkpoint info (local + cloud sync status)
	interface MergedCheckpoint {
		id: string; // Checkpoint ID (same for local and cloud)
		ref: string;
		title: string;
		description?: string;
		timestamp: number;
		quadCount: number;
		isLocal: boolean;
		isCloud: boolean;
	}

	// State
	let localCheckpoints = $state<LocalCheckpoint[]>([]);
	let cloudCheckpoints = $state<CheckpointInfo[]>([]);
	let mergedCheckpoints = $state<MergedCheckpoint[]>([]);
	let isLoading = $state(false);
	let isApplying = $state(false);
	let isCreating = $state(false);
	let isUploading = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let store = $state<RDFStore | null>(null);

	// Menu state for each checkpoint
	let openMenuId = $state<string | null>(null);
	// Submenu position for upload visibility selection (fixed positioning)
	let submenuPosition = $state<{ top: number; left: number } | null>(null);
	let hoveredUploadId = $state<string | null>(null);

	// Create form state
	let showCreateForm = $state(false);
	let newCheckpointTitle = $state('');
	let newCheckpointDescription = $state('');
	let syncToCloud = $state(false);

	// Visibility options for dropdown
	type VisibilityOption = { value: 'PRIVATE' | 'UNLISTED' | 'PUBLIC'; label: string };
	const visibilityOptions: VisibilityOption[] = [
		{ value: 'PRIVATE', label: '私有' },
		{ value: 'UNLISTED', label: '不公开' },
		{ value: 'PUBLIC', label: '公开' }
	];
	let selectedVisibility = $state<VisibilityOption>(visibilityOptions[0]);

	// Derived cloudVisibility from selected option
	let cloudVisibility = $derived(selectedVisibility.value);

	// Derived state
	let saveId = $derived(data.content.saveId);
	let hasSave = $derived(!!saveId);
	
	// Get checkpoint by hoveredUploadId for the fixed submenu
	let hoveredCheckpoint = $derived(
		hoveredUploadId ? mergedCheckpoints.find(c => c.id === hoveredUploadId) : null
	);

	// Merge local and cloud checkpoints
	function mergeCheckpoints() {
		const merged = new Map<string, MergedCheckpoint>();

		// Add local checkpoints (keyed by id)
		for (const local of localCheckpoints) {
			merged.set(local.id, {
				id: local.id,
				ref: local.ref,
				title: local.title,
				description: local.description,
				timestamp: local.timestamp,
				quadCount: local.quadCount,
				isLocal: true,
				isCloud: false
			});
		}

		// Merge cloud checkpoints (by id)
		for (const cloud of cloudCheckpoints) {
			const existing = merged.get(cloud.id);
			if (existing) {
				existing.isCloud = true;
			} else {
				merged.set(cloud.id, {
					id: cloud.id,
					ref: cloud.ref,
					title: cloud.name || `存档 ${cloud.ref.slice(0, 8)}`,
					description: cloud.description || undefined,
					timestamp: cloud.timestamp,
					quadCount: cloud.quadCount,
					isLocal: false,
					isCloud: true
				});
			}
		}

		// Sort by timestamp descending
		mergedCheckpoints = Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp);
	}

	// Clear success message after timeout (error requires manual dismissal)
	function clearMessages() {
		setTimeout(() => {
			successMessage = null;
		}, 3000);
	}

	// Clear error manually
	function clearError() {
		error = null;
	}

	// Refresh all checkpoints
	async function refreshCheckpoints() {
		isLoading = true;
		error = null;

		try {
			// Get local store
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			// Get local checkpoints
			localCheckpoints = await store.listCheckpoints();

			// Try to lookup saveId from backend if not set locally
			let effectiveSaveId = saveId;
			if (!effectiveSaveId) {
				effectiveSaveId = await getSaveIdByStateNode(nodeId);
				if (effectiveSaveId) {
					// Update the node data with the found saveId using StateContent.withSaveId
					nodeStore.update(nodeId, (nodeData) => {
						const stateData = nodeData as StateNodeData;
						return {
							...stateData,
							content: stateData.content.withSaveId(effectiveSaveId)
						};
					});
				}
			}

			// Get cloud checkpoints if connected
			if (effectiveSaveId) {
				cloudCheckpoints = await fetchCloudCheckpoints(effectiveSaveId);
			} else {
				cloudCheckpoints = [];
			}

			mergeCheckpoints();
		} catch (e) {
			error = e instanceof Error ? e.message : '获取存档失败';
			clearMessages();
		} finally {
			isLoading = false;
		}
	}

	// Create a new checkpoint
	async function createCheckpoint() {
		if (!newCheckpointTitle.trim()) {
			error = '请输入存档标题';
			clearMessages();
			return;
		}

		isCreating = true;
		error = null;

		try {
			// Get store
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			// Generate checkpoint info (but don't save yet if syncing to cloud)
			const checkpointId = crypto.randomUUID();
			const currentRef = store.currentRef;
			const quads = await store.getAllQuads();

			// Sync to cloud first if requested (before creating local checkpoint)
			if (syncToCloud) {
				let targetSaveId = saveId;
				
				// Create cloud save if not exists
				if (!targetSaveId) {
					targetSaveId = await createCloudSave(
						data.name || `State ${nodeId.slice(0, 8)}`,
						nodeId
					);
					// Update node with saveId
					nodeStore.update(nodeId, (nodeData) => {
						const stateData = nodeData as StateNodeData;
						return {
							...stateData,
							content: stateData.content.withSaveId(targetSaveId)
						} as StateNodeData;
					});
				}

				// Build sync operations and sync to cloud
				const syncInfo = await buildSyncOperations(store, cloudCheckpoints, currentRef);
				const syncResult = await syncOperationsToCloud(targetSaveId, syncInfo);
				if (!syncResult.success) {
					throw new Error(syncResult.message || '同步操作失败');
				}
				await createCloudCheckpoint(targetSaveId, {
					id: checkpointId,
					ref: currentRef,
					name: newCheckpointTitle.trim(),
					description: newCheckpointDescription.trim() || undefined,
					visibility: cloudVisibility
				});
			}

			// Now create local checkpoint (after cloud sync succeeded, or if not syncing)
			await store.checkpoint({
				id: checkpointId,
				title: newCheckpointTitle.trim(),
				description: newCheckpointDescription.trim() || undefined
			});

			// Update node with checkpoint pointing to the new checkpoint
			nodeStore.update(nodeId, (nodeData) => {
				const stateData = nodeData as StateNodeData;
				return {
					...stateData,
					content: stateData.content.withCheckpoint(checkpointId, currentRef)
				} as StateNodeData;
			});

			// Reset form
			newCheckpointTitle = '';
			newCheckpointDescription = '';
			syncToCloud = false;
			showCreateForm = false;

			// Refresh
			await refreshCheckpoints();

			successMessage = '存档创建成功';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '创建存档失败';
			clearMessages();
		} finally {
			isCreating = false;
		}
	}

	// Apply a checkpoint (restore state to that point)
	async function applyCheckpoint(checkpoint: MergedCheckpoint) {
		isApplying = true;
		error = null;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			// Checkout to the ref
			await store.checkout(checkpoint.ref);

			// Update node content with selected checkpoint
			nodeStore.update(nodeId, (nodeData) => {
				const stateData = nodeData as StateNodeData;
				return {
					...stateData,
					content: stateData.content.withCheckpoint(checkpoint.id, checkpoint.ref)
				} as StateNodeData;
			});

			successMessage = `已应用存档: ${checkpoint.title}`;
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '应用存档失败';
			clearMessages();
		} finally {
			isApplying = false;
		}
	}

	// Delete a checkpoint
	async function deleteCheckpoint(checkpoint: MergedCheckpoint) {
		if (!confirm(`确定要删除存档 "${checkpoint.title}" 吗？`)) return;

		try {
			// Delete from cloud if it's there
			if (checkpoint.isCloud && saveId) {
				await deleteCloudCheckpoint(saveId, checkpoint.id);
			}

			// Delete from local if it's there
			if (checkpoint.isLocal) {
				if (!store) {
					store = await getNodeRDFStore(nodeId);
				}
				await store.deleteCheckpoint(checkpoint.id, checkpoint.ref);
			}

			await refreshCheckpoints();
			successMessage = '存档已删除';
			clearMessages();
		} catch (e) {
			error = e instanceof Error ? e.message : '删除失败';
			clearMessages();
		}
	}

	// Upload a local checkpoint to cloud with specified visibility
	async function uploadCheckpoint(checkpoint: MergedCheckpoint, visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC') {
		if (checkpoint.isCloud) {
			error = '此存档已在云端';
			clearMessages();
			return;
		}

		isUploading = true;
		error = null;
		openMenuId = null;
		hoveredUploadId = null;
		submenuPosition = null;

		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}

			let targetSaveId = saveId;

			// Verify save exists if we have a saveId, otherwise create new save
			if (targetSaveId) {
				const exists = await cloudSaveExists(targetSaveId);
				if (!exists) {
					console.log(`[SavePanel] Save ${targetSaveId} not found, creating new save`);
					targetSaveId = null;
					
					// Clear the invalid saveId from state
					nodeStore.update(nodeId, (nodeData) => {
						const stateData = nodeData as StateNodeData;
						return {
							...stateData,
							content: stateData.content.withSaveId(null)
						} as StateNodeData;
					});
				}
			}

			// Create cloud save if not exists
			if (!targetSaveId) {
				targetSaveId = await createCloudSave(
					data.name || `State ${nodeId.slice(0, 8)}`,
					nodeId
				);
				// Update node with saveId
				nodeStore.update(nodeId, (nodeData) => {
					const stateData = nodeData as StateNodeData;
					return {
						...stateData,
						content: stateData.content.withSaveId(targetSaveId)
					} as StateNodeData;
				});
			}

			// Sync operations and create checkpoint
			const result = await uploadCheckpointToCloud(
				store,
				targetSaveId,
				cloudCheckpoints,
				{
					id: checkpoint.id,
					ref: checkpoint.ref,
					name: checkpoint.title,
					description: checkpoint.description,
					visibility: visibility
				}
			);
			if (!result.success) {
				throw new Error(result.error || '上传失败');
			}

			await refreshCheckpoints();
			successMessage = '已上传到云端';
			clearMessages();
		} catch (e) {
			console.error('[SavePanel] uploadCheckpoint failed:', e);
			error = e instanceof Error ? e.message : '上传失败';
			clearMessages();
		} finally {
			isUploading = false;
		}
	}

	// Toggle menu for a checkpoint
	function toggleMenu(id: string) {
		openMenuId = openMenuId === id ? null : id;
		hoveredUploadId = null; // Close submenu when toggling main menu
		submenuPosition = null;
	}

	// Handle hover on upload button - show submenu with fixed position
	function handleUploadMouseEnter(id: string, event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		submenuPosition = {
			top: rect.top,
			left: rect.right
		};
		hoveredUploadId = id;
	}

	// Handle mouse leave on upload button
	function handleUploadMouseLeave() {
		// Delay to allow moving to submenu
		setTimeout(() => {
			if (!document.querySelector('.upload-submenu:hover')) {
				hoveredUploadId = null;
				submenuPosition = null;
			}
		}, 100);
	}

	// Handle mouse leave on submenu
	function handleSubmenuMouseLeave() {
		hoveredUploadId = null;
		submenuPosition = null;
	}

	// Close menu when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if ((openMenuId || hoveredUploadId) && !(event.target as Element).closest('.checkpoint-menu')) {
			openMenuId = null;
			hoveredUploadId = null;
			submenuPosition = null;
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

	// Track if we've initialized
	let hasInitialized = $state(false);

	// Auto-load checkpoints on mount
	$effect(() => {
		// Read nodeId to track it as dependency
		const currentNodeId = nodeId;
		if (!hasInitialized && currentNodeId) {
			hasInitialized = true;
			refreshCheckpoints();
		}
	});

	// Reset when nodeId changes
	$effect(() => {
		// Track nodeId changes
		const _nodeId = nodeId;
		return () => {
			// Cleanup: reset state when component unmounts or nodeId changes
			hasInitialized = false;
			store = null;
			localCheckpoints = [];
			cloudCheckpoints = [];
			mergedCheckpoints = [];
		};
	});
</script>

<div class="space-y-3">
	<!-- Header with title and create button -->
	<div class="flex items-center justify-between">
		<span class="text-xs font-medium text-gray-500">存档</span>
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
				onclick={refreshCheckpoints}
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
				刷新
			</button>
		</div>
	</div>

	<!-- Success message -->
	{#if successMessage}
		<div class="px-3 py-2 text-xs bg-green-50 text-green-600 rounded-lg border border-green-200">
			{successMessage}
		</div>
	{/if}

	<!-- Create checkpoint form (inline) -->
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
			<div class="space-y-2">
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={syncToCloud}
						onclick={(e) => e.stopPropagation()}
						class="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
					/>
					<span class="text-sm text-gray-700">同步到云端</span>
				</label>
				{#if syncToCloud}
					<div class="ml-6">
						<span class="block text-xs font-medium text-gray-600 mb-1">可见性</span>
						<Dropdown
							items={visibilityOptions}
							bind:value={selectedVisibility}
							getLabel={(item) => item.label}
							getKey={(item) => item.value}
							size="sm"
							class="w-full"
						/>
					</div>
				{/if}
			</div>
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
						创建存档
					{/if}
				</button>
				<button
					type="button"
					onclick={() => { showCreateForm = false; newCheckpointTitle = ''; newCheckpointDescription = ''; syncToCloud = false; }}
					class="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
				>
					取消
				</button>
			</div>
		</div>
	{/if}

	<!-- Error message (below create form, requires manual dismissal) -->
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
		{#if mergedCheckpoints.length > 0}
			<div class="divide-y divide-gray-100">
				{#each mergedCheckpoints as checkpoint (checkpoint.id)}
					<div class="p-3 hover:bg-gray-50 transition-colors">
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-medium text-gray-800 truncate">
										{checkpoint.title}
									</span>
									<!-- Sync status badges -->
									<div class="flex items-center gap-1">
										{#if checkpoint.isLocal}
											<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded" title="本地存档">本地</span>
										{/if}
										{#if checkpoint.isCloud}
											<span class="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded" title="已同步到云端">
												<svg class="w-3 h-3 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
												</svg>
												云端
											</span>
										{/if}
									</div>
								</div>
								<div class="text-xs text-gray-500 mt-0.5">
									{formatDate(checkpoint.timestamp)} · {checkpoint.quadCount} 条数据
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
									<div class="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
										{#if checkpoint.isLocal && !checkpoint.isCloud}
											<!-- Upload with submenu for visibility selection -->
											<button
												type="button"
												onmouseenter={(e) => handleUploadMouseEnter(checkpoint.id, e)}
												onmouseleave={handleUploadMouseLeave}
												disabled={isUploading}
												class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 flex items-center justify-between gap-2"
											>
												<span class="flex items-center gap-2">
													<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
													</svg>
													上传
												</span>
												<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
												</svg>
											</button>
										{/if}
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
				暂无存档
			</div>
		{:else}
			<div class="px-3 py-6 text-sm text-gray-400 text-center">
				加载中...
			</div>
		{/if}
	</div>

	<!-- Cloud save info -->
	{#if hasSave}
		<p class="text-xs text-gray-400">
			云存档 ID: {saveId?.slice(0, 8)}...
		</p>
	{/if}
</div>

<!-- Fixed position upload visibility submenu (rendered outside overflow container) -->
{#if hoveredCheckpoint && submenuPosition}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="upload-submenu fixed w-24 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1"
		style="top: {submenuPosition.top}px; left: {submenuPosition.left}px;"
		onmouseleave={handleSubmenuMouseLeave}
	>
		<button
			type="button"
			onclick={() => uploadCheckpoint(hoveredCheckpoint, 'PRIVATE')}
			disabled={isUploading}
			class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
		>
			私有
		</button>
		<button
			type="button"
			onclick={() => uploadCheckpoint(hoveredCheckpoint, 'UNLISTED')}
			disabled={isUploading}
			class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
		>
			不公开
		</button>
		<button
			type="button"
			onclick={() => uploadCheckpoint(hoveredCheckpoint, 'PUBLIC')}
			disabled={isUploading}
			class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
		>
			公开
		</button>
	</div>
{/if}
