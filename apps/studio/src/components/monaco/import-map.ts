/**
 * Import map management utilities for Monaco editor with VFS
 */

import type { Vfs, VfsProvider } from '@pubwiki/vfs';

// ============================================================================
// Types
// ============================================================================

export interface ImportMap {
	imports: Record<string, string>;
	scopes: Record<string, Record<string, string>>;
}

export interface ImportMapConfig {
	/** Path to the import map file in VFS (default: /importmap.json) */
	path?: string;
	/** CDN URL for third-party packages (default: https://esm.sh) */
	cdnUrl?: string;
	/** Packages that should not be auto-resolved from CDN */
	builtinPackages?: Set<string>;
	/** Default import map to use when creating a new file */
	defaultImports?: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_IMPORTMAP_PATH = '/importmap.json';
export const DEFAULT_CDN_URL = 'https://esm.sh';

export const DEFAULT_BUILTIN_PACKAGES = new Set([
	'@pubwiki/sandbox-client',
]);

// ============================================================================
// Import Statement Parsing
// ============================================================================

/**
 * Parse import statements from TypeScript/JavaScript code
 * Returns an array of package names (non-relative imports only)
 * 
 * @param code - Source code to parse
 * @param builtinPackages - Set of package names to exclude from results
 * @returns Array of unique package names
 */
export function parseImports(code: string, builtinPackages: Set<string> = DEFAULT_BUILTIN_PACKAGES): string[] {
	const imports: string[] = [];
	// Match: import ... from 'package' or import 'package' or export ... from 'package'
	const importRegex = /(?:import|export)\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"./][^'"]*)['"]/g;
	let match;
	while ((match = importRegex.exec(code)) !== null) {
		const specifier = match[1];
		// Extract package name (handle scoped packages like @scope/package)
		const packageName = specifier.startsWith('@') 
			? specifier.split('/').slice(0, 2).join('/')
			: specifier.split('/')[0];
		if (packageName && !builtinPackages.has(packageName)) {
			imports.push(packageName);
		}
	}
	return [...new Set(imports)]; // Deduplicate
}

// ============================================================================
// Import Map Manager Class
// ============================================================================

/**
 * Manages import map in VFS for Monaco TypeScript LSP
 */
export class ImportMapManager {
	private readonly importMapPath: string;
	private readonly cdnUrl: string;
	private readonly builtinPackages: Set<string>;
	private readonly defaultImports: Record<string, string>;
	
	private knownImports = new Set<string>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly vfs: Vfs<VfsProvider>,
		config: ImportMapConfig = {}
	) {
		this.importMapPath = config.path ?? DEFAULT_IMPORTMAP_PATH;
		this.cdnUrl = config.cdnUrl ?? DEFAULT_CDN_URL;
		this.builtinPackages = config.builtinPackages ?? DEFAULT_BUILTIN_PACKAGES;
		this.defaultImports = config.defaultImports ?? {
			// React is needed for JSX support detection by modern-monaco
			'react': `${this.cdnUrl}/react@18`,
			'react/': `${this.cdnUrl}/react@18/`,
			'react-dom': `${this.cdnUrl}/react-dom@18`,
			'react-dom/': `${this.cdnUrl}/react-dom@18/`,
			'@pubwiki/sandbox-client': `${this.cdnUrl}/@pubwiki/sandbox-client@2`,
			'@pubwiki/sandbox-client/': `${this.cdnUrl}/@pubwiki/sandbox-client@2/`,
		};
	}

	/**
	 * Read the current import map from VFS
	 */
	async readImportMap(): Promise<ImportMap> {
		try {
			const exists = await this.vfs.exists(this.importMapPath);
			if (exists) {
				const file = await this.vfs.readFile(this.importMapPath);
				const content = typeof file.content === 'string' 
					? file.content 
					: new TextDecoder().decode(file.content);
				return JSON.parse(content);
			}
		} catch (err) {
			console.warn('[ImportMapManager] Failed to read import map:', err);
		}
		return { imports: {}, scopes: {} };
	}

	/**
	 * Write the import map to VFS
	 */
	async writeImportMap(importMap: ImportMap): Promise<void> {
		const content = JSON.stringify(importMap, null, 2);
		const exists = await this.vfs.exists(this.importMapPath);
		if (exists) {
			await this.vfs.updateFile(this.importMapPath, content);
		} else {
			await this.vfs.createFile(this.importMapPath, content);
		}
		console.log('[ImportMapManager] Import map updated:', importMap.imports);
	}

	/**
	 * Initialize known imports from current import map
	 */
	async initializeKnownImports(): Promise<void> {
		const importMap = await this.readImportMap();
		for (const pkg of Object.keys(importMap.imports)) {
			// Skip subpath mappings (ending with /)
			if (!pkg.endsWith('/')) {
				this.knownImports.add(pkg);
			}
		}
		// Always add builtin packages
		for (const pkg of this.builtinPackages) {
			this.knownImports.add(pkg);
		}
	}

	/**
	 * Ensure importmap.json exists with default mappings
	 */
	async ensureImportMapExists(): Promise<void> {
		const exists = await this.vfs.exists(this.importMapPath);
		if (!exists) {
			const defaultImportMap: ImportMap = {
				imports: { ...this.defaultImports },
				scopes: {},
			};
			await this.vfs.createFile(this.importMapPath, JSON.stringify(defaultImportMap, null, 2));
			console.log('[ImportMapManager] Created default importmap.json');
		}
	}

	/**
	 * Check for new imports in the given code and update import map if needed
	 */
	async detectAndUpdateImports(code: string): Promise<string[]> {
		const detectedImports = parseImports(code, this.builtinPackages);
		const newImports = detectedImports.filter(pkg => !this.knownImports.has(pkg));
		
		if (newImports.length === 0) return [];
		
		// Mark as known immediately to avoid duplicate processing
		for (const pkg of newImports) {
			this.knownImports.add(pkg);
		}
		
		// Read current import map
		const importMap = await this.readImportMap();
		
		// Add new imports
		let hasChanges = false;
		for (const pkg of newImports) {
			if (!importMap.imports[pkg]) {
				// Map package to CDN
				importMap.imports[pkg] = `${this.cdnUrl}/${pkg}`;
				// Also add path mapping for subpath imports
				importMap.imports[`${pkg}/`] = `${this.cdnUrl}/${pkg}/`;
				hasChanges = true;
				console.log('[ImportMapManager] Auto-added import mapping:', pkg);
			}
		}
		
		if (hasChanges) {
			await this.writeImportMap(importMap);
		}
		
		return newImports;
	}

	/**
	 * Schedule a debounced import detection
	 * @param code - Source code to scan for imports
	 * @param debounceMs - Debounce delay in milliseconds (default: 1000)
	 * @returns Promise that resolves when detection is complete
	 */
	scheduleDetection(code: string, debounceMs: number = 1000): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(async () => {
			await this.detectAndUpdateImports(code);
		}, debounceMs);
	}

	/**
	 * Cancel any pending debounced detection
	 */
	cancelPendingDetection(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.cancelPendingDetection();
		this.knownImports.clear();
	}
}
