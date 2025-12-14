/**
 * In-Memory VFS Provider for Testing
 *
 * A simple in-memory implementation of VfsProvider for bundler tests.
 */

import type { VfsProvider, VfsStat } from '@pubwiki/vfs'

/**
 * In-memory VFS provider implementation
 */
export class MemoryVfsProvider implements VfsProvider {
  private files = new Map<string, Uint8Array>()
  private directories = new Set<string>(['/'])

  private normalizePath(path: string): string {
    if (!path.startsWith('/')) path = '/' + path
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)
    return path
  }

  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.substring(0, lastSlash)
  }

  async id(path: string): Promise<string> {
    return this.normalizePath(path)
  }

  async readFile(path: string): Promise<Uint8Array> {
    const normalized = this.normalizePath(path)
    const content = this.files.get(normalized)
    if (!content) {
      throw new Error(`ENOENT: no such file: ${normalized}`)
    }
    return content
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const normalized = this.normalizePath(path)
    // Ensure parent directory exists
    const parent = this.getParentPath(normalized)
    if (parent !== '/' && !this.directories.has(parent)) {
      await this.mkdir(parent, { recursive: true })
    }
    this.files.set(normalized, content)
  }

  async unlink(path: string): Promise<void> {
    const normalized = this.normalizePath(path)
    if (!this.files.has(normalized)) {
      throw new Error(`ENOENT: no such file: ${normalized}`)
    }
    this.files.delete(normalized)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalizePath(path)
    
    if (options?.recursive) {
      const parts = normalized.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.directories.add(current)
      }
    } else {
      const parent = this.getParentPath(normalized)
      if (parent !== '/' && !this.directories.has(parent)) {
        throw new Error(`ENOENT: no such directory: ${parent}`)
      }
      this.directories.add(normalized)
    }
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path)
    const prefix = normalized === '/' ? '/' : normalized + '/'
    
    const entries = new Set<string>()
    
    // Find files in this directory
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.substring(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }
    
    // Find subdirectories
    for (const dirPath of this.directories) {
      if (dirPath.startsWith(prefix) && dirPath !== normalized) {
        const relative = dirPath.substring(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }
    
    return Array.from(entries)
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalizePath(path)
    
    if (options?.recursive) {
      // Delete all files and subdirectories
      const prefix = normalized + '/'
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(prefix)) {
          this.files.delete(filePath)
        }
      }
      for (const dirPath of this.directories) {
        if (dirPath.startsWith(prefix) || dirPath === normalized) {
          this.directories.delete(dirPath)
        }
      }
    } else {
      const contents = await this.readdir(normalized)
      if (contents.length > 0) {
        throw new Error(`ENOTEMPTY: directory not empty: ${normalized}`)
      }
      this.directories.delete(normalized)
    }
  }

  async stat(path: string): Promise<VfsStat> {
    const normalized = this.normalizePath(path)
    const now = new Date()
    
    if (this.files.has(normalized)) {
      const content = this.files.get(normalized)!
      return {
        isDirectory: false,
        isFile: true,
        size: content.length,
        createdAt: now,
        updatedAt: now
      }
    }
    
    if (this.directories.has(normalized)) {
      return {
        isDirectory: true,
        isFile: false,
        size: 0,
        createdAt: now,
        updatedAt: now
      }
    }
    
    throw new Error(`ENOENT: no such file or directory: ${normalized}`)
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path)
    return this.files.has(normalized) || this.directories.has(normalized)
  }

  async rename(from: string, to: string): Promise<void> {
    const normalizedFrom = this.normalizePath(from)
    const normalizedTo = this.normalizePath(to)
    
    if (this.files.has(normalizedFrom)) {
      const content = this.files.get(normalizedFrom)!
      this.files.delete(normalizedFrom)
      this.files.set(normalizedTo, content)
    } else if (this.directories.has(normalizedFrom)) {
      // Move directory and all contents
      const prefix = normalizedFrom + '/'
      const newPrefix = normalizedTo + '/'
      
      // Move files
      for (const [filePath, content] of this.files.entries()) {
        if (filePath.startsWith(prefix)) {
          const newPath = newPrefix + filePath.substring(prefix.length)
          this.files.delete(filePath)
          this.files.set(newPath, content)
        }
      }
      
      // Move directories
      for (const dirPath of this.directories) {
        if (dirPath === normalizedFrom || dirPath.startsWith(prefix)) {
          this.directories.delete(dirPath)
          const newPath = dirPath === normalizedFrom 
            ? normalizedTo 
            : newPrefix + dirPath.substring(prefix.length)
          this.directories.add(newPath)
        }
      }
    } else {
      throw new Error(`ENOENT: no such file or directory: ${normalizedFrom}`)
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    await this.writeFile(to, content)
  }
}
