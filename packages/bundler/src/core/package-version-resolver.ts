/**
 * Package Version Resolver
 *
 * Reads package.json and common lock files (package-lock.json, pnpm-lock.yaml,
 * yarn.lock) from VFS to extract pinned dependency versions for CDN resolution.
 */

/**
 * File reader interface — a minimal subset of VFS for reading text files.
 */
export interface FileReader {
  readTextFile(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
}

/**
 * Resolved version map: package name → version string (e.g. "18.2.0")
 */
export type VersionMap = Map<string, string>

/**
 * PackageVersionResolver scans VFS for package.json and lock files
 * and provides a lookup from package name to a resolved version string.
 */
export class PackageVersionResolver {
  private versions: VersionMap = new Map()
  private loaded = false

  constructor(private fileReader: FileReader, private projectRoot: string) {}

  /**
   * Load and merge version information.
   * Sources are tried in order; later sources override earlier ones,
   * so lock files (which have exact versions) take precedence over
   * package.json ranges.
   */
  async load(): Promise<void> {
    if (this.loaded) return

    // 1. package.json — gives semver ranges (used as base)
    await this.loadPackageJson()

    // 2. importmap.json — CDN URLs serve as a lightweight lockfile.
    //    Versions extracted from URLs override package.json ranges.
    await this.loadImportMap()

    // 3. Lock files — give exact versions (override all above)
    //    Try all known lock files; typically only one exists.
    await this.loadPnpmLock()
    await this.loadNpmLock()
    await this.loadYarnLock()

    this.loaded = true
    console.log(`[PackageVersionResolver] Loaded ${this.versions.size} package version(s)`, Object.fromEntries(this.versions))
  }

  /**
   * Get the resolved version for a package, or undefined if unknown.
   * The returned string is suitable for appending to a CDN URL
   * (e.g. "18.2.0" or "^18.2.0").
   */
  getVersion(packageName: string): string | undefined {
    return this.versions.get(packageName)
  }

  /**
   * Get the full version map (read-only copy).
   * Useful for bulk operations like building import maps.
   */
  getVersionMap(): ReadonlyMap<string, string> {
    return this.versions
  }

  /**
   * Check if any version information has been loaded.
   */
  hasVersions(): boolean {
    return this.versions.size > 0
  }

  /**
   * Check whether a version string looks like a real semver version
   * (possibly with a range prefix like ^, ~, >=, etc.).
   *
   * Rejects:
   *  - Relative paths: "./foo", "../bar", "file:../lib"
   *  - Protocol specifiers: "file:", "link:", "workspace:", "portal:"
   *  - Git URLs: "git+https://...", "github:user/repo"
   *  - HTTP URLs: "https://..."
   *  - Tags that are clearly not versions: "latest", "next", "canary"
   *  - npm aliases: "npm:other-pkg@1.0.0"
   *  - Star wildcards: "*"
   */
  static isValidVersion(version: string): boolean {
    // Must be a non-empty string
    if (!version || typeof version !== 'string') return false

    const v = version.trim()

    // Reject protocols and URL-like specifiers
    if (/^(file|link|workspace|portal|git|git\+https?|git\+ssh|github|gitlab|bitbucket|https?):/.test(v)) return false

    // Reject relative paths
    if (v.startsWith('./') || v.startsWith('../') || v.startsWith('/')) return false

    // Reject npm aliases (npm:pkg@version)
    if (v.startsWith('npm:')) return false

    // Reject lone star or empty-ish
    if (v === '*' || v === '') return false

    // Reject well-known dist-tags (no digits at all)
    if (/^[a-zA-Z-]+$/.test(v)) return false

    // Must contain at least one digit to be version-like
    if (!/\d/.test(v)) return false

    return true
  }

  // ---------------------------------------------------------------------------
  // package.json
  // ---------------------------------------------------------------------------

  private async loadPackageJson(): Promise<void> {
    const path = this.resolvePath('package.json')
    const content = await this.fileReader.readTextFile(path)
    if (!content) return

    try {
      const pkg = JSON.parse(content) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }

      // Merge both sections; devDependencies can be useful for build-time deps
      for (const deps of [pkg.dependencies, pkg.devDependencies]) {
        if (!deps) continue
        for (const [name, range] of Object.entries(deps)) {
          if (PackageVersionResolver.isValidVersion(range)) {
            this.versions.set(name, range)
          } else {
            console.log(`[PackageVersionResolver] Skipped non-version dep: ${name} = ${range}`)
          }
        }
      }
    } catch {
      console.warn('[PackageVersionResolver] Failed to parse package.json')
    }
  }

  // ---------------------------------------------------------------------------
  // importmap.json — CDN URLs as a lightweight lockfile
  // ---------------------------------------------------------------------------

  /**
   * Pattern to extract package name and version from CDN URLs.
   * Matches: https://esm.sh/react@18.2.0, https://cdn.jsdelivr.net/npm/@scope/pkg@1.0.0
   */
  private static readonly CDN_VERSION_PATTERN = /^https?:\/\/[^/]+\/(@[^/@]+\/[^/@]+|[^/@]+)@([^/?/]+)/

  private async loadImportMap(): Promise<void> {
    const path = this.resolvePath('importmap.json')
    const content = await this.fileReader.readTextFile(path)
    if (!content) return

    try {
      const importMap = JSON.parse(content) as { imports?: Record<string, string> }
      const imports = importMap?.imports
      if (!imports || typeof imports !== 'object') return

      const before = this.versions.size
      for (const [key, url] of Object.entries(imports)) {
        // Skip subpath mappings (ending with /)
        if (key.endsWith('/')) continue
        if (typeof url !== 'string') continue

        const match = url.match(PackageVersionResolver.CDN_VERSION_PATTERN)
        if (match) {
          const pkg = match[1]
          const version = match[2]
          // Only use if the key matches the extracted package name
          if (pkg === key && PackageVersionResolver.isValidVersion(version)) {
            this.versions.set(key, version)
          }
        }
      }
      console.log(`[PackageVersionResolver] importmap.json: +${this.versions.size - before} version(s)`)
    } catch {
      console.warn('[PackageVersionResolver] Failed to parse importmap.json')
    }
  }

  // ---------------------------------------------------------------------------
  // pnpm-lock.yaml (v6+ lockfileVersion)
  // ---------------------------------------------------------------------------

  private async loadPnpmLock(): Promise<void> {
    const path = this.resolvePath('pnpm-lock.yaml')
    const content = await this.fileReader.readTextFile(path)
    if (!content) return

    try {
      const before = this.versions.size
      this.parsePnpmLock(content)
      console.log(`[PackageVersionResolver] pnpm-lock.yaml: +${this.versions.size - before} version(s)`)
    } catch {
      console.warn('[PackageVersionResolver] Failed to parse pnpm-lock.yaml')
    }
  }

  /**
   * Lightweight YAML-subset parser for pnpm-lock.yaml.
   *
   * We look for the `importers > . > dependencies/devDependencies` section
   * (lockfile v6+) or the top-level `dependencies` section (older format).
   *
   * Entries look like:
   *   react:
   *     specifier: ^18.2.0
   *     version: 18.2.0
   *
   * or in older format:
   *   /react/18.2.0:
   *     ...
   */
  private parsePnpmLock(content: string): void {
    const lines = content.split('\n')

    // We only care about the root importer (importers > . > dependencies/devDependencies).
    // Other importers (workspace members) have link: versions that don't apply to us.

    let state: 'scanning' | 'in-root-importer' | 'in-deps' | 'done' = 'scanning'
    let currentPkg: string | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trimEnd()
      if (trimmed === '') continue

      switch (state) {
        case 'scanning':
          // Look for the root importer "  .:" or "  '.:'""
          if (/^ {2}['"]?\.['"]?:/.test(trimmed)) {
            state = 'in-root-importer'
          }
          break

        case 'in-root-importer':
          // Inside root importer block — look for dependencies/devDependencies
          if (/^ {4}(dependencies|devDependencies):/.test(trimmed)) {
            state = 'in-deps'
            currentPkg = null
            break
          }
          // If we hit a line at ≤2-space indent, we've left the root importer
          if (/^\S/.test(trimmed) || /^ {2}\S/.test(trimmed)) {
            state = 'done'
          }
          break

        case 'in-deps': {
          // Exit deps section if we're back at importer-level indent (4 spaces or less)
          // A new "dependencies:" or "devDependencies:" at 4-space indent stays in root importer
          if (/^ {4}(dependencies|devDependencies):/.test(trimmed)) {
            currentPkg = null
            break
          }
          // Left root importer section entirely (new importer or top-level key)
          if (/^\S/.test(trimmed) || (/^ {2}\S/.test(trimmed) && !/^ {4}/.test(trimmed))) {
            state = 'done'
            break
          }

          // Package name line (e.g. "      react:" or "      '@scope/pkg':")
          const pkgMatch = trimmed.match(/^\s{6}(['"]?(@[\w-]+\/[\w.-]+|[\w.-]+)['"]?):$/)
          if (pkgMatch) {
            currentPkg = pkgMatch[2]
            break
          }

          // Version line under a package (e.g. "        version: 18.2.0")
          if (currentPkg) {
            const versionMatch = trimmed.match(/^\s+version:\s+['"]?([^'"}\s,]+)['"]?/)
            if (versionMatch) {
              // pnpm lock versions can have suffixes like 18.2.0(@types/react@18.2.0)
              const version = versionMatch[1].split('(')[0]
              if (PackageVersionResolver.isValidVersion(version)) {
                this.versions.set(currentPkg, version)
              }
              currentPkg = null
              break
            }

            // specifier line — skip, we want the resolved version
            if (/^\s+specifier:/.test(trimmed)) {
              break
            }

            // New package or unrecognized line — reset
            if (/^\s{6}\S/.test(trimmed)) {
              currentPkg = null
            }
          }
          break
        }
      }

      if (state === 'done') break
    }
  }

  // ---------------------------------------------------------------------------
  // package-lock.json (npm lockfile v2/v3)
  // ---------------------------------------------------------------------------

  private async loadNpmLock(): Promise<void> {
    const path = this.resolvePath('package-lock.json')
    const content = await this.fileReader.readTextFile(path)
    if (!content) return

    try {
      const lock = JSON.parse(content) as {
        lockfileVersion?: number
        packages?: Record<string, { version?: string }>
        dependencies?: Record<string, { version?: string }>
      }

      // v2/v3: packages section ("node_modules/<name>" → { version })
      if (lock.packages) {
        for (const [key, entry] of Object.entries(lock.packages)) {
          if (!entry.version) continue
          // key is like "node_modules/react" or "node_modules/@scope/pkg"
          const match = key.match(/^node_modules\/(.+)$/)
          if (match && PackageVersionResolver.isValidVersion(entry.version)) {
            this.versions.set(match[1], entry.version)
          }
        }
      }

      // v1 fallback: dependencies section
      if (lock.dependencies) {
        for (const [name, entry] of Object.entries(lock.dependencies)) {
          if (entry.version && PackageVersionResolver.isValidVersion(entry.version)) {
            this.versions.set(name, entry.version)
          }
        }
      }
      console.log(`[PackageVersionResolver] package-lock.json: ${this.versions.size} version(s) total`)
    } catch {
      console.warn('[PackageVersionResolver] Failed to parse package-lock.json')
    }
  }

  // ---------------------------------------------------------------------------
  // yarn.lock (v1 format)
  // ---------------------------------------------------------------------------

  private async loadYarnLock(): Promise<void> {
    const path = this.resolvePath('yarn.lock')
    const content = await this.fileReader.readTextFile(path)
    if (!content) return

    try {
      const before = this.versions.size
      this.parseYarnLock(content)
      console.log(`[PackageVersionResolver] yarn.lock: +${this.versions.size - before} version(s)`)
    } catch {
      console.warn('[PackageVersionResolver] Failed to parse yarn.lock')
    }
  }

  /**
   * Lightweight parser for yarn.lock v1 format.
   *
   * Entries look like:
   *   react@^18.2.0:
   *     version "18.2.0"
   *     ...
   *
   * Or with quotes:
   *   "react@^18.2.0", "react@>=18.0.0":
   *     version "18.2.0"
   */
  private parseYarnLock(content: string): void {
    const lines = content.split('\n')
    let currentPackages: string[] = []

    for (const line of lines) {
      // Skip comments and blank lines
      if (line.startsWith('#') || line.trim() === '') continue

      // Package header line (not indented)
      if (!line.startsWith(' ') && line.endsWith(':')) {
        // Parse package names from the header
        // e.g. 'react@^18.2.0:' or '"react@^18.2.0", "react@>=18":' 
        currentPackages = this.parseYarnLockHeader(line)
        continue
      }

      // Version line (indented)
      if (currentPackages.length > 0) {
        const versionMatch = line.match(/^\s+version\s+"([^"]+)"/)
        if (versionMatch) {
          const version = versionMatch[1]
          if (PackageVersionResolver.isValidVersion(version)) {
            for (const pkg of currentPackages) {
              this.versions.set(pkg, version)
            }
          }
          currentPackages = []
        }
      }
    }
  }

  /**
   * Parse a yarn.lock header line into package names.
   * Handles formats like:
   *   react@^18.2.0:
   *   "react@^18.2.0", "react@>=18.0.0":
   *   "@scope/pkg@^1.0.0":
   */
  private parseYarnLockHeader(line: string): string[] {
    // Remove trailing colon
    const header = line.slice(0, -1).trim()
    const packages: string[] = []

    // Split on ", " to handle multiple specifiers
    const parts = header.split(/,\s*/)
    for (let part of parts) {
      // Remove surrounding quotes
      part = part.replace(/^["']|["']$/g, '').trim()
      // Extract package name (everything before the last @version)
      // Handle scoped packages: @scope/name@version
      const atIdx = part.lastIndexOf('@')
      if (atIdx > 0) {
        packages.push(part.substring(0, atIdx))
      }
    }

    return packages
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolvePath(filename: string): string {
    if (this.projectRoot === '/') return `/${filename}`
    return `${this.projectRoot}/${filename}`
  }
}
