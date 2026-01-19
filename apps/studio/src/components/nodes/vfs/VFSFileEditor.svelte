<script lang="ts">
	/**
	 * VFSFileEditor - Floating file editor panel for VFS files
	 * 
	 * This is a floating editor that appears on the right side of the screen
	 * and allows editing files from a VFS node. It has the same z-index as the sidebar
	 * so users can interact with both simultaneously.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import loader from '@monaco-editor/loader';
	import type * as Monaco from 'monaco-editor';
	import type { VersionedVfs } from '$lib/vfs';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		vfs: VersionedVfs;
		filePath: string;
		onClose: () => void;
	}

	let { vfs, filePath, onClose }: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let fileContent = $state<string>('');
	let fileName = $derived(filePath.split('/').pop() || '');
	
	// Track dirty state using Monaco's alternative version ID
	let lastSavedVersionId = $state(0);
	let currentVersionId = $state(0);
	let isDirty = $derived(currentVersionId !== lastSavedVersionId);

	// Monaco editor state
	let editorContainer = $state<HTMLDivElement | null>(null);
	let monaco: typeof Monaco | null = $state(null);
	let editor: Monaco.editor.IStandaloneCodeEditor | null = $state(null);

	// Loading state
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// ============================================================================
	// Initialization
	// ============================================================================

	onMount(async () => {
		console.log('[VFSFileEditor] onMount, filePath:', filePath);
		monaco = await loader.init();
		console.log('[VFSFileEditor] Monaco loaded');
		await loadFileContent();
	});

	onDestroy(() => {
		console.log('[VFSFileEditor] onDestroy');
		if (editor) {
			editor.dispose();
			editor = null;
		}
	});

	// Create editor when container is ready and content is loaded
	$effect(() => {
		if (monaco && editorContainer && !isLoading && !error && !editor) {
			console.log('[VFSFileEditor] Creating editor');
			createEditor(fileContent, fileName);
		}
	});

	// Track previous file path for change detection
	let previousFilePath: string | null = null;

	// Reload file when filePath changes (not on initial mount, handled by onMount)
	$effect(() => {
		const currentPath = filePath;
		console.log('[VFSFileEditor] filePath effect:', { currentPath, previousFilePath, hasMonaco: !!monaco });
		// Skip the first run (handled by onMount) and only react to actual changes
		if (previousFilePath !== null && currentPath !== previousFilePath && monaco) {
			console.log('[VFSFileEditor] File path changed, reloading content');
			// Save current file before switching if dirty
			if (isDirty && editor) {
				saveFile();
			}
			loadFileContent();
		}
		previousFilePath = currentPath;
	});

	// ============================================================================
	// File Operations
	// ============================================================================

	async function loadFileContent() {
		console.log('[VFSFileEditor] loadFileContent start, filePath:', filePath, 'hasEditor:', !!editor);
		// Only show loading spinner if editor doesn't exist yet
		// Otherwise we'd unmount the editor container!
		if (!editor) {
			isLoading = true;
		}
		error = null;
		
		// Capture the current filePath at the start
		const currentFilePath = filePath;
		const currentFileName = currentFilePath.split('/').pop() || '';
		
		try {
			console.log('[VFSFileEditor] Reading file:', currentFilePath);
			const file = await vfs.readFile(currentFilePath);
			
			// Check if filePath changed during async operation
			if (currentFilePath !== filePath) {
				console.log('[VFSFileEditor] Path changed during read, aborting');
				return; // Abort if path changed
			}
			
			let content: string;
			if (typeof file.content === 'string') {
				content = file.content;
			} else {
				const decoder = new TextDecoder();
				content = decoder.decode(file.content);
			}
			console.log('[VFSFileEditor] File read success, content length:', content.length);
			fileContent = content;

			if (editor) {
				console.log('[VFSFileEditor] Updating existing editor');
				editor.setValue(content);
				const ext = currentFileName.split('.').pop() || '';
				const language = getLanguageFromExtension(ext);
				monaco?.editor.setModelLanguage(editor.getModel()!, language);
				
				// Record the version ID after loading as the "saved" state
				const versionId = editor.getModel()?.getAlternativeVersionId() ?? 0;
				lastSavedVersionId = versionId;
				currentVersionId = versionId;
				console.log('[VFSFileEditor] Editor updated, versionId:', versionId);
			} else {
				console.log('[VFSFileEditor] No editor exists yet');
			}
			
			console.log('[VFSFileEditor] Setting isLoading = false');
			isLoading = false;
		} catch (err) {
			// Only handle error if path hasn't changed
			if (currentFilePath === filePath) {
				console.error('[VFSFileEditor] Failed to load file:', err);
				error = err instanceof Error ? err.message : 'Failed to load file';
				fileContent = '';
				isLoading = false;
			}
		}
	}

	function getLanguageFromExtension(ext: string): string {
		const languageMap: Record<string, string> = {
			'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
			'json': 'json', 'html': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',
			'md': 'markdown', 'py': 'python', 'rs': 'rust', 'go': 'go', 'java': 'java',
			'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp', 'yaml': 'yaml', 'yml': 'yaml',
			'xml': 'xml', 'sql': 'sql', 'sh': 'shell', 'bash': 'shell', 'svelte': 'html', 'vue': 'html',
			'lua': 'lua'
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
			currentVersionId = editor!.getModel()?.getAlternativeVersionId() ?? 0;
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			saveFile();
		});
		
		// Set initial saved version
		lastSavedVersionId = editor.getModel()?.getAlternativeVersionId() ?? 0;
		currentVersionId = lastSavedVersionId;
	}

	async function saveFile() {
		if (!isDirty) return;

		try {
			await vfs.updateFile(filePath, fileContent);
			lastSavedVersionId = editor?.getModel()?.getAlternativeVersionId() ?? 0;
		} catch (err) {
			console.error('Failed to save file:', err);
		}
	}

	function handleClose() {
		if (isDirty) {
			saveFile();
		}
		onClose();
	}
</script>

<!-- Floating Editor Panel (no overlay, just a right-side panel) -->
<div
	class="fixed top-4 right-4 bottom-4 z-30 bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
	style="left: 352px;"
	transition:fly={{ x: 100, duration: 200 }}
>
	<!-- Header -->
	<div class="flex items-center justify-between px-4 py-3 bg-indigo-500 text-white shrink-0">
		<div class="flex items-center gap-3 min-w-0">
			<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
			<span class="font-medium truncate">{filePath}</span>
			{#if isDirty}
				<span class="text-xs bg-white/20 px-2 py-0.5 rounded shrink-0">{m.studio_node_unsaved()}</span>
			{/if}
		</div>
		<button
			class="p-1.5 hover:bg-white/20 rounded transition-colors shrink-0"
			onclick={handleClose}
			title={m.studio_node_close()}
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	</div>

	<!-- Editor Area -->
	<div class="flex-1 flex flex-col min-h-0">
		{#if isLoading}
			<div class="flex-1 flex items-center justify-center text-gray-400">
				<svg class="w-5 h-5 animate-spin mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				{m.studio_vfs_loading()}
			</div>
		{:else if error}
			<div class="flex-1 flex items-center justify-center text-red-500 text-sm px-4">
				{error}
			</div>
		{:else}
			<!-- File tab bar -->
			<div class="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-2 shrink-0">
				<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				<span class="text-sm text-gray-700 truncate">{fileName}</span>
				{#if isDirty}
					<span class="text-xs text-amber-600">●</span>
				{/if}
				<div class="flex-1"></div>
				<button
					class="px-2 py-1 text-xs bg-indigo-500 hover:bg-indigo-600 text-white rounded transition-colors disabled:opacity-50"
					onclick={saveFile}
					disabled={!isDirty}
				>
					Save
				</button>
			</div>
			<!-- Monaco editor container -->
			<div bind:this={editorContainer} class="flex-1"></div>
		{/if}
	</div>
</div>
