/**
 * RemoteBuildFetcher — L2 remote cache implementation
 *
 * Fetches build cache metadata and archives from the backend API.
 * Used by BuildAwareVfs for L2 cache resolution (R2 via build-cache API).
 */

import type { RemoteBuildFetcher, BuildCacheFile } from '@pubwiki/bundler'
import type { BuildManifest } from '@pubwiki/bundler'
import { extractTarGz } from '@pubwiki/flow-core'

/**
 * Create a RemoteBuildFetcher that uses the PubWiki API.
 *
 * @param apiBaseUrl - The base URL for the API (e.g., 'https://api.pub.wiki/api')
 * @returns A RemoteBuildFetcher instance
 */
export function createRemoteBuildFetcher(apiBaseUrl: string): RemoteBuildFetcher {
  return {
    async getMetadata(cacheKey: string) {
      try {
        const response = await fetch(`${apiBaseUrl}/build-cache/${encodeURIComponent(cacheKey)}`, {
          credentials: 'include',
        })
        if (!response.ok) return null

        const data = await response.json() as {
          releaseHash: string
          fileHashes: Record<string, string>
        }
        return data
      } catch (err) {
        console.warn('[RemoteBuildFetcher] getMetadata failed:', err)
        return null
      }
    },

    async fetchArchive(cacheKey: string) {
      try {
        const response = await fetch(`${apiBaseUrl}/build-cache/${encodeURIComponent(cacheKey)}/archive`, {
          credentials: 'include',
        })
        if (!response.ok) return null

        const archiveBuffer = await response.arrayBuffer()
        const tarFiles = await extractTarGz(archiveBuffer)

        // Parse manifest
        const manifestFile = tarFiles.find(f => f.path === 'manifest.json')
        if (!manifestFile) {
          console.warn('[RemoteBuildFetcher] Build manifest missing in archive')
          return null
        }

        const manifest: BuildManifest = JSON.parse(new TextDecoder().decode(manifestFile.content))
        const files: BuildCacheFile[] = tarFiles
          .filter(f => f.path !== 'manifest.json')
          .map(f => ({ path: f.path, content: f.content }))

        return { manifest, files }
      } catch (err) {
        console.warn('[RemoteBuildFetcher] fetchArchive failed:', err)
        return null
      }
    },
  }
}
