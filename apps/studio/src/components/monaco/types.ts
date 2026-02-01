/**
 * Types for Monaco editor components
 */

import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import type { Snippet } from 'svelte';

export interface VfsMonacoEditorProps {
	/** The VFS instance to use */
	vfs: Vfs<VfsProvider>;
	/** Unique identifier for this editor instance (used to isolate Monaco models) */
	instanceId: string;
	/** Path to the file to edit */
	filePath: string;
	/** Monaco theme (default: 'light-plus') */
	theme?: string;
	/** Font size in pixels (default: 13) */
	fontSize?: number;
	/** Enable auto-detection of imports and importMap updates (default: true) */
	autoImports?: boolean;
	/** Callback when file content changes */
	onContentChange?: (content: string, isDirty: boolean) => void;
	/** Callback when file is saved */
	onSave?: (content: string) => void;
	/** Callback when external file changes are detected */
	onExternalChange?: () => void;
	/** Custom loading content snippet */
	loading?: Snippet;
	/** Custom error content snippet */
	error?: Snippet<[string]>;
}
