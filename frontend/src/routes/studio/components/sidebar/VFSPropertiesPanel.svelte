<script lang="ts">
	/**
	 * VFSPropertiesPanel - File list and management for VFS nodes in sidebar
	 */
	import { onMount, onDestroy } from 'svelte';
	import type { VFSNodeData } from '../../types';
	import { getNodeVfs, type VersionedVfs } from '../../vfs';
	import { getStudioContext } from '../../state';
	import FileTree from '$lib/components/FileTree/FileTree.svelte';
	import type { FileItem, FileOperations } from '$lib/components/FileTree/types';
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

	let vfs: VersionedVfs | null = $state(null);
	let fileTree = $state<FileItem[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let expandedFolders = $state<Set<string>>(new Set());
	let selectedFilePath = $state<string | undefined>(undefined);
	
	// Event unsubscribe functions
	let eventUnsubscribers: (() => void)[] = [];

	// ============================================================================
	// Derived
	// ============================================================================

	const fileCount = $derived(countFiles(fileTree));
	const folderCount = $derived(countFolders(fileTree));

	function countFiles(items: FileItem[]): number {
		let count = 0;
		for (const item of items) {
			if (item.type === 'file') count++;
			if (item.files) count += countFiles(item.files);
		}
		return count;
	}

	function countFolders(items: FileItem[]): number {
		let count = 0;
		for (const item of items) {
			if (item.type === 'folder') {
				count++;
				if (item.files) count += countFolders(item.files);
			}
		}
		return count;
	}

	// ============================================================================
	// File Operations (for FileTree)
	// ============================================================================

	const fileOperations: FileOperations = {
		onRename: async (oldPath, newPath) => {
			if (!vfs) return;
			await vfs.moveItem(oldPath, newPath);
			if (selectedFilePath === oldPath) {
				selectedFilePath = newPath;
				persistUIState({ selectedFilePath: newPath });
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
			persistUIState({ expandedFolders: Array.from(newExpanded) });
		},
		onMove: async (oldPath, newPath) => {
			if (!vfs) return;
			await vfs.moveItem(oldPath, newPath);
			if (selectedFilePath === oldPath) {
				selectedFilePath = newPath;
				persistUIState({ selectedFilePath: newPath });
			}
		},
		onUpload: async (files: FileList) => {
			if (!vfs) return;
			
			for (const file of files) {
				// Use webkitRelativePath for folder uploads, otherwise just the file name
				const relativePath = (file as any).webkitRelativePath || file.name;
				const targetPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
				
				// Create parent directories if needed
				const parentDir = targetPath.slice(0, targetPath.lastIndexOf('/'));
				if (parentDir && parentDir !== '/') {
					await ensureFolderExists(parentDir);
				}
				
				// Read file content
				const content = await file.arrayBuffer();
				
				// Create or update the file
				try {
					await vfs.createFile(targetPath, content);
				} catch {
					// File might already exist, try to update it
					await vfs.updateFile(targetPath, content);
				}
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
					if ('parentFolderId' in entry && !('size' in entry)) {
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

	// Helper function to ensure folder exists
	async function ensureFolderExists(folderPath: string) {
		if (!vfs) return;
		
		const parts = folderPath.split('/').filter(Boolean);
		let currentPath = '';
		
		for (const part of parts) {
			currentPath += '/' + part;
			try {
				await vfs.createFolder(currentPath);
			} catch {
				// Folder might already exist, ignore error
			}
		}
	}

	// ============================================================================
	// Initialization
	// ============================================================================

	onMount(async () => {
		// Initialize UI state from persisted data
		expandedFolders = new Set(data.expandedFolders ?? []);
		selectedFilePath = data.selectedFilePath ?? undefined;
		
		try {
			vfs = await getNodeVfs(data.content.projectId, nodeId);
			await refreshFileTree();
			setupVfsEventListeners();
			isLoading = false;
		} catch (err) {
			console.error('Failed to initialize VFS:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize';
			isLoading = false;
		}
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
		eventUnsubscribers.push(
			events.on('file:created', () => refreshFileTree()),
			events.on('file:updated', () => refreshFileTree()),
			events.on('file:deleted', () => refreshFileTree()),
			events.on('file:moved', () => refreshFileTree()),
			events.on('folder:created', () => refreshFileTree()),
			events.on('folder:deleted', () => refreshFileTree()),
			events.on('folder:moved', () => refreshFileTree()),
			events.on('version:checkout', () => refreshFileTree())
		);
	}

	// ============================================================================
	// File Tree Operations
	// ============================================================================

	async function refreshFileTree() {
		if (!vfs) return;
		try {
			const items = await loadFolderContents('/');
			fileTree = items;
		} catch (err) {
			console.error('Failed to load file tree:', err);
		}
	}

	function isVfsFolder(item: { folderId?: string; parentFolderId?: string }): boolean {
		return 'parentFolderId' in item && !('size' in item);
	}

	async function loadFolderContents(folderPath: string): Promise<FileItem[]> {
		if (!vfs) return [];

		const items: FileItem[] = [];
		const entries = await vfs.listFolder(folderPath);

		for (const entry of entries) {
			if (isVfsFolder(entry)) {
				const children = await loadFolderContents(entry.path);
				items.push({ 
					type: 'folder', 
					name: entry.name, 
					path: entry.path, 
					files: children 
				});
			} else {
				items.push({ 
					type: 'file', 
					name: entry.name, 
					path: entry.path 
				});
			}
		}

		items.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		return items;
	}

	// ============================================================================
	// UI Actions
	// ============================================================================

	function handleFileClick(item: FileItem) {
		selectedFilePath = item.path;
		persistUIState({ selectedFilePath: item.path });
		onOpenFile(nodeId, item.path);
	}

	function handleExpandedChange(folders: Set<string>) {
		expandedFolders = folders;
		persistUIState({ expandedFolders: Array.from(folders) });
	}

	function handleSelectionChange(path: string | undefined) {
		selectedFilePath = path;
		if (path) {
			persistUIState({ selectedFilePath: path });
		}
	}

	function persistUIState(updates: Partial<{
		expandedFolders: string[];
		selectedFilePath: string;
	}>) {
		ctx.updateNode(nodeId, (nodeData) => ({
			...nodeData,
			...updates
		}));
	}
</script>

<div class="flex flex-col">
	<!-- File List Header -->
	<div class="flex items-center justify-between mb-2">
		<span class="text-xs font-medium text-gray-500">{m.studio_overview_files()}</span>
	</div>

	<!-- File Tree -->
	<div class="rounded-lg border border-gray-200 bg-gray-50 max-h-80 overflow-y-auto">
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
				selectedPath={selectedFilePath}
				draggable={true}
				contextMenuEnabled={true}
				showQuickActions={true}
				operations={fileOperations}
				onFileClick={handleFileClick}
				onExpandedChange={handleExpandedChange}
				onSelectionChange={handleSelectionChange}
				onRefresh={refreshFileTree}
				class="p-1"
			/>
		{/if}
	</div>

	<!-- Stats footer -->
	<div class="mt-2 text-xs text-gray-400 flex items-center gap-3">
		<span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
		<span>{folderCount} folder{folderCount !== 1 ? 's' : ''}</span>
	</div>
</div>
