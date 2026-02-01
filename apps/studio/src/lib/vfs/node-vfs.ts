/**
 * NodeVfs - Unified VFS interface for VFS nodes in Studio
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

import type { VfsCommit, VfsDiff, VersionedVfs, VfsFile, VfsFolder } from '@pubwiki/vfs';
import { Vfs, MountedVfsProvider, normalizePath } from '@pubwiki/vfs';

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
  private readonly _baseVfs: VersionedVfs;
  
  /** Event unsubscribers for each mounted VFS (keyed by mount path) */
  private readonly _mountEventUnsubscribers: Map<string, Array<() => void>> = new Map();
  
  constructor(baseVfs: VersionedVfs) {
    // Create MountedVfsProvider with baseVfs as root mount
    const provider = new MountedVfsProvider([['/', baseVfs]]);
    super(provider);
    this._baseVfs = baseVfs;
    
    // Forward version control events from base VFS
    this.setupEventForwarding();
  }
  
  /**
   * Forward version-related events from base VFS to this NodeVfs
   */
  private setupEventForwarding(): void {
    // Forward version events from base VFS
    this._baseVfs.events.on('version:commit', (e) => {
      this.events.emit(e);
    });
    this._baseVfs.events.on('version:checkout', (e) => {
      this.events.emit(e);
    });
    this._baseVfs.events.on('version:revert', (e) => {
      this.events.emit(e);
    });
  }
  
  // ========== Mount Management ==========
  
  /**
   * Mount a child VFS at a path
   * @param mountPath The path to mount at (e.g., '/subdir')
   * @param childVfs The VFS to mount (should be a NodeVfs for proper nested mount support)
   * @param mountedId Optional ID for tracking the source of this mount (used for UI display)
   */
  mount(mountPath: string, childVfs: Vfs, mountedId?: string): void {
    const normalizedMountPath = normalizePath(mountPath);
    
    this._provider.mount(normalizedMountPath, childVfs, mountedId);
    
    // Setup event forwarding from child VFS to this NodeVfs
    this.setupMountEventForwarding(normalizedMountPath, childVfs);
    
    // Emit mount:added event
    this.events.emit({
      type: 'mount:added',
      path: normalizedMountPath,
      mountedId,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Unmount a VFS from a path
   * @param mountPath The path to unmount
   */
  unmount(mountPath: string): void {
    const normalizedMountPath = normalizePath(mountPath);
    
    // Get the mounted ID before unmounting (for the event)
    const mountedId = this._provider.getMountedId(normalizedMountPath);
    
    // Clean up event listeners before unmounting
    this.cleanupMountEventForwarding(normalizedMountPath);
    
    this._provider.unmount(normalizedMountPath);
    
    // Emit mount:removed event
    this.events.emit({
      type: 'mount:removed',
      path: normalizedMountPath,
      mountedId,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Setup event forwarding from a mounted child VFS.
   * All events from the child VFS are re-emitted with paths prefixed by the mount path.
   */
  private setupMountEventForwarding(mountPath: string, childVfs: Vfs): void {
    const unsubscribers: Array<() => void> = [];
    
    // Helper to prefix path with mount path
    const prefixPath = (path: string): string => {
      if (path === '/') return mountPath;
      return mountPath + path;
    };
    
    // Helper to create a new file object with prefixed path
    const prefixFile = (file: VfsFile): VfsFile => ({
      ...file,
      path: prefixPath(file.path)
    });
    
    // Helper to create a new folder object with prefixed path
    const prefixFolder = (folder: VfsFolder): VfsFolder => ({
      ...folder,
      path: prefixPath(folder.path)
    });
    
    // Forward file events
    unsubscribers.push(
      childVfs.events.on('file:created', (e) => {
        this.events.emit({
          ...e,
          path: prefixPath(e.path),
          file: prefixFile(e.file)
        });
      }),
      childVfs.events.on('file:updated', (e) => {
        this.events.emit({
          ...e,
          path: prefixPath(e.path),
          file: prefixFile(e.file)
        });
      }),
      childVfs.events.on('file:deleted', (e) => {
        this.events.emit({
          ...e,
          path: prefixPath(e.path)
        });
      }),
      childVfs.events.on('file:moved', (e) => {
        this.events.emit({
          ...e,
          fromPath: prefixPath(e.fromPath),
          toPath: prefixPath(e.toPath),
          file: prefixFile(e.file)
        });
      })
    );
    
    // Forward folder events
    unsubscribers.push(
      childVfs.events.on('folder:created', (e) => {
        this.events.emit({
          ...e,
          path: prefixPath(e.path),
          folder: prefixFolder(e.folder)
        });
      }),
      childVfs.events.on('folder:updated', (e) => {
        this.events.emit({
          ...e,
          path: prefixPath(e.path)
        });
      }),
      childVfs.events.on('folder:deleted', (e) => {
        this.events.emit({
          ...e,
          path: prefixPath(e.path)
        });
      }),
      childVfs.events.on('folder:moved', (e) => {
        this.events.emit({
          ...e,
          fromPath: prefixPath(e.fromPath),
          toPath: prefixPath(e.toPath)
        });
      }),
      childVfs.events.on('mount:added', (e) => {
        // Forward mount:added event with prefixed path
        this.events.emit({
          ...e,
          path: prefixPath(e.path)
        });
      }),
      childVfs.events.on('mount:moved', (e) => {
        // Forward mount:moved event with prefixed paths
        this.events.emit({
          ...e,
          fromPath: prefixPath(e.fromPath),
          toPath: prefixPath(e.toPath)
        });
      }),
      childVfs.events.on('mount:removed', (e) => {
        // Forward mount:removed event with prefixed path
        this.events.emit({
          ...e,
          path: prefixPath(e.path)
        });
      })
    );
    
    // Note: We don't forward version events (commit, checkout, revert) from child VFS
    // because version control is scoped to each VFS node independently
    
    this._mountEventUnsubscribers.set(mountPath, unsubscribers);
  }
  
  /**
   * Clean up event forwarding for a mounted VFS
   */
  private cleanupMountEventForwarding(mountPath: string): void {
    const unsubscribers = this._mountEventUnsubscribers.get(mountPath);
    if (unsubscribers) {
      for (const unsub of unsubscribers) {
        unsub();
      }
      this._mountEventUnsubscribers.delete(mountPath);
    }
  }
  
  /**
   * Get all mount points
   */
  getMountPoints(): string[] {
    return this._provider.getMountPoints();
  }
  
  /**
   * Check if a path is a mount point
   */
  isUnderMount(filePath: string): string | null {
    return this._provider.isUnderMount(filePath);
  }
  
  /**
   * Get the VFS mounted at a specific path
   */
  getMountedVfs(mountPath: string): Vfs | undefined {
    return this._provider.getMountedVfs(mountPath);
  }
  
  /**
   * Get the mount ID for a mount point
   */
  getMountedId(mountPath: string): string | undefined {
    return this._provider.getMountedId(mountPath);
  }
  
  /**
   * Check if a path is exactly a mountpoint (not root, not a path under a mount)
   */
  isMountpoint(filePath: string): string | undefined {
    return this._provider.isMountpoint(filePath);
  }
  
  // ========== File Operations Override ==========
  
  /**
   * Move a file or folder, with special handling for mountpoint moves.
   * When moving a mountpoint, only the mount mapping is updated, not the underlying data.
   * This emits a 'mount:moved' event instead of the normal move events.
   */
  async moveItem(fromPath: string, toPath: string): Promise<void> {
    const normalizedFrom = normalizePath(fromPath);
    const normalizedTo = normalizePath(toPath);
    
    // Check if this is a mountpoint move
    const mountedId = this._provider.isMountpoint(normalizedFrom);
    
    if (mountedId !== undefined) {
      // Get the child VFS before the move (we need it to re-setup event forwarding)
      const childVfs = this._provider.getMountedVfs(normalizedFrom);
      
      // This is moving a mountpoint - delegate to provider which only updates mapping
      await this._provider.rename(normalizedFrom, normalizedTo);
      
      // Update event forwarding: the old listeners use the old mountPath in closures,
      // so we need to remove them and re-setup with the new path
      if (childVfs) {
        this.cleanupMountEventForwarding(normalizedFrom);
        this.setupMountEventForwarding(normalizedTo, childVfs);
      }
      
      // Emit mount:moved event (instead of folder:moved)
      this.events.emit({
        type: 'mount:moved',
        fromPath: normalizedFrom,
        toPath: normalizedTo,
        mountedId,
        timestamp: Date.now(),
      });
      return;
    }
    
    // Not a mountpoint, use normal move logic
    await super.moveItem(fromPath, toPath);
  }
  
  // ========== Version Control Operations (proxied to baseVfs) ==========
  
  /**
   * Commit changes
   */
  async commit(
    message: string,
    options?: { author?: string; email?: string }
  ): Promise<VfsCommit> {
    return this._baseVfs.commit(message, options);
  }
  
  /**
   * Get commit history
   */
  async getHistory(options?: {
    path?: string;
    depth?: number;
    ref?: string;
  }): Promise<VfsCommit[]> {
    return this._baseVfs.getHistory(options);
  }
  
  /**
   * Alias for getHistory
   */
  async history(depth?: number): Promise<VfsCommit[]> {
    return this._baseVfs.history(depth);
  }
  
  /**
   * Checkout to a specific version
   */
  async checkout(ref: string): Promise<void> {
    return this._baseVfs.checkout(ref);
  }
  
  /**
   * Compare two versions
   */
  async diff(commitA: string, commitB: string): Promise<VfsDiff[]> {
    return this._baseVfs.diff(commitA, commitB);
  }
  
  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    return this._baseVfs.getCurrentBranch();
  }
  
  /**
   * Get HEAD commit
   */
  async getHead(): Promise<VfsCommit> {
    return this._baseVfs.getHead();
  }
  
  /**
   * Get workspace status (changed files)
   */
  async getStatus(): Promise<
    Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted' | 'untracked';
      staged: boolean;
    }>
  > {
    return this._baseVfs.getStatus();
  }
  
  /**
   * Hard reset to a specific commit
   */
  async revert(ref: string): Promise<void> {
    return this._baseVfs.revert(ref);
  }
  
  /**
   * Create a new branch
   */
  async createBranch(name: string, ref?: string): Promise<void> {
    return this._baseVfs.createBranch(name, ref);
  }
  
  /**
   * Delete a branch
   */
  async deleteBranch(name: string): Promise<void> {
    return this._baseVfs.deleteBranch(name);
  }
  
  /**
   * List all branches
   */
  async listBranches(): Promise<string[]> {
    return this._baseVfs.listBranches();
  }
  
  // ========== Lifecycle ==========
  
  /**
   * Dispose the NodeVfs and its resources
   */
  async dispose(): Promise<void> {
    // Clean up all mount event listeners
    for (const mountPath of this._mountEventUnsubscribers.keys()) {
      this.cleanupMountEventForwarding(mountPath);
    }
    
    // Note: We don't dispose _baseVfs here since it may be shared
    // The caller (VfsFactory) is responsible for managing baseVfs lifecycle
    await super.dispose();
  }
}

/**
 * Create a NodeVfs from a VersionedVfs
 */
export function createNodeVfs(baseVfs: VersionedVfs): NodeVfs {
  return new NodeVfs(baseVfs);
}
