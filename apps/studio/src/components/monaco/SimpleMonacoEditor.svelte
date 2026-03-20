<script lang="ts">
	/**
	 * SimpleMonacoEditor - Lightweight read-only Monaco editor
	 *
	 * A minimal Monaco wrapper for displaying text content (logs, JSON, etc.)
	 * without VFS, TypeScript LSP, or import map overhead.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { init } from 'modern-monaco';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		/** Text content to display */
		value: string;
		/** Monaco language id (e.g. 'log', 'json', 'plaintext') */
		language?: string;
		/** Editor theme */
		theme?: 'light-plus' | 'dark-plus';
		/** Font size in px */
		fontSize?: number;
		/** Whether the editor is read-only */
		readOnly?: boolean;
		/** Show line numbers */
		lineNumbers?: 'on' | 'off' | 'relative';
		/** Enable word wrap */
		wordWrap?: 'on' | 'off' | 'bounded';
		/** CSS class for the container */
		class?: string;
	}

	let {
		value,
		language = 'plaintext',
		theme = 'light-plus',
		fontSize = 12,
		readOnly = true,
		lineNumbers = 'on',
		wordWrap = 'on',
		class: className = '',
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let container = $state<HTMLDivElement | null>(null);
	let monacoInstance: Awaited<ReturnType<typeof init>> | null = null;
	let editorInstance: ReturnType<Awaited<ReturnType<typeof init>>['editor']['create']> | null = $state(null);

	// ============================================================================
	// Lifecycle
	// ============================================================================

	onMount(() => {
		initEditor();
	});

	onDestroy(() => {
		dispose();
	});

	// ============================================================================
	// Editor management
	// ============================================================================

	async function initEditor() {
		if (!container) return;

		try {
			monacoInstance = await init({ defaultTheme: theme });

			editorInstance = monacoInstance.editor.create(container, {
				value,
				language,
				readOnly,
				minimap: { enabled: false },
				lineNumbers,
				fontSize,
				fontFamily: 'monospace',
				wordWrap,
				scrollBeyondLastLine: false,
				automaticLayout: true,
				// Hide cursor in read-only mode
				...(readOnly ? {
					cursorStyle: 'line',
					cursorBlinking: 'solid',
					cursorWidth: 0,
					domReadOnly: true,
					renderLineHighlight: 'none',
				} : {}),
			});
		} catch (err) {
			console.error('[SimpleMonacoEditor] Failed to init:', err);
		}
	}

	function dispose() {
		if (editorInstance) {
			editorInstance.dispose();
			editorInstance = null;
		}
		monacoInstance = null;
	}

	// ============================================================================
	// Reactive updates
	// ============================================================================

	$effect(() => {
		if (editorInstance && value !== editorInstance.getValue()) {
			editorInstance.setValue(value);
		}
	});
</script>

<div bind:this={container} class={className}></div>
