/**
 * NodeFsProvider - VfsProvider implementation using Node.js fs module
 * 
 * This provider is for testing purposes and demonstrates how to implement
 * a VfsProvider using the native Node.js file system.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { VfsProvider, VfsStat } from '../../src'

/**
 * VfsProvider implementation using Node.js fs module
 */
export class NodeFsProvider implements VfsProvider {
  constructor(private readonly rootDir: string) {}

  private resolvePath(filePath: string): string {
    // Normalize and resolve to absolute path within rootDir
    const normalized = path.normalize(filePath).replace(/^\/+/, '')
    return path.join(this.rootDir, normalized)
  }

  async id(filePath: string): Promise<string> {
    // Generate a stable ID based on the path
    const hash = createHash('sha256')
    hash.update(filePath)
    return hash.digest('hex').slice(0, 16)
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const fullPath = this.resolvePath(filePath)
    const buffer = await fs.readFile(fullPath)
    return new Uint8Array(buffer)
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const fullPath = this.resolvePath(filePath)
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
  }

  async unlink(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath)
    await fs.unlink(fullPath)
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(dirPath)
    await fs.mkdir(fullPath, { recursive: options?.recursive ?? false })
  }

  async readdir(dirPath: string): Promise<string[]> {
    const fullPath = this.resolvePath(dirPath)
    return await fs.readdir(fullPath)
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(dirPath)
    if (options?.recursive) {
      await fs.rm(fullPath, { recursive: true, force: true })
    } else {
      await fs.rmdir(fullPath)
    }
  }

  async stat(filePath: string): Promise<VfsStat> {
    const fullPath = this.resolvePath(filePath)
    const stats = await fs.stat(fullPath)
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath)
    try {
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const fullFrom = this.resolvePath(from)
    const fullTo = this.resolvePath(to)
    // Ensure target directory exists
    await fs.mkdir(path.dirname(fullTo), { recursive: true })
    await fs.rename(fullFrom, fullTo)
  }

  async copyFile(from: string, to: string): Promise<void> {
    const fullFrom = this.resolvePath(from)
    const fullTo = this.resolvePath(to)
    // Ensure target directory exists
    await fs.mkdir(path.dirname(fullTo), { recursive: true })
    await fs.copyFile(fullFrom, fullTo)
  }

  async initialize(): Promise<void> {
    // Ensure root directory exists
    await fs.mkdir(this.rootDir, { recursive: true })
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
