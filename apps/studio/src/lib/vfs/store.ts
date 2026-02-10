/**
 * VFS Store for Studio
 *
 * Provides scoped VFS instances using ZenFS as the underlying file system
 * and isomorphic-git for version control.
 *
 * Each node gets an isolated VFS provider scoped to /<project_id>/<node_id>/
 * 
 * API: Use getNodeVfs() to get the NodeVfs for a node. NodeVfs is the unified
 * interface that includes file operations, mount support, and version control.
 */

// Polyfill Buffer for isomorphic-git in browser environment
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import { configure, fs as zenfs } from '@zenfs/core';
import { WebAccess } from '@zenfs/dom';
import * as git from 'isomorphic-git';
import {
  type VfsProvider,
  type VersionedVfsProvider,
  type VfsStat,
  type VfsCommit,
  type VfsDiff,
  type VfsCommitChange,
  createVfs,
  type VersionedVfs,
} from '@pubwiki/vfs';
import { NodeVfs } from './node-vfs.svelte';
import { nodeStore } from '$lib/persistence';
import type { VFSNodeData, VFSContent } from '$lib/types';

// ============================================================================
// ZenFS Configuration
// ============================================================================

let zenfsConfigured = false;
let configurePromise: Promise<void> | null = null;

/**
 * Configure ZenFS with OPFS backend
 */
async function ensureZenFSConfigured(): Promise<void> {
  if (zenfsConfigured) {
    console.log('[VFS:ZenFS] Already configured, skipping');
    return;
  }
  if (configurePromise) {
    console.log('[VFS:ZenFS] Configuration in progress, waiting...');
    const waitStart = performance.now();
    await configurePromise;
    console.log(`[VFS:ZenFS] Wait for existing config took ${(performance.now() - waitStart).toFixed(2)}ms`);
    return;
  }

  console.log('[VFS:ZenFS] Starting configuration...');
  
  configurePromise = (async () => {
    const configureStart = performance.now();
    console.log('[VFS:ZenFS] Calling configure() with OPFS backend...');
    
    // Get OPFS root directory handle
    const opfsRoot = await navigator.storage.getDirectory();
    
    await configure({
      mounts: {
        '/': { backend: WebAccess, handle: opfsRoot },
      },
    });
    console.log(`[VFS:ZenFS] configure() returned in ${(performance.now() - configureStart).toFixed(2)}ms`);
    zenfsConfigured = true;
  })();

  const awaitStart = performance.now();
  await configurePromise;
  console.log(`[VFS:ZenFS] First await took ${(performance.now() - awaitStart).toFixed(2)}ms`);
}

/**
 * Pre-initialize ZenFS to avoid delay on first VFS access.
 * Call this early in app startup (e.g., in layout or page load).
 * Returns immediately if already initialized or in progress.
 */
export function preInitializeZenFS(): Promise<void> {
  console.log('[VFS:ZenFS] preInitializeZenFS called');
  return ensureZenFSConfigured();
}

// ============================================================================
// Git Context for Submodule Operations
// ============================================================================

/**
 * Context needed for isomorphic-git operations.
 * This provides the minimal interface needed without exposing internals.
 */
export interface GitContext {
  /** The file system interface (ZenFS) */
  fs: typeof zenfs;
  /** The repository directory path */
  dir: string;
  /** The node ID for this VFS */
  nodeId: string;
}

// ============================================================================
// Scoped VFS Provider with Git Version Control
// ============================================================================

/**
 * A VFS provider scoped to a specific path with git version control.
 * All operations are relative to the base path.
 */
export class ScopedVfsProvider implements VersionedVfsProvider {
  private basePath: string;
  private initialized = false;
  private author = { name: 'Anonymous', email: 'anonymous@pubwiki.local' };

  constructor(
    private projectId: string,
    private nodeId: string
  ) {
    this.basePath = `/${projectId}/${nodeId}`;
  }

  // ========== Path Utilities ==========

  private toAbsolutePath(path: string): string {
    // Normalize the path
    let normalized = path;
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    // Remove trailing slash except for root
    if (normalized !== '/' && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    // Join with base path
    if (normalized === '/') {
      return this.basePath;
    }
    return this.basePath + normalized;
  }

  // ========== Submodule Support (for isomorphic-git) ==========

  /**
   * Get the underlying file system interface (ZenFS)
   * Used by submodule.ts to call isomorphic-git directly
   */
  getFs(): typeof zenfs {
    return zenfs;
  }

  /**
   * Get the repository directory path
   * Used by submodule.ts to call isomorphic-git directly
   */
  getDir(): string {
    return this.basePath;
  }

  /**
   * Get the node ID for this VFS
   */
  getNodeId(): string {
    return this.nodeId;
  }

  // ========== Lifecycle ==========

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log(`[VFS:Provider] ${this.basePath} already initialized, skipping`);
      return;
    }

    console.log(`[VFS:Provider] Initializing ${this.basePath}...`);
    const totalStart = performance.now();
    
    const zenfsStart = performance.now();
    await ensureZenFSConfigured();
    console.log(`[VFS:Provider] ${this.basePath} ZenFS ready in ${(performance.now() - zenfsStart).toFixed(2)}ms`);

    // Ensure base directory exists
    const absPath = this.basePath;
    const mkdirStart = performance.now();
    try {
      await zenfs.promises.mkdir(absPath, { recursive: true });
    } catch (e: unknown) {
      // Directory might already exist
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
    }
    console.log(`[VFS:Provider] ${this.basePath} mkdir in ${(performance.now() - mkdirStart).toFixed(2)}ms`);

    // Initialize git repository if not already initialized
    const gitStart = performance.now();
    try {
      await git.init({
        fs: zenfs,
        dir: absPath,
        defaultBranch: 'main',
      });
      console.log(`[VFS:Provider] ${this.basePath} git init (new) in ${(performance.now() - gitStart).toFixed(2)}ms`);
    } catch (e: unknown) {
      // Repository might already exist
      const err = e as Error;
      if (!err.message?.includes('already exists')) {
        console.warn('Git init warning:', err.message);
      }
      console.log(`[VFS:Provider] ${this.basePath} git init (existing) in ${(performance.now() - gitStart).toFixed(2)}ms`);
    }

    this.initialized = true;
    console.log(`[VFS:Provider] ${this.basePath} TOTAL initialization: ${(performance.now() - totalStart).toFixed(2)}ms`);
  }

  async dispose(): Promise<void> {
    // Reset state
    this.initialized = false;
  }

  // ========== File Operations ==========

  async readFile(path: string): Promise<Uint8Array> {
    const absPath = this.toAbsolutePath(path);
    const buffer = await zenfs.promises.readFile(absPath);
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const absPath = this.toAbsolutePath(path);

    // Ensure parent directory exists
    const parentDir = absPath.substring(0, absPath.lastIndexOf('/'));
    if (parentDir && parentDir !== this.basePath) {
      try {
        await zenfs.promises.mkdir(parentDir, { recursive: true });
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw e;
        }
      }
    }

    await zenfs.promises.writeFile(absPath, content);
  }

  async unlink(path: string): Promise<void> {
    const absPath = this.toAbsolutePath(path);
    await zenfs.promises.unlink(absPath);
  }

  // ========== Directory Operations ==========

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const absPath = this.toAbsolutePath(path);
    try {
      await zenfs.promises.mkdir(absPath, { recursive: options?.recursive });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
    }
  }

  async readdir(path: string): Promise<string[]> {
    const absPath = this.toAbsolutePath(path);
    const entries = await zenfs.promises.readdir(absPath);
    return entries;
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const absPath = this.toAbsolutePath(path);
    if (options?.recursive) {
      await zenfs.promises.rm(absPath, { recursive: true });
    } else {
      await zenfs.promises.rmdir(absPath);
    }
  }

  // ========== Status Query ==========

  async stat(path: string): Promise<VfsStat> {
    const absPath = this.toAbsolutePath(path);
    const stats = await zenfs.promises.stat(absPath);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: new Date(stats.birthtimeMs),
      updatedAt: new Date(stats.mtimeMs),
    };
  }

  async exists(path: string): Promise<boolean> {
    const absPath = this.toAbsolutePath(path);
    try {
      await zenfs.promises.access(absPath);
      return true;
    } catch {
      return false;
    }
  }

  // ========== Move/Copy ==========

  async rename(from: string, to: string): Promise<void> {
    const absFrom = this.toAbsolutePath(from);
    const absTo = this.toAbsolutePath(to);

    // Ensure target parent directory exists
    const toParent = absTo.substring(0, absTo.lastIndexOf('/'));
    if (toParent && toParent !== this.basePath) {
      try {
        await zenfs.promises.mkdir(toParent, { recursive: true });
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw e;
        }
      }
    }

    await zenfs.promises.rename(absFrom, absTo);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const absFrom = this.toAbsolutePath(from);
    const absTo = this.toAbsolutePath(to);

    // Ensure target parent directory exists
    const toParent = absTo.substring(0, absTo.lastIndexOf('/'));
    if (toParent && toParent !== this.basePath) {
      try {
        await zenfs.promises.mkdir(toParent, { recursive: true });
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw e;
        }
      }
    }

    await zenfs.promises.copyFile(absFrom, absTo);
  }

  // ========== Git Version Control ==========

  /**
   * Set the author for git operations
   */
  setAuthor(name: string, email: string): void {
    this.author = { name, email };
  }

  /**
   * Stage all changes and commit
   */
  async commit(
    message: string,
    options?: { author?: string; email?: string }
  ): Promise<VfsCommit> {
    const author = {
      name: options?.author ?? this.author.name,
      email: options?.email ?? this.author.email,
    };

    // Get status and stage all changes
    const statusMatrix = await git.statusMatrix({
      fs: zenfs,
      dir: this.basePath,
    });

    // Stage all changes
    for (const [filepath, head, workdir, stage] of statusMatrix) {
      // Skip if already staged and unchanged
      if (head === workdir && workdir === stage) continue;

      if (workdir === 0) {
        // File was deleted
        await git.remove({
          fs: zenfs,
          dir: this.basePath,
          filepath,
        });
      } else {
        // File was added or modified
        await git.add({
          fs: zenfs,
          dir: this.basePath,
          filepath,
        });
      }
    }

    // Create commit
    const sha = await git.commit({
      fs: zenfs,
      dir: this.basePath,
      message,
      author,
    });

    // Get the commit object
    const commitObj = await git.readCommit({
      fs: zenfs,
      dir: this.basePath,
      oid: sha,
    });

    // Get changes for this commit
    const changes = await this.getCommitChanges(sha);

    return {
      hash: sha,
      message: commitObj.commit.message.trim(),
      author: `${commitObj.commit.author.name} <${commitObj.commit.author.email}>`,
      timestamp: new Date(commitObj.commit.author.timestamp * 1000),
      changes,
    };
  }

  private async getCommitChanges(commitOid: string): Promise<VfsCommitChange[]> {
    const changes: VfsCommitChange[] = [];

    try {
      const commit = await git.readCommit({
        fs: zenfs,
        dir: this.basePath,
        oid: commitOid,
      });

      // Get parent commit (if any)
      const parentOid = commit.commit.parent[0];

      if (!parentOid) {
        // First commit - all files are added
        const files = await git.listFiles({
          fs: zenfs,
          dir: this.basePath,
          ref: commitOid,
        });

        for (const file of files) {
          changes.push({ type: 'added', path: '/' + file });
        }
      } else {
        // Compare with parent
        const diffs = await this.diff(parentOid, commitOid);
        for (const d of diffs) {
          changes.push({ type: d.type, path: d.path });
        }
      }
    } catch (e) {
      console.warn('Failed to get commit changes:', e);
    }

    return changes;
  }

  async getHistory(options?: {
    path?: string;
    depth?: number;
    ref?: string;
  }): Promise<VfsCommit[]> {
    try {
      const logs = await git.log({
        fs: zenfs,
        dir: this.basePath,
        depth: options?.depth ?? 50,
        ref: options?.ref ?? 'HEAD',
        filepath: options?.path?.replace(/^\//, ''),
      });

      return Promise.all(
        logs.map(async (log) => ({
          hash: log.oid,
          message: log.commit.message.trim(),
          author: `${log.commit.author.name} <${log.commit.author.email}>`,
          timestamp: new Date(log.commit.author.timestamp * 1000),
          changes: await this.getCommitChanges(log.oid),
        }))
      );
    } catch {
      // No commits yet
      return [];
    }
  }

  async checkout(ref: string): Promise<void> {
    await git.checkout({
      fs: zenfs,
      dir: this.basePath,
      ref,
      force: true,
    });
  }

  async diff(commitA: string, commitB: string): Promise<VfsDiff[]> {
    const diffs: VfsDiff[] = [];

    // Get file lists for both commits
    const filesA = await git.listFiles({
      fs: zenfs,
      dir: this.basePath,
      ref: commitA,
    });

    const filesB = await git.listFiles({
      fs: zenfs,
      dir: this.basePath,
      ref: commitB,
    });

    const allFiles = new Set([...filesA, ...filesB]);

    for (const file of allFiles) {
      const inA = filesA.includes(file);
      const inB = filesB.includes(file);

      if (!inA && inB) {
        // Added
        diffs.push({
          type: 'added',
          path: '/' + file,
        });
      } else if (inA && !inB) {
        // Deleted
        diffs.push({
          type: 'deleted',
          path: '/' + file,
        });
      } else if (inA && inB) {
        // Check if modified
        try {
          const blobA = await git.readBlob({
            fs: zenfs,
            dir: this.basePath,
            oid: commitA,
            filepath: file,
          });

          const blobB = await git.readBlob({
            fs: zenfs,
            dir: this.basePath,
            oid: commitB,
            filepath: file,
          });

          if (blobA.oid !== blobB.oid) {
            const decoder = new TextDecoder();
            diffs.push({
              type: 'modified',
              path: '/' + file,
              oldContent: decoder.decode(blobA.blob),
              newContent: decoder.decode(blobB.blob),
            });
          }
        } catch {
          // Could not compare, assume modified
          diffs.push({
            type: 'modified',
            path: '/' + file,
          });
        }
      }
    }

    return diffs;
  }

  async getCurrentBranch(): Promise<string> {
    try {
      return await git.currentBranch({
        fs: zenfs,
        dir: this.basePath,
        fullname: false,
      }) ?? 'main';
    } catch {
      return 'main';
    }
  }

  async getHead(): Promise<VfsCommit> {
    const history = await this.getHistory({ depth: 1 });
    if (history.length === 0) {
      throw new Error('No commits yet');
    }
    return history[0];
  }

  async revert(ref: string): Promise<void> {
    // Hard reset to the specified ref
    const currentBranch = await this.getCurrentBranch();

    // Resolve the ref to an OID
    const oid = await git.resolveRef({
      fs: zenfs,
      dir: this.basePath,
      ref,
    });

    // Update the branch ref to point to the target commit
    await git.writeRef({
      fs: zenfs,
      dir: this.basePath,
      ref: `refs/heads/${currentBranch}`,
      value: oid,
      force: true,
    });

    // Checkout to update working directory
    await git.checkout({
      fs: zenfs,
      dir: this.basePath,
      ref: currentBranch,
      force: true,
    });
  }

  // ========== Optional Git Operations ==========

  async createBranch(name: string, ref?: string): Promise<void> {
    await git.branch({
      fs: zenfs,
      dir: this.basePath,
      ref: name,
      checkout: false,
    });
  }

  async deleteBranch(name: string): Promise<void> {
    await git.deleteBranch({
      fs: zenfs,
      dir: this.basePath,
      ref: name,
    });
  }

  async listBranches(): Promise<string[]> {
    return git.listBranches({
      fs: zenfs,
      dir: this.basePath,
    });
  }

  async stage(path: string): Promise<void> {
    const relativePath = path.replace(/^\//, '');
    await git.add({
      fs: zenfs,
      dir: this.basePath,
      filepath: relativePath,
    });
  }

  async unstage(path: string): Promise<void> {
    const relativePath = path.replace(/^\//, '');
    await git.resetIndex({
      fs: zenfs,
      dir: this.basePath,
      filepath: relativePath,
    });
  }

  async status(): Promise<
    Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted' | 'untracked';
      staged: boolean;
    }>
  > {
    const matrix = await git.statusMatrix({
      fs: zenfs,
      dir: this.basePath,
    });

    const results: Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted' | 'untracked';
      staged: boolean;
    }> = [];

    for (const [filepath, head, workdir, stage] of matrix) {
      // Skip unmodified files
      if (head === 1 && workdir === 1 && stage === 1) continue;

      let status: 'added' | 'modified' | 'deleted' | 'untracked';
      let staged = false;

      if (head === 0 && workdir === 2 && stage === 0) {
        status = 'untracked';
      } else if (head === 0 && workdir === 2 && stage === 2) {
        status = 'added';
        staged = true;
      } else if (head === 1 && workdir === 2 && stage === 1) {
        status = 'modified';
      } else if (head === 1 && workdir === 2 && stage === 2) {
        status = 'modified';
        staged = true;
      } else if (head === 1 && workdir === 0 && stage === 1) {
        status = 'deleted';
      } else if (head === 1 && workdir === 0 && stage === 0) {
        status = 'deleted';
        staged = true;
      } else {
        // Other states, default to modified
        status = 'modified';
        staged = stage !== head;
      }

      results.push({
        path: '/' + filepath,
        status,
        staged,
      });
    }

    return results;
  }
}

// ============================================================================
// Factory for VersionedVfs Instances
// ============================================================================

/**
 * Factory for creating and managing VersionedVfs instances
 * 
 * Each VFS node gets a VersionedVfs instance that wraps a ScopedVfsProvider.
 * The VersionedVfs provides:
 * - High-level file operations (createFile, readFile, updateFile, etc.)
 * - Event system for reactive updates
 * - Git version control (commit, history, checkout, etc.)
 */
export class NodeVfsFactory {
  private vfsInstances = new Map<string, VersionedVfs>();
  private providers = new Map<string, ScopedVfsProvider>();
  /** Promise cache to prevent duplicate concurrent creations */
  private pendingCreations = new Map<string, Promise<VersionedVfs>>();

  /**
   * Get or create a VersionedVfs instance for a node
   */
  async getVfs(projectId: string, nodeId: string): Promise<VersionedVfs> {
    const key = `${projectId}/${nodeId}`;

    // Check if already cached
    let vfs = this.vfsInstances.get(key);
    if (vfs) {
      console.log(`[VFS:Factory] ${key} already cached, returning existing instance`);
      return vfs;
    }
    
    // Check if creation is already in progress (prevent race condition)
    let pending = this.pendingCreations.get(key);
    if (pending) {
      console.log(`[VFS:Factory] ${key} creation already pending, waiting...`);
      return pending;
    }

    console.log(`[VFS:Factory] Creating new VFS for ${key}...`);
    const totalStart = performance.now();
    
    // Create promise and cache it immediately to prevent duplicate creations
    const createPromise = (async (): Promise<VersionedVfs> => {
      // Create and initialize the provider
      const providerStart = performance.now();
      const provider = new ScopedVfsProvider(projectId, nodeId);
      await provider.initialize();
      this.providers.set(key, provider);
      console.log(`[VFS:Factory] ${key} provider ready in ${(performance.now() - providerStart).toFixed(2)}ms`);
      
      // Create VersionedVfs wrapper
      const vfsStart = performance.now();
      const newVfs = createVfs(provider) as VersionedVfs;
      await newVfs.initialize();
      this.vfsInstances.set(key, newVfs);
      console.log(`[VFS:Factory] ${key} VFS wrapper ready in ${(performance.now() - vfsStart).toFixed(2)}ms`);
      
      console.log(`[VFS:Factory] ${key} TOTAL creation: ${(performance.now() - totalStart).toFixed(2)}ms`);
      
      return newVfs;
    })();
    
    this.pendingCreations.set(key, createPromise);
    
    try {
      vfs = await createPromise;
      return vfs;
    } finally {
      this.pendingCreations.delete(key);
    }
  }

  /**
   * Get the underlying provider for a node (for low-level operations)
   */
  getProvider(projectId: string, nodeId: string): ScopedVfsProvider | undefined {
    const key = `${projectId}/${nodeId}`;
    return this.providers.get(key);
  }

  /**
   * Dispose a specific VFS instance
   */
  async disposeVfs(projectId: string, nodeId: string): Promise<void> {
    const key = `${projectId}/${nodeId}`;
    
    const vfs = this.vfsInstances.get(key);
    if (vfs) {
      await vfs.dispose();
      this.vfsInstances.delete(key);
    }
    
    // Provider is disposed via VFS dispose
    this.providers.delete(key);
  }

  /**
   * Delete all VFS data for a node from OPFS storage.
   * This permanently removes all files in the /<projectId>/<nodeId>/ directory.
   * Should be called after disposeVfs or when the VFS node is deleted.
   */
  async deleteVfsData(projectId: string, nodeId: string): Promise<void> {
    await ensureZenFSConfigured();
    
    const vfsPath = `/${projectId}/${nodeId}`;
    
    try {
      // Check if the directory exists before attempting to delete
      await zenfs.promises.stat(vfsPath);
      // Recursively delete the entire VFS directory
      await zenfs.promises.rm(vfsPath, { recursive: true });
      console.log(`[VFS:NodeVfsFactory] Deleted VFS data at ${vfsPath}`);
    } catch (e) {
      // Directory doesn't exist, nothing to delete
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log(`[VFS:NodeVfsFactory] No VFS data to delete at ${vfsPath}`);
        return;
      }
      throw e;
    }
  }

  /**
   * Dispose all VFS instances
   */
  async disposeAll(): Promise<void> {
    for (const vfs of this.vfsInstances.values()) {
      await vfs.dispose();
    }
    this.vfsInstances.clear();
    this.providers.clear();
  }
}

// ============================================================================
// Singleton Factory Instance
// ============================================================================

let factoryInstance: NodeVfsFactory | null = null;

/**
 * Get the singleton factory instance
 */
export function getVfsFactory(): NodeVfsFactory {
  if (!factoryInstance) {
    factoryInstance = new NodeVfsFactory();
  }
  return factoryInstance;
}

/**
 * Internal function to get a raw VersionedVfs for a node.
 * This is used internally by getNodeVfs() to create the base VFS.
 * 
 * @internal - Do not use directly, use getNodeVfs() instead.
 */
async function getBaseVersionedVfs(
  projectId: string,
  nodeId: string
): Promise<VersionedVfs> {
  const factory = getVfsFactory();
  return factory.getVfs(projectId, nodeId);
}

// ============================================================================
// NodeVfs Cache - Complete VFS with mounts
// ============================================================================

/**
 * Cache for NodeVfs instances.
 * Each NodeVfs includes the base VFS + all mount configurations.
 */
const nodeVfsCache = new Map<string, NodeVfs>();

/**
 * Pending NodeVfs creation promises to prevent duplicate concurrent creations.
 */
const pendingNodeVfsCreations = new Map<string, Promise<NodeVfs>>();

/**
 * Get or create a NodeVfs for a node.
 * 
 * This is the primary and ONLY API for accessing VFS nodes. The returned NodeVfs:
 * - Includes all mount configurations from the node's content
 * - Supports nested mounts (mounted child VFS also includes their mounts)
 * - Provides both file operations and version control
 * 
 * @param projectId The project ID
 * @param nodeId The VFS node ID
 * @param visitedNodes Set of node IDs already being resolved (for cycle detection)
 * @returns Complete NodeVfs instance
 */
export async function getNodeVfs(
  projectId: string,
  nodeId: string,
  visitedNodes: Set<string> = new Set()
): Promise<NodeVfs> {
  const key = `${projectId}:${nodeId}`;
  
  // Check for circular mount
  if (visitedNodes.has(nodeId)) {
    throw new Error(`Circular mount detected: ${Array.from(visitedNodes).join(' -> ')} -> ${nodeId}`);
  }
  
  // Return cached instance if available
  if (nodeVfsCache.has(key)) {
    console.log(`[VFS:NodeVfs] ${key} found in cache`);
    return nodeVfsCache.get(key)!;
  }
  
  // Check if creation is already in progress
  const pending = pendingNodeVfsCreations.get(key);
  if (pending) {
    console.log(`[VFS:NodeVfs] ${key} creation already pending, waiting...`);
    return pending;
  }
  
  console.log(`[VFS:NodeVfs] Creating NodeVfs for ${key}...`);
  
  // Create promise and cache it
  const createPromise = (async (): Promise<NodeVfs> => {
    // Get the base VersionedVfs
    const baseVfs = await getBaseVersionedVfs(projectId, nodeId);
    
    // Create NodeVfs (wraps base VFS with MountedVfsProvider)
    const nodeVfs = new NodeVfs(baseVfs);
    
    // Load mount configuration and mount child VFS nodes
    const nodeData = nodeStore.get(nodeId) as VFSNodeData | undefined;
    if (nodeData && nodeData.content) {
      const content = nodeData.content as VFSContent;
      const mounts = content.mounts || [];
      
      // Track visited nodes for cycle detection
      const newVisited = new Set(visitedNodes);
      newVisited.add(nodeId);
      
      for (const mount of mounts) {
        try {
          // Recursively get child's complete NodeVfs (includes its mounts)
          const childVfs = await getNodeVfs(projectId, mount.sourceNodeId, newVisited);
          // Pass the sourceNodeId so stat() can return mountedId
          nodeVfs.mount(mount.mountPath, childVfs, mount.sourceNodeId);
          console.log(`[VFS:NodeVfs] ${key} mounted ${mount.sourceNodeId} at ${mount.mountPath}`);
        } catch (err) {
          console.error(`[VFS:NodeVfs] Failed to mount ${mount.sourceNodeId}:`, err);
          // Continue with other mounts even if one fails
        }
      }
    }
    
    // Cache the complete NodeVfs
    nodeVfsCache.set(key, nodeVfs);
    
    return nodeVfs;
  })();
  
  pendingNodeVfsCreations.set(key, createPromise);
  
  try {
    const result = await createPromise;
    console.log(`[VFS:NodeVfs] ${key} created successfully`);
    return result;
  } finally {
    pendingNodeVfsCreations.delete(key);
  }
}

/**
 * Invalidate a cached NodeVfs instance.
 * Call this when mount configuration changes.
 * 
 * @param projectId The project ID
 * @param nodeId The VFS node ID
 */
export function invalidateNodeVfs(projectId: string, nodeId: string): void {
  const key = `${projectId}:${nodeId}`;
  const nodeVfs = nodeVfsCache.get(key);
  if (nodeVfs) {
    // Note: We don't dispose here since the base VFS may still be valid
    nodeVfsCache.delete(key);
    console.log(`[VFS:NodeVfs] ${key} invalidated`);
  }
  
  // Also invalidate any NodeVfs that mounts this one
  // (We need to find and invalidate parent VFS nodes that mount this one)
  invalidateMountingNodes(projectId, nodeId);
}

/**
 * Find and invalidate all NodeVfs instances that mount the given node.
 */
function invalidateMountingNodes(projectId: string, mountedNodeId: string): void {
  // Get all VFS nodes and check their mount configurations
  for (const data of nodeStore.getAll()) {
    if (data.type !== 'VFS') continue;
    
    const content = data.content as VFSContent;
    const mounts = content.mounts || [];
    
    // Check if this node mounts the invalidated node
    const mountsTarget = mounts.some(m => m.sourceNodeId === mountedNodeId);
    if (mountsTarget) {
      const key = `${projectId}:${data.id}`;
      if (nodeVfsCache.has(key)) {
        nodeVfsCache.delete(key);
        console.log(`[VFS:NodeVfs] ${key} invalidated (mounts ${mountedNodeId})`);
        // Recursively invalidate nodes that mount this one
        invalidateMountingNodes(projectId, data.id);
      }
    }
  }
}

/**
 * Clear all cached NodeVfs instances.
 * Use this when switching projects or for cleanup.
 */
export function clearNodeVfsCache(): void {
  nodeVfsCache.clear();
  console.log('[VFS:NodeVfs] Cache cleared');
}

// Re-export types - only VfsProvider for internal use, NodeVfs is the public API
export type { VfsProvider };
export { NodeVfs };
