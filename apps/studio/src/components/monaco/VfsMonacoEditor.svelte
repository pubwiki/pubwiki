<script lang="ts">
	/**
	 * VfsMonacoEditor - Monaco editor component with VFS integration
	 * 
	 * A reusable Monaco editor component that integrates with VFS.
	 * Handles TypeScript LSP configuration, import map management, and file operations.
	 */
	import { onMount, onDestroy, tick } from 'svelte';
	import { init, Workspace } from 'modern-monaco';
	import { VfsMonacoAdapter } from '$lib/vfs/monaco-adapter';
	import { getLanguageFromPath, isScriptFile } from './language';
	import { ImportMapManager } from './import-map';
	import { PackageVersionResolver } from '@pubwiki/bundler';
	import type { VfsMonacoEditorProps } from './types';

	// ============================================================================
	// Props
	// ============================================================================

	let {
		vfs,
		instanceId,
		filePath,
		theme = 'light-plus',
		fontSize = 13,
		autoImports = true,
		onContentChange,
		onSave,
		onExternalChange,
		loading: loadingSnippet,
		error: errorSnippet,
	}: VfsMonacoEditorProps = $props();

	// ============================================================================
	// State
	// ============================================================================
	
	// Capture instanceId at mount time to avoid null access during destroy
	// This is needed because parent may set state to null before onDestroy runs
	// svelte-ignore state_referenced_locally
	const capturedInstanceId: string = instanceId;
	
	// Track dirty state
	let lastSavedVersionId = $state(0);
	let currentVersionId = $state(0);
	let isDirty = $derived(currentVersionId !== lastSavedVersionId);

	// Monaco editor state
	let editorContainer = $state<HTMLDivElement | null>(null);
	let monaco: Awaited<ReturnType<typeof init>> | null = $state(null);
	let editor: ReturnType<Awaited<ReturnType<typeof init>>['editor']['create']> | null = $state(null);
	let model: ReturnType<Awaited<ReturnType<typeof init>>['editor']['createModel']> | null = $state(null);

	// VFS adapter for modern-monaco
	let vfsAdapter: VfsMonacoAdapter | null = $state(null);
	// Workspace for modern-monaco with customFS
	let workspace: Workspace | null = $state(null);
	// Import map manager
	let importMapManager: ImportMapManager | null = $state(null);

	// Loading state
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// ============================================================================
	// Exposed State (for parent components)
	// ============================================================================

	export function getIsDirty(): boolean {
		return isDirty;
	}

	export function getContent(): string | null {
		return model?.getValue() ?? null;
	}

	export function getEditor() {
		return editor;
	}

	export function getMonaco() {
		return monaco;
	}

	export function getIsLoading(): boolean {
		return isLoading;
	}

	export function getError(): string | null {
		return error;
	}

	// ============================================================================
	// TypeScript Configuration
	// ============================================================================

	/**
	 * Build TypeScript compiler options for modern-monaco LSP configuration
	 * Note: Do NOT set jsxImportSource here - modern-monaco auto-detects it from importMap
	 * and sets jsx option accordingly in #updateJsxImportSource()
	 * @returns Compiler options object (using any to bypass strict type checking)
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getTypeScriptCompilerOptions(): any {
		return {
			target: 'ESNext',
			module: 'ESNext',
			moduleResolution: 'Bundler',
			allowSyntheticDefaultImports: true,
			esModuleInterop: true,
			strict: true,
			noEmit: true,
			allowNonTsExtensions: true,
		};
	}

	// ============================================================================
	// Initialization
	// ============================================================================

	let eventUnsubscribe: (() => void) | null = null;

	onMount(async () => {
		console.log('[VfsMonacoEditor] onMount, filePath:', filePath, 'instanceId:', instanceId);
		
		try {
			// Wait for the container to be bound
			await tick();
			
			// Create VFS adapter with instanceId to isolate models from different instances
			vfsAdapter = new VfsMonacoAdapter(vfs, instanceId);
			
			// Initialize import map manager if auto-imports is enabled
			let importMapForLsp = { imports: {} as Record<string, string>, scopes: {} as Record<string, Record<string, string>> };
			if (autoImports) {
				// Load package versions from package.json / lock files
				const versionResolver = new PackageVersionResolver(
					{
						readTextFile: async (path: string) => {
							try {
								const file = await vfs.readFile(path);
								if (file.content === null) return null;
								if (file.content instanceof ArrayBuffer) {
									return new TextDecoder().decode(file.content);
								}
								return file.content as string;
							} catch {
								return null;
							}
						},
						exists: (path: string) => vfs.exists(path),
					},
					'/'
				);
				await versionResolver.load();

				importMapManager = new ImportMapManager(vfs, {
					packageVersionResolver: versionResolver.hasVersions() ? versionResolver : undefined,
				});
				await importMapManager.initializeKnownImports();
				await importMapManager.ensureImportMapExists();
				importMapForLsp = await importMapManager.buildImportMapForLsp();
			}
			
			// Create Workspace with customFS using our VFS adapter
			workspace = new Workspace({
				name: `vfs-workspace-${instanceId}`,
				customFS: vfsAdapter,
				entryFile: filePath,
			});
			
			// Initialize modern-monaco with workspace and LSP configuration
			monaco = await init({
				defaultTheme: theme,
				workspace,
				langs: ['typescript', 'javascript', 'tsx', 'jsx', 'json', 'html', 'css', 'markdown', 'lua'],
				lsp: {
					typescript: {
						compilerOptions: getTypeScriptCompilerOptions(),
						importMap: importMapForLsp,
					},
				},
			});
			console.log('[VfsMonacoEditor] Monaco initialized with workspace');
			
			// Load file content and create editor
			await loadFileAndCreateEditor();

			// Subscribe to file change events
			eventUnsubscribe = vfs.events.on('file:updated', async (event) => {
				if (event.path === filePath) {
					console.log('[VfsMonacoEditor] File updated externally:', event.path);
					if (!isDirty) {
						await reloadFileContent();
					} else {
						console.log('[VfsMonacoEditor] External change detected but have unsaved changes');
						onExternalChange?.();
					}
				}
			});
		} catch (err) {
			console.error('[VfsMonacoEditor] Failed to initialize:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize editor';
			isLoading = false;
		}
	});

	onDestroy(() => {
		console.log('[VfsMonacoEditor] onDestroy, cleaning up instanceId:', capturedInstanceId);
		if (eventUnsubscribe) {
			eventUnsubscribe();
			eventUnsubscribe = null;
		}
		
		// Dispose import map manager
		if (importMapManager) {
			importMapManager.dispose();
			importMapManager = null;
		}
		
		// Dispose all models belonging to this instance
		if (monaco) {
			const prefix = `file:///vfs-${capturedInstanceId}/`;
			const allModels = monaco.editor.getModels();
			for (const m of allModels) {
				if (m.uri.toString().startsWith(prefix)) {
					console.log('[VfsMonacoEditor] Disposing model:', m.uri.toString());
					m.dispose();
				}
			}
		}
		model = null;
		
		if (editor) {
			editor.dispose();
			editor = null;
		}
		workspace = null;
		if (vfsAdapter) {
			vfsAdapter.dispose();
			vfsAdapter = null;
		}
	});

	// Track previous file path for change detection
	let previousFilePath: string | null = null;

	// Reload file when filePath changes
	$effect(() => {
		const currentPath = filePath;
		if (previousFilePath !== null && currentPath !== previousFilePath && monaco && editor) {
			console.log('[VfsMonacoEditor] File path changed, switching file');
			// Save current file before switching if dirty
			if (isDirty && model) {
				const content = model.getValue();
				vfs.updateFile(previousFilePath, content).then(() => {
					console.log('[VfsMonacoEditor] Saved previous file before switching:', previousFilePath);
				}).catch((err) => {
					console.error('[VfsMonacoEditor] Failed to save previous file:', err);
				});
			}
			switchToFile(currentPath);
		}
		previousFilePath = currentPath;
	});

	// ============================================================================
	// File Operations
	// ============================================================================

	async function loadFileAndCreateEditor(): Promise<void> {
		if (!monaco || !editorContainer) return;
		
		try {
			const language = getLanguageFromPath(filePath);
			
			// Create URI with instanceId prefix to isolate models
			const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
			const uri = monaco.Uri.parse(`file:///vfs-${instanceId}/${normalizedPath}`);
			
			// Check if model already exists
			model = monaco.editor.getModel(uri);
			if (!model) {
				const file = await vfs.readFile(filePath);
				let content: string;
				if (typeof file.content === 'string') {
					content = file.content;
				} else {
					content = new TextDecoder().decode(file.content);
				}
				model = monaco.editor.createModel(content, language, uri);
			}
			
			// Create editor
			editor = monaco.editor.create(editorContainer, {
				model,
				theme,
				minimap: { enabled: false },
				fontSize,
				lineNumbers: 'on',
				scrollBeyondLastLine: false,
				automaticLayout: true,
				wordWrap: 'on',
				tabSize: 2
			});
			
			// Track content changes
			editor.onDidChangeModelContent(() => {
				currentVersionId = model?.getAlternativeVersionId() ?? 0;
				const content = model?.getValue() ?? '';
				onContentChange?.(content, isDirty);
				
				// Schedule import detection for script files
				if (autoImports && importMapManager && isScriptFile(filePath)) {
					importMapManager.scheduleDetection(content);
				}
			});
			
			// Add save command (Ctrl/Cmd+S)
			editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
				saveFile();
			});
			
			// Set initial saved version
			lastSavedVersionId = model.getAlternativeVersionId();
			currentVersionId = lastSavedVersionId;
			
			// Initial import detection for script files
			if (autoImports && importMapManager && isScriptFile(filePath)) {
				importMapManager.scheduleDetection(model.getValue());
			}
			
			isLoading = false;
			console.log('[VfsMonacoEditor] Editor created for:', filePath);
		} catch (err) {
			console.error('[VfsMonacoEditor] Failed to load file:', err);
			error = err instanceof Error ? err.message : 'Failed to load file';
			isLoading = false;
		}
	}

	async function reloadFileContent(): Promise<void> {
		if (!monaco || !model) return;
		
		try {
			const file = await vfs.readFile(filePath);
			let content: string;
			if (typeof file.content === 'string') {
				content = file.content;
			} else {
				content = new TextDecoder().decode(file.content);
			}
			
			model.setValue(content);
			
			const versionId = model.getAlternativeVersionId();
			lastSavedVersionId = versionId;
			currentVersionId = versionId;
			
			console.log('[VfsMonacoEditor] File content reloaded');
		} catch (err) {
			console.error('[VfsMonacoEditor] Failed to reload file:', err);
		}
	}

	async function switchToFile(newPath: string): Promise<void> {
		if (!monaco || !editor) return;
		
		try {
			const language = getLanguageFromPath(newPath);
			
			const normalizedNewPath = newPath.startsWith('/') ? newPath.slice(1) : newPath;
			const uri = monaco.Uri.parse(`file:///vfs-${instanceId}/${normalizedNewPath}`);
			
			let newModel = monaco.editor.getModel(uri);
			if (!newModel) {
				const file = await vfs.readFile(newPath);
				let content: string;
				if (typeof file.content === 'string') {
					content = file.content;
				} else {
					content = new TextDecoder().decode(file.content);
				}
				newModel = monaco.editor.createModel(content, language, uri);
			}
			
			model = newModel;
			editor.setModel(model);
			
			// Track content changes for new model
			editor.onDidChangeModelContent(() => {
				currentVersionId = model?.getAlternativeVersionId() ?? 0;
				const content = model?.getValue() ?? '';
				onContentChange?.(content, isDirty);
				
				if (autoImports && importMapManager && isScriptFile(newPath)) {
					importMapManager.scheduleDetection(content);
				}
			});
			
			lastSavedVersionId = model.getAlternativeVersionId();
			currentVersionId = lastSavedVersionId;
			
			console.log('[VfsMonacoEditor] Switched to file:', newPath);
		} catch (err) {
			console.error('[VfsMonacoEditor] Failed to switch file:', err);
			error = err instanceof Error ? err.message : 'Failed to switch file';
		}
	}

	// ============================================================================
	// Public Methods
	// ============================================================================

	/**
	 * Save the current file to VFS
	 */
	export async function saveFile(): Promise<boolean> {
		if (!isDirty || !model) return false;

		try {
			const content = model.getValue();
			await vfs.updateFile(filePath, content);
			lastSavedVersionId = model.getAlternativeVersionId();
			console.log('[VfsMonacoEditor] File saved:', filePath);
			onSave?.(content);
			return true;
		} catch (err) {
			console.error('[VfsMonacoEditor] Failed to save file:', err);
			return false;
		}
	}

	/**
	 * Reload file content from VFS (discards unsaved changes)
	 */
	export async function reload(): Promise<void> {
		await reloadFileContent();
	}

	/**
	 * Focus the editor
	 */
	export function focus(): void {
		editor?.focus();
	}
</script>

<div 
	bind:this={editorContainer} 
	class="w-full h-full"
	class:hidden={isLoading || !!error}
></div>

{#if isLoading}
	<div class="w-full h-full flex items-center justify-center text-gray-400">
		<svg class="w-5 h-5 animate-spin mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
		</svg>
		{#if loadingSnippet}
			{@render loadingSnippet()}
		{:else}
			Loading...
		{/if}
	</div>
{:else if error}
	<div class="w-full h-full flex items-center justify-center text-red-500 text-sm px-4">
		{#if errorSnippet}
			{@render errorSnippet(error)}
		{:else}
			{error}
		{/if}
	</div>
{/if}
