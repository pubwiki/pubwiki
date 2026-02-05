<script lang="ts">
	/**
	 * VFSPropertiesPanel - File list and management for VFS nodes in sidebar
	 * Uses shared VfsController with VFSNode for single event subscription
	 */
	import type { VFSNodeData } from '$lib/types';
	import { countFiles, countFolders, type LocalSyncStatus } from '$lib/vfs';
	import { isVfsFolder } from '@pubwiki/vfs';
	import { getVfsController, releaseVfsController, type VfsController } from '../../../nodes/vfs/controller.svelte';
	import UploadOverlay from '../../../nodes/vfs/UploadOverlay.svelte';
	import { getStudioContext } from '$lib/state';
	import { FileTree, type FileItem, type FileOperations } from '@pubwiki/ui/components';
	import VFSGitPanel from './VFSGitPanel.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		nodeId: string;
		data: VFSNodeData;
		onOpenFile: (nodeId: string, filePath: string) => void;
	}

	let { nodeId, data, onOpenFile }: Props = $props();

	const ctx = getStudioContext();

	// ============================================================================
	// State
	// ============================================================================

	let controller: VfsController | null = $state<VfsController | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let expandedFolders = $state<Set<string>>(new Set());
	let selectedFilePath = $state<string | undefined>(undefined);
	let focusedPaths = $state<Set<string>>(new Set());

	// Local Sync State
	let showDisconnectConfirm = $state(false);

	// ============================================================================
	// Derived
	// ============================================================================

	const fileTree = $derived(controller?.fileTree ?? []);
	const fileCount = $derived(countFiles(fileTree));
	const folderCount = $derived(countFolders(fileTree));
	const vfs = $derived(controller?.vfs ?? null);
	const uploadState = $derived(controller?.uploadState);
	const localSync = $derived(controller?.localSync);
	const localSyncStatus = $derived<LocalSyncStatus>(localSync?.state.status ?? 'disconnected');
	const localSyncState = $derived(localSync?.state);

	// ============================================================================
	// File Operations (for FileTree)
	// ============================================================================

	const fileOperations: FileOperations = {
		onRename: async (oldPath, newPath) => {
			if (!vfs) return;
			await vfs.moveItem(oldPath, newPath);
			if (selectedFilePath === oldPath) {
				selectedFilePath = newPath;
			}
		},
		onDelete: async (path, isFolder) => {
			if (!vfs) return;
			if (isFolder) {
				await vfs.deleteFolder(path, true);
			} else {
				await vfs.deleteFile(path);
				if (selectedFilePath === path) {
					selectedFilePath = undefined;
				}
			}
		},
		onCreateFile: async (path) => {
			if (!vfs) return;
			await vfs.createFile(path, '');
		},
		onCreateFolder: async (path) => {
			if (!vfs) return;
			await vfs.createFolder(path);
			// Auto-expand newly created folder
			const newExpanded = new Set(expandedFolders);
			newExpanded.add(path);
			expandedFolders = newExpanded;
		},
		onMove: async (oldPath, newPath) => {
			if (!vfs) return;
			await vfs.moveItem(oldPath, newPath);
			if (selectedFilePath === oldPath) {
				selectedFilePath = newPath;
			}
		},
		onUpload: async (files: FileList) => {
			if (!vfs || !controller) return;
			
			// Capture controller reference to avoid null access if component unmounts during upload
			const ctrl = controller;
			const currentVfs = vfs;
			const totalFiles = files.length;
			
			// Set uploading flag to pause git status monitoring
			ctrl.setUploading(true, { current: 0, total: totalFiles });
			
			// Track created directories to avoid redundant createFolder calls
			const createdDirs = new Set<string>();
			let filesProcessed = 0;
			
			try {
				for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
					const file = files[fileIndex];
					
					// Use webkitRelativePath for folder uploads, otherwise just the file name
					const relativePath = (file as any).webkitRelativePath || file.name;
					const targetPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
					
					// Create parent directory if needed (only once per unique directory)
					const parentDir = targetPath.slice(0, targetPath.lastIndexOf('/'));
					if (parentDir && parentDir !== '/' && !createdDirs.has(parentDir)) {
						try {
							await currentVfs.createFolder(parentDir);
						} catch {
							// Directory might already exist
						}
						createdDirs.add(parentDir);
						// Also mark all parent directories as created
						let dir = parentDir;
						while (dir.includes('/')) {
							dir = dir.slice(0, dir.lastIndexOf('/'));
							if (dir) createdDirs.add(dir);
						}
					}
					
					// Read file content
					const content = await file.arrayBuffer();
					
					// Create or update the file
					try {
						await currentVfs.createFile(targetPath, content);
					} catch {
						// File might already exist, try to update it
						await currentVfs.updateFile(targetPath, content);
					}
					
					filesProcessed++;
					
					// Update progress
					ctrl.setUploading(true, { current: filesProcessed, total: totalFiles });
				}
			} finally {
				// Always clear uploading flag when done
				ctrl.setUploading(false);
			}
		},
		onDownload: async () => {
			if (!vfs) return;
			
			const JSZip = (await import('jszip')).default;
			const zip = new JSZip();
			
			// Recursively add all files to zip
			async function addFilesToZip(folderPath: string) {
				const entries = await vfs!.listFolder(folderPath);
				
				for (const entry of entries) {
					if (isVfsFolder(entry)) {
						// It's a folder
						await addFilesToZip(entry.path);
					} else {
						// It's a file
						const file = await vfs!.readFile(entry.path);
						// Remove leading slash for zip path
						const zipPath = entry.path.startsWith('/') ? entry.path.slice(1) : entry.path;
						if (file.content !== undefined) {
							zip.file(zipPath, file.content);
						}
					}
				}
			}
			
			await addFilesToZip('/');
			
			// Generate zip and download
			const blob = await zip.generateAsync({ type: 'blob' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${nodeId || 'vfs'}.zip`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	};

	// ============================================================================
	// Initialization - $effect handles lifecycle automatically
	// ============================================================================

	$effect(() => {
		// Track dependencies
		const currentNodeId = nodeId;
		const currentProjectId = data.content.projectId;
		
		// State for this effect instance
		let cancelled = false;
		
		// Reset UI state
		isLoading = true;
		error = null;
		expandedFolders = new Set();
		selectedFilePath = undefined;
		
		// Async initialization
		(async () => {
			try {
				const ctrl = await getVfsController(currentProjectId, currentNodeId);
				if (cancelled) {
					releaseVfsController(currentNodeId);
					return;
				}
				
				controller = ctrl;
				isLoading = ctrl.isLoading;
				error = ctrl.error;
			} catch (err) {
				if (cancelled) return;
				console.error('Failed to initialize VFS:', err);
				error = err instanceof Error ? err.message : 'Failed to initialize';
				isLoading = false;
			}
		})();
		
		// Cleanup when effect re-runs or component unmounts
		return () => {
			cancelled = true;
			releaseVfsController(currentNodeId);
			controller = null;
		};
	});

	// ============================================================================
	// UI Actions
	// ============================================================================

	function handleFileClick(item: FileItem) {
		selectedFilePath = item.path;
		onOpenFile(nodeId, item.path);
	}

	function handleExpandedChange(folders: Set<string>) {
		expandedFolders = folders;
	}

	function handleSelectionChange(path: string | undefined) {
		selectedFilePath = path;
	}

	function handleFocusedChange(paths: Set<string>) {
		focusedPaths = paths;
	}
	
	async function handleRefresh() {
		if (controller?.fileTreeService) {
			await controller.fileTreeService.loadFullTree();
		}
	}

	// ============================================================================
	// Local Sync Actions
	// ============================================================================

	async function handleLocalSyncConnect() {
		if (!localSync) return;
		try {
			await localSync.connect();
		} catch (err) {
			// Error is already handled in localSync state
			console.error('Failed to connect local sync:', err);
		}
	}

	function handleLocalSyncDisconnect() {
		if (!localSync) return;
		localSync.disconnect();
		showDisconnectConfirm = false;
	}

	async function handleManualSync() {
		if (!localSync) return;
		try {
			await localSync.manualSync();
		} catch (err) {
			console.error('Manual sync failed:', err);
		}
	}

	function toggleDisconnectConfirm() {
		showDisconnectConfirm = !showDisconnectConfirm;
	}
</script>

<div class="flex flex-col">
	<!-- File List Header -->
	<div class="flex items-center justify-between mb-2">
		<span class="text-xs font-medium text-gray-500">{m.studio_overview_files()}</span>
		
		<!-- Local Sync Button -->
		<div class="relative flex items-center gap-1">
			{#if localSyncStatus === 'synced' || localSyncStatus === 'syncing'}
				{#if showDisconnectConfirm}
					<div class="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-md flex items-center gap-2">
						<span>{m.studio_vfs_local_sync_disconnect()}?</span>
						<button
							type="button"
							class="flex items-center justify-center hover:bg-amber-200 rounded p-0.5 transition-colors"
							onclick={toggleDisconnectConfirm}
							title="Cancel"
						>
							<svg class="w-3 h-3 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="12" cy="12" r="10"/>
								<path d="M15 9l-6 6m0-6l6 6"/>
							</svg>
						</button>
						<button
							type="button"
							class="flex items-center justify-center hover:bg-amber-200 rounded p-0.5 transition-colors"
							onclick={handleLocalSyncDisconnect}
							title="Confirm disconnect"
						>
							<svg class="w-3 h-3 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="12" cy="12" r="10"/>
								<path d="M9 12l2 2 4-4"/>
							</svg>
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-md flex items-center gap-1 hover:bg-green-200 transition-colors"
						onclick={toggleDisconnectConfirm}
						title={m.studio_vfs_local_sync_disconnect()}
					>
						{#if localSyncStatus === 'syncing'}
							<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							{m.studio_vfs_local_syncing()}
						{:else}
							<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="12" cy="12" r="10"/>
								<path d="M9 12l2 2 4-4"/>
							</svg>
							{localSyncState?.directoryName ?? m.studio_vfs_local_synced()}
						{/if}
					</button>
					
					<!-- Manual sync button when observer is not supported -->
					{#if !localSyncState?.observerSupported && localSyncStatus === 'synced'}
						<button
							type="button"
							class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-md flex items-center gap-1 hover:bg-blue-200 transition-colors"
							onclick={handleManualSync}
							title={m.studio_vfs_local_sync_manual()}
						>
							<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M21 12a9 9 0 11-9-9"/>
								<path d="M21 3v6h-6"/>
							</svg>
						</button>
					{/if}
				{/if}
			{:else if localSyncStatus === 'connecting'}
				<button
					type="button"
					class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-md flex items-center gap-1"
					disabled
				>
					<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					{m.studio_vfs_local_syncing()}
				</button>
			{:else}
				<button
					type="button"
					class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-md flex items-center gap-1 hover:bg-blue-200 transition-colors"
					onclick={handleLocalSyncConnect}
				>
					<!-- Folder Icon -->
					<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
					</svg>
					{m.studio_vfs_local_sync()}
				</button>
			{/if}
			
			<!-- Error tooltip -->
			{#if localSyncState?.error}
				<div class="text-xs text-red-500" title={localSyncState.error}>
					<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/>
						<path d="M12 8v4m0 4h.01"/>
					</svg>
				</div>
			{/if}
		</div>
	</div>

	<!-- File Tree -->
	<div class="rounded-lg border border-gray-200 bg-gray-50 relative" class:min-h-32={uploadState?.isUploading}>
		{#if isLoading}
			<div class="flex items-center justify-center py-8 text-gray-400 text-xs">
				{m.studio_vfs_loading()}
			</div>
		{:else if error}
			<div class="flex items-center justify-center py-4 text-red-500 text-xs px-3">
				{error}
			</div>
		{:else}
			<FileTree
				items={fileTree}
				{expandedFolders}
				{focusedPaths}
				selectedPath={selectedFilePath}
				draggable={!uploadState?.isUploading}
				contextMenuEnabled={!uploadState?.isUploading}
				showQuickActions={!uploadState?.isUploading}
				operations={uploadState?.isUploading ? undefined : fileOperations}
				onFileClick={uploadState?.isUploading ? undefined : handleFileClick}
				onExpandedChange={handleExpandedChange}
				onSelectionChange={handleSelectionChange}
				onFocusedChange={handleFocusedChange}
				onRefresh={uploadState?.isUploading ? undefined : handleRefresh}
				class="p-1"
			/>
			
			<!-- Upload overlay -->
			{#if uploadState?.isUploading && uploadState.progress}
				<UploadOverlay progress={uploadState.progress} />
			{/if}
		{/if}
	</div>

	<!-- Stats footer -->
	<div class="mt-2 text-xs text-gray-400 flex items-center gap-3">
		<span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
		<span>{folderCount} folder{folderCount !== 1 ? 's' : ''}</span>
	</div>

	<!-- Git Version Control -->
	<div class="mt-4 pt-4 border-t border-gray-200">
		<VFSGitPanel {nodeId} {data} />
	</div>
</div>
