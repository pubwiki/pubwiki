/**
 * Language detection utilities for Monaco editor
 */

/**
 * Map file extensions to Monaco language IDs
 */
const LANGUAGE_MAP: Record<string, string> = {
	'js': 'javascript',
	'jsx': 'jsx',
	'ts': 'typescript',
	'tsx': 'tsx',
	'mjs': 'javascript',
	'mts': 'typescript',
	'cjs': 'javascript',
	'cts': 'typescript',
	'json': 'json',
	'html': 'html',
	'htm': 'html',
	'css': 'css',
	'scss': 'scss',
	'sass': 'scss',
	'less': 'less',
	'md': 'markdown',
	'markdown': 'markdown',
	'py': 'python',
	'rs': 'rust',
	'go': 'go',
	'java': 'java',
	'c': 'c',
	'cpp': 'cpp',
	'cc': 'cpp',
	'cxx': 'cpp',
	'h': 'c',
	'hpp': 'cpp',
	'hxx': 'cpp',
	'yaml': 'yaml',
	'yml': 'yaml',
	'xml': 'xml',
	'sql': 'sql',
	'sh': 'shell',
	'bash': 'shell',
	'zsh': 'shell',
	'fish': 'shell',
	'svelte': 'html',
	'vue': 'html',
	'lua': 'lua',
	'rb': 'ruby',
	'php': 'php',
	'swift': 'swift',
	'kt': 'kotlin',
	'kts': 'kotlin',
	'scala': 'scala',
	'r': 'r',
	'R': 'r',
	'toml': 'ini',
	'ini': 'ini',
	'dockerfile': 'dockerfile',
	'graphql': 'graphql',
	'gql': 'graphql',
};

/**
 * File extensions that are considered script files (for import detection)
 */
const SCRIPT_EXTENSIONS = new Set([
	'ts', 'tsx', 'js', 'jsx', 'mjs', 'mts', 'cjs', 'cts'
]);

/**
 * Get the Monaco language ID for a file extension
 * @param extension - File extension without the dot (e.g., 'ts', 'js')
 * @returns Monaco language ID (e.g., 'typescript', 'javascript')
 */
export function getLanguageFromExtension(extension: string): string {
	return LANGUAGE_MAP[extension.toLowerCase()] || 'plaintext';
}

/**
 * Check if a file extension represents a script file (TypeScript/JavaScript)
 * @param extension - File extension without the dot
 * @returns true if the extension is a script file
 */
export function isScriptExtension(extension: string): boolean {
	return SCRIPT_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Get file extension from a file path
 * @param filePath - Full file path or file name
 * @returns File extension without the dot, or empty string if no extension
 */
export function getFileExtension(filePath: string): string {
	const fileName = filePath.split('/').pop() || '';
	const dotIndex = fileName.lastIndexOf('.');
	if (dotIndex === -1 || dotIndex === 0) {
		return '';
	}
	return fileName.slice(dotIndex + 1);
}

/**
 * Get the Monaco language ID for a file path
 * @param filePath - Full file path or file name
 * @returns Monaco language ID
 */
export function getLanguageFromPath(filePath: string): string {
	const ext = getFileExtension(filePath);
	return getLanguageFromExtension(ext);
}

/**
 * Check if a file path represents a script file (TypeScript/JavaScript)
 * @param filePath - Full file path or file name
 * @returns true if the file is a script file
 */
export function isScriptFile(filePath: string): boolean {
	const ext = getFileExtension(filePath);
	return isScriptExtension(ext);
}
