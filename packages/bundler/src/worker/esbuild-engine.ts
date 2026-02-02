/**
 * ESBuild Engine
 *
 * Core bundling engine using esbuild-wasm.
 * Handles TypeScript/JSX compilation and dependency bundling.
 * Supports multi-entry project builds natively.
 */

import * as esbuild from 'esbuild-wasm'
import { DependencyResolver } from './dependency-resolver'
import { BundleCache } from './bundle-cache'
import type { ProjectBuildResult, FileBuildResult, BuildError, BundleOptions } from '../types'
import type { LoaderType } from './types'

/**
 * Build request for project-level builds
 */
export interface ProjectBuildRequest {
  /** Project root directory */
  projectRoot: string
  /** Entry file paths (absolute) */
  entryFiles: string[]
  /** Build options */
  options?: BundleOptions
}

/**
 * ESBuild Engine
 * 
 * Supports multi-entry builds using esbuild's native entryPoints.
 */
export class ESBuildEngine {
  private initialized = false
  private initPromise: Promise<void> | null = null
  private resolver: DependencyResolver
  private cache: BundleCache

  // Build context for incremental compilation (keyed by projectRoot)
  private buildContexts = new Map<string, esbuild.BuildContext>()
  // Track build options hash per project to detect option changes
  private buildOptionsHash = new Map<string, string>()

  // Dependency graph (all files across projects)
  private dependencyGraph = new Map<string, Set<string>>()
  private dependentGraph = new Map<string, Set<string>>()

  // File loader (injected from VFS adapter)
  private fileLoader?: (path: string) => Promise<string>

  // HTTP loader with caching - returns content and content-type
  private async httpLoader(url: string): Promise<{ content: string; contentType: string }> {
    const cached = await this.cache.getHttp(url)
    if (cached) {
      return cached
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') || ''
    const content = await response.text()
    await this.cache.setHttp(url, content, contentType)
    return { content, contentType }
  }

  // Get Content-Type for HTTP resource (uses cache or HEAD request)
  private async getHttpContentType(url: string): Promise<string> {
    // Check cache first
    const cached = await this.cache.getHttp(url)
    if (cached) {
      return cached.contentType
    }

    // Use HEAD request to check content-type without downloading full content
    try {
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok) {
        return response.headers.get('content-type') || ''
      }
    } catch {
      // Ignore HEAD request errors, will be handled during actual load
    }
    
    return ''
  }

  constructor(resolver: DependencyResolver, cache: BundleCache) {
    this.resolver = resolver
    this.cache = cache
  }

  /**
   * Set the file loader function
   */
  setFileLoader(loader: (path: string) => Promise<string>): void {
    this.fileLoader = loader
  }

  /**
   * Initialize esbuild-wasm
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    console.log('[ESBuildEngine] Initializing esbuild-wasm...')

    this.initPromise = (async () => {
      try {
        // Use CDN URL for esbuild-wasm binary
        // The version should match the package.json dependency
        await esbuild.initialize({
          wasmURL: 'https://unpkg.com/esbuild-wasm@0.27.2/esbuild.wasm',
          worker: false // Web Worker cannot create sub-workers
        })
        this.initialized = true
        console.log('[ESBuildEngine] esbuild-wasm initialized')
      } catch (error) {
        // Handle "already initialized" error - this is not a real error
        if (error instanceof Error && error.message.includes('Cannot call "initialize" more than once')) {
          this.initialized = true
          console.log('[ESBuildEngine] esbuild-wasm was already initialized')
          return
        }
        console.error('[ESBuildEngine] Failed to initialize:', error)
        this.initPromise = null
        throw error
      }
    })()

    return this.initPromise
  }

  /**
   * Check if engine is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Compute a hash of build options to detect changes
   */
  private computeOptionsHash(options: BundleOptions, entryFiles: string[]): string {
    const relevant = {
      target: options.target || 'es2020',
      jsx: options.jsx || 'automatic',
      jsxImportSource: options.jsxImportSource || 'react',
      sourcemap: options.sourcemap,
      minify: options.minify || false,
      treeShaking: options.treeShaking ?? true,
      define: options.define,
      entryFiles: entryFiles.sort()
    }
    return JSON.stringify(relevant)
  }

  /**
   * Get loader type for a file
   */
  private getLoader(filePath: string): LoaderType {
    if (filePath.endsWith('.tsx')) return 'tsx'
    if (filePath.endsWith('.ts')) return 'ts'
    if (filePath.endsWith('.jsx')) return 'jsx'
    if (filePath.endsWith('.js')) return 'js'
    if (filePath.endsWith('.json')) return 'json'
    if (filePath.endsWith('.css')) return 'css'
    return 'tsx' // Default to tsx (most permissive)
  }

  /**
   * Get loader type based on Content-Type header
   * Returns 'binary' for resources that should be kept as external URLs
   */
  private getLoaderFromContentType(contentType: string): LoaderType | 'binary' {
    // Normalize content-type (remove charset and other params)
    const mimeType = contentType.split(';')[0].trim().toLowerCase()

    // CSS
    if (mimeType === 'text/css') {
      return 'css'
    }

    // JavaScript
    if (mimeType === 'text/javascript' || 
        mimeType === 'application/javascript' ||
        mimeType === 'application/x-javascript') {
      return 'js'
    }

    // JSON
    if (mimeType === 'application/json' || mimeType === 'text/json') {
      return 'json'
    }

    // TypeScript (rare from HTTP but possible)
    if (mimeType === 'text/typescript' ||
        mimeType === 'application/typescript') {
      return 'ts'
    }

    // Binary types - images
    if (mimeType.startsWith('image/')) {
      return 'binary'
    }

    // Binary types - fonts
    if (mimeType.startsWith('font/') ||
        mimeType === 'application/font-woff' ||
        mimeType === 'application/font-woff2' ||
        mimeType === 'application/x-font-ttf' ||
        mimeType === 'application/x-font-opentype') {
      return 'binary'
    }

    // Binary types - audio/video
    if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
      return 'binary'
    }

    // Binary types - other
    if (mimeType === 'application/octet-stream' ||
        mimeType === 'application/pdf' ||
        mimeType === 'application/zip') {
      return 'binary'
    }

    // Default to JS for text/* and unknown types
    return 'binary'
  }

  /**
   * Build a project with multiple entry files
   */
  async build(request: ProjectBuildRequest): Promise<ProjectBuildResult> {
    if (!this.initialized) {
      await this.initialize()
    }

    if (!this.fileLoader) {
      return {
        success: false,
        outputs: new Map(),
        dependencies: []
      }
    }

    const { projectRoot, entryFiles, options = {} } = request
    const startTime = performance.now()
    console.log("[ESBuildEngine] building project", request.projectRoot)
    
    // Clear dependency graph for entry files before rebuild to get fresh data
    // This ensures new imports are tracked correctly during incremental builds
    for (const entry of entryFiles) {
      this.clearDependencies(entry)
    }
    
    // Collect all VFS dependencies encountered during this build
    const allProjectDeps = new Set<string>()
    
    // Current entry being processed (for dependency tracking)
    let currentEntry: string | null = null

    try {
      // Create esbuild plugin for resolution and loading
      const resolverPlugin: esbuild.Plugin = {
        name: 'bundler-resolver',
        setup: (build) => {
          // Resolve imports
          build.onResolve({ filter: /.*/ }, async (args) => {
            try {
              // Track which entry we're processing
              if (entryFiles.includes(args.importer) || !args.importer) {
                currentEntry = args.importer || args.path
              }

              // For CSS url() tokens referencing external URLs, mark as external
              // This keeps the original URL in the CSS output
              if (args.kind === 'url-token' && 
                  (args.path.startsWith('http://') || args.path.startsWith('https://'))) {
                return { path: args.path, external: true }
              }

              const resolved = await this.resolver.resolve(
                args.path,
                args.importer || currentEntry || entryFiles[0]
              )

              // For HTTP resources that are binary (images, fonts, etc.), mark as external
              // This applies to both CSS url() and JS imports of remote assets
              if (resolved.namespace === 'http') {
                const contentType = await this.getHttpContentType(resolved.path)
                const loader = this.getLoaderFromContentType(contentType)
                if (loader === 'binary') {
                  return { path: resolved.path, external: true }
                }
              }

              // Track VFS dependencies directly in dependencyGraph
              if (resolved.namespace === 'vfs' && currentEntry) {
                this.addDependency(currentEntry, resolved.path)
              }

              return {
                path: resolved.path,
                namespace: resolved.namespace,
              }
            } catch (error) {
              console.error(`[ESBuildEngine] Resolve failed for ${args.path}:`, error)
              return { path: args.path, external: true }
            }
          })

          // Load VFS files
          build.onLoad({ filter: /.*/, namespace: 'vfs' }, async (args) => {
            try {
              const contents = await this.fileLoader!(args.path)
              const loader = this.getLoader(args.path)

              return { contents, loader }
            } catch (error) {
              console.error(`[ESBuildEngine] Load failed for ${args.path}:`, error)
              throw error
            }
          })

          // Load HTTP resources (binary resources are already marked external in onResolve)
          build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
            try {
              const { content, contentType } = await this.httpLoader(args.path)
              const loader = this.getLoaderFromContentType(contentType)
              
              console.log(`[ESBuildEngine] HTTP load: ${args.path}`)
              console.log(`[ESBuildEngine]   Content-Type: "${contentType}" -> loader: "${loader}"`)

              return { contents: content, loader }
            } catch (error) {
              console.error(`[ESBuildEngine] HTTP load failed for ${args.path}:`, error)
              throw error
            }
          })
        }
      }

      // Build options with multiple entry points
      const buildOptions: esbuild.BuildOptions = {
        entryPoints: entryFiles.map(f => ({ in: f, out: this.getOutputName(f) })),
        bundle: true,
        write: false,
        format: 'esm',
        target: options.target || 'es2020',
        jsx: options.jsx === 'classic' ? 'transform' : 'automatic',
        jsxImportSource: options.jsxImportSource || 'react',
        sourcemap: options.sourcemap === true ? 'inline' : 
                   options.sourcemap === 'external' ? 'external' :
                   options.sourcemap === 'inline' ? 'inline' : 'inline',
        minify: options.minify || false,
        treeShaking: options.treeShaking ?? true,
        splitting: entryFiles.length > 1, // Enable code splitting for multi-entry
        chunkNames: 'chunks/[name]-[hash]',
        outdir: 'out', // Required for splitting
        plugins: [resolverPlugin],
        logLevel: 'warning',
        define: options.define
      }

      // Use context for incremental builds, but recreate if options changed
      let result: esbuild.BuildResult
      let context = this.buildContexts.get(projectRoot)
      const currentOptionsHash = this.computeOptionsHash(options, entryFiles)
      const previousOptionsHash = this.buildOptionsHash.get(projectRoot)

      // If options changed, dispose old context and create new one
      if (context && previousOptionsHash !== currentOptionsHash) {
        await context.dispose()
        context = undefined
        this.buildContexts.delete(projectRoot)
      }

      if (context) {
        result = await context.rebuild()
      } else {
        context = await esbuild.context(buildOptions)
        this.buildContexts.set(projectRoot, context)
        this.buildOptionsHash.set(projectRoot, currentOptionsHash)
        result = await context.rebuild()
      }

      // Collect all dependencies for entries from the dependency graph
      for (const entry of entryFiles) {
        const allDeps = this.dependencyGraph.get(entry)
        if (allDeps) {
          for (const dep of allDeps) {
            allProjectDeps.add(dep)
          }
        }
      }
      console.log("[BundlerWorker] dep graph is", this.dependencyGraph, allProjectDeps)
      console.log("[BundlerWorker] result is ", result)

      // Process output files into per-entry results
      const outputs = new Map<string, FileBuildResult>()
      let allSuccess = true

      // Map output files to entry files
      for (const entryPath of entryFiles) {
        const outputName = this.getOutputName(entryPath)
        const outputFile = result.outputFiles?.find(f => 
          f.path.includes(outputName) && f.path.endsWith('.js')
        )
        const mapFile = result.outputFiles?.find(f => 
          f.path.includes(outputName) && f.path.endsWith('.js.map')
        )
        const cssFile = result.outputFiles?.find(f => 
          f.path.includes(outputName) && f.path.endsWith('.css')
        )

        const entryDeps = this.dependencyGraph.get(entryPath)
        const depsArray = entryDeps ? Array.from(entryDeps) : []

        if (outputFile) {
          // If there's CSS output, inject it into the JS code at runtime
          let finalCode = outputFile.text
          if (cssFile?.text) {
            const cssInjectionCode = this.generateCssInjectionCode(cssFile.text, entryPath)
            // Prepend CSS injection to JS so styles are applied before script runs
            finalCode = cssInjectionCode + '\n' + finalCode
          }

          outputs.set(entryPath, {
            success: true,
            code: finalCode,
            css: cssFile?.text,
            map: mapFile?.text,
            dependencies: depsArray,
            errors: [],
            warnings: result.warnings?.filter(w => 
              w.location?.file === entryPath
            ).map(w => ({
              file: w.location?.file,
              line: w.location?.line,
              column: w.location?.column,
              message: w.text
            }))
          })
        } else {
          // Fallback: if no specific output found, use first output
          const fallbackOutput = result.outputFiles?.[0]
          if (fallbackOutput && entryFiles.length === 1) {
            outputs.set(entryPath, {
              success: true,
              code: fallbackOutput.text,
              dependencies: depsArray,
              errors: []
            })
          } else {
            allSuccess = false
            outputs.set(entryPath, {
              success: false,
              errors: [{ 
                file: entryPath, 
                line: 0, 
                column: 0, 
                message: 'No output generated' 
              }]
            })
          }
        }
      }

      const duration = performance.now() - startTime
      console.log(`[ESBuildEngine] Built ${entryFiles.length} entries in ${duration.toFixed(2)}ms`)

      return {
        success: allSuccess,
        outputs,
        dependencies: Array.from(allProjectDeps)
      }

    } catch (error) {
      console.error('[ESBuildEngine] Build failed:', error)

      // Create error result for all entries
      const outputs = new Map<string, FileBuildResult>()
      const buildError = this.parseError(error, entryFiles[0])

      for (const entryPath of entryFiles) {
        outputs.set(entryPath, {
          success: false,
          errors: [buildError]
        })
      }

      return {
        success: false,
        outputs,
        dependencies: []
      }
    }
  }

  /**
   * Get output filename from entry path
   */
  private getOutputName(entryPath: string): string {
    const basename = entryPath.split('/').pop() || 'output'
    return basename.replace(/\.(tsx?|jsx?)$/, '')
  }

  /**
   * Generate CSS injection code that will inject styles at runtime
   * This is used to inline CSS into JS bundle so users don't need to add <link> tags
   */
  private generateCssInjectionCode(css: string, entryPath: string): string {
    // Create a unique style ID based on entry path to avoid duplicate injection
    const styleId = 'css-' + entryPath.replace(/[^a-zA-Z0-9]/g, '-')
    
    return `
// Injected CSS from bundler
(function() {
  var css = ${JSON.stringify(css)};
  var styleId = ${JSON.stringify(styleId)};
  if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
`
  }

  /**
   * Parse esbuild error
   */
  private parseError(error: unknown, defaultFile: string): BuildError {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const buildError: BuildError = {
      file: defaultFile,
      line: 0,
      column: 0,
      message: errorMessage
    }

    if (error && typeof error === 'object' && 'errors' in error) {
      const esbuildErrors = (error as { errors: esbuild.Message[] }).errors
      if (esbuildErrors.length > 0) {
        const e = esbuildErrors[0]
        buildError.file = e.location?.file || defaultFile
        buildError.line = e.location?.line || 0
        buildError.column = e.location?.column || 0
        buildError.message = e.text
        buildError.snippet = e.location?.lineText
      }
    }

    return buildError
  }

  /**
   * Clear dependencies for a file (used before rebuild)
   */
  private clearDependencies(file: string): void {
    const oldDeps = this.dependencyGraph.get(file)
    if (oldDeps) {
      for (const dep of oldDeps) {
        const dependents = this.dependentGraph.get(dep)
        if (dependents) {
          dependents.delete(file)
        }
      }
      this.dependencyGraph.delete(file)
    }
  }

  /**
   * Add a dependency for a file (used during build)
   */
  private addDependency(file: string, dep: string): void {
    let deps = this.dependencyGraph.get(file)
    if (!deps) {
      deps = new Set()
      this.dependencyGraph.set(file, deps)
    }
    if (!deps.has(dep)) {
      deps.add(dep)
      
      // Update dependents graph
      let dependents = this.dependentGraph.get(dep)
      if (!dependents) {
        dependents = new Set()
        this.dependentGraph.set(dep, dependents)
      }
      dependents.add(file)
    }
  }

  /**
   * Get files affected by a change
   */
  getAffectedFiles(changedFile: string): string[] {
    const affected = new Set<string>()
    const queue = [changedFile]

    while (queue.length > 0) {
      const file = queue.shift()!
      if (affected.has(file)) continue
      affected.add(file)

      const dependents = this.dependentGraph.get(file)
      if (dependents) {
        for (const dep of dependents) {
          if (!affected.has(dep)) {
            queue.push(dep)
          }
        }
      }
    }

    return Array.from(affected)
  }

  /**
   * Invalidate build context for a project
   */
  async invalidateContext(projectRoot: string): Promise<void> {
    const context = this.buildContexts.get(projectRoot)
    if (context) {
      await context.dispose()
      this.buildContexts.delete(projectRoot)
    }
  }

  /**
   * Invalidate all build contexts
   */
  async invalidateAllContexts(): Promise<void> {
    for (const context of this.buildContexts.values()) {
      await context.dispose()
    }
    this.buildContexts.clear()
    this.dependencyGraph.clear()
    this.dependentGraph.clear()
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): Map<string, { dependencies: string[]; dependents: string[] }> {
    const result = new Map<string, { dependencies: string[]; dependents: string[] }>()

    for (const [file, deps] of this.dependencyGraph.entries()) {
      const dependents = this.dependentGraph.get(file) || new Set()
      result.set(file, {
        dependencies: Array.from(deps),
        dependents: Array.from(dependents)
      })
    }

    return result
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    await this.invalidateAllContexts()
    this.initialized = false
    this.initPromise = null
  }
}
