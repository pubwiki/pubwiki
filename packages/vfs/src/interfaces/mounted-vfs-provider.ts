import type { VfsProvider } from './vfs-provider'
import type { VfsStat } from '../types'
import { VfsPath } from '../utils/vfs-path'
import { Vfs } from '../vfs'

/**
 * MountedVfsProvider - A VFS provider that mounts multiple VFS providers at different paths
 * 
 * This allows creating a unified virtual file system from multiple sources.
 * Example: Mount VFS1 at /src and VFS2 at /config to access files as /src/app.ts or /config/settings.json
 */
export class MountedVfsProvider implements VfsProvider {
  private mounts: Map<string, VfsProvider> = new Map()

  /**
   * Create a new MountedVfsProvider
   * @param mounts Initial mount points as [path, provider] pairs
   */
  constructor(mounts?: Iterable<[string, VfsProvider]>) {
    if (mounts) {
      for (const [mountPath, provider] of mounts) {
        this.mount(mountPath, provider)
      }
    }
  }

  /**
   * Mount a VFS provider at a specific path
   * @param mountPath The path to mount at (e.g., '/src', '/config')
   * @param provider The VFS provider to mount
   */
  mount(mountPath: string, provider: VfsProvider): void {
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      throw new Error(`Cannot mount at root path`)
    }
    // Store with normalized path string as key
    this.mounts.set(vp.toString(), provider)
  }

  /**
   * Mount a Vfs instance at a specific path by extracting its underlying provider
   * @param mountPath The path to mount at (e.g., '/src', '/config')  
   * @param vfs The Vfs instance to mount
   */
  mountVfs(mountPath: string, vfs: Vfs): void {
    this.mount(mountPath, vfs.getProvider())
  }

  /**
   * Unmount a VFS provider from a path
   * @param mountPath The path to unmount
   */
  unmount(mountPath: string): void {
    const vp = VfsPath.parse(mountPath)
    this.mounts.delete(vp.toString())
  }

  /**
   * Get all mount points
   */
  getMountPoints(): string[] {
    return Array.from(this.mounts.keys())
  }

  /**
   * Resolve a path to its mount point and relative path
   * @param filePath The absolute path to resolve
   * @returns [provider, relativePath] or null if not found
   */
  private resolvePath(filePath: string): [VfsProvider, string] | null {
    const vp = VfsPath.parse(filePath)
    
    // Find the longest matching mount point using segments comparison
    let bestMatch: string | null = null
    let bestMatchPath: VfsPath | null = null
    let bestLength = 0
    
    for (const mountPathStr of this.mounts.keys()) {
      const mountPath = VfsPath.parse(mountPathStr)
      
      // Check if vp equals or is under mountPath
      if (vp.equals(mountPath) || vp.isUnder(mountPath, true)) {
        if (mountPath.depth > bestLength) {
          bestMatch = mountPathStr
          bestMatchPath = mountPath
          bestLength = mountPath.depth
        }
      }
    }
    
    if (!bestMatch || !bestMatchPath) {
      return null
    }
    
    const provider = this.mounts.get(bestMatch)!
    // Get relative path within the mount
    const relativePath = vp.relativeTo(bestMatchPath)
    const relativeStr = relativePath ? relativePath.toString() : '/'
    
    return [provider, relativeStr]
  }

  // ========== ID 生成 ==========

  async id(filePath: string): Promise<string> {
    if (filePath === '/') {
      return "/"
    }
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [provider, relativePath] = resolved
    // Prefix with mount path to ensure uniqueness across mounts
    const mountPath = Array.from(this.mounts.entries())
      .find(([_, p]) => p === provider)?.[0] ?? ''
    const subId = await provider.id(relativePath)
    return `${mountPath}:${subId}`
  }

  // ========== 文件操作 ==========

  async readFile(filePath: string): Promise<Uint8Array> {
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [provider, relativePath] = resolved
    return provider.readFile(relativePath)
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [provider, relativePath] = resolved
    return provider.writeFile(relativePath, content)
  }

  async unlink(filePath: string): Promise<void> {
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [provider, relativePath] = resolved
    return provider.unlink(relativePath)
  }

  // ========== 目录操作 ==========

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolvePath(dirPath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${dirPath}`)
    }
    const [provider, relativePath] = resolved
    return provider.mkdir(relativePath, options)
  }

  async readdir(dirPath: string): Promise<string[]> {
    const vp = VfsPath.parse(dirPath)
    
    // Check if we're at root level - need to show mount points
    if (vp.isRoot) {
      // Return top-level mount point names
      const topLevel = new Set<string>()
      for (const mountPathStr of this.mounts.keys()) {
        const mountPath = VfsPath.parse(mountPathStr)
        // Get first segment
        const firstSegment = mountPath.at(0)
        if (firstSegment) {
          topLevel.add(firstSegment)
        }
      }
      return Array.from(topLevel)
    }
    
    const resolved = this.resolvePath(dirPath)
    if (!resolved) {
      // Check if this path is a prefix of any mount point (virtual directory)
      const virtualEntries = new Set<string>()
      for (const mountPathStr of this.mounts.keys()) {
        const mountPath = VfsPath.parse(mountPathStr)
        // Check if mountPath is under vp (vp is a prefix of mountPath)
        if (mountPath.isUnder(vp, true)) {
          // Get the next segment after vp
          const nextSegment = mountPath.at(vp.depth)
          if (nextSegment) {
            virtualEntries.add(nextSegment)
          }
        }
      }
      if (virtualEntries.size > 0) {
        return Array.from(virtualEntries)
      }
      throw new Error(`Path not mounted: ${dirPath}`)
    }
    
    const [provider, relativePath] = resolved
    return provider.readdir(relativePath)
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolvePath(dirPath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${dirPath}`)
    }
    const [provider, relativePath] = resolved
    return provider.rmdir(relativePath, options)
  }

  // ========== 状态查询 ==========

  async stat(filePath: string): Promise<VfsStat> {
    const vp = VfsPath.parse(filePath)
    
    // Root is always a virtual directory
    if (vp.isRoot) {
      return {
        isFile: false,
        isDirectory: true,
        size: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }
    
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      // Check if it's a virtual directory (prefix of any mount point)
      for (const mountPathStr of this.mounts.keys()) {
        const mountPath = VfsPath.parse(mountPathStr)
        // If mountPath is under vp, then vp is a virtual directory
        if (mountPath.isUnder(vp, true)) {
          return {
            isFile: false,
            isDirectory: true,
            size: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }
      }
      throw new Error(`Path not mounted: ${filePath}`)
    }
    
    const [provider, relativePath] = resolved
    return provider.stat(relativePath)
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.stat(filePath)
      return true
    } catch {
      return false
    }
  }

  // ========== 移动/复制 ==========

  async rename(from: string, to: string): Promise<void> {
    const fromResolved = this.resolvePath(from)
    const toResolved = this.resolvePath(to)
    
    if (!fromResolved || !toResolved) {
      throw new Error(`Path not mounted: ${!fromResolved ? from : to}`)
    }
    
    const [fromProvider, fromRelative] = fromResolved
    const [toProvider, toRelative] = toResolved
    
    if (fromProvider !== toProvider) {
      // Cross-mount rename: copy then delete
      const content = await fromProvider.readFile(fromRelative)
      await toProvider.writeFile(toRelative, content)
      await fromProvider.unlink(fromRelative)
    } else {
      await fromProvider.rename(fromRelative, toRelative)
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    const fromResolved = this.resolvePath(from)
    const toResolved = this.resolvePath(to)
    
    if (!fromResolved || !toResolved) {
      throw new Error(`Path not mounted: ${!fromResolved ? from : to}`)
    }
    
    const [fromProvider, fromRelative] = fromResolved
    const [toProvider, toRelative] = toResolved
    
    if (fromProvider !== toProvider) {
      // Cross-mount copy
      const content = await fromProvider.readFile(fromRelative)
      await toProvider.writeFile(toRelative, content)
    } else {
      await fromProvider.copyFile(fromRelative, toRelative)
    }
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    for (const provider of this.mounts.values()) {
      if (provider.initialize) {
        await provider.initialize()
      }
    }
  }

  async dispose(): Promise<void> {
    for (const provider of this.mounts.values()) {
      if (provider.dispose) {
        await provider.dispose()
      }
    }
    this.mounts.clear()
  }
}

/**
 * Factory function to create a Vfs instance with MountedVfsProvider
 * This allows using multiple VFS sources as a single unified VFS
 */
export function createMountedVfs(mounts?: Iterable<[string, VfsProvider]>): Vfs<MountedVfsProvider> {
  const provider = new MountedVfsProvider(mounts)
  return new Vfs(provider)
}

/**
 * Get the underlying MountedVfsProvider from a Vfs instance
 * Returns null if the Vfs doesn't use MountedVfsProvider
 */
export function getMountedProvider(vfs: Vfs): MountedVfsProvider | null {
  // Access the protected provider property
  const provider = vfs.getProvider()
  if (provider instanceof MountedVfsProvider) {
    return provider
  }
  return null
}
