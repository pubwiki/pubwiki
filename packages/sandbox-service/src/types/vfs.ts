/**
 * VFS (Virtual File System) Types
 *
 * Types for Virtual File System operations exposed to sandbox applications.
 * These types define the interface for reading files from the main site's VFS.
 */

/**
 * File content type - can be text or binary
 */
export type FileContent = string | Uint8Array

/**
 * File information returned from VFS operations
 */
export interface FileInfo {
  /** Relative path from workspace root */
  path: string
  /** File content (text or binary) */
  content: FileContent
  /** MIME type of the file */
  mimeType: string
  /** File size in bytes */
  size: number
  /** Last modification timestamp */
  lastModified?: number
}

/**
 * Result of file existence check
 */
export interface FileExistsResult {
  exists: boolean
  isDirectory?: boolean
}

/**
 * Directory entry information
 */
export interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified?: number
}

/**
 * File read options
 */
export interface ReadFileOptions {
  /** Encoding for text files (default: 'utf-8') */
  encoding?: 'utf-8' | 'binary'
}
