/**
 * Test VFS Helper
 *
 * Creates a real Vfs instance with in-memory backend for testing.
 */

import { Vfs } from '@pubwiki/vfs'
import { MemoryVfsProvider } from './memory-vfs-provider'

/**
 * Create a Vfs instance with in-memory backend for testing
 */
export function createTestVfs(): Vfs {
  const provider = new MemoryVfsProvider()
  return new Vfs(provider)
}

/**
 * Helper to add a file to VFS (convenience wrapper)
 */
export async function addFile(vfs: Vfs, path: string, content: string): Promise<void> {
  await vfs.createFile(path, content)
}

/**
 * Helper to update a file in VFS
 */
export async function updateFile(vfs: Vfs, path: string, content: string): Promise<void> {
  await vfs.updateFile(path, content)
}

/**
 * Helper to delete a file from VFS
 */
export async function deleteFile(vfs: Vfs, path: string): Promise<void> {
  await vfs.deleteFile(path)
}

/**
 * Helper to read file content as string
 */
export async function readFileContent(vfs: Vfs, path: string): Promise<string | null> {
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
