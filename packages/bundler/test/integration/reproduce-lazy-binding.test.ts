/**
 * Reproduce the E2E publish-flow Build 4 failure using the actual ESBuildEngine
 * in a BROWSER environment (esbuild-wasm with Web Worker).
 *
 * Uses the FULL 193-file source tree from the E2E blob directory via a JSON fixture.
 * Simulates the 4-build sequence from the E2E publish-flow test:
 *   Build 1: Original files → OK
 *   Build 2: Broken main.tsx (syntax error) → FAIL
 *   Build 3: Fixed main.tsx → OK
 *   Build 4: App.tsx with added comment → CHECK for broken lazy binding
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ESBuildEngine } from '../../src/core/esbuild-engine'
import { DependencyResolver } from '../../src/core/dependency-resolver'
import { PackageVersionResolver } from '../../src/core/package-version-resolver'
import { MockBuildCacheStorage } from '../helpers/mock-build-cache'
import type { FileReader as PVRFileReader } from '../../src/core/package-version-resolver'
import blobFiles from '../fixtures/e2e-blob-files.json'

// Cast to typed record
const BLOB: Record<string, string> = blobFiles as Record<string, string>

// ── Engine setup ──────────────────────────────────────────────────────────

function createVfsFiles(overrides: Map<string, string> = new Map()): Map<string, string> {
  const files = new Map<string, string>()
  for (const [key, value] of Object.entries(BLOB)) {
    files.set(key, value)
  }
  for (const [key, value] of overrides) {
    files.set(key, value)
  }
  return files
}

async function setupEngine(
  files: Map<string, string>,
  cache: MockBuildCacheStorage
): Promise<{ engine: ESBuildEngine; resolver: DependencyResolver }> {
  const fileReader: PVRFileReader = {
    async readTextFile(path: string) {
      return files.get(path) ?? null
    },
    async exists(path: string) {
      return files.has(path)
    }
  }

  const resolver = new DependencyResolver({
    fileExistsChecker: async (path: string) => files.has(path),
    cache
  })

  const pvr = new PackageVersionResolver(fileReader, '/')
  await pvr.load()
  resolver.setPackageVersionResolver(pvr)

  const engine = new ESBuildEngine(resolver, cache)
  engine.setFileLoader(async (path: string) => {
    const content = files.get(path)
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content
  })

  await engine.initialize()
  return { engine, resolver }
}

async function doBuild(
  label: string,
  files: Map<string, string>,
  cache: MockBuildCacheStorage
): Promise<{ success: boolean; code: string; hasBareLazy: boolean; size: number; resolvedVersions: ReadonlyMap<string, string> }> {
  const { engine, resolver } = await setupEngine(files, cache)

  try {
    const result = await engine.build({
      projectRoot: '/',
      entryFiles: ['/src/main.tsx'],
      options: {
        target: 'es2020',
        jsx: 'automatic',
        jsxImportSource: 'react',
        sourcemap: 'inline',
        treeShaking: true,
      }
    })

    const resolvedVersions = resolver.getResolvedPackageVersions()

    if (!result.success) {
      const errors = [...result.outputs.values()]
        .flatMap(o => o.errors)
        .map(e => e.message)
      console.log(`[${label}] Build failed: ${errors.join('; ')}`)
      return { success: false, code: '', hasBareLazy: false, size: 0, resolvedVersions }
    }

    const output = result.outputs.get('/src/main.tsx')
    const code = output?.code || ''

    // Check for the broken pattern: `lazy(` appearing as a bare identifier
    const lazyCallPattern = /\bvar\s+\w+\s*=\s*lazy\s*\(/
    const hasBareLazy = lazyCallPattern.test(code)

    // Show context around CustomGame assignment
    const cgAssign = code.indexOf('CustomGame2')
    if (cgAssign >= 0) {
      const ctx = code.slice(Math.max(0, cgAssign - 100), cgAssign + 300)
      console.log(`[${label}] CG2_CONTEXT: @${cgAssign} ...${ctx}...`)
    }
    // Find where lazy is exported
    const lazyExport = code.match(/lazy:\s*\(\)\s*=>\s*(\w+)/)
    if (lazyExport) {
      console.log(`[${label}] LAZY_EXPORT: ${lazyExport[0]} (internal: ${lazyExport[1]})`)
    }

    // Show context around lazy usage
    const lazyMatch = code.match(/CustomGame\d*\s*=\s*\w+\s*\(/)
    if (lazyMatch) {
      const idx = code.indexOf(lazyMatch[0])
      const ctx = code.slice(Math.max(0, idx - 30), idx + 120)
      console.log(`[${label}] CustomGame context: ...${ctx}...`)
    }

    console.log(`[${label}] ${hasBareLazy ? '⚠️ BROKEN lazy binding' : '✅ OK'}, size=${code.length}`)
    return { success: true, code, hasBareLazy, size: code.length, resolvedVersions }
  } finally {
    await engine.dispose()
  }
}

// ── Build sequence file overrides matching E2E steps ──────────────────────

// Step 12: Broken main.tsx (syntax error injected by E2E test)
const MAIN_TSX_BROKEN = 'THIS IS NOT VALID TYPESCRIPT {{{'

// Step 14: Fixed main.tsx (original content with Chinese i18n comment removed)
const MAIN_TSX_FIXED = BLOB['/src/main.tsx']!.replace("import './i18n' // 初始化 i18n", "import './i18n'")

// Step 15: App.tsx with prepended comment
const APP_TSX_WITH_COMMENT = `// E2E test comment\n` + BLOB['/src/App.tsx']!

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Reproduce E2E Build 4 lazy binding issue (full project)', () => {
  let cache: MockBuildCacheStorage

  beforeEach(() => {
    cache = new MockBuildCacheStorage()
  })

  it('Build 1 (original) should have correct lazy binding', async () => {
    const files = createVfsFiles()
    const result = await doBuild('Build 1', files, cache)
    expect(result.success).toBe(true)
    expect(result.hasBareLazy).toBe(false)
  }, 120_000)

  it('Full 4-build sequence with shared HTTP cache', async () => {
    const sharedCache = new MockBuildCacheStorage()

    // Build 1: original
    const r1 = await doBuild(
      'Seq-B1',
      createVfsFiles(),
      sharedCache
    )
    expect(r1.success).toBe(true)
    expect(r1.hasBareLazy).toBe(false)

    // Build 2: broken (syntax error)
    const r2 = await doBuild(
      'Seq-B2',
      createVfsFiles(new Map([['/src/main.tsx', MAIN_TSX_BROKEN]])),
      sharedCache
    )
    expect(r2.success).toBe(false)

    // Build 3: fixed main.tsx
    const r3 = await doBuild(
      'Seq-B3',
      createVfsFiles(new Map([['/src/main.tsx', MAIN_TSX_FIXED]])),
      sharedCache
    )
    expect(r3.success).toBe(true)
    expect(r3.hasBareLazy).toBe(false)

    // Build 4: App.tsx with comment (THE CRITICAL BUILD)
    const r4 = await doBuild(
      'Seq-B4',
      createVfsFiles(new Map([
        ['/src/main.tsx', MAIN_TSX_FIXED],
        ['/src/App.tsx', APP_TSX_WITH_COMMENT],
      ])),
      sharedCache
    )
    expect(r4.success).toBe(true)
    expect(r4.hasBareLazy).toBe(false)

    console.log(`\nSize comparison:`)
    console.log(`  Build 1: ${r1.size}`)
    console.log(`  Build 3: ${r3.size}`)
    console.log(`  Build 4: ${r4.size}`)
    console.log(`  E2E ref: ~17,091,650`)
  }, 600_000)

  it('Full 4-build sequence with SINGLE persistent engine (like Studio)', async () => {
    // This matches Studio behavior: one ESBuildEngine instance reused across builds.
    // File overrides are applied by updating the fileLoader dynamically.
    const sharedCache = new MockBuildCacheStorage()
    let currentFiles = createVfsFiles()

    const fileReader: PVRFileReader = {
      async readTextFile(path: string) { return currentFiles.get(path) ?? null },
      async exists(path: string) { return currentFiles.has(path) }
    }

    const resolver = new DependencyResolver({
      fileExistsChecker: async (path: string) => currentFiles.has(path),
      cache: sharedCache
    })

    const pvr = new PackageVersionResolver(fileReader, '/')
    await pvr.load()
    resolver.setPackageVersionResolver(pvr)

    const engine = new ESBuildEngine(resolver, sharedCache)
    engine.setFileLoader(async (path: string) => {
      const content = currentFiles.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      return content
    })
    await engine.initialize()

    async function buildWithFiles(
      label: string,
      overrides: Map<string, string>
    ): Promise<{ success: boolean; code: string; hasBareLazy: boolean; size: number }> {
      currentFiles = createVfsFiles(overrides)

      const result = await engine.build({
        projectRoot: '/',
        entryFiles: ['/src/main.tsx'],
        options: {
          target: 'es2020',
          jsx: 'automatic',
          jsxImportSource: 'react',
          sourcemap: 'inline',
          treeShaking: true,
        }
      })

      if (!result.success) {
        const errors = [...result.outputs.values()]
          .flatMap(o => o.errors)
          .map(e => e.message)
        console.log(`[${label}] Build failed: ${errors.join('; ')}`)
        return { success: false, code: '', hasBareLazy: false, size: 0 }
      }

      const output = result.outputs.get('/src/main.tsx')
      const code = output?.code || ''
      const lazyCallPattern = /\bvar\s+\w+\s*=\s*lazy\s*\(/
      const hasBareLazy = lazyCallPattern.test(code)

      const lazyMatch = code.match(/CustomGame\d*\s*=\s*\w+\s*\(/)
      if (lazyMatch) {
        const idx = code.indexOf(lazyMatch[0])
        const ctx = code.slice(Math.max(0, idx - 30), idx + 120)
        console.log(`[${label}] CustomGame context: ...${ctx}...`)
      }

      console.log(`[${label}] ${hasBareLazy ? '⚠️ BROKEN' : '✅ OK'}, size=${code.length}`)
      return { success: true, code, hasBareLazy, size: code.length }
    }

    try {
      // Build 1: original
      const r1 = await buildWithFiles('Persist-B1', new Map())
      expect(r1.success).toBe(true)
      expect(r1.hasBareLazy).toBe(false)

      // Build 2: broken
      const r2 = await buildWithFiles('Persist-B2', new Map([['/src/main.tsx', MAIN_TSX_BROKEN]]))
      expect(r2.success).toBe(false)

      // Build 3: fixed
      const r3 = await buildWithFiles('Persist-B3', new Map([['/src/main.tsx', MAIN_TSX_FIXED]]))
      expect(r3.success).toBe(true)
      expect(r3.hasBareLazy).toBe(false)

      // Build 4: comment added (THE CRITICAL BUILD)
      const r4 = await buildWithFiles('Persist-B4', new Map([
        ['/src/main.tsx', MAIN_TSX_FIXED],
        ['/src/App.tsx', APP_TSX_WITH_COMMENT],
      ]))
      expect(r4.success).toBe(true)
      expect(r4.hasBareLazy).toBe(false)

      console.log(`\nPersistent engine sizes:`)
      console.log(`  Build 1: ${r1.size}`)
      console.log(`  Build 3: ${r3.size}`)
      console.log(`  Build 4: ${r4.size}`)
    } finally {
      await engine.dispose()
    }
  }, 600_000)

  it('Full 4-build sequence WITH IMPORTMAP WRITEBACK (like E2E)', async () => {
    // This simulates what build-runner.ts does: after Build 1, it writes resolved
    // package versions back to importmap.json via ImportMapManager.mergeResolvedPackages().
    // Build 4 then reads the UPDATED importmap.json with potentially different version info.
    const sharedCache = new MockBuildCacheStorage()
    const CDN_URL = 'https://esm.sh'

    // Build 1: original files
    const files1 = createVfsFiles()
    const r1 = await doBuild('ImportMap-B1', files1, sharedCache)
    expect(r1.success).toBe(true)
    expect(r1.hasBareLazy).toBe(false)

    // Simulate mergeResolvedPackages: write resolved versions to importmap.json
    const importMapStr = files1.get('/importmap.json')
    const importMap = importMapStr ? JSON.parse(importMapStr) as { imports: Record<string, string> } : { imports: {} }
    console.log(`[ImportMap-writeback] Before: ${Object.keys(importMap.imports).filter(k => !k.endsWith('/')).length} packages`)
    console.log(`[ImportMap-writeback] Resolved versions: ${JSON.stringify(Object.fromEntries(r1.resolvedVersions))}`)

    for (const [pkg, versionedPkg] of r1.resolvedVersions) {
      const expectedUrl = `${CDN_URL}/${versionedPkg}`
      if (importMap.imports[pkg] !== expectedUrl) {
        importMap.imports[pkg] = expectedUrl
        importMap.imports[`${pkg}/`] = `${expectedUrl}/`
      }
    }
    const updatedImportMapStr = JSON.stringify(importMap, null, 2)
    console.log(`[ImportMap-writeback] After: ${Object.keys(importMap.imports).filter(k => !k.endsWith('/')).length} packages`)

    // Build 2: broken (syntax error) — uses UPDATED importmap
    const r2 = await doBuild(
      'ImportMap-B2',
      createVfsFiles(new Map([
        ['/src/main.tsx', MAIN_TSX_BROKEN],
        ['/importmap.json', updatedImportMapStr],
      ])),
      sharedCache
    )
    expect(r2.success).toBe(false)

    // Build 3: fixed main.tsx — uses UPDATED importmap
    const r3 = await doBuild(
      'ImportMap-B3',
      createVfsFiles(new Map([
        ['/src/main.tsx', MAIN_TSX_FIXED],
        ['/importmap.json', updatedImportMapStr],
      ])),
      sharedCache
    )
    expect(r3.success).toBe(true)
    expect(r3.hasBareLazy).toBe(false)

    // Build 4: App.tsx with comment (THE CRITICAL BUILD) — uses UPDATED importmap
    const r4 = await doBuild(
      'ImportMap-B4',
      createVfsFiles(new Map([
        ['/src/main.tsx', MAIN_TSX_FIXED],
        ['/src/App.tsx', APP_TSX_WITH_COMMENT],
        ['/importmap.json', updatedImportMapStr],
      ])),
      sharedCache
    )
    expect(r4.success).toBe(true)
    expect(r4.hasBareLazy).toBe(false)

    console.log(`\nImportMap writeback sizes:`)
    console.log(`  Build 1: ${r1.size}`)
    console.log(`  Build 3: ${r3.size}`)
    console.log(`  Build 4: ${r4.size}`)
  }, 600_000)
})
