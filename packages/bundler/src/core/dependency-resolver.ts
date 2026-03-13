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


  constructor(options?: { fileExistsChecker?: (path: string) => Promise<boolean>; cache?: BuildCacheStorage }) {
    this.fileExistsChecker = options?.fileExistsChecker
    this.cache = options?.cache

    // CDN configurations, sorted by priority
    this.cdnConfigs = [
      {
        name: 'esm.sh',
        url: (pkg) => {
          return `https://esm.sh/${pkg}`
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
    // 4. npm packages
    else {
      result = await this.resolveNpmPackage(specifier)
    }

    // Cache result
    this.resolveCache.set(cacheKey, result)
    return result
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
   * Resolve npm package
   */
  private async resolveNpmPackage(packageName: string): Promise<ResolveResult> {
    // Check persistent CDN cache
    if (this.cache) {
      const cached = await this.cache.getCdnUrl(packageName)
      if (cached) {
        return { path: cached, namespace: 'http' }
      }
    }

    // Notify progress — this is the slow path (uncached HEAD requests)
    this.progressCallback?.(`Resolving ${packageName}`)

    // Try multiple CDNs
    for (const cdn of this.cdnConfigs) {
      const url = cdn.url(packageName)

      try {
        // HEAD request to check if resource exists
        const response = await fetch(url, { method: 'HEAD' })

        if (response.ok) {
          if (this.cache) {
            this.cache.setCdnUrl(packageName, url).catch(() => {})
          }
          return { path: url, namespace: 'http' }
        }
      } catch {
        // Try next CDN
        continue
      }
    }

    // All CDNs failed, use fallback
    const fallbackUrl = this.cdnConfigs[0].url(packageName)
    console.warn(`[Resolver] All CDNs failed for ${packageName}, using fallback`)
    return { path: fallbackUrl, namespace: 'http' }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.resolveCache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { resolveCache: number } {
    return {
      resolveCache: this.resolveCache.size,
    }
  }
}
