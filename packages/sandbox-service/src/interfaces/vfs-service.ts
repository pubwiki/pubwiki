/**
 * VFS Service Interface
 *
 * Defines the RPC interface for Virtual File System operations.
 * This service runs on the main site and is accessed by sandbox applications.
 *
 * Uses capnweb RpcTarget for type-safe RPC communication.
 */

import type {
  FileInfo,
  FileExistsResult,
  DirectoryEntry,
  ReadFileOptions,
} from '../types/vfs'

/**
 * VFS Service - runs on main site, consumed by sandbox apps
 *
 * Provides file system read operations for the sandbox environment.
 * Service Worker uses this to proxy static resources (images, CSS, etc.).
 */
export interface IVfsService {
  /**
   * Read a file from the virtual file system
   * @param path - Relative path from the workspace base
   * @param options - Read options (encoding, etc.)
   * @returns File information including content and MIME type
   */
  readFile(path: string, options?: ReadFileOptions): Promise<FileInfo>

  /**
   * Check if a file or directory exists
   * @param path - Relative path to check
   * @returns Existence result with directory flag
   */
  fileExists(path: string): Promise<FileExistsResult>

  /**
   * List contents of a directory
   * @param path - Directory path (relative)
   * @returns Array of directory entries
   */
  listDir(path: string): Promise<DirectoryEntry[]>

  /**
   * Get the MIME type for a file path
   * @param path - File path
   * @returns MIME type string
   */
  getMimeType(path: string): string
}
