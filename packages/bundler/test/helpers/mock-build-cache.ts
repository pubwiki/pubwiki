import type { BuildCacheStorage, BuildCacheEntry, BuildCacheFile, BuildCacheMetadata } from '../../src/cache'
import type { BuildManifest } from '../../src/types/result'

/**
 * In-memory BuildCacheStorage for tests.
 * Stores everything in plain Maps — no OPFS or IndexedDB needed.
 */
export class MockBuildCacheStorage implements BuildCacheStorage {
  private entries = new Map<string, { manifest: BuildManifest; metadata: BuildCacheMetadata; files: Map<string, Uint8Array> }>()
  private httpCache = new Map<string, { content: string; contentType: string }>()
  private cdnCache = new Map<string, string>()
  private transformCache = new Map<string, unknown>()

  async put(key: string, manifest: BuildManifest, files: BuildCacheFile[], metadata: BuildCacheMetadata): Promise<void> {
    const fileMap = new Map<string, Uint8Array>()
    for (const f of files) fileMap.set(f.path, f.content)
    this.entries.set(key, { manifest, metadata, files: fileMap })
  }

  async get(key: string): Promise<BuildCacheEntry | null> {
    const e = this.entries.get(key)
    return e ? { manifest: e.manifest, metadata: e.metadata } : null
  }

  async has(key: string): Promise<boolean> { return this.entries.has(key) }
  async delete(key: string): Promise<void> { this.entries.delete(key) }

  async list(): Promise<BuildCacheMetadata[]> {
    return [...this.entries.values()].map(e => e.metadata)
  }

  async readFile(key: string, filePath: string): Promise<Uint8Array | null> {
    return this.entries.get(key)?.files.get(filePath) ?? null
  }

  async evict(): Promise<number> { return 0 }
  async updateMetadata(key: string, updates: Partial<BuildCacheMetadata>): Promise<void> {
    const e = this.entries.get(key)
    if (e) Object.assign(e.metadata, updates)
  }

  async resolve(buildCacheKey: string, _fileHashes: Record<string, string>): Promise<BuildCacheEntry | null> {
    return this.get(buildCacheKey)
  }

  async getHttp(url: string) { return this.httpCache.get(url) ?? null }
  async setHttp(url: string, content: string, contentType: string) { this.httpCache.set(url, { content, contentType }) }

  async getCdnUrl(packageName: string) { return this.cdnCache.get(packageName) ?? null }
  async setCdnUrl(packageName: string, resolvedUrl: string) { this.cdnCache.set(packageName, resolvedUrl) }

  async getTransform(key: string) { return this.transformCache.get(key) ?? null }
  async setTransform(key: string, value: unknown) { this.transformCache.set(key, value) }
  async deleteTransform(key: string) { this.transformCache.delete(key) }
  async clearTransformCache() { this.transformCache.clear() }
}
