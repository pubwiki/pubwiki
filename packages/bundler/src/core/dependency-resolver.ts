/**
 * Dependency Resolver
 *
 * Handles resolution of import paths:
 * - Relative paths (./app, ../utils)
 * - Absolute paths (/src/app)
 * - npm packages (react, @scope/package)
 * - HTTP URLs
 *
 * Supports multiple CDN fallbacks for npm packages.
 */

import type { ResolveResult, CDNConfig } from './types'
import type { BuildCacheStorage } from '../cache'
import type { PackageVersionResolver } from './package-version-resolver'

/**
 * Dependency Resolver
 */
export class DependencyResolver {
  private cdnConfigs: CDNConfig[]
  private resolveCache = new Map<string, ResolveResult>()
  private cache?: BuildCacheStorage

  // File existence checker (injected from VFS adapter)
  private fileExistsChecker?: (path: string) => Promise<boolean>

  // Progress callback for reporting package resolution
  private progressCallback?: (message: string) => void

  // Package version resolver for pinned dependency versions
  private packageVersionResolver?: PackageVersionResolver

  // Resolved npm packages for importmap write-back (basePkg → versionedName, e.g. "react" → "react@18.2.0")
  private resolvedPackageVersions = new Map<string, string>()

  // In-flight npm resolve promises — coalesces concurrent resolutions for the same package
  private inflightNpmResolves = new Map<string, Promise<ResolveResult>>()

  // Content-type cache from HEAD responses during npm resolution
  private headContentTypes = new Map<string, string>()

  // tsconfig path aliases for local package resolution (e.g. @pubwiki/game-sdk → /lib/game-sdk)
  private pathAliases: Map<string, string[]> | null = null


  constructor(options?: { fileExistsChecker?: (path: string) => Promise<boolean>; cache?: BuildCacheStorage }) {
    this.fileExistsChecker = options?.fileExistsChecker
    this.cache = options?.cache

    // CDN configurations, sorted by priority
    this.cdnConfigs = [
      {
        name: 'esm.sh',
        url: (pkg) => {
          const ext = this.getEsmShExternalParam()
          return `https://esm.sh/${pkg}${ext}`
        },
        priority: 1
      },
      {
        name: 'unpkg',
        url: (pkg) => `https://unpkg.com/${pkg}?module`,
        priority: 2
      },
      {
        name: 'jsdelivr',
        url: (pkg) => `https://cdn.jsdelivr.net/npm/${pkg}/+esm`,
        priority: 3
      }
    ]
  }

  /**
   * Set the file existence checker
   */
  setFileExistsChecker(checker: (path: string) => Promise<boolean>): void {
    this.fileExistsChecker = checker
  }

  /**
   * Set progress callback for reporting package resolution activity.
   * Called when resolving uncached npm packages (the slow path).
   */
  setProgressCallback(callback: (message: string) => void): void {
    this.progressCallback = callback
  }

  /**
   * Set the package version resolver for pinning dependency versions.
   * When set, resolved versions are appended to CDN URLs.
   */
  setPackageVersionResolver(resolver: PackageVersionResolver): void {
    this.packageVersionResolver = resolver
    this.esmShExternalParam = null // Reset cached param so it's recomputed
  }

  /**
   * Set tsconfig path aliases for local package resolution.
   * Entries like { "@pubwiki/game-sdk": ["./lib/game-sdk"] }
   * are normalized to absolute VFS paths.
   */
  setPathAliases(paths: Record<string, string[]>, baseUrl: string = '/'): void {
    this.pathAliases = new Map()
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
    for (const [pattern, targets] of Object.entries(paths)) {
      const normalized = targets.map(t => {
        const clean = t.startsWith('./') ? t.slice(2) : t
        return base + clean
      })
      this.pathAliases.set(pattern, normalized)
    }
    this.resolveCache.clear()
  }

  /**
   * Resolve an import path
   * @param specifier Import specifier (e.g., './app', 'react', '@scope/package')
   * @param importer Importer file path
   */
  async resolve(specifier: string, importer?: string): Promise<ResolveResult> {
    // Check cache
    const cacheKey = `${importer || ''}:${specifier}`
    const cached = this.resolveCache.get(cacheKey)
    if (cached) {
      return cached
    }

    let result: ResolveResult

    // 1. Relative paths (./, ../)
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      result = await this.resolveRelative(specifier, importer)
    }
    // 2. Absolute paths (/)
    else if (specifier.startsWith('/')) {
      // Check if importer is an HTTP URL
      if (importer && (importer.startsWith('http://') || importer.startsWith('https://'))) {
        const importerUrl = new URL(importer)
        const resolvedUrl = new URL(specifier, importerUrl.origin)
        result = { path: resolvedUrl.href, namespace: 'http' }
      } else {
        // Local VFS absolute path - keep the leading slash
        result = { path: specifier, namespace: 'vfs' }
      }
    }
    // 3. HTTP(S) URLs
    else if (specifier.startsWith('http://') || specifier.startsWith('https://')) {
      result = { path: specifier, namespace: 'http' }
    }
    // 4. data: URIs — mark external, not resolvable as packages
    else if (specifier.startsWith('data:')) {
      result = { path: specifier, namespace: 'external' }
    }
    // 5. tsconfig path aliases (before npm to intercept local packages)
    else {
      const aliasResult = this.pathAliases ? await this.resolvePathAlias(specifier) : null
      if (aliasResult) {
        result = aliasResult
      } else {
        // 6. npm packages
        result = await this.resolveNpmPackage(specifier)
      }
    }

    // Cache result
    this.resolveCache.set(cacheKey, result)
    return result
  }

  /**
   * Try to resolve a specifier using tsconfig path aliases.
   * Returns null if no alias matches.
   */
  private async resolvePathAlias(specifier: string): Promise<ResolveResult | null> {
    if (!this.pathAliases) return null

    for (const [pattern, targets] of this.pathAliases) {
      if (pattern.endsWith('/*')) {
        // Wildcard pattern: "@pubwiki/game-sdk/*" matches "@pubwiki/game-sdk/hooks"
        const prefix = pattern.slice(0, -2)
        if (specifier.startsWith(prefix + '/')) {
          const rest = specifier.slice(prefix.length + 1)
          const target = targets[0]
          const targetBase = target.endsWith('/*') ? target.slice(0, -2) : target
          const resolved = await this.resolveExtensions(targetBase + '/' + rest)
          return { path: resolved, namespace: 'vfs' }
        }
      } else {
        // Exact pattern: "@pubwiki/game-sdk" matches "@pubwiki/game-sdk"
        if (specifier === pattern) {
          const target = targets[0]
          const resolved = await this.resolveExtensions(target)
          return { path: resolved, namespace: 'vfs' }
        }
      }
    }
    return null
  }

  /**
   * Resolve relative path
   */
  private async resolveRelative(specifier: string, importer?: string): Promise<ResolveResult> {
    if (!importer) {
      throw new Error(`Cannot resolve relative path ${specifier} without importer`)
    }

    // Check if importer is an HTTP URL
    if (importer.startsWith('http://') || importer.startsWith('https://')) {
      const importerUrl = new URL(importer)
      const resolvedUrl = new URL(specifier, importerUrl.href)
      return { path: resolvedUrl.href, namespace: 'http' }
    }

    // Local VFS file relative path resolution
    const importerDir = importer.substring(0, importer.lastIndexOf('/'))
    let resolved = this.normalizePath(`${importerDir}/${specifier}`)

    // Try adding extensions
    resolved = await this.resolveExtensions(resolved)

    return { path: resolved, namespace: 'vfs' }
  }

  /**
   * Try different file extensions
   */
  private async resolveExtensions(path: string): Promise<string> {
    // If already has extension, return as-is
    if (/\.(tsx?|jsx?|json|css)$/.test(path)) {
      return path
    }

    // Extensions to try, in order
    const extensions = ['.tsx', '.ts', '.jsx', '.js', '.json']

    for (const ext of extensions) {
      const pathWithExt = path + ext

      if (this.fileExistsChecker) {
        const fileExists = await this.fileExistsChecker(pathWithExt)
        if (fileExists) {
          return pathWithExt
        }
      } else {
        // No checker, assume .tsx exists
        return path + '.tsx'
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = `${path}/index${ext}`
      if (this.fileExistsChecker) {
        const fileExists = await this.fileExistsChecker(indexPath)
        if (fileExists) {
          return indexPath
        }
      }
    }

    // Not found, return original path
    console.warn(`[Resolver] Could not resolve extensions for: ${path}`)
    return path
  }

  /**
   * Normalize path (handle . and ..)
   */
  private normalizePath(path: string): string {
    const isAbsolute = path.startsWith('/')
    const parts = path.split('/')
    const result: string[] = []

    for (const part of parts) {
      if (part === '' || part === '.') {
        continue
      } else if (part === '..') {
        result.pop()
      } else {
        result.push(part)
      }
    }

    const normalized = result.join('/')
    return isAbsolute ? '/' + normalized : normalized
  }

  /**
   * Resolve npm package.
   * 
   * When a PackageVersionResolver is available, the resolved version is
   * appended to the bare package name so CDN URLs pin to a specific version
   * (e.g. `react` → `react@18.2.0`).
   */
  private async resolveNpmPackage(packageName: string): Promise<ResolveResult> {
    // Build a versioned specifier if we have version info
    const versionedName = this.applyVersion(packageName)

    // Track resolved package for importmap write-back
    this.trackResolvedPackage(packageName)

    // Cache key includes esm.sh external params so entries invalidate when deps change
    const esmExt = this.getEsmShExternalParam()
    const cacheKey = esmExt ? `${versionedName}${esmExt}` : versionedName

    // Coalesce concurrent resolutions for the same package.
    // The sync Map check must happen before any await to prevent races.
    const inflight = this.inflightNpmResolves.get(cacheKey)
    if (inflight) return inflight

    const promise = this.resolveNpmPackageUncached(versionedName, cacheKey)
    this.inflightNpmResolves.set(cacheKey, promise)
    try {
      return await promise
    } finally {
      this.inflightNpmResolves.delete(cacheKey)
    }
  }

  private async resolveNpmPackageUncached(versionedName: string, cacheKey: string): Promise<ResolveResult> {
    // Check persistent CDN cache
    if (this.cache) {
      const cached = await this.cache.getCdnUrl(cacheKey)
      if (cached) {
        return { path: cached, namespace: 'http' }
      }
    }

    // Notify progress — this is the slow path (uncached HEAD requests)
    this.progressCallback?.(`Resolving ${versionedName}`)

    // Try multiple CDNs
    for (const cdn of this.cdnConfigs) {
      const url = cdn.url(versionedName)

      try {
        // HEAD request to check if resource exists
        const response = await fetch(url, { method: 'HEAD' })

        if (response.ok) {
          const contentType = response.headers.get('content-type') || ''
          this.headContentTypes.set(url, contentType)
          if (this.cache) {
            this.cache.setCdnUrl(cacheKey, url).catch(() => {})
          }
          return { path: url, namespace: 'http' }
        }
      } catch {
        // Try next CDN
        continue
      }
    }

    // All CDNs failed, use fallback
    const fallbackUrl = this.cdnConfigs[0].url(versionedName)
    console.warn(`[Resolver] All CDNs failed for ${versionedName}, using fallback`)
    return { path: fallbackUrl, namespace: 'http' }
  }

  /**
   * Append version from PackageVersionResolver to a bare package name.
   *
   * Handles both bare names (`react`) and deep imports (`react/jsx-runtime`).
   * If the specifier already contains a version (`react@18`), it is returned as-is.
   */
  private applyVersion(specifier: string): string {
    if (!this.packageVersionResolver) return specifier

    // Already has an explicit version (e.g. react@18)
    // For scoped packages (@scope/pkg@ver), the version @ is after the first /
    const hasExplicitVersion = specifier.startsWith('@')
      ? specifier.slice(specifier.indexOf('/') + 1).includes('@')
      : specifier.includes('@')
    if (hasExplicitVersion) return specifier

    // Extract the bare package name (handle deep imports like react/jsx-runtime)
    let pkgName: string
    if (specifier.startsWith('@')) {
      // Scoped: @scope/name or @scope/name/sub/path
      const parts = specifier.split('/')
      pkgName = parts.slice(0, 2).join('/')
    } else {
      pkgName = specifier.split('/')[0]
    }

    const version = this.packageVersionResolver.getVersion(pkgName)
    if (!version) return specifier

    // Insert version after the package name
    const subpath = specifier.slice(pkgName.length) // e.g. "/jsx-runtime" or ""
    const result = `${pkgName}@${version}${subpath}`
    console.log(`[Resolver] Pinned version: ${specifier} → ${result}`)
    return result
  }

  /**
   * Track a resolved npm package for importmap.json write-back.
   * Only records packages where a version was resolved.
   */
  private trackResolvedPackage(specifier: string): void {
    if (!this.packageVersionResolver) return

    // Extract the bare package name (handle deep imports like react/jsx-runtime)
    const basePkg = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]

    if (this.resolvedPackageVersions.has(basePkg)) return

    const version = this.packageVersionResolver.getVersion(basePkg)
    if (version) {
      this.resolvedPackageVersions.set(basePkg, `${basePkg}@${version}`)
    }
  }

  /**
   * Build the `?external=` query parameter for esm.sh URLs.
   *
   * Without this, esm.sh resolves shared dependencies (e.g. React) to its own
   * internal paths, causing our bundler to load duplicate module instances.
   * With `?external=pkg1,pkg2,...`, esm.sh keeps those as bare import specifiers,
   * so our bundler resolves them through `resolveNpmPackage` to a single canonical URL.
   */
  private esmShExternalParam: string | null = null
  private getEsmShExternalParam(): string {
    if (this.esmShExternalParam !== null) return this.esmShExternalParam
    if (!this.packageVersionResolver?.hasVersions()) return ''

    const allPkgs = [...this.packageVersionResolver.getVersionMap().keys()].sort()
    if (allPkgs.length === 0) return ''

    this.esmShExternalParam = `?external=${allPkgs.join(',')}`
    return this.esmShExternalParam
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.resolveCache.clear()
    this.resolvedPackageVersions.clear()
    this.inflightNpmResolves.clear()
    this.headContentTypes.clear()
  }

  /**
   * Get all resolved npm package versions collected during resolution.
   * Returns a map of base package name → versioned name (e.g. "react" → "react@18.2.0").
   * Used for writing resolved versions back to importmap.json as a lockfile.
   */
  getResolvedPackageVersions(): ReadonlyMap<string, string> {
    return this.resolvedPackageVersions
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { resolveCache: number } {
    return {
      resolveCache: this.resolveCache.size,
    }
  }

  /**
   * Get content-type for a URL that was previously HEAD-checked during npm resolution.
   * Returns undefined if the URL was not resolved by this resolver.
   */
  getKnownContentType(url: string): string | undefined {
    return this.headContentTypes.get(url)
  }
}
