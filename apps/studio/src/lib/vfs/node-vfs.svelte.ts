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
 * 4. Git submodule operations are encapsulated within this class
 * 5. Reactive dirty state tracking via Svelte 5 runes
 */

import * as git from 'isomorphic-git';
import type { VfsCommit, VfsDiff, VersionedVfs, VfsFile, VfsFolder, VersionedVfsProvider } from '@pubwiki/vfs';
import { Vfs, MountedVfsProvider, normalizePath } from '@pubwiki/vfs';
import type { GitCompatibleFs } from './opfs-provider';

/**
 * Interface for providers that support low-level git operations
 */
export interface GitCapableProvider extends VersionedVfsProvider {
  getFs(): GitCompatibleFs;
  getDir(): string;
  getNodeId(): string;
}

/**
 * Submodule information parsed from .gitmodules
 */
export interface SubmoduleInfo {
  /** Mount path in the target VFS */
  path: string;
  /** Source VFS Node ID (from vfs:// URL) */
  nodeId: string;
}

/**
 * NodeVfs - The unified VFS interface for VFS nodes
 * 
 * Provides:
 * - File operations (inherited from Vfs) - routed through MountedVfsProvider
 * - Version control operations - proxied to base VersionedVfs
 * - Mount management - via MountedVfsProvider
 * - Reactive dirty state tracking
 */
export class NodeVfs extends Vfs<MountedVfsProvider> {
  /** The underlying VersionedVfs for version control operations */
  private readonly _baseVfs: VersionedVfs;
  
  /** Event unsubscribers for each mounted VFS (keyed by mount path) */
  private readonly _mountEventUnsubscribers: Map<string, Array<() => void>> = new Map();
  
  /** Event unsubscribers for dirty state tracking */
  private readonly _dirtyTrackingUnsubscribers: Array<() => void> = [];
  
  /** Debounce timer for dirty state refresh */
  private _dirtyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  
  /** 
   * Reactive dirty state - true if there are uncommitted changes.
   * This is automatically updated when files change (debounced).
   */
  isDirty = $state(false);

  /**
   * Reactive modification counter — incremented on every file/folder event.
   *
   * Used by the build cache system for lightweight stale detection:
   * the build-runner records `writeVersion` at build time, and the UI
   * re-derives status whenever the counter advances.
   *
   * Unlike `isDirty` (git status), this counter never resets — it only
   * ever increases, so a simple `!==` comparison is sufficient.
   */
  writeVersion = $state(0);
  
  constructor(baseVfs: VersionedVfs) {
    // Create MountedVfsProvider with baseVfs as root mount
    const provider = new MountedVfsProvider([['/', baseVfs]]);
    super(provider);
    this._baseVfs = baseVfs;
    
    // Forward version control events from base VFS
    this.setupEventForwarding();
    
    // Setup dirty state tracking
    this.setupDirtyTracking();
  }
  
  // ========== Git Access ==========
  
  private get _gitProvider(): GitCapableProvider {
    return this._baseVfs.getProvider() as GitCapableProvider;
  }
  
  private get _fs(): GitCompatibleFs {
    return this._gitProvider.getFs();
  }
  
  private get _dir(): string {
    return this._gitProvider.getDir();
  }

  /**
   * Get the isomorphic-git compatible filesystem interface.
   * Used by computeVfsContentHash for lightweight content hashing via git.walk().
   */
  get gitFs(): GitCompatibleFs {
    return this._fs;
  }

  /**
   * Get the git repository directory path.
   * Always '/' since each VFS node maps to its own OPFS subtree.
   */
  get gitDir(): string {
    return this._dir;
  }

  /**
   * Read file content as string.
   * Handles both ArrayBuffer and string content types from VfsFile.
   */
  private async readFileAsText(path: string): Promise<string> {
    const file = await this.readFile(path);
    if (file.content === undefined) {
      throw new Error(`File content is undefined: ${path}`);
    }
    if (typeof file.content === 'string') {
      return file.content;
    }
    return new TextDecoder().decode(file.content);
  }
  
  /**
   * Get the node ID for this VFS.
   */
  getNodeId(): string {
    return this._gitProvider.getNodeId();
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
  
  // ========== Dirty State Tracking ==========
  
  /**
   * Setup event listeners to track dirty state.
   * When files change, we schedule a debounced status refresh.
   */
  private setupDirtyTracking(): void {
    console.log('[NodeVfs] setupDirtyTracking for node:', this.getNodeId());
    
    const scheduleRefresh = (eventName: string) => () => {
      console.log('[NodeVfs] Event triggered:', eventName, 'for node:', this.getNodeId());
      // Bump the monotonic modification counter (used by build cache stale detection)
      this.writeVersion++;
      this.scheduleDirtyRefresh();
    };
    
    // Track file changes
    this._dirtyTrackingUnsubscribers.push(
      this.events.on('file:created', scheduleRefresh('file:created')),
      this.events.on('file:updated', scheduleRefresh('file:updated')),
      this.events.on('file:deleted', scheduleRefresh('file:deleted')),
      this.events.on('file:moved', scheduleRefresh('file:moved')),
      this.events.on('folder:created', scheduleRefresh('folder:created')),
      this.events.on('folder:deleted', scheduleRefresh('folder:deleted')),
      this.events.on('folder:moved', scheduleRefresh('folder:moved')),
      // Also track commits (status should be cleared after commit)
      this.events.on('version:commit', scheduleRefresh('version:commit')),
      this.events.on('version:checkout', scheduleRefresh('version:checkout')),
      this.events.on('version:revert', scheduleRefresh('version:revert'))
    );
  }
  
  /**
   * Schedule a debounced dirty state refresh.
   */
  private scheduleDirtyRefresh(): void {
    console.log('[NodeVfs] scheduleDirtyRefresh called for node:', this.getNodeId());
    
    // Clear existing timer
    if (this._dirtyRefreshTimer) {
      clearTimeout(this._dirtyRefreshTimer);
    }
    
    // Schedule new refresh with 300ms debounce
    this._dirtyRefreshTimer = setTimeout(async () => {
      this._dirtyRefreshTimer = null;
      console.log('[NodeVfs] Debounce timer fired, refreshing dirty state for node:', this.getNodeId());
      await this.refreshDirtyState();
    }, 300);
  }
  
  /**
   * Refresh the dirty state by checking actual git status.
   */
  async refreshDirtyState(): Promise<void> {
    try {
      const status = await this.getStatus();
      const wasDirty = this.isDirty;
      this.isDirty = status.length > 0;
      console.log('[NodeVfs] refreshDirtyState for node:', this.getNodeId(), '- status count:', status.length, '- isDirty:', wasDirty, '->', this.isDirty);
    } catch (err) {
      // On error, assume dirty to be safe
      console.warn('[NodeVfs] Failed to refresh dirty state:', err);
      this.isDirty = true;
    }
  }
  
  /**
   * Cleanup dirty tracking resources
   */
  private cleanupDirtyTracking(): void {
    // Clear timer
    if (this._dirtyRefreshTimer) {
      clearTimeout(this._dirtyRefreshTimer);
      this._dirtyRefreshTimer = null;
    }
    
    // Unsubscribe event listeners
    for (const unsub of this._dirtyTrackingUnsubscribers) {
      unsub();
    }
    this._dirtyTrackingUnsubscribers.length = 0;
  }
  
  // ========== Git Submodule Operations ==========
  
  /**
   * Add a git submodule entry for a mounted VFS.
   * This records the mount in .gitmodules and creates a gitlink in the index.
   * 
   * @param mountPath - Path where the source VFS is mounted
   * @param sourceVfs - The mounted VFS (must be a NodeVfs)
   */
  async addSubmodule(mountPath: string, sourceVfs: NodeVfs): Promise<void> {
    const fs = this._fs;
    const dir = this._dir;

    // Get source VFS's current HEAD commit
    const sourceHead = await sourceVfs.getHead();
    const sourceNodeId = sourceVfs.getNodeId();

    // Read or create .gitmodules
    let gitmodules = '';
    try {
      gitmodules = await this.readFileAsText('/.gitmodules');
    } catch {
      // File doesn't exist, create new
    }

    // Normalize mount path (remove leading slash for gitmodules)
    const normalizedPath = mountPath.startsWith('/') ? mountPath.slice(1) : mountPath;

    // Check if submodule already exists
    if (gitmodules.includes(`[submodule "${normalizedPath}"]`)) {
      console.log(`[VFS:Submodule] Submodule ${normalizedPath} already exists, skipping add`);
      return;
    }

    // Add submodule configuration using vfs:// URL format
    const submoduleConfig = `
[submodule "${normalizedPath}"]
	path = ${normalizedPath}
	url = vfs://${sourceNodeId}
`;
    gitmodules += submoduleConfig;

    await this.updateFile('/.gitmodules', gitmodules);

    // Create gitlink (special tree entry pointing to submodule commit)
    await git.updateIndex({
      fs,
      dir,
      filepath: normalizedPath,
      oid: sourceHead.hash,
      mode: 0o160000 // gitlink mode
    });

    console.log(`[VFS:Submodule] Added submodule ${sourceNodeId} at ${normalizedPath} (commit: ${sourceHead.hash.slice(0, 7)})`);
  }

  /**
   * Remove a git submodule entry.
   * 
   * @param mountPath - Path of the submodule to remove
   */
  async removeSubmodule(mountPath: string): Promise<void> {
    const fs = this._fs;
    const dir = this._dir;

    // Normalize mount path
    const normalizedPath = mountPath.startsWith('/') ? mountPath.slice(1) : mountPath;

    // Read and update .gitmodules
    try {
      const gitmodules = await this.readFileAsText('/.gitmodules');

      // Remove the submodule section
      const lines = gitmodules.split('\n');
      const newLines: string[] = [];
      let inRemoveSection = false;

      for (const line of lines) {
        if (line.match(new RegExp(`^\\[submodule "${normalizedPath}"\\]`))) {
          inRemoveSection = true;
          continue;
        }
        if (inRemoveSection && line.match(/^\[/)) {
          inRemoveSection = false;
        }
        if (!inRemoveSection) {
          newLines.push(line);
        }
      }

      const newContent = newLines.join('\n').trim();
      if (newContent) {
        await this.updateFile('/.gitmodules', newContent + '\n');
      } else {
        // Remove empty .gitmodules file
        await this.deleteFile('/.gitmodules');
      }
    } catch {
      // .gitmodules doesn't exist, nothing to remove
    }

    // Remove from git index
    try {
      await git.remove({
        fs,
        dir,
        filepath: normalizedPath
      });
    } catch {
      // Entry might not exist in index
    }

    console.log(`[VFS:Submodule] Removed submodule at ${normalizedPath}`);
  }

  /**
   * Update a submodule's commit reference.
   * 
   * @param mountPath - Path of the submodule
   * @param commitHash - New commit hash to reference
   */
  async updateSubmoduleCommit(mountPath: string, commitHash: string): Promise<void> {
    const fs = this._fs;
    const dir = this._dir;

    // Normalize mount path
    const normalizedPath = mountPath.startsWith('/') ? mountPath.slice(1) : mountPath;

    // Update gitlink to new commit
    await git.updateIndex({
      fs,
      dir,
      filepath: normalizedPath,
      oid: commitHash,
      mode: 0o160000 // gitlink mode
    });

    console.log(`[VFS:Submodule] Updated ${normalizedPath} to commit ${commitHash.slice(0, 7)}`);
  }

  /**
   * List all submodules from .gitmodules
   */
  async listSubmodules(): Promise<SubmoduleInfo[]> {
    try {
      const content = await this.readFileAsText('/.gitmodules');
      return this.parseGitmodules(content);
    } catch {
      return [];
    }
  }

  /**
   * Parse .gitmodules INI format
   */
  private parseGitmodules(content: string): SubmoduleInfo[] {
    const result: SubmoduleInfo[] = [];
    const lines = content.split('\n');

    let currentPath = '';
    for (const line of lines) {
      const pathMatch = line.match(/^\s*path\s*=\s*(.+)$/);
      const urlMatch = line.match(/^\s*url\s*=\s*vfs:\/\/(.+)$/);

      if (pathMatch) currentPath = pathMatch[1].trim();
      if (urlMatch && currentPath) {
        result.push({ path: currentPath, nodeId: urlMatch[1].trim() });
        currentPath = '';
      }
    }

    return result;
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
    options?: { author?: string; email?: string; skipChangeDetails?: boolean }
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
    // Clean up dirty tracking
    this.cleanupDirtyTracking();
    
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
