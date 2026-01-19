<script lang="ts">
	/**
	 * FileTree - A full-featured file tree component
	 * 
	 * Features:
	 * - Tree view of files and folders
	 * - Drag-and-drop for moving files
	 * - Context menu (right-click) for rename/delete
	 * - Inline editing for new file/folder creation
	 * - Controlled expand/collapse state
	 * - File selection
	 */
	import { slide } from 'svelte/transition';
	import type { FileItem, FileOperations, ContextMenuState, InlineEditState } from './types';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		/** Tree structure of files */
		items: FileItem[];
		/** Set of expanded folder paths */
		expandedFolders?: Set<string>;
		/** Currently selected file path */
		selectedPath?: string;
		/** Enable drag-and-drop (requires operations.onMove) */
		draggable?: boolean;
		/** Enable context menu (requires operations for rename/delete) */
		contextMenuEnabled?: boolean;
		/** Show quick action buttons at bottom */
		showQuickActions?: boolean;
		/** File operations handlers */
		operations?: FileOperations;
		/** Called when a file is clicked */
		onFileClick?: (item: FileItem) => void;
		/** Called when a folder is toggled */
		onFolderToggle?: (path: string, expanded: boolean) => void;
		/** Called when expanded folders set changes */
		onExpandedChange?: (folders: Set<string>) => void;
		/** Called when selection changes */
		onSelectionChange?: (path: string | undefined) => void;
		/** Called after any file operation completes (for refreshing tree) */
		onRefresh?: () => Promise<void>;
		/** Custom class for the container */
		class?: string;
	}

	let {
		items,
		expandedFolders = new Set(),
		selectedPath,
		draggable = false,
		contextMenuEnabled = false,
		showQuickActions = false,
		operations,
		onFileClick,
		onFolderToggle,
		onExpandedChange,
		onSelectionChange,
		onRefresh,
		class: className = ''
	}: Props = $props();

	// ============================================================================
	// Internal State
	// ============================================================================

	// Context menu
	let contextMenu = $state<ContextMenuState>({
		visible: false,
		x: 0,
		y: 0,
		target: null,
		targetType: 'root'
	});

	// Inline editing
	let inlineEdit = $state<InlineEditState>({
		active: false,
		type: 'new-file',
		parentPath: '/',
		name: ''
	});

	// Drag and drop
	let draggedItem = $state<FileItem | null>(null);
	let dragOverItem = $state<FileItem | null>(null);
	let dragOverRoot = $state(false);

	// File upload input references and dropdown state
	let fileInput: HTMLInputElement | undefined = $state();
	let folderInput: HTMLInputElement | undefined = $state();
	let showUploadMenu = $state(false);
	let uploadButtonRef: HTMLButtonElement | undefined = $state();
	let uploadMenuPosition = $state({ x: 0, y: 0 });

	// Computed upload menu position based on button ref
	function updateUploadMenuPosition() {
		if (uploadButtonRef) {
			const rect = uploadButtonRef.getBoundingClientRect();
			const menuHeight = 76; // Approximate menu height (2 items * ~38px)
			const menuWidth = 112; // min-w-28 = 7rem = 112px
			
			// Position above the button, aligned to right edge
			let x = rect.right - menuWidth;
			let y = rect.top - menuHeight - 4; // 4px gap
			
			// Ensure menu doesn't go above viewport
			if (y < 8) {
				// Show below the button instead
				y = rect.bottom + 4;
			}
			
			// Ensure menu doesn't go off left edge
			if (x < 8) {
				x = 8;
			}
			
			uploadMenuPosition = { x, y };
		}
	}

	// ============================================================================
	// Upload Handler
	// ============================================================================

	async function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		
		await operations?.onUpload?.(input.files);
		await onRefresh?.();
		
		// Reset input to allow uploading the same files again
		input.value = '';
	}

	// ============================================================================
	// Folder Operations
	// ============================================================================

	function toggleFolder(path: string) {
		const newExpanded = new Set(expandedFolders);
		const wasExpanded = newExpanded.has(path);
		
		if (wasExpanded) {
			newExpanded.delete(path);
		} else {
			newExpanded.add(path);
		}
		
		onFolderToggle?.(path, !wasExpanded);
		onExpandedChange?.(newExpanded);
	}

	function handleItemClick(item: FileItem) {
		if (item.type === 'folder') {
			toggleFolder(item.path);
		} else {
			onSelectionChange?.(item.path);
			onFileClick?.(item);
		}
	}

	// ============================================================================
	// Drag and Drop
	// ============================================================================

	function handleDragStart(e: DragEvent, item: FileItem) {
		if (!draggable) return;
		draggedItem = item;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', item.path);
		}
	}

	function handleDragOver(e: DragEvent, item: FileItem | null) {
		if (!draggable || !draggedItem) return;
		e.preventDefault();
		e.stopPropagation();

		// Don't allow dropping on itself or its children
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
		if (!draggable || !draggedItem || !operations?.onMove) {
			handleDragEnd();
			return;
		}
		
		e.preventDefault();
		e.stopPropagation();

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
			await operations.onMove(draggedPath, newPath);

			// Update selection if moved item was selected
			if (selectedPath === draggedPath) {
				onSelectionChange?.(newPath);
			}

			// Expand target folder
			if (targetFolder !== '/') {
				const newExpanded = new Set(expandedFolders);
				newExpanded.add(targetFolder);
				onExpandedChange?.(newExpanded);
			}

			await onRefresh?.();
		} catch (err) {
			console.error('Failed to move item:', err);
		}
	}

	// ============================================================================
	// Context Menu
	// ============================================================================

	function handleContextMenu(e: MouseEvent, item: FileItem | null) {
		if (!contextMenuEnabled) return;
		e.preventDefault();
		e.stopPropagation();
		
		if (item) {
			contextMenu = {
				visible: true,
				x: e.clientX,
				y: e.clientY,
				target: item,
				targetType: item.type
			};
		} else {
			// Right-click on empty space - show root menu for new file/folder
			contextMenu = {
				visible: true,
				x: e.clientX,
				y: e.clientY,
				target: null,
				targetType: 'root'
			};
		}
	}

	function closeContextMenu() {
		contextMenu = { ...contextMenu, visible: false };
	}

	function handleWindowClick() {
		if (contextMenu.visible) closeContextMenu();
		if (showUploadMenu) showUploadMenu = false;
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
		if (!contextMenu.target || !operations?.onDelete) return;

		const target = contextMenu.target;
		const confirmMsg = target.type === 'folder'
			? `Delete folder "${target.name}" and all its contents?`
			: `Delete file "${target.name}"?`;

		if (!confirm(confirmMsg)) {
			closeContextMenu();
			return;
		}

		try {
			await operations.onDelete(target.path, target.type === 'folder');
			
			// Clear selection if deleted item was selected
			if (selectedPath === target.path) {
				onSelectionChange?.(undefined);
			}
			
			await onRefresh?.();
		} catch (err) {
			console.error('Failed to delete:', err);
		}

		closeContextMenu();
	}

	function handleNewFile() {
		const parentPath = contextMenu.target?.type === 'folder' 
			? contextMenu.target.path 
			: '/';
		inlineEdit = { active: true, type: 'new-file', parentPath, name: '' };
		
		// Expand parent folder if needed
		if (parentPath !== '/' && !expandedFolders.has(parentPath)) {
			const newExpanded = new Set(expandedFolders);
			newExpanded.add(parentPath);
			onExpandedChange?.(newExpanded);
		}
		
		closeContextMenu();
	}

	function handleNewFolder() {
		const parentPath = contextMenu.target?.type === 'folder' 
			? contextMenu.target.path 
			: '/';
		inlineEdit = { active: true, type: 'new-folder', parentPath, name: '' };
		
		// Expand parent folder if needed
		if (parentPath !== '/' && !expandedFolders.has(parentPath)) {
			const newExpanded = new Set(expandedFolders);
			newExpanded.add(parentPath);
			onExpandedChange?.(newExpanded);
		}
		
		closeContextMenu();
	}

	// ============================================================================
	// Inline Editing
	// ============================================================================

	async function confirmInlineEdit() {
		if (!inlineEdit.name.trim()) {
			cancelInlineEdit();
			return;
		}

		const editName = inlineEdit.name.trim();
		const fullPath = inlineEdit.parentPath === '/' ? `/${editName}` : `${inlineEdit.parentPath}/${editName}`;

		try {
			if (inlineEdit.type === 'rename' && inlineEdit.target && operations?.onRename) {
				await operations.onRename(inlineEdit.target.path, fullPath);
				// Update selection if renamed item was selected
				if (selectedPath === inlineEdit.target.path) {
					onSelectionChange?.(fullPath);
				}
			} else if (inlineEdit.type === 'new-folder' && operations?.onCreateFolder) {
				await operations.onCreateFolder(fullPath);
				// Expand the new folder
				const newExpanded = new Set(expandedFolders);
				newExpanded.add(fullPath);
				onExpandedChange?.(newExpanded);
			} else if (inlineEdit.type === 'new-file' && operations?.onCreateFile) {
				await operations.onCreateFile(fullPath);
			}
			await onRefresh?.();
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

	// ============================================================================
	// Quick Actions
	// ============================================================================

	function startNewFile() {
		inlineEdit = { active: true, type: 'new-file', parentPath: '/', name: '' };
	}

	function startNewFolder() {
		inlineEdit = { active: true, type: 'new-folder', parentPath: '/', name: '' };
	}
</script>

<svelte:window onclick={handleWindowClick} />

<!-- File Tree Container -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col {className}"
	oncontextmenu={(e) => handleContextMenu(e, null)}
	ondragover={(e) => handleDragOver(e, null)}
	ondragleave={handleDragLeave}
	ondrop={(e) => handleDrop(e, null)}
>
	<div class="flex-1 overflow-y-auto p-2 {dragOverRoot ? 'bg-indigo-100' : ''}">
		{#if inlineEdit.active && inlineEdit.type !== 'rename' && inlineEdit.parentPath === '/'}
			{@render inlineNewItemInput(0)}
		{/if}
		{#if items.length === 0 && !inlineEdit.active}
			<div class="text-gray-400 text-xs px-2 py-8 text-center">
				Empty folder
				{#if contextMenuEnabled}
					<br /><span class="text-gray-500">Right-click to create files</span>
				{/if}
			</div>
		{:else}
			{#each items as item}
				{@render fileTreeItem(item, 0)}
			{/each}
		{/if}
	</div>

	<!-- Quick Actions -->
	{#if showQuickActions && operations?.onCreateFile && operations?.onCreateFolder}
		<div class="border-t border-gray-200 px-2 py-1 flex justify-end gap-1">
			{#if operations?.onUpload}
				<button
					bind:this={uploadButtonRef}
					class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
					onclick={(e) => { e.stopPropagation(); updateUploadMenuPosition(); showUploadMenu = !showUploadMenu; }}
					title="Upload"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
					</svg>
				</button>
				<input
					bind:this={fileInput}
					type="file"
					multiple
					class="hidden"
					onchange={handleFileUpload}
				/>
				<!-- @ts-ignore webkitdirectory is a non-standard attribute -->
				<input
					bind:this={folderInput}
					type="file"
					webkitdirectory
					class="hidden"
					onchange={handleFileUpload}
				/>
			{/if}
			{#if operations?.onDownload}
				<button
					class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
					onclick={() => operations?.onDownload?.()}
					title="Download as zip"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
					</svg>
				</button>
			{/if}
			<button
				class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
				onclick={startNewFile}
				title="New file"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
			</button>
			<button
				class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
				onclick={startNewFolder}
				title="New folder"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
				</svg>
			</button>
		</div>
	{/if}
</div>

<!-- Context Menu -->
{#if contextMenu.visible}
	<div
		class="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-32 z-10000"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
	>
		{#if contextMenu.targetType === 'root' || contextMenu.target?.type === 'folder'}
			<button
				class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
				onclick={handleNewFile}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				New File
			</button>
			<button
				class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
				onclick={handleNewFolder}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-2 4H5a2 2 0 01-2-2V6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1m-6 9v-1a2 2 0 012-2h6" />
				</svg>
				New Folder
			</button>
			{#if contextMenu.target}
				<div class="border-t border-gray-100 my-1"></div>
			{/if}
		{/if}
		{#if contextMenu.target && operations?.onRename}
			<button
				class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
				onclick={handleRename}
			>
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
				</svg>
				Rename
			</button>
		{/if}
		{#if contextMenu.target && operations?.onDelete}
			<button
				class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 text-red-600 flex items-center gap-2"
				onclick={handleDelete}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
				</svg>
				Delete
			</button>
		{/if}
	</div>
{/if}

<!-- Upload Menu -->
{#if showUploadMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-28 z-10000"
		style="left: {uploadMenuPosition.x}px; top: {uploadMenuPosition.y}px;"
		onclick={(e) => e.stopPropagation()}
	>
		<button
			class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
			onclick={() => { fileInput?.click(); showUploadMenu = false; }}
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
			Files
		</button>
		<button
			class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
			onclick={() => { folderInput?.click(); showUploadMenu = false; }}
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
			</svg>
			Folder
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
				{selectedPath === item.path ? 'bg-indigo-100 text-indigo-700' : ''}
				{dragOverItem?.path === item.path ? 'bg-indigo-200 ring-2 ring-indigo-400' : ''}
				{draggedItem?.path === item.path ? 'opacity-50' : ''}"
			style="padding-left: {depth * 14 + 8}px"
			draggable={draggable ? 'true' : 'false'}
			ondragstart={(e) => handleDragStart(e, item)}
			ondragover={(e) => handleDragOver(e, item)}
			ondragleave={handleDragLeave}
			ondragend={handleDragEnd}
			ondrop={(e) => handleDrop(e, item)}
			onclick={() => handleItemClick(item)}
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
