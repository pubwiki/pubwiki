/**
 * File type - matches VS Code's FileType values
 */
export type FileType = 'unknown' | 'file' | 'directory' | 'symlink';

/**
 * File metadata returned by stat operations
 */
export interface FileStat {
  type: FileType;
  size: number;
  mtime: number;
  ctime: number;
}

/**
 * File change type for notifications
 */
export type FileChangeType = 'changed' | 'created' | 'deleted';

/**
 * File change event
 */
export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
}

/**
 * Callback function type for file change notifications
 * When passed over RPC, capnweb automatically creates a stub that calls back to the original
 */
export type FileChangeCallback = (changes: FileChangeEvent[]) => void;

/**
 * RPC interface for communication between vfs-extension and browser-client
 * This defines the contract for file system operations over WebSocket RPC
 */
export interface IVirtualFileSystem {
  stat(path: string): Promise<FileStat>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  readDirectory(path: string): Promise<Array<[string, FileType]>>;
  createDirectory(path: string): Promise<void>;
  delete(path: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /**
   * Register a callback function for file change notifications.
   * The callback is passed over RPC and will be invoked when files change.
   */
  onFileChange(callback: FileChangeCallback): Promise<void>;
}
