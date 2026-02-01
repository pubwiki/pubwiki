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
 * Supports root mount (`/`) which serves as the base filesystem. Non-root mounts overlay
 * on top of the root mount at their specified paths. When reading a directory, entries from
 * both the root VFS and overlaid mounts are merged (with mount points taking precedence).
 * 
 * IMPORTANT: This provider stores full Vfs instances (not just VfsProvider) to ensure
 * that events are properly propagated. When operations are performed through MountedVfsProvider,
 * they are delegated to the underlying Vfs instances, which will emit the appropriate events.
 */
export class MountedVfsProvider implements VfsProvider {
  /** Non-root mounts: path -> { vfs, nodeId } */
  private mounts: Map<string, { vfs: Vfs; nodeId?: string }> = new Map()
  /** Root mount (optional): serves as base filesystem */
  private rootVfs: Vfs | null = null
  /** Root mount nodeId (optional) */
  private rootNodeId?: string

  /**
   * Create a new MountedVfsProvider
   * @param mounts Initial mount points as [path, vfs, nodeId?] tuples
   */
  constructor(mounts?: Iterable<[string, Vfs, string?]>) {
    if (mounts) {
      for (const [mountPath, vfs, nodeId] of mounts) {
        this.mount(mountPath, vfs, nodeId)
      }
    }
  }

  /**
   * Mount a Vfs instance at a specific path
   * @param mountPath The path to mount at (e.g., '/', '/src', '/config')
   * @param vfs The Vfs instance to mount
   * @param nodeId Optional node ID for tracking the source of this mount
   */
  mount(mountPath: string, vfs: Vfs, nodeId?: string): void {
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      // Root mount - serves as base filesystem
      this.rootVfs = vfs
      this.rootNodeId = nodeId
    } else {
      // Store with normalized path string as key
      this.mounts.set(vp.toString(), { vfs, nodeId })
    }
  }

  /**
   * Unmount a Vfs instance from a path
   * @param mountPath The path to unmount
   */
  unmount(mountPath: string): void {
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      this.rootVfs = null
      this.rootNodeId = undefined
    } else {
      this.mounts.delete(vp.toString())
    }
  }

  /**
   * Get all mount points (including root if mounted)
   */
  getMountPoints(): string[] {
    const points = Array.from(this.mounts.keys())
    if (this.rootVfs) {
      points.unshift('/')
    }
    return points
  }

  /**
   * Get the Vfs instance mounted at a specific path
   * @param mountPath The mount path to look up
   * @returns The Vfs instance or undefined if not found
   */
  getMountedVfs(mountPath: string): Vfs | undefined {
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      return this.rootVfs ?? undefined
    }
    return this.mounts.get(vp.toString())?.vfs
  }

  /**
   * Get the ID for a mount point
   * @param mountPath The mount path to look up
   * @returns The mount ID or undefined if not found or not set
   */
  getMountedId(mountPath: string): string | undefined {
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      return this.rootNodeId
    }
    return this.mounts.get(vp.toString())?.nodeId
  }

  /**
   * Check if a path is exactly a mountpoint (not root, not a path under a mount)
   * @param filePath The path to check
   * @returns The mount ID if the path is exactly a non-root mountpoint, undefined otherwise
   */
  isMountpoint(filePath: string): string | undefined {
    const vp = VfsPath.parse(filePath)
    if (vp.isRoot) {
      return undefined // Root is not considered a "mountpoint" for this check
    }
    const entry = this.mounts.get(vp.toString())
    return entry?.nodeId
  }

  /**
   * Get the root VFS if mounted
   */
  getRootVfs(): Vfs | null {
    return this.rootVfs
  }

  /**
   * Check if a mount path would conflict with existing paths in the root VFS.
   * Returns the conflicting path if found, null otherwise.
   * @param mountPath The proposed mount path
   */
  async checkMountPathConflict(mountPath: string): Promise<string | null> {
    if (!this.rootVfs) {
      return null
    }
    
    const vp = VfsPath.parse(mountPath)
    if (vp.isRoot) {
      return null // Can't conflict with root
    }
    
    // Check if mount path exactly matches an existing file/folder in root VFS
    try {
      const exists = await this.rootVfs.exists(mountPath)
      if (exists) {
        return mountPath
      }
    } catch {
      // Path doesn't exist, no conflict
    }
    
    return null
  }

  /**
   * Check if a path is a mount point or under a mount point
   * @param filePath The path to check
   * @returns The mount path if the path is within a non-root mount, null otherwise
   */
  isUnderMount(filePath: string): string | null {
    const vp = VfsPath.parse(filePath)
    
    for (const mountPathStr of this.mounts.keys()) {
      const mountPath = VfsPath.parse(mountPathStr)
      if (vp.equals(mountPath) || vp.isUnder(mountPath, true)) {
        return mountPathStr
      }
    }
    
    return null
  }

  /**
   * Resolve a path to its mount point and relative path.
   * Checks non-root mounts first (longest match), then falls back to root VFS.
   * @param filePath The absolute path to resolve
   * @returns [vfs, relativePath, mountPath] or null if not found
   */
  private resolvePath(filePath: string): [Vfs, string, string] | null {
    const vp = VfsPath.parse(filePath)
    
    // Find the longest matching non-root mount point using segments comparison
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
    
    // If we found a non-root mount match, use it
    if (bestMatch && bestMatchPath) {
      const mount = this.mounts.get(bestMatch)!
      // Get relative path within the mount
      const relativePath = vp.relativeTo(bestMatchPath)
      const relativeStr = relativePath ? relativePath.toString() : '/'
      return [mount.vfs, relativeStr, bestMatch]
    }
    
    // Fall back to root VFS if available
    if (this.rootVfs) {
      return [this.rootVfs, filePath, '/']
    }
    
    return null
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
    const entries = new Set<string>()
    
    // Collect mount point entries that are direct children of this path
    for (const mountPathStr of this.mounts.keys()) {
      const mountPath = VfsPath.parse(mountPathStr)
      
      if (vp.isRoot) {
        // At root: get first segment of each mount
        const firstSegment = mountPath.at(0)
        if (firstSegment) {
          entries.add(firstSegment)
        }
      } else if (mountPath.isUnder(vp, true) && mountPath.depth > vp.depth) {
        // Path is a prefix of mount: get the next segment
        const nextSegment = mountPath.at(vp.depth)
        if (nextSegment) {
          entries.add(nextSegment)
        }
      }
    }
    
    // If we have a root VFS, get entries from it too
    if (this.rootVfs) {
      try {
        const rootEntries = await this.rootVfs.getProvider().readdir(dirPath)
        for (const entry of rootEntries) {
          // Mount points take precedence (already added above)
          // Only add if not already present from mounts
          entries.add(entry)
        }
      } catch {
        // Root VFS might not have this path, that's ok
      }
    }
    
    if (entries.size > 0) {
      return Array.from(entries)
    }
    
    // Try to resolve via non-root mounts
    const resolved = this.resolvePath(dirPath)
    if (resolved) {
      const [vfs, relativePath] = resolved
      return vfs.getProvider().readdir(relativePath)
    }
    
    throw new Error(`Path not mounted: ${dirPath}`)
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
    
    // Check if this path is exactly a non-root mount point
    const mountEntry = this.mounts.get(vp.toString())
    if (mountEntry) {
      // This path is a mount point - get stat from the mounted VFS root
      // and add the mountedId
      try {
        const stat = await mountEntry.vfs.stat('/')
        return {
          ...stat,
          mountedId: mountEntry.nodeId
        }
      } catch {
        // If we can't stat the root of the mounted VFS, return a virtual directory
        return {
          isFile: false,
          isDirectory: true,
          size: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          mountedId: mountEntry.nodeId
        }
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
    
    const [vfs, relativePath, mountPath] = resolved
    
    // Get stat from the underlying VFS
    const stat = await vfs.stat(relativePath)
    
    // If this is from a non-root mount and we're at the root of that mount,
    // add the mountedId (this case is handled above, but keeping for safety)
    if (mountPath !== '/' && relativePath === '/') {
      const mount = this.mounts.get(mountPath)
      if (mount?.nodeId) {
        return { ...stat, mountedId: mount.nodeId }
      }
    }
    
    return stat
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
    const fromVp = VfsPath.parse(from)
    const toVp = VfsPath.parse(to)
    
    // 1. Check if 'from' is exactly a mountpoint (not a path under a mount)
    const mountEntry = this.mounts.get(fromVp.toString())
    if (mountEntry) {
      // This is moving a mountpoint itself, not data inside it
      await this.renameMountpoint(fromVp.toString(), toVp.toString(), mountEntry)
      return
    }
    
    // 2. Not a mountpoint, proceed with normal rename logic
    const fromResolved = this.resolvePath(from)
    const toResolved = this.resolvePath(to)
    
    if (!fromResolved || !toResolved) {
      throw new Error(`Path not mounted: ${!fromResolved ? from : to}`)
    }
    
    const [fromVfs, fromRelative] = fromResolved
    const [toVfs, toRelative] = toResolved
    
    if (fromVfs !== toVfs) {
      // Cross-mount rename: need to check if file or directory
      const stat = await fromVfs.stat(fromRelative)
      
      if (stat.isDirectory) {
        // Directory: recursively copy then delete
        await this.copyDirectoryCrossMount(fromVfs, fromRelative, toVfs, toRelative)
        await fromVfs.deleteFolder(fromRelative, true)
      } else {
        // File: copy then delete
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
      }
    } else {
      // Same mount - use moveItem for proper event handling
      await fromVfs.moveItem(fromRelative, toRelative)
    }
  }
  
  /**
   * Rename/move a mountpoint to a new path.
   * This only updates the mount mapping, not the underlying data.
   * @param fromPath The current mount path
   * @param toPath The new mount path
   * @param mountEntry The mount entry to move
   */
  private async renameMountpoint(
    fromPath: string,
    toPath: string,
    mountEntry: { vfs: Vfs; nodeId?: string }
  ): Promise<void> {
    // Check if target path already exists (in any mount or root VFS)
    const targetExists = await this.exists(toPath)
    if (targetExists) {
      throw new Error(`Target path already exists: ${toPath}`)
    }
    
    // Check if target would conflict with existing mount points
    const toVp = VfsPath.parse(toPath)
    for (const existingMountPath of this.mounts.keys()) {
      const existingVp = VfsPath.parse(existingMountPath)
      // New mount cannot be under an existing mount (except root)
      if (toVp.isUnder(existingVp, true)) {
        throw new Error(`Cannot move mountpoint under existing mount: ${existingMountPath}`)
      }
      // Existing mount cannot be under new mount path
      if (existingVp.isUnder(toVp, true)) {
        throw new Error(`Existing mount ${existingMountPath} would be under new path`)
      }
    }
    
    // Also update any nested mountpoints that are under this mountpoint
    const fromVp = VfsPath.parse(fromPath)
    const nestedMounts: Array<[string, { vfs: Vfs; nodeId?: string }]> = []
    
    for (const [mountPathStr, entry] of this.mounts.entries()) {
      const mountVp = VfsPath.parse(mountPathStr)
      if (mountVp.isUnder(fromVp, true)) {
        // This mount is nested under the one being moved
        const relative = mountVp.relativeTo(fromVp)
        if (relative) {
          nestedMounts.push([mountPathStr, entry])
          // Will update after removing the main one
        }
      }
    }
    
    // Remove old mount entry
    this.mounts.delete(fromPath)
    
    // Add at new path
    this.mounts.set(toPath, mountEntry)
    
    // Update nested mounts
    for (const [oldNestedPath, nestedEntry] of nestedMounts) {
      const oldNestedVp = VfsPath.parse(oldNestedPath)
      const relative = oldNestedVp.relativeTo(fromVp)
      if (relative) {
        const newNestedPath = toVp.join(relative).toString()
        this.mounts.delete(oldNestedPath)
        this.mounts.set(newNestedPath, nestedEntry)
      }
    }
    
    // Note: The caller (NodeVfs/studio) is responsible for:
    // 1. Updating persistent mount configuration in node store
    // 2. Updating git submodule paths
    // This provider only manages the in-memory mount mapping
  }

  /**
   * Recursively copy a directory from one VFS to another
   */
  private async copyDirectoryCrossMount(
    fromVfs: Vfs,
    fromPath: string,
    toVfs: Vfs,
    toPath: string
  ): Promise<void> {
    // Create destination directory
    await toVfs.createFolder(toPath)
    
    // List and copy all items
    const items = await fromVfs.listFolder(fromPath)
    const fromVp = VfsPath.parse(fromPath)
    const toVp = VfsPath.parse(toPath)
    
    for (const item of items) {
      const itemVp = VfsPath.parse(item.path)
      const relative = itemVp.relativeTo(fromVp)
      if (!relative) continue
      
      const destPath = toVp.join(relative).toString()
      
      if ('folderPath' in item) {
        // It's a file (VfsFile has folderPath)
        const file = await fromVfs.readFile(item.path)
        if (file.content !== undefined) {
          await toVfs.createFile(destPath, file.content)
        }
      } else {
        // It's a folder - recurse
        await this.copyDirectoryCrossMount(fromVfs, item.path, toVfs, destPath)
      }
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
    for (const mount of this.mounts.values()) {
      await mount.vfs.initialize()
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
export function createMountedVfs(mounts?: Iterable<[string, Vfs, string?]>): Vfs<MountedVfsProvider> {
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
