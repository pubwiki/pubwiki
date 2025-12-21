<script lang="ts">
	/**
	 * VFSExpandedView - Floating panel for VFS file browser with Monaco editor
	 * 
	 * This is the expanded/detailed view for VFS nodes, separate from the compact node view.
	 */
	import { onMount, onDestroy, tick } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import loader from '@monaco-editor/loader';
	import type * as Monaco from 'monaco-editor';
	import type { VersionedVfs } from '../../stores/vfs';

	// ============================================================================
	// Types
	// ============================================================================

	interface FileItem {
		type: 'file' | 'folder';
		name: string;
		path: string;
		files?: FileItem[];
	}

	interface ContextMenuState {
		visible: boolean;
		x: number;
		y: number;
		target: FileItem | null;
		targetType: 'file' | 'folder' | 'root';
	}

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		vfs: VersionedVfs;
		name: string;
		fileTree: FileItem[];
		expandedFolders: Set<string>;
		initialSelectedFilePath?: string;
		onClose: () => void;
		onRefresh: () => Promise<void>;
		onExpandedFoldersChange: (folders: Set<string>) => void;
		onSelectedFileChange?: (path: string | undefined) => void;
	}

	let {
		vfs,
		name,
		fileTree,
		expandedFolders,
		initialSelectedFilePath,
		onClose,
		onRefresh,
		onExpandedFoldersChange,
		onSelectedFileChange
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let selectedFile = $state<FileItem | null>(null);
	let fileContent = $state<string>('');
	
	// Track dirty state using Monaco's alternative version ID
	let lastSavedVersionId = $state(0);
	let currentVersionId = $state(0);
	let isDirty = $derived(currentVersionId !== lastSavedVersionId);

	// Monaco editor state
	let editorContainer = $state<HTMLDivElement | null>(null);
	let monaco: typeof Monaco | null = $state(null);
	let editor: Monaco.editor.IStandaloneCodeEditor | null = $state(null);

	// Context menu state
	let contextMenu = $state<ContextMenuState>({
		visible: false,
		x: 0,
		y: 0,
		target: null,
		targetType: 'root'
	});

	// Inline editing state
	let inlineEdit = $state<{
		active: boolean;
		type: 'new-file' | 'new-folder' | 'rename';
		parentPath: string;
		target?: FileItem;
		name: string;
	}>({
		active: false,
		type: 'new-file',
		parentPath: '/',
		name: ''
	});

	// Drag and drop state
	let draggedItem = $state<FileItem | null>(null);
	let dragOverItem = $state<FileItem | null>(null);
	let dragOverRoot = $state(false);

	// ============================================================================
	// Initialization
	// ============================================================================

	onMount(async () => {
		monaco = await loader.init();
		
		// Restore selected file from persisted path
		if (initialSelectedFilePath) {
			const file = findFileByPath(fileTree, initialSelectedFilePath);
			if (file && file.type === 'file') {
				selectedFile = file;
				await loadFileContent(file);
			}
		}
	});

	onDestroy(() => {
		if (editor) {
			editor.dispose();
			editor = null;
		}
	});

	// Create editor when container is ready and file is selected
	$effect(() => {
		if (monaco && editorContainer && selectedFile && !editor) {
			createEditor(fileContent, selectedFile.name);
		}
	});

	// ============================================================================
	// Helper Functions
	// ============================================================================

	function findFileByPath(items: FileItem[], path: string): FileItem | null {
		for (const item of items) {
			if (item.path === path) return item;
			if (item.files) {
				const found = findFileByPath(item.files, path);
				if (found) return found;
			}
		}
		return null;
	}

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
	// File Operations
	// ============================================================================

	async function handleFileClick(item: FileItem) {
		if (item.type === 'folder') {
			toggleFolder(item.path);
			return;
		}

		if (isDirty && selectedFile) {
			await saveCurrentFile();
		}

		selectedFile = item;
		onSelectedFileChange?.(item.path);
		await loadFileContent(item);
	}

	function toggleFolder(path: string) {
		const newExpanded = new Set(expandedFolders);
		if (newExpanded.has(path)) {
			newExpanded.delete(path);
		} else {
			newExpanded.add(path);
		}
		onExpandedFoldersChange(newExpanded);
	}

	async function loadFileContent(item: FileItem) {
		try {
			const file = await vfs.readFile(item.path);
			// VfsFile.content can be string or ArrayBuffer
			let content: string;
			if (typeof file.content === 'string') {
				content = file.content;
			} else {
				const decoder = new TextDecoder();
				content = decoder.decode(file.content);
			}
			fileContent = content;

			if (editor) {
				editor.setValue(content);
				const ext = item.name.split('.').pop() || '';
				const language = getLanguageFromExtension(ext);
				monaco?.editor.setModelLanguage(editor.getModel()!, language);
			} else if (monaco && editorContainer) {
				createEditor(content, item.name);
			}
			// Record the version ID after loading as the "saved" state
			const versionId = editor?.getModel()?.getAlternativeVersionId() ?? 0;
			lastSavedVersionId = versionId;
			currentVersionId = versionId;
		} catch (err) {
			console.error('Failed to load file:', err);
			fileContent = '';
		}
	}

	function getLanguageFromExtension(ext: string): string {
		const languageMap: Record<string, string> = {
			'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
			'json': 'json', 'html': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',
			'md': 'markdown', 'py': 'python', 'rs': 'rust', 'go': 'go', 'java': 'java',
			'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp', 'yaml': 'yaml', 'yml': 'yaml',
			'xml': 'xml', 'sql': 'sql', 'sh': 'shell', 'bash': 'shell', 'svelte': 'html', 'vue': 'html'
		};
		return languageMap[ext.toLowerCase()] || 'plaintext';
	}

	function createEditor(content: string, filename: string) {
		if (!monaco || !editorContainer) return;

		const ext = filename.split('.').pop() || '';
		const language = getLanguageFromExtension(ext);

		editor = monaco.editor.create(editorContainer, {
			value: content,
			language,
			theme: 'vs',
			minimap: { enabled: false },
			fontSize: 13,
			lineNumbers: 'on',
			scrollBeyondLastLine: false,
			automaticLayout: true,
			wordWrap: 'on',
			tabSize: 2
		});

		editor.onDidChangeModelContent(() => {
			fileContent = editor!.getValue();
			// Update current version ID to trigger dirty state recalculation
			currentVersionId = editor!.getModel()?.getAlternativeVersionId() ?? 0;
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			saveCurrentFile();
		});
	}

	async function saveCurrentFile() {
		if (!selectedFile || !isDirty) return;

		try {
			await vfs.updateFile(selectedFile.path, fileContent);
			// Update saved version ID after successful save
			lastSavedVersionId = editor?.getModel()?.getAlternativeVersionId() ?? 0;
		} catch (err) {
			console.error('Failed to save file:', err);
		}
	}

	// ============================================================================
	// Drag and Drop
	// ============================================================================

	function handleDragStart(e: DragEvent, item: FileItem) {
		draggedItem = item;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', item.path);
		}
	}

	function handleDragOver(e: DragEvent, item: FileItem | null) {
		e.preventDefault();
		e.stopPropagation();
		if (!draggedItem) return;

		if (item && (item.path === draggedItem.path || item.path.startsWith(draggedItem.path + '/'))) {
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
			dragOverItem = null;
			dragOverRoot = false;
			return;
		}

		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

		if (item) {
			dragOverItem = item;
			dragOverRoot = false;
		} else {
			dragOverItem = null;
			dragOverRoot = true;
		}
	}

	function handleDragLeave(e: DragEvent) {
		e.stopPropagation();
	}

	function handleDragEnd() {
		draggedItem = null;
		dragOverItem = null;
		dragOverRoot = false;
	}

	async function handleDrop(e: DragEvent, targetItem: FileItem | null) {
		e.preventDefault();
		e.stopPropagation();

		if (!draggedItem) {
			handleDragEnd();
			return;
		}

		const draggedPath = draggedItem.path;
		const draggedName = draggedItem.name;

		let targetFolder = '/';
		if (targetItem) {
			if (targetItem.type === 'folder') {
				targetFolder = targetItem.path;
			} else {
				const lastSlash = targetItem.path.lastIndexOf('/');
				targetFolder = lastSlash === 0 ? '/' : targetItem.path.slice(0, lastSlash);
			}
		}

		const newPath = targetFolder === '/' ? `/${draggedName}` : `${targetFolder}/${draggedName}`;

		if (newPath === draggedPath) {
			handleDragEnd();
			return;
		}

		handleDragEnd();

		try {
			await vfs.moveItem(draggedPath, newPath);

			if (selectedFile?.path === draggedPath) {
				selectedFile = { ...selectedFile, path: newPath };
				onSelectedFileChange?.(newPath);
			}

			await onRefresh();

			if (targetFolder !== '/') {
				const newExpanded = new Set(expandedFolders);
				newExpanded.add(targetFolder);
				onExpandedFoldersChange(newExpanded);
			}
		} catch (err) {
			console.error('Failed to move item:', err);
		}
	}

	// ============================================================================
	// Context Menu
	// ============================================================================

	function handleContextMenu(e: MouseEvent, item: FileItem | null) {
		if (!item) return;
		e.preventDefault();
		e.stopPropagation();
		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			target: item,
			targetType: item.type
		};
	}

	function closeContextMenu() {
		contextMenu = { ...contextMenu, visible: false };
	}

	function handleRename() {
		if (!contextMenu.target) return;
		const parentPath = contextMenu.target.path.slice(0, contextMenu.target.path.lastIndexOf('/')) || '/';
		inlineEdit = {
			active: true,
			type: 'rename',
			parentPath,
			target: contextMenu.target,
			name: contextMenu.target.name
		};
		closeContextMenu();
	}

	async function handleDelete() {
		if (!contextMenu.target) return;

		const target = contextMenu.target;
		const confirmMsg = target.type === 'folder'
			? `Delete folder "${target.name}" and all its contents?`
			: `Delete file "${target.name}"?`;

		if (!confirm(confirmMsg)) {
			closeContextMenu();
			return;
		}

		try {
			if (target.type === 'folder') {
				await vfs.deleteFolder(target.path, true);
			} else {
				await vfs.deleteFile(target.path);
				if (selectedFile?.path === target.path) {
					selectedFile = null;
					fileContent = '';
					if (editor) editor.setValue('');
					onSelectedFileChange?.(undefined);
				}
			}
			await onRefresh();
		} catch (err) {
			console.error('Failed to delete:', err);
		}

		closeContextMenu();
	}

	async function confirmInlineEdit() {
		if (!inlineEdit.name.trim()) {
			cancelInlineEdit();
			return;
		}

		const editName = inlineEdit.name.trim();
		const fullPath = inlineEdit.parentPath === '/' ? `/${editName}` : `${inlineEdit.parentPath}/${editName}`;

		try {
			if (inlineEdit.type === 'rename' && inlineEdit.target) {
				await vfs.moveItem(inlineEdit.target.path, fullPath);
				if (selectedFile?.path === inlineEdit.target.path) {
					selectedFile = { ...selectedFile, name: editName, path: fullPath };
					onSelectedFileChange?.(fullPath);
				}
			} else if (inlineEdit.type === 'new-folder') {
				await vfs.createFolder(fullPath);
				const newExpanded = new Set(expandedFolders);
				newExpanded.add(fullPath);
				onExpandedFoldersChange(newExpanded);
			} else {
				await vfs.createFile(fullPath, '');
			}
			await onRefresh();
		} catch (err) {
			console.error('Failed to complete inline edit:', err);
		}

		cancelInlineEdit();
	}

	function cancelInlineEdit() {
		inlineEdit = { active: false, type: 'new-file', parentPath: '/', name: '' };
	}

	function handleInlineKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			confirmInlineEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelInlineEdit();
		}
	}

	function focusInlineInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function handleWindowClick() {
		if (contextMenu.visible) closeContextMenu();
	}

	function handleClose() {
		if (isDirty && selectedFile) {
			saveCurrentFile();
		}
		if (editor) {
			editor.dispose();
			editor = null;
		}
		onClose();
	}
</script>

<svelte:window onclick={handleWindowClick} />

<!-- Expanded View (Floating Panel) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	use:portal
	class="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
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
		<div class="flex items-center justify-between px-4 py-3 bg-indigo-500 text-white">
			<div class="flex items-center gap-3">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
				<span class="font-medium">{name || 'Virtual File System'}</span>
				{#if isDirty}
					<span class="text-xs bg-white/20 px-2 py-0.5 rounded">Unsaved</span>
				{/if}
			</div>
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

		<!-- Content -->
		<div class="flex flex-1 overflow-hidden" style="min-width: 0;">
			<!-- File Tree Panel -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="border-r border-gray-200 overflow-y-auto bg-gray-50 text-sm flex flex-col shrink-0"
				style="width: 240px;"
				oncontextmenu={(e) => handleContextMenu(e, null)}
				ondragover={(e) => handleDragOver(e, null)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, null)}
			>
				<div class="p-2 flex-1 {dragOverRoot ? 'bg-indigo-100' : ''}">
					{#if inlineEdit.active && inlineEdit.type !== 'rename' && inlineEdit.parentPath === '/'}
						{@render inlineNewItemInput(0)}
					{/if}
					{#if fileTree.length === 0 && !inlineEdit.active}
						<div class="text-gray-400 text-xs px-2 py-8 text-center">
							Empty folder<br />
							<span class="text-gray-500">Right-click to create files</span>
						</div>
					{:else}
						{#each fileTree as item}
							{@render fileTreeItem(item, 0)}
						{/each}
					{/if}
				</div>

				<!-- Quick actions -->
				<div class="border-t border-gray-200 p-2 flex gap-1">
					<button
						class="flex-1 px-2 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center gap-1 transition-colors"
						onclick={() => { inlineEdit = { active: true, type: 'new-file', parentPath: '/', name: '' }; }}
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
						File
					</button>
					<button
						class="flex-1 px-2 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center gap-1 transition-colors"
						onclick={() => { inlineEdit = { active: true, type: 'new-folder', parentPath: '/', name: '' }; }}
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
						Folder
					</button>
				</div>
			</div>

			<!-- Editor Panel -->
			<div class="flex-1 flex flex-col min-w-0">
				{#if selectedFile}
					<div class="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
						<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
						<span class="text-sm text-gray-700 truncate">{selectedFile.path}</span>
						{#if isDirty}
							<span class="text-xs text-amber-600">●</span>
						{/if}
						<div class="flex-1"></div>
						<button
							class="px-2 py-1 text-xs bg-indigo-500 hover:bg-indigo-600 text-white rounded transition-colors disabled:opacity-50"
							onclick={saveCurrentFile}
							disabled={!isDirty}
						>
							Save
						</button>
					</div>
					<div bind:this={editorContainer} class="flex-1"></div>
				{:else}
					<div class="flex-1 flex items-center justify-center text-gray-400 text-sm">
						Select a file to edit
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- Context Menu -->
{#if contextMenu.visible}
	<div
		use:portal
		class="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-32 z-[10000]"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
	>
		<button
			class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
			onclick={handleRename}
		>
			<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
			</svg>
			Rename
		</button>
		<button
			class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 text-red-600 flex items-center gap-2"
			onclick={handleDelete}
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
			</svg>
			Delete
		</button>
	</div>
{/if}

<!-- File Tree Item Snippet -->
{#snippet fileTreeItem(item: FileItem, depth: number)}
	{#if inlineEdit.active && inlineEdit.type === 'rename' && inlineEdit.target?.path === item.path}
		<div
			class="flex items-center gap-1.5 py-0.5 px-2"
			style="padding-left: {depth * 14 + 8}px"
		>
			{#if item.type === 'folder'}
				<svg class="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
			{:else}
				<svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
			{/if}
			<input
				type="text"
				class="flex-1 px-1.5 py-0.5 text-sm border border-indigo-400 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
				bind:value={inlineEdit.name}
				onkeydown={handleInlineKeydown}
				onblur={confirmInlineEdit}
				use:focusInlineInput
			/>
		</div>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-gray-700 hover:bg-gray-200 transition-colors
				{selectedFile?.path === item.path ? 'bg-indigo-100 text-indigo-700' : ''}
				{dragOverItem?.path === item.path ? 'bg-indigo-200 ring-2 ring-indigo-400' : ''}
				{draggedItem?.path === item.path ? 'opacity-50' : ''}"
			style="padding-left: {depth * 14 + 8}px"
			draggable="true"
			ondragstart={(e) => handleDragStart(e, item)}
			ondragover={(e) => handleDragOver(e, item)}
			ondragleave={handleDragLeave}
			ondragend={handleDragEnd}
			ondrop={(e) => handleDrop(e, item)}
			onclick={() => handleFileClick(item)}
			oncontextmenu={(e) => handleContextMenu(e, item)}
		>
			{#if item.type === 'folder'}
				<svg class="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					{#if expandedFolders.has(item.path)}
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
					{:else}
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
					{/if}
				</svg>
			{:else}
				<svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
			{/if}
			<span class="truncate text-sm">{item.name}</span>
		</div>
	{/if}
	{#if item.type === 'folder' && expandedFolders.has(item.path)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			transition:slide={{ duration: 100 }}
			ondragover={(e) => handleDragOver(e, item)}
			ondrop={(e) => handleDrop(e, item)}
		>
			{#if inlineEdit.active && inlineEdit.type !== 'rename' && inlineEdit.parentPath === item.path}
				{@render inlineNewItemInput(depth + 1)}
			{/if}
			{#if item.files}
				{#each item.files as child}
					{@render fileTreeItem(child, depth + 1)}
				{/each}
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Inline New Item Input Snippet -->
{#snippet inlineNewItemInput(depth: number)}
	<div
		class="flex items-center gap-1.5 py-0.5 px-2"
		style="padding-left: {depth * 14 + 8}px"
	>
		{#if inlineEdit.type === 'new-folder'}
			<svg class="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
			</svg>
		{:else}
			<svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
		{/if}
		<input
			type="text"
			class="flex-1 px-1.5 py-0.5 text-sm border border-indigo-400 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
			placeholder={inlineEdit.type === 'new-folder' ? 'folder name' : 'file name'}
			bind:value={inlineEdit.name}
			onkeydown={handleInlineKeydown}
			onblur={confirmInlineEdit}
			use:focusInlineInput
		/>
	</div>
{/snippet}
