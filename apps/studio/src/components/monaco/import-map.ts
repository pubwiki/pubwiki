/**
 * Import map management utilities for Monaco editor with VFS
 */

import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import type { PackageVersionResolver } from '@pubwiki/bundler';

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
	/** Optional package version resolver for pinning dependency versions */
	packageVersionResolver?: PackageVersionResolver;
	/**
	 * Local library path mappings.
	 * Maps npm package names to local VFS entry points.
	 * E.g. `{ '@pubwiki/game-sdk': '/lib/game-sdk/index.ts' }`
	 * These are resolved locally instead of via CDN, and are also
	 * added to builtinPackages so auto-detect skips them.
	 */
	localLibraries?: Record<string, string>;
	/**
	 * Transitive dependencies of local libraries.
	 * These package names are added to the default import map as CDN entries
	 * so that imports inside mounted libraries resolve correctly.
	 */
	localLibraryDeps?: Set<string>;
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
	private readonly localLibraries: Record<string, string>;
	private readonly localLibraryDeps: Set<string>;
	
	private knownImports = new Set<string>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly packageVersionResolver?: PackageVersionResolver;

	constructor(
		private readonly vfs: Vfs<VfsProvider>,
		config: ImportMapConfig = {}
	) {
		this.importMapPath = config.path ?? DEFAULT_IMPORTMAP_PATH;
		this.cdnUrl = config.cdnUrl ?? DEFAULT_CDN_URL;
		this.localLibraries = config.localLibraries ?? {};
		this.localLibraryDeps = config.localLibraryDeps ?? new Set();
		// Merge caller-supplied builtins with local library package names
		// and their transitive deps (so auto-detect doesn't re-add them)
		this.builtinPackages = new Set([
			...(config.builtinPackages ?? DEFAULT_BUILTIN_PACKAGES),
			...Object.keys(this.localLibraries),
			...this.localLibraryDeps,
		]);
		this.packageVersionResolver = config.packageVersionResolver;
		this.defaultImports = config.defaultImports ?? this.buildDefaultImports();
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
	 * Ensure importmap.json exists with default mappings.
	 * If the file already exists, merge in any local library entries that are missing.
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
		} else if (Object.keys(this.localLibraries).length > 0 || this.localLibraryDeps.size > 0) {
			// Merge local library entries and their deps into existing import map
			const importMap = await this.readImportMap();
			let hasChanges = false;
			for (const [pkg, localPath] of Object.entries(this.localLibraries)) {
				if (importMap.imports[pkg] !== localPath) {
					importMap.imports[pkg] = localPath;
					const dir = localPath.replace(/\/index\.ts$/, '');
					importMap.imports[`${pkg}/`] = `${dir}/`;
					hasChanges = true;
				}
			}
			for (const dep of this.localLibraryDeps) {
				if (!importMap.imports[dep]) {
					const versionedDep = this.applyVersion(dep);
					importMap.imports[dep] = `${this.cdnUrl}/${versionedDep}`;
					importMap.imports[`${dep}/`] = `${this.cdnUrl}/${versionedDep}/`;
					hasChanges = true;
				}
			}
			if (hasChanges) {
				await this.writeImportMap(importMap);
				console.log('[ImportMapManager] Merged local library/dep entries into existing importmap.json');
			}
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
				// Map package to CDN with version if available
				const versionedPkg = this.applyVersion(pkg);
				importMap.imports[pkg] = `${this.cdnUrl}/${versionedPkg}`;
				// Also add path mapping for subpath imports
				importMap.imports[`${pkg}/`] = `${this.cdnUrl}/${versionedPkg}/`;
				hasChanges = true;
				console.log('[ImportMapManager] Auto-added import mapping:', pkg, '->', versionedPkg);
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

	/**
	 * Merge resolved package versions from the bundler into the import map.
	 * Called after a build to persist resolved CDN URLs as a lightweight lockfile.
	 *
	 * @param resolvedVersions - Map of base package name → versioned name (e.g. "react" → "react@18.2.0")
	 */
	async mergeResolvedPackages(resolvedVersions: ReadonlyMap<string, string>): Promise<void> {
		if (resolvedVersions.size === 0) return;

		const importMap = await this.readImportMap();
		let hasChanges = false;

		for (const [pkg, versionedPkg] of resolvedVersions) {
			const expectedUrl = `${this.cdnUrl}/${versionedPkg}`;
			if (importMap.imports[pkg] !== expectedUrl) {
				importMap.imports[pkg] = expectedUrl;
				importMap.imports[`${pkg}/`] = `${expectedUrl}/`;
				hasChanges = true;
			}
		}

		if (hasChanges) {
			await this.writeImportMap(importMap);
			console.log('[ImportMapManager] Merged resolved package versions into importmap.json');
		}
	}

	/**
	 * Build the current import map as a plain object, suitable for passing
	 * to modern-monaco's LSP `importMap` option at init time.
	 * This reads from the persisted importmap.json.
	 */
	async buildImportMapForLsp(): Promise<ImportMap> {
		const stored = await this.readImportMap();
		// If nothing stored yet, use defaults
		if (Object.keys(stored.imports).length === 0) {
			return { imports: { ...this.defaultImports }, scopes: {} };
		}
		// Always ensure local library entries are present in the LSP import map,
		// even if the stored file was created before mounts were configured.
		for (const [pkg, localPath] of Object.entries(this.localLibraries)) {
			stored.imports[pkg] = localPath;
			const dir = localPath.replace(/\/index\.ts$/, '');
			stored.imports[`${pkg}/`] = `${dir}/`;
		}
		// Ensure transitive dep CDN entries are present
		for (const dep of this.localLibraryDeps) {
			if (!stored.imports[dep]) {
				const versionedDep = this.applyVersion(dep);
				stored.imports[dep] = `${this.cdnUrl}/${versionedDep}`;
				stored.imports[`${dep}/`] = `${this.cdnUrl}/${versionedDep}/`;
			}
		}
		return stored;
	}

	// ============================================================================
	// Private helpers
	// ============================================================================

	/**
	 * Build default import mappings, using versions from PackageVersionResolver
	 * when available, falling back to hard-coded major versions.
	 */
	private buildDefaultImports(): Record<string, string> {
		const v = (pkg: string, fallbackVersion: string): string => {
			return this.applyVersion(pkg, fallbackVersion);
		};

		const imports: Record<string, string> = {
			// React is needed for JSX support detection by modern-monaco
			'react': `${this.cdnUrl}/${v('react', '18')}`,
			'react/': `${this.cdnUrl}/${v('react', '18')}/`,
			'react-dom': `${this.cdnUrl}/${v('react-dom', '18')}`,
			'react-dom/': `${this.cdnUrl}/${v('react-dom', '18')}/`,
			'@pubwiki/sandbox-client': `${this.cdnUrl}/${v('@pubwiki/sandbox-client', '2')}`,
			'@pubwiki/sandbox-client/': `${this.cdnUrl}/${v('@pubwiki/sandbox-client', '2')}/`,
		};

		// Add local library paths (resolved via VFS mounts, not CDN)
		for (const [pkg, localPath] of Object.entries(this.localLibraries)) {
			imports[pkg] = localPath;
			// Subpath entry: @pubwiki/game-sdk/hooks → /lib/game-sdk/hooks
			const dir = localPath.replace(/\/index\.ts$/, '');
			imports[`${pkg}/`] = `${dir}/`;
		}

		// Add CDN entries for transitive dependencies of local libraries
		for (const dep of this.localLibraryDeps) {
			if (!(dep in imports)) {
				const versionedDep = this.applyVersion(dep);
				imports[dep] = `${this.cdnUrl}/${versionedDep}`;
				imports[`${dep}/`] = `${this.cdnUrl}/${versionedDep}/`;
			}
		}

		return imports;
	}

	/**
	 * Apply a resolved version to a package name.
	 * Returns "pkg@version" if a version is available, otherwise "pkg" (or "pkg@fallback").
	 */
	private applyVersion(pkg: string, fallbackVersion?: string): string {
		const version = this.packageVersionResolver?.getVersion(pkg);
		if (version) {
			console.log(`[ImportMap] Resolved ${pkg} → ${version} (from lock/package.json)`);
			return `${pkg}@${version}`;
		}
		if (fallbackVersion) return `${pkg}@${fallbackVersion}`;
		return pkg;
	}
}
