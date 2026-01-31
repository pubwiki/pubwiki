/**
 * VFS Adapter for modern-monaco
 * 
 * Bridges our VersionedVfs interface with modern-monaco's FileSystem interface.
 */

import type { VersionedVfs } from '@pubwiki/vfs';

// ============================================================================
// modern-monaco FileSystem types (copied from workspace.d.ts since not exported)
// ============================================================================

/**
 * The type of a file system entry.
 * - `0`: unknown
 * - `1`: file
 * - `2`: directory
 * - `64`: symlink
 */
type FileSystemEntryType = 0 | 1 | 2 | 64;

interface FileSystemWatchContext {
  isModelContentChange?: boolean;
}

interface FileSystemWatchHandle {
  (kind: "create" | "modify" | "remove", filename: string, type?: number, context?: FileSystemWatchContext): void;
}

interface FileStat {
  readonly type: FileSystemEntryType;
  readonly ctime: number;
  readonly mtime: number;
  readonly version: number;
  readonly size: number;
}

interface FileSystem {
  copy(source: string, target: string, options?: { overwrite: boolean }): Promise<void>;
  createDirectory(dir: string): Promise<void>;
  delete(filename: string, options?: { recursive: boolean }): Promise<void>;
  readDirectory(filename: string): Promise<[string, number][]>;
  readFile(filename: string): Promise<Uint8Array>;
  readTextFile(filename: string): Promise<string>;
  rename(oldName: string, newName: string, options?: { overwrite: boolean }): Promise<void>;
  stat(filename: string): Promise<FileStat>;
  writeFile(filename: string, content: string | Uint8Array, context?: FileSystemWatchContext): Promise<void>;
  watch(filename: string, options: { recursive: boolean }, handle: FileSystemWatchHandle): () => void;
  watch(filename: string, handle: FileSystemWatchHandle): () => void;
}

/**
 * Adapter that wraps VersionedVfs to implement modern-monaco's FileSystem interface
 */
export class VfsMonacoAdapter implements FileSystem {
  private watchHandlers = new Map<string, Set<FileSystemWatchHandle>>();
  private eventUnsubscribes: Array<() => void> = [];
  private readonly pathPrefix: string;

  constructor(
    private readonly vfs: VersionedVfs,
    private readonly nodeId: string
  ) {
    // Path prefix used to isolate this VFS from others in Monaco's model system
    this.pathPrefix = `/vfs-${nodeId}`;
    // Subscribe to VFS events and forward them to watch handlers
    this.setupEventForwarding();
  }

  /**
   * TypeScript module resolution extension order
   * When a path has no extension, we try these in order
   */
  private static readonly TS_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx'];
  private static readonly INDEX_FILES = ['index.ts', 'index.tsx', 'index.d.ts', 'index.js', 'index.jsx'];

  /**
   * Normalize path from modern-monaco format to VFS format
   * modern-monaco may pass paths like "services.ts" or "/services.ts" or "file:///vfs-{nodeId}/services.ts"
   * VFS expects paths like "/services.ts"
   */
  private normalizePath(path: string): string {
    // Remove file:// or file:/// prefix
    if (path.startsWith('file:///')) {
      path = path.slice(7); // Remove 'file://'
    } else if (path.startsWith('file://')) {
      path = path.slice(7);
    }
    
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // Remove the vfs-{nodeId} prefix if present
    if (path.startsWith(this.pathPrefix)) {
      path = path.slice(this.pathPrefix.length);
    }
    
    // Ensure path still starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // Remove double slashes
    path = path.replace(/\/+/g, '/');
    
    return path;
  }

  /**
   * Check if a path has a known script extension
   */
  private hasScriptExtension(path: string): boolean {
    const basename = path.substring(path.lastIndexOf('/') + 1);
    return basename.includes('.') && (
      path.endsWith('.ts') ||
      path.endsWith('.tsx') ||
      path.endsWith('.d.ts') ||
      path.endsWith('.js') ||
      path.endsWith('.jsx') ||
      path.endsWith('.mjs') ||
      path.endsWith('.cjs') ||
      path.endsWith('.mts') ||
      path.endsWith('.cts')
    );
  }

  /**
   * Try to resolve a path without extension to an actual file.
   * This implements TypeScript-style module resolution for modern-monaco
   * which doesn't do this automatically for file:// URLs.
   * 
   * Resolution order:
   * 1. path.ts, path.tsx, path.d.ts, path.js, path.jsx
   * 2. path/index.ts, path/index.tsx, path/index.d.ts, path/index.js, path/index.jsx
   */
  private async resolveModulePath(normalizedPath: string): Promise<string | null> {
    // If it already has an extension, check if it exists
    if (this.hasScriptExtension(normalizedPath)) {
      if (await this.vfs.exists(normalizedPath)) {
        return normalizedPath;
      }
      return null;
    }

    // Try adding extensions
    for (const ext of VfsMonacoAdapter.TS_EXTENSIONS) {
      const pathWithExt = normalizedPath + ext;
      if (await this.vfs.exists(pathWithExt)) {
        return pathWithExt;
      }
    }

    // Try index files in directory
    for (const indexFile of VfsMonacoAdapter.INDEX_FILES) {
      const indexPath = normalizedPath + '/' + indexFile;
      if (await this.vfs.exists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  private setupEventForwarding(): void {
    // Forward file:created events
    this.eventUnsubscribes.push(
      this.vfs.events.on('file:created', (event) => {
        this.notifyWatchers('create', event.path, 1);
      })
    );

    // Forward file:updated events
    this.eventUnsubscribes.push(
      this.vfs.events.on('file:updated', (event) => {
        this.notifyWatchers('modify', event.path, 1);
      })
    );

    // Forward file:deleted events
    this.eventUnsubscribes.push(
      this.vfs.events.on('file:deleted', (event) => {
        this.notifyWatchers('remove', event.path, 1);
      })
    );

    // Forward folder events
    this.eventUnsubscribes.push(
      this.vfs.events.on('folder:created', (event) => {
        this.notifyWatchers('create', event.path, 2);
      })
    );

    this.eventUnsubscribes.push(
      this.vfs.events.on('folder:deleted', (event) => {
        this.notifyWatchers('remove', event.path, 2);
      })
    );
  }

  private notifyWatchers(
    kind: 'create' | 'modify' | 'remove',
    filename: string,
    type: FileSystemEntryType,
    context?: FileSystemWatchContext
  ): void {
    // Notify handlers watching this specific path
    const handlers = this.watchHandlers.get(filename);
    if (handlers) {
      for (const handler of handlers) {
        handler(kind, filename, type, context);
      }
    }

    // Notify handlers watching parent directories (for recursive watches)
    for (const [watchPath, pathHandlers] of this.watchHandlers) {
      if (filename.startsWith(watchPath + '/') || watchPath === '/') {
        for (const handler of pathHandlers) {
          handler(kind, filename, type, context);
        }
      }
    }
  }

  /**
   * Clean up event subscriptions
   */
  dispose(): void {
    for (const unsubscribe of this.eventUnsubscribes) {
      unsubscribe();
    }
    this.eventUnsubscribes = [];
    this.watchHandlers.clear();
  }

  // ========== FileSystem Interface Implementation ==========

  async copy(source: string, target: string, options?: { overwrite: boolean }): Promise<void> {
    source = this.normalizePath(source);
    target = this.normalizePath(target);
    
    // Read source file and write to target
    const file = await this.vfs.readFile(source);
    if (!file.content) {
      throw new Error(`Source file is empty: ${source}`);
    }
    const data = file.content;
    
    // Check if target exists
    const exists = await this.vfs.exists(target);
    if (exists && !options?.overwrite) {
      throw new Error(`Target already exists: ${target}`);
    }

    if (exists) {
      await this.vfs.updateFile(target, data);
    } else {
      await this.vfs.createFile(target, data);
    }
  }

  async createDirectory(dir: string): Promise<void> {
    dir = this.normalizePath(dir);
    await this.vfs.createFolder(dir);
  }

  async delete(filename: string, options?: { recursive: boolean }): Promise<void> {
    filename = this.normalizePath(filename);
    const stat = await this.vfs.stat(filename);
    if (stat.isDirectory) {
      await this.vfs.deleteFolder(filename, options?.recursive ?? false);
    } else {
      await this.vfs.deleteFile(filename);
    }
  }

  async readDirectory(filename: string): Promise<[string, number][]> {
    filename = this.normalizePath(filename);
    const entries = await this.vfs.listFolder(filename);
    const result: [string, number][] = [];
    
    for (const entry of entries) {
      // Determine the type: 1 = file, 2 = directory
      // VfsFile has content property, VfsFolder does not
      const isFile = 'content' in entry;
      const entryType: FileSystemEntryType = isFile ? 1 : 2;
      result.push([entry.name, entryType]);
    }
    
    return result;
  }

  async readFile(filename: string): Promise<Uint8Array> {
    filename = this.normalizePath(filename);
    const file = await this.vfs.readFile(filename);
    if (!file.content) {
      return new Uint8Array(0);
    }
    if (typeof file.content === 'string') {
      return new TextEncoder().encode(file.content);
    }
    return file.content instanceof ArrayBuffer 
      ? new Uint8Array(file.content)
      : new Uint8Array(file.content);
  }

  async readTextFile(filename: string): Promise<string> {
    let normalizedPath = this.normalizePath(filename);
    
    // Try to resolve module path if it doesn't have an extension
    if (!this.hasScriptExtension(normalizedPath)) {
      const resolved = await this.resolveModulePath(normalizedPath);
      if (resolved) {
        normalizedPath = resolved;
      }
    }
    
    const file = await this.vfs.readFile(normalizedPath);
    if (typeof file.content === 'string') {
      return file.content;
    }
    return new TextDecoder().decode(file.content);
  }

  async rename(oldName: string, newName: string, options?: { overwrite: boolean }): Promise<void> {
    oldName = this.normalizePath(oldName);
    newName = this.normalizePath(newName);
    
    // Check if target exists
    const exists = await this.vfs.exists(newName);
    if (exists && !options?.overwrite) {
      throw new Error(`Target already exists: ${newName}`);
    }

    await this.vfs.moveItem(oldName, newName);
  }

  async stat(filename: string): Promise<FileStat> {
    let normalizedPath = this.normalizePath(filename);
    
    // Try to resolve module path if it doesn't have an extension
    if (!this.hasScriptExtension(normalizedPath)) {
      const resolved = await this.resolveModulePath(normalizedPath);
      if (resolved) {
        normalizedPath = resolved;
      }
    }
    
    const stat = await this.vfs.stat(normalizedPath);
    
    // Convert to modern-monaco's FileStat format
    const type: FileSystemEntryType = stat.isDirectory ? 2 : stat.isFile ? 1 : 0;
    
    return {
      type,
      ctime: stat.createdAt.getTime(),
      mtime: stat.updatedAt.getTime(),
      version: stat.updatedAt.getTime(), // Use mtime as version
      size: stat.size,
    };
  }

  async writeFile(
    filename: string, 
    content: string | Uint8Array, 
    context?: FileSystemWatchContext
  ): Promise<void> {
    filename = this.normalizePath(filename);
    const exists = await this.vfs.exists(filename);
    
    // Convert Uint8Array to string for VFS compatibility (VFS works better with strings)
    const data: string | ArrayBuffer = typeof content === 'string' 
      ? content 
      : new Uint8Array(content).buffer as ArrayBuffer;
    
    if (exists) {
      await this.vfs.updateFile(filename, data);
    } else {
      await this.vfs.createFile(filename, data);
    }
    
    // If this is a model content change from Monaco, mark it as such
    if (context?.isModelContentChange) {
      this.notifyWatchers('modify', filename, 1, context);
    }
  }

  watch(
    filename: string, 
    optionsOrHandle: { recursive: boolean } | FileSystemWatchHandle,
    handle?: FileSystemWatchHandle
  ): () => void {
    filename = this.normalizePath(filename);
    
    // Handle both overloads
    const actualHandle = typeof optionsOrHandle === 'function' 
      ? optionsOrHandle 
      : handle!;
    const isRecursive = typeof optionsOrHandle === 'object' && optionsOrHandle.recursive;
    
    // Get or create handler set for this path
    if (!this.watchHandlers.has(filename)) {
      this.watchHandlers.set(filename, new Set());
    }
    this.watchHandlers.get(filename)!.add(actualHandle);

    // Scan existing files and notify the handler about them
    // This is crucial for TypeScript module resolution to work with customFS
    this.scanAndNotifyExistingFiles(filename, isRecursive, actualHandle);

    // Return unsubscribe function
    return () => {
      const handlers = this.watchHandlers.get(filename);
      if (handlers) {
        handlers.delete(actualHandle);
        if (handlers.size === 0) {
          this.watchHandlers.delete(filename);
        }
      }
    };
  }

  /**
   * Scan existing files in VFS and notify the handler about them.
   * This is needed because TypeScript worker builds a file map from fsNotify events,
   * and won't know about existing files unless we notify it.
   */
  private async scanAndNotifyExistingFiles(
    path: string, 
    recursive: boolean, 
    handle: FileSystemWatchHandle
  ): Promise<void> {
    try {
      const entries = await this.vfs.listFolder(path);
      for (const entry of entries) {
        const entryPath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
        const isFile = 'content' in entry;
        const type: FileSystemEntryType = isFile ? 1 : 2;
        
        // Notify about this entry
        handle('create', entryPath, type);
        
        // Recurse into directories if recursive watch
        if (!isFile && recursive) {
          await this.scanAndNotifyExistingFiles(entryPath, true, handle);
        }
      }
    } catch (err) {
      // Ignore errors (e.g., path doesn't exist)
      console.debug('[VfsMonacoAdapter] Failed to scan path:', path, err);
    }
  }
}
