/**
 * NodeVfs - Unified VFS interface for VFS nodes
 * 
 * This class wraps a VersionedVfs (for version control) with MountedVfsProvider
 * (for file operations including mounts). It provides a single unified interface
 * that includes both file operations and version control methods.
 * 
 * Design principles:
 * 1. All file operations go through MountedVfsProvider (supports mounts)
 * 2. Version control operations are proxied to the base VersionedVfs
 * 3. When mounting child VFS, use their NodeVfs (not raw VersionedVfs) to support nested mounts
 */

import type { VfsCommit, VfsDiff } from './types'
import type { VersionedVfs } from './vfs'
import { Vfs } from './vfs'
import { MountedVfsProvider } from './interfaces/mounted-vfs-provider'

/**
 * NodeVfs - The unified VFS interface for VFS nodes
 * 
 * Provides:
 * - File operations (inherited from Vfs) - routed through MountedVfsProvider
 * - Version control operations - proxied to base VersionedVfs
 * - Mount management - via MountedVfsProvider
 */
export class NodeVfs extends Vfs<MountedVfsProvider> {
  /** The underlying VersionedVfs for version control operations */
  private readonly _baseVfs: VersionedVfs
  
  constructor(baseVfs: VersionedVfs) {
    // Create MountedVfsProvider with baseVfs as root mount
    const provider = new MountedVfsProvider([['/', baseVfs]])
    super(provider)
    this._baseVfs = baseVfs
    
    // Forward version control events from base VFS
    this.setupEventForwarding()
  }
  
  /**
   * Forward version-related events from base VFS to this NodeVfs
   */
  private setupEventForwarding(): void {
    // Forward version events from base VFS
    this._baseVfs.events.on('version:commit', (e) => {
      this.events.emit(e)
    })
    this._baseVfs.events.on('version:checkout', (e) => {
      this.events.emit(e)
    })
    this._baseVfs.events.on('version:revert', (e) => {
      this.events.emit(e)
    })
  }
  
  // ========== Mount Management ==========
  
  /**
   * Mount a child VFS at a path
   * @param mountPath The path to mount at (e.g., '/subdir')
   * @param childVfs The VFS to mount (should be a NodeVfs for proper nested mount support)
   * @param nodeId Optional node ID for tracking the source of this mount (used for UI display)
   */
  mount(mountPath: string, childVfs: Vfs, nodeId?: string): void {
    this._provider.mount(mountPath, childVfs, nodeId)
  }
  
  /**
   * Unmount a VFS from a path
   * @param mountPath The path to unmount
   */
  unmount(mountPath: string): void {
    this._provider.unmount(mountPath)
  }
  
  /**
   * Get all mount points
   */
  getMountPoints(): string[] {
    return this._provider.getMountPoints()
  }
  
  /**
   * Check if a path is a mount point
   */
  isUnderMount(filePath: string): string | null {
    return this._provider.isUnderMount(filePath)
  }
  
  /**
   * Get the VFS mounted at a specific path
   */
  getMountedVfs(mountPath: string): Vfs | undefined {
    return this._provider.getMountedVfs(mountPath)
  }
  
  /**
   * Get the node ID for a mount point
   */
  getMountedNodeId(mountPath: string): string | undefined {
    return this._provider.getMountedId(mountPath)
  }
  
  // ========== Version Control Operations (proxied to baseVfs) ==========
  
  /**
   * Commit changes
   */
  async commit(
    message: string,
    options?: { author?: string; email?: string }
  ): Promise<VfsCommit> {
    return this._baseVfs.commit(message, options)
  }
  
  /**
   * Get commit history
   */
  async getHistory(options?: {
    path?: string
    depth?: number
    ref?: string
  }): Promise<VfsCommit[]> {
    return this._baseVfs.getHistory(options)
  }
  
  /**
   * Alias for getHistory
   */
  async history(depth?: number): Promise<VfsCommit[]> {
    return this._baseVfs.history(depth)
  }
  
  /**
   * Checkout to a specific version
   */
  async checkout(ref: string): Promise<void> {
    return this._baseVfs.checkout(ref)
  }
  
  /**
   * Compare two versions
   */
  async diff(commitA: string, commitB: string): Promise<VfsDiff[]> {
    return this._baseVfs.diff(commitA, commitB)
  }
  
  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    return this._baseVfs.getCurrentBranch()
  }
  
  /**
   * Get HEAD commit
   */
  async getHead(): Promise<VfsCommit> {
    return this._baseVfs.getHead()
  }
  
  /**
   * Get workspace status (changed files)
   */
  async getStatus(): Promise<
    Array<{
      path: string
      status: 'added' | 'modified' | 'deleted' | 'untracked'
      staged: boolean
    }>
  > {
    return this._baseVfs.getStatus()
  }
  
  /**
   * Hard reset to a specific commit
   */
  async revert(ref: string): Promise<void> {
    return this._baseVfs.revert(ref)
  }
  
  /**
   * Create a new branch
   */
  async createBranch(name: string, ref?: string): Promise<void> {
    return this._baseVfs.createBranch(name, ref)
  }
  
  /**
   * Delete a branch
   */
  async deleteBranch(name: string): Promise<void> {
    return this._baseVfs.deleteBranch(name)
  }
  
  /**
   * List all branches
   */
  async listBranches(): Promise<string[]> {
    return this._baseVfs.listBranches()
  }
  
  // ========== Lifecycle ==========
  
  /**
   * Dispose the NodeVfs and its resources
   */
  async dispose(): Promise<void> {
    // Note: We don't dispose _baseVfs here since it may be shared
    // The caller (VfsFactory) is responsible for managing baseVfs lifecycle
    await super.dispose()
  }
}

/**
 * Create a NodeVfs from a VersionedVfs
 */
export function createNodeVfs(baseVfs: VersionedVfs): NodeVfs {
  return new NodeVfs(baseVfs)
}
