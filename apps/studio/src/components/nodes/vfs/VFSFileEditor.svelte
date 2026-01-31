<script lang="ts">
	/**
	 * VFSFileEditor - Floating file editor panel for VFS files
	 * 
	 * This is a floating editor that appears on the right side of the screen
	 * and allows editing files from a VFS node. Uses VfsMonacoEditor internally.
	 */
	import { fly } from 'svelte/transition';
	import type { VersionedVfs } from '$lib/vfs';
	import { VfsMonacoEditor } from '$components/monaco';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		vfs: VersionedVfs;
		nodeId: string;
		filePath: string;
		onClose: () => void;
	}

	let { vfs, nodeId, filePath, onClose }: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let fileName = $derived(filePath.split('/').pop() || '');
	
	// Reference to the editor component
	let editorComponent: ReturnType<typeof VfsMonacoEditor> | undefined = $state();
	
	// Track dirty state from editor
	let isDirty = $state(false);
	
	// Track external file changes when we have unsaved changes
	let hasExternalChanges = $state(false);

	// ============================================================================
	// Event Handlers
	// ============================================================================

	function handleContentChange(_content: string, dirty: boolean): void {
		isDirty = dirty;
	}

	function handleExternalChange(): void {
		hasExternalChanges = true;
	}

	function handleSave(): void {
		hasExternalChanges = false;
		isDirty = false;
	}

	async function saveFile(): Promise<void> {
		if (editorComponent) {
			await editorComponent.saveFile();
			hasExternalChanges = false;
			isDirty = false;
		}
	}

	async function reloadFromDisk(): Promise<void> {
		if (editorComponent) {
			await editorComponent.reload();
			hasExternalChanges = false;
			isDirty = false;
		}
	}

	function handleClose(): void {
		if (isDirty) {
			saveFile();
		}
		onClose();
	}
</script>

<!-- Floating Editor Panel -->
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
		<!-- External changes warning -->
		{#if hasExternalChanges}
			<div class="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-800">
				<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<span class="flex-1">This file has been modified externally.</span>
				<button
					class="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
					onclick={reloadFromDisk}
				>
					Reload
				</button>
			</div>
		{/if}

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

		<!-- Monaco Editor -->
		<div class="flex-1 min-h-0">
			{#snippet loadingContent()}
				{m.studio_vfs_loading()}
			{/snippet}
			<VfsMonacoEditor
				bind:this={editorComponent}
				{vfs}
				instanceId={nodeId}
				{filePath}
				autoImports={true}
				onContentChange={handleContentChange}
				onExternalChange={handleExternalChange}
				onSave={handleSave}
				loading={loadingContent}
			/>
		</div>
	</div>
</div>
