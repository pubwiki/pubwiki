import type { VfsProvider } from './vfs-provider'
import type { VfsStat } from '../types'
import { VfsPath } from '../utils/vfs-path'
import { Vfs } from '../vfs'

/**
 * MountedVfsProvider - A VFS provider that mounts multiple Vfs instances at different paths
 * 
 * This allows creating a unified virtual file system from multiple sources.
 * Example: Mount VFS1 at /src and VFS2 at /config to access files as /src/app.ts or /config/settings.json
 * 
 * IMPORTANT: This provider stores full Vfs instances (not just VfsProvider) to ensure
 * that events are properly propagated. When operations are performed through MountedVfsProvider,
 * they are delegated to the underlying Vfs instances, which will emit the appropriate events.
 */
export class MountedVfsProvider implements VfsProvider {
  private mounts: Map<string, Vfs> = new Map()

  /**
   * Create a new MountedVfsProvider
   * @param mounts Initial mount points as [path, vfs] pairs
   */
  constructor(mounts?: Iterable<[string, Vfs]>) {
    if (mounts) {
      for (const [mountPath, vfs] of mounts) {
        this.mount(mountPath, vfs)
      }
    }
  }

  /**
   * Mount a Vfs instance at a specific path
   * @param mountPath The path to mount at (e.g., '/src', '/config')
   * @param vfs The Vfs instance to mount
   */
  mount(mountPath: string, vfs: Vfs): void {
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      throw new Error(`Cannot mount at root path`)
    }
    // Store with normalized path string as key
    this.mounts.set(vp.toString(), vfs)
  }

  /**
   * Unmount a Vfs instance from a path
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
   * Get the Vfs instance mounted at a specific path
   * @param mountPath The mount path to look up
   * @returns The Vfs instance or undefined if not found
   */
  getMountedVfs(mountPath: string): Vfs | undefined {
    const vp = VfsPath.parse(mountPath)
    return this.mounts.get(vp.toString())
  }

  /**
   * Resolve a path to its mount point and relative path
   * @param filePath The absolute path to resolve
   * @returns [vfs, relativePath, mountPath] or null if not found
   */
  private resolvePath(filePath: string): [Vfs, string, string] | null {
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
    
    const vfs = this.mounts.get(bestMatch)!
    // Get relative path within the mount
    const relativePath = vp.relativeTo(bestMatchPath)
    const relativeStr = relativePath ? relativePath.toString() : '/'
    
    return [vfs, relativeStr, bestMatch]
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
    const [vfs, relativePath, mountPath] = resolved
    const subId = await vfs.getProvider().id(relativePath)
    return `${mountPath}:${subId}`
  }

  // ========== 文件操作 ==========

  async readFile(filePath: string): Promise<Uint8Array> {
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [vfs, relativePath] = resolved
    const file = await vfs.readFile(relativePath)
    // readFile returns VfsFile, extract content
    if (file.content === undefined) {
      throw new Error(`File has no content: ${filePath}`)
    }
    if (typeof file.content === 'string') {
      return new TextEncoder().encode(file.content)
    }
    return new Uint8Array(file.content)
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [vfs, relativePath] = resolved
    
    // Convert Uint8Array to ArrayBuffer for Vfs methods
    // Create a new ArrayBuffer to avoid SharedArrayBuffer type issues
    const buffer = new ArrayBuffer(content.byteLength)
    new Uint8Array(buffer).set(content)
    
    // Check if file exists to decide create vs update
    const exists = await vfs.exists(relativePath)
    if (exists) {
      await vfs.updateFile(relativePath, buffer)
    } else {
      await vfs.createFile(relativePath, buffer)
    }
  }

  async unlink(filePath: string): Promise<void> {
    const resolved = this.resolvePath(filePath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${filePath}`)
    }
    const [vfs, relativePath] = resolved
    await vfs.deleteFile(relativePath)
  }

  // ========== 目录操作 ==========

  async mkdir(dirPath: string): Promise<void> {
    const resolved = this.resolvePath(dirPath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${dirPath}`)
    }
    const [vfs, relativePath] = resolved
    // Vfs.createFolder handles recursive creation internally
    await vfs.createFolder(relativePath)
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
    
    const [vfs, relativePath] = resolved
    // Use provider directly for readdir since Vfs.listFolder returns objects
    return vfs.getProvider().readdir(relativePath)
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolvePath(dirPath)
    if (!resolved) {
      throw new Error(`Path not mounted: ${dirPath}`)
    }
    const [vfs, relativePath] = resolved
    await vfs.deleteFolder(relativePath, options?.recursive)
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
    
    const [vfs, relativePath] = resolved
    return vfs.stat(relativePath)
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
    
    const [fromVfs, fromRelative] = fromResolved
    const [toVfs, toRelative] = toResolved
    
    if (fromVfs !== toVfs) {
      // Cross-mount rename: copy then delete
      // Read from source
      const file = await fromVfs.readFile(fromRelative)
      if (file.content === undefined) {
        throw new Error(`File has no content: ${from}`)
      }
      
      // Write to destination (will emit create event)
      const destExists = await toVfs.exists(toRelative)
      if (destExists) {
        await toVfs.updateFile(toRelative, file.content)
      } else {
        await toVfs.createFile(toRelative, file.content)
      }
      
      // Delete from source (will emit delete event)
      await fromVfs.deleteFile(fromRelative)
    } else {
      // Same mount - use moveItem for proper event handling
      await fromVfs.moveItem(fromRelative, toRelative)
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    const fromResolved = this.resolvePath(from)
    const toResolved = this.resolvePath(to)
    
    if (!fromResolved || !toResolved) {
      throw new Error(`Path not mounted: ${!fromResolved ? from : to}`)
    }
    
    const [fromVfs, fromRelative] = fromResolved
    const [toVfs, toRelative] = toResolved
    
    if (fromVfs !== toVfs) {
      // Cross-mount copy
      const file = await fromVfs.readFile(fromRelative)
      if (file.content === undefined) {
        throw new Error(`File has no content: ${from}`)
      }
      
      // Write to destination (will emit create event)
      const destExists = await toVfs.exists(toRelative)
      if (destExists) {
        await toVfs.updateFile(toRelative, file.content)
      } else {
        await toVfs.createFile(toRelative, file.content)
      }
    } else {
      // Same mount - use copyItem for proper event handling
      await fromVfs.copyItem(fromRelative, toRelative)
    }
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    for (const vfs of this.mounts.values()) {
      await vfs.initialize()
    }
  }

  async dispose(): Promise<void> {
    // Note: We don't dispose the mounted Vfs instances since they may be used elsewhere
    // The caller is responsible for disposing them if needed
    this.mounts.clear()
  }
}

/**
 * Factory function to create a Vfs instance with MountedVfsProvider
 * This allows using multiple VFS sources as a single unified VFS
 */
export function createMountedVfs(mounts?: Iterable<[string, Vfs]>): Vfs<MountedVfsProvider> {
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
