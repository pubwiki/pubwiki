/**
 * OpfsProvider — VfsProvider backed by the OPFS API directly.
 *
 * Each instance is scoped to a subtree of OPFS:
 *   navigator.storage.getDirectory() / <projectId> / <nodeId> /
 *
 * Key design decisions:
 * - NO global handle cache (handles are obtained per-operation)
 * - NO in-memory file content mirroring
 * - Each provider owns its own DirectoryHandle, independently disposable
 * - WritableFileStream is always closed in a finally block
 */

import type { VfsStat } from '@pubwiki/vfs';

// POSIX-like error for isomorphic-git compatibility
function posixError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

export class OpfsProvider {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private initialized = false;

  constructor(
    private readonly projectId: string,
    private readonly nodeId: string,
  ) {}

  // ============================================================
  // Lifecycle
  // ============================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const opfsRoot = await navigator.storage.getDirectory();
    const projectDir = await opfsRoot.getDirectoryHandle(this.projectId, { create: true });
    this.rootHandle = await projectDir.getDirectoryHandle(this.nodeId, { create: true });
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    // Release the handle reference — GC will clean up
    this.rootHandle = null;
    this.initialized = false;
  }

  // ============================================================
  // Path resolution helpers
  // ============================================================

  /**
   * Walk down the directory tree to resolve a path.
   * Returns [parentDirHandle, leafName].
   *
   * For paths like "/a/b/c.txt":
   *   parentDirHandle = handle for "/a/b"
   *   leafName = "c.txt"
   *
   * For "/":
   *   parentDirHandle = rootHandle
   *   leafName = ""
   */
  private async resolve(
    path: string,
    options?: { createParents?: boolean }
  ): Promise<[FileSystemDirectoryHandle, string]> {
    const root = this.getRoot();
    const segments = this.splitPath(path);

    if (segments.length === 0) {
      return [root, ''];
    }

    let current = root;
    // Navigate to parent directory
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        current = await current.getDirectoryHandle(segments[i], {
          create: options?.createParents ?? false
        });
      } catch {
        throw posixError('ENOENT', `No such file or directory: ${path}`);
      }
    }

    return [current, segments[segments.length - 1]];
  }

  /**
   * Resolve a path to a directory handle.
   */
  private async resolveDir(
    path: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    const root = this.getRoot();
    const segments = this.splitPath(path);

    let current = root;
    for (const segment of segments) {
      try {
        current = await current.getDirectoryHandle(segment, {
          create: options?.create ?? false
        });
      } catch {
        throw posixError('ENOENT', `No such directory: ${path}`);
      }
    }
    return current;
  }

  private splitPath(path: string): string[] {
    // Normalize: convert backslashes to forward slashes (Windows paths),
    // strip leading/trailing slashes, treat '.' as root
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized === '.') return [];
    return normalized.split('/').filter(s => s !== '.');
  }

  private getRoot(): FileSystemDirectoryHandle {
    if (!this.rootHandle) {
      throw new Error('OpfsProvider not initialized');
    }
    return this.rootHandle;
  }

  // ============================================================
  // VfsProvider interface
  // ============================================================

  async readFile(path: string): Promise<Uint8Array> {
    const [parent, name] = await this.resolve(path);
    if (!name) throw posixError('EISDIR', `Is a directory: ${path}`);

    const fileHandle = await parent.getFileHandle(name).catch(() => {
      throw posixError('ENOENT', `No such file: ${path}`);
    });
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const [parent, name] = await this.resolve(path, { createParents: true });
    if (!name) throw posixError('EISDIR', `Is a directory: ${path}`);

    const fileHandle = await parent.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content as unknown as ArrayBuffer); // OPFS accepts ArrayBuffer/ArrayBufferView
    } finally {
      await writable.close(); // ALWAYS close, even on error
    }
  }

  async unlink(path: string): Promise<void> {
    const [parent, name] = await this.resolve(path);
    if (!name) throw posixError('EPERM', `Cannot unlink root`);
    await parent.removeEntry(name);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      await this.resolveDir(path, { create: true });
    } else {
      const [parent, name] = await this.resolve(path);
      if (!name) return; // root already exists
      await parent.getDirectoryHandle(name, { create: true });
    }
  }

  async readdir(path: string): Promise<string[]> {
    const dir = await this.resolveDir(path);
    const entries: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name] of (dir as any).entries()) {
      entries.push(name);
    }
    return entries;
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const [parent, name] = await this.resolve(path);
    if (!name) throw posixError('EPERM', `Cannot remove root directory`);
    await parent.removeEntry(name, { recursive: options?.recursive });
  }

  async stat(path: string): Promise<VfsStat> {
    const root = this.getRoot();
    const segments = this.splitPath(path);

    if (segments.length === 0) {
      // Root directory
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    }

    // Navigate to the parent
    let current: FileSystemDirectoryHandle = root;
    for (let i = 0; i < segments.length - 1; i++) {
      current = await current.getDirectoryHandle(segments[i]).catch(() => {
        throw posixError('ENOENT', `No such file or directory: ${path}`);
      });
    }

    const leafName = segments[segments.length - 1];

    // Try as file first
    try {
      const fileHandle = await current.getFileHandle(leafName);
      const file = await fileHandle.getFile();
      return {
        size: file.size,
        isFile: true,
        isDirectory: false,
        createdAt: new Date(file.lastModified),
        updatedAt: new Date(file.lastModified),
      };
    } catch {
      // Not a file, try as directory
    }

    try {
      await current.getDirectoryHandle(leafName);
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    } catch {
      throw posixError('ENOENT', `No such file or directory: ${path}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    // OPFS doesn't have a native rename.
    // For files: read → write to new → delete old.
    // For directories: recursive copy → recursive delete.
    const stat = await this.stat(from);

    if (stat.isFile) {
      const content = await this.readFile(from);
      await this.writeFile(to, content);
      await this.unlink(from);
    } else {
      await this.copyDirectory(from, to);
      await this.rmdir(from, { recursive: true });
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from);
    await this.writeFile(to, content);
  }

  // ============================================================
  // isomorphic-git compatible `fs` interface
  // ============================================================

  /**
   * Returns an object compatible with isomorphic-git's `fs` parameter.
   * The `dir` should be '/' since this provider is already scoped.
   */
  asGitFs(): GitCompatibleFs {
    return new GitCompatibleFs(this);
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  private async copyDirectory(from: string, to: string): Promise<void> {
    await this.mkdir(to, { recursive: true });
    const entries = await this.readdir(from);
    for (const entry of entries) {
      const fromChild = from === '/' ? `/${entry}` : `${from}/${entry}`;
      const toChild = to === '/' ? `/${entry}` : `${to}/${entry}`;
      const childStat = await this.stat(fromChild);
      if (childStat.isDirectory) {
        await this.copyDirectory(fromChild, toChild);
      } else {
        await this.copyFile(fromChild, toChild);
      }
    }
  }
}

// ============================================================
// isomorphic-git compatible FS wrapper
// ============================================================

/**
 * Wraps OpfsProvider to implement the fs interface expected by isomorphic-git.
 *
 * isomorphic-git checks for `fs.promises` and uses the promises API exclusively
 * in modern usage. This class provides that interface.
 */
export class GitCompatibleFs {
  readonly promises: GitCompatibleFsPromises;

  constructor(provider: OpfsProvider) {
    this.promises = new GitCompatibleFsPromises(provider);
  }
}

class GitCompatibleFsPromises {
  constructor(private provider: OpfsProvider) {}

  async readFile(
    path: string,
    options?: { encoding?: string }
  ): Promise<Uint8Array | string> {
    const data = await this.provider.readFile(path);
    if (options?.encoding === 'utf8') {
      return new TextDecoder().decode(data);
    }
    return data;
  }

  async writeFile(
    path: string,
    data: Uint8Array | string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: { mode?: number }
  ): Promise<void> {
    const content = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data);
    await this.provider.writeFile(path, content);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async mkdir(path: string, options?: { mode?: number }): Promise<void> {
    await this.provider.mkdir(path, { recursive: true });
  }

  async rmdir(path: string): Promise<void> {
    await this.provider.rmdir(path, { recursive: false });
  }

  async unlink(path: string): Promise<void> {
    await this.provider.unlink(path);
  }

  async stat(path: string): Promise<OpfsStats> {
    const s = await this.provider.stat(path);
    return new OpfsStats(s.isFile, s.isDirectory, s.size, s.updatedAt.getTime());
  }

  async lstat(path: string): Promise<OpfsStats> {
    // OPFS has no symlinks, lstat === stat
    return this.stat(path);
  }

  async readdir(path: string): Promise<string[]> {
    return this.provider.readdir(path);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readlink(path: string): Promise<string> {
    throw posixError('ENOTSUP', 'Symlinks not supported on OPFS');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async symlink(target: string, path: string): Promise<void> {
    throw posixError('ENOTSUP', 'Symlinks not supported on OPFS');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chmod(path: string, mode: number): Promise<void> {
    // no-op: OPFS doesn't have POSIX permissions
  }
}

class OpfsStats {
  readonly type: 'file' | 'dir';

  // isomorphic-git normalizeStats requires these timing fields
  readonly ctimeMs: number;
  readonly ctimeSeconds: number;
  readonly ctimeNanoseconds: number;
  readonly mtimeMs: number;
  readonly mtimeSeconds: number;
  readonly mtimeNanoseconds: number;

  // Standard fs.Stats fields isomorphic-git may access
  readonly dev: number = 0;
  readonly ino: number = 0;
  readonly mode: number;
  readonly uid: number = 0;
  readonly gid: number = 0;

  constructor(
    private readonly _isFile: boolean,
    private readonly _isDir: boolean,
    readonly size: number,
    mtimeMs: number,
  ) {
    this.type = _isFile ? 'file' : 'dir';
    this.mode = _isFile ? 0o100644 : 0o40755;

    this.mtimeMs = mtimeMs;
    this.mtimeSeconds = Math.floor(mtimeMs / 1000);
    this.mtimeNanoseconds = ((mtimeMs % 1000) * 1_000_000) | 0;

    this.ctimeMs = mtimeMs;
    this.ctimeSeconds = this.mtimeSeconds;
    this.ctimeNanoseconds = this.mtimeNanoseconds;
  }

  isFile(): boolean { return this._isFile; }
  isDirectory(): boolean { return this._isDir; }
  isSymbolicLink(): boolean { return false; }
}
