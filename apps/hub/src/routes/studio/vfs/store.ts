/**
 * VFS Store for Studio
 *
 * Provides scoped VFS instances using ZenFS as the underlying file system
 * and isomorphic-git for version control.
 *
 * Each node gets an isolated VFS provider scoped to /<project_id>/<node_id>/
 */

// Polyfill Buffer for isomorphic-git in browser environment
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import { configure, fs as zenfs } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
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

// ============================================================================
// ZenFS Configuration
// ============================================================================

let zenfsConfigured = false;
let configurePromise: Promise<void> | null = null;

/**
 * Configure ZenFS with IndexedDB backend
 */
async function ensureZenFSConfigured(): Promise<void> {
  if (zenfsConfigured) return;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    await configure({
      mounts: {
        '/': IndexedDB,
      },
    });
    zenfsConfigured = true;
  })();

  return configurePromise;
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

  // ========== Lifecycle ==========

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await ensureZenFSConfigured();

    // Ensure base directory exists
    const absPath = this.basePath;
    try {
      await zenfs.promises.mkdir(absPath, { recursive: true });
    } catch (e: unknown) {
      // Directory might already exist
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
    }

    // Initialize git repository if not already initialized
    try {
      await git.init({
        fs: zenfs,
        dir: absPath,
        defaultBranch: 'main',
      });
    } catch (e: unknown) {
      // Repository might already exist
      const err = e as Error;
      if (!err.message?.includes('already exists')) {
        console.warn('Git init warning:', err.message);
      }
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    // Nothing to dispose for ZenFS
    this.initialized = false;
  }

  // ========== ID Generation ==========

  async id(path: string): Promise<string> {
    // Get the inode number from ZenFS stat
    const absPath = this.toAbsolutePath(path);
    const stats = await zenfs.promises.stat(absPath);
    return stats.ino.toString(16).padStart(8, '0');
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
    // Filter out .git directory from listings
    return entries.filter((entry) => entry !== '.git');
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

  /**
   * Get or create a VersionedVfs instance for a node
   */
  async getVfs(projectId: string, nodeId: string): Promise<VersionedVfs> {
    const key = `${projectId}/${nodeId}`;

    let vfs = this.vfsInstances.get(key);
    if (!vfs) {
      // Create and initialize the provider
      const provider = new ScopedVfsProvider(projectId, nodeId);
      await provider.initialize();
      this.providers.set(key, provider);
      
      // Create VersionedVfs wrapper
      vfs = createVfs(provider) as VersionedVfs;
      await vfs.initialize();
      this.vfsInstances.set(key, vfs);
    }

    return vfs;
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
 * Convenience function to get a VersionedVfs for a node
 */
export async function getNodeVfs(
  projectId: string,
  nodeId: string
): Promise<VersionedVfs> {
  const factory = getVfsFactory();
  return factory.getVfs(projectId, nodeId);
}

// Re-export types
export type { VfsProvider, VersionedVfsProvider, VersionedVfs };
