/**
 * VFS Adapter
 *
 * Provides access to the Virtual File System from the worker.
 * Uses Comlink to communicate with the main thread.
 * 
 * Note: The VFS is passed from main thread via Comlink proxy.
 */

import type { Vfs } from '@pubwiki/vfs'

let vfs: Vfs | null = null

/**
 * Set the VFS instance
 * Called during initialization
 */
export function setVFS(instance: Vfs): void {
  vfs = instance
  console.log('[VFSAdapter] VFS set')
}

/**
 * Get the VFS instance
 */
export function getVFS(): Vfs | null {
  return vfs
}

/**
 * Check if VFS is available
 */
export function hasVFS(): boolean {
  return vfs !== null
}

/**
 * Read a file from the VFS
 * @param path File path
 * @returns File content as string or null if not found
 */
export async function readFile(path: string): Promise<string | null> {
  if (!vfs) {
    throw new Error('[VFSAdapter] VFS not initialized')
  }
  try {
    const file = await vfs.readFile(path)
    if (file.content === null) return null
    if (file.content instanceof ArrayBuffer) {
      return new TextDecoder().decode(file.content)
    }
    return file.content as string
  } catch {
    return null
  }
}

/**
 * Check if a file exists in the VFS
 * @param path File path
 * @returns True if file exists
 */
export async function exists(path: string): Promise<boolean> {
  if (!vfs) {
    throw new Error('[VFSAdapter] VFS not initialized')
  }
  return vfs.exists(path)
}

/**
 * List directory contents
 * @param path Directory path
 * @returns Array of file/directory names
 */
export async function readDir(path: string): Promise<string[]> {
  if (!vfs) {
    throw new Error('[VFSAdapter] VFS not initialized')
  }
  const items = await vfs.listFolder(path)
  return items.map(item => item.name)
}

/**
 * Create a file loader function
 * Used by esbuild plugin
 */
export function createFileLoader() {
  return async (path: string): Promise<string> => {
    const content = await readFile(path)
    if (content === null) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }
}

/**
 * Create a file exists checker
 * Used by dependency resolver
 */
export function createFileExistsChecker() {
  return async (path: string): Promise<boolean> => {
    return exists(path)
  }
}
