/**
 * Instrumented OPFS Mock for Node.js testing.
 *
 * Implements the full FileSystemDirectoryHandle / FileSystemFileHandle /
 * FileSystemWritableFileStream API surface used by OpfsProvider, with
 * a global audit registry that tracks:
 *
 *  - Every handle that was created
 *  - Every WritableFileStream that was opened and whether it was closed
 *  - Current open handle count
 *
 * Usage:
 *   const registry = installOpfsMock();      // patches globalThis.navigator
 *   // ... run code under test ...
 *   registry.assertNoLeaks();                // throws if streams left open
 *   registry.reset();                        // wipe all state for next test
 *   uninstallOpfsMock();                     // restore original navigator
 */

// ============================================================
// Audit Registry
// ============================================================

export interface HandleAuditEntry {
  kind: 'file' | 'directory';
  name: string;
  createdAt: number;   // Date.now()
}

export interface WritableAuditEntry {
  path: string;
  openedAt: number;
  closedAt: number | null;
}

export class OpfsAuditRegistry {
  handles: HandleAuditEntry[] = [];
  writables: WritableAuditEntry[] = [];

  recordHandle(kind: 'file' | 'directory', name: string): void {
    this.handles.push({ kind, name, createdAt: Date.now() });
  }

  recordWritableOpen(path: string): WritableAuditEntry {
    const entry: WritableAuditEntry = { path, openedAt: Date.now(), closedAt: null };
    this.writables.push(entry);
    return entry;
  }

  get openWritables(): WritableAuditEntry[] {
    return this.writables.filter(w => w.closedAt === null);
  }

  get totalHandleCount(): number {
    return this.handles.length;
  }

  /** Throws an Error listing all unclosed WritableFileStreams */
  assertNoLeaks(): void {
    const leaks = this.openWritables;
    if (leaks.length > 0) {
      const details = leaks.map(l => `  - ${l.path} (opened ${l.openedAt})`).join('\n');
      throw new Error(`WritableFileStream leak detected!\n${leaks.length} unclosed stream(s):\n${details}`);
    }
  }

  reset(): void {
    this.handles.length = 0;
    this.writables.length = 0;
  }
}

// ============================================================
// Mock File System (in-memory tree)
// ============================================================

type FsNode = FsFile | FsDir;

interface FsFile {
  kind: 'file';
  name: string;
  data: Uint8Array;
  lastModified: number;
}

interface FsDir {
  kind: 'directory';
  name: string;
  children: Map<string, FsNode>;
}

function createDir(name: string): FsDir {
  return { kind: 'directory', name, children: new Map() };
}

function createFile(name: string, data: Uint8Array = new Uint8Array(0)): FsFile {
  return { kind: 'file', name, data, lastModified: Date.now() };
}

// ============================================================
// Mock WritableFileStream
// ============================================================

class MockWritableFileStream {
  private file: FsFile;
  private auditEntry: WritableAuditEntry;
  private closed = false;
  private pendingData: Uint8Array | null = null;

  constructor(file: FsFile, auditEntry: WritableAuditEntry) {
    this.file = file;
    this.auditEntry = auditEntry;
  }

  async write(data: ArrayBuffer | Uint8Array | string): Promise<void> {
    if (this.closed) throw new DOMException('Stream is closed', 'InvalidStateError');
    if (typeof data === 'string') {
      this.pendingData = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      this.pendingData = new Uint8Array(data);
    } else {
      this.pendingData = new Uint8Array(data);
    }
  }

  async close(): Promise<void> {
    if (this.closed) throw new DOMException('Already closed', 'InvalidStateError');
    // Commit pending data
    if (this.pendingData) {
      this.file.data = this.pendingData;
      this.file.lastModified = Date.now();
      this.pendingData = null;
    }
    this.closed = true;
    this.auditEntry.closedAt = Date.now();
  }

  async abort(): Promise<void> {
    this.pendingData = null;
    this.closed = true;
    this.auditEntry.closedAt = Date.now();
  }
}

// ============================================================
// Mock FileSystemFileHandle
// ============================================================

class MockFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  private file: FsFile;
  private registry: OpfsAuditRegistry;
  private pathHint: string;

  constructor(file: FsFile, registry: OpfsAuditRegistry, pathHint: string) {
    this.file = file;
    this.name = file.name;
    this.registry = registry;
    this.pathHint = pathHint;
    registry.recordHandle('file', file.name);
  }

  async getFile(): Promise<{ size: number; lastModified: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }> {
    const data = this.file.data;
    return {
      size: data.byteLength,
      lastModified: this.file.lastModified,
      async arrayBuffer() { return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength); },
      async text() { return new TextDecoder().decode(data); },
    };
  }

  async createWritable(): Promise<MockWritableFileStream> {
    const entry = this.registry.recordWritableOpen(this.pathHint);
    return new MockWritableFileStream(this.file, entry);
  }
}

// ============================================================
// Mock FileSystemDirectoryHandle
// ============================================================

class MockDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  private dir: FsDir;
  private registry: OpfsAuditRegistry;
  private pathPrefix: string;

  constructor(dir: FsDir, registry: OpfsAuditRegistry, pathPrefix: string) {
    this.dir = dir;
    this.name = dir.name;
    this.registry = registry;
    this.pathPrefix = pathPrefix;
    registry.recordHandle('directory', dir.name);
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MockDirectoryHandle> {
    let child = this.dir.children.get(name);
    if (child && child.kind === 'directory') {
      return new MockDirectoryHandle(child, this.registry, `${this.pathPrefix}/${name}`);
    }
    if (child && child.kind === 'file') {
      throw new DOMException(`"${name}" is a file, not a directory`, 'TypeMismatchError');
    }
    if (!child && options?.create) {
      const newDir = createDir(name);
      this.dir.children.set(name, newDir);
      return new MockDirectoryHandle(newDir, this.registry, `${this.pathPrefix}/${name}`);
    }
    throw new DOMException(`Directory "${name}" not found`, 'NotFoundError');
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MockFileHandle> {
    let child = this.dir.children.get(name);
    if (child && child.kind === 'file') {
      return new MockFileHandle(child, this.registry, `${this.pathPrefix}/${name}`);
    }
    if (child && child.kind === 'directory') {
      throw new DOMException(`"${name}" is a directory, not a file`, 'TypeMismatchError');
    }
    if (!child && options?.create) {
      const newFile = createFile(name);
      this.dir.children.set(name, newFile);
      return new MockFileHandle(newFile, this.registry, `${this.pathPrefix}/${name}`);
    }
    throw new DOMException(`File "${name}" not found`, 'NotFoundError');
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const child = this.dir.children.get(name);
    if (!child) {
      throw new DOMException(`Entry "${name}" not found`, 'NotFoundError');
    }
    if (child.kind === 'directory' && child.children.size > 0 && !options?.recursive) {
      throw new DOMException(`Directory "${name}" is not empty`, 'InvalidModificationError');
    }
    this.dir.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, MockFileHandle | MockDirectoryHandle]> {
    for (const [name, node] of this.dir.children) {
      if (node.kind === 'file') {
        yield [name, new MockFileHandle(node, this.registry, `${this.pathPrefix}/${name}`)];
      } else {
        yield [name, new MockDirectoryHandle(node, this.registry, `${this.pathPrefix}/${name}`)];
      }
    }
  }

  // Needed for `for await (const [name] of dir.entries())`
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, MockFileHandle | MockDirectoryHandle]> {
    return this.entries();
  }
}

// ============================================================
// Install / Uninstall
// ============================================================

let originalNavigator: PropertyDescriptor | undefined;
let rootDir: FsDir | null = null;
let currentRegistry: OpfsAuditRegistry | null = null;

/**
 * Install the OPFS mock onto `globalThis.navigator.storage.getDirectory()`.
 * Returns the audit registry for asserting resource leaks.
 */
export function installOpfsMock(): OpfsAuditRegistry {
  const registry = new OpfsAuditRegistry();
  currentRegistry = registry;
  rootDir = createDir('');

  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const storage = {
    async getDirectory(): Promise<MockDirectoryHandle> {
      return new MockDirectoryHandle(rootDir!, registry, '');
    },
    async estimate() { return { quota: 1e9, usage: 0 }; },
    async persist() { return true; },
    async persisted() { return true; },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav: any = globalThis.navigator ?? {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { ...nav, storage },
    writable: true,
    configurable: true,
  });

  return registry;
}

/**
 * Restore the original `navigator`.
 */
export function uninstallOpfsMock(): void {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
    originalNavigator = undefined;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).navigator;
  }
  rootDir = null;
  currentRegistry = null;
}

/**
 * Get the current audit registry (convenience for tests).
 */
export function getAuditRegistry(): OpfsAuditRegistry {
  if (!currentRegistry) throw new Error('OPFS mock not installed');
  return currentRegistry;
}
