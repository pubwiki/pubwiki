/**
 * Monaco editor components and utilities
 */

export { default as VfsMonacoEditor } from './VfsMonacoEditor.svelte';
export type { VfsMonacoEditorProps } from './types';

export {
	getLanguageFromExtension,
	getLanguageFromPath,
	getFileExtension,
	isScriptExtension,
	isScriptFile,
} from './language';

export {
	ImportMapManager,
	parseImports,
	DEFAULT_IMPORTMAP_PATH,
	DEFAULT_CDN_URL,
	DEFAULT_BUILTIN_PACKAGES,
	type ImportMap,
	type ImportMapConfig,
} from './import-map';
