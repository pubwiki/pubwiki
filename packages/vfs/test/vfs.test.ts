/**
 * Integration tests for Vfs class with NodeFsProvider
 * 
 * Tests basic file system operations: create, read, update, delete files and folders
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createVfs, Vfs } from '../src'
import { NodeFsProvider } from './providers'

describe('Vfs with NodeFsProvider', () => {
  let testDir: string
  let vfs: Vfs
  let provider: NodeFsProvider

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vfs-test-'))
    provider = new NodeFsProvider(testDir)
    await provider.initialize()
    vfs = createVfs(provider)
    await vfs.initialize()
  })

  afterEach(async () => {
    // Clean up test directory
    await vfs.dispose()
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('File Operations', () => {
    it('should create a file with string content', async () => {
      const file = await vfs.createFile('/hello.txt', 'Hello, World!')

      expect(file.name).toBe('hello.txt')
      expect(file.path).toBe('/hello.txt')
      expect(file.type).toBe('txt')
      expect(file.content).toBe('Hello, World!')

      // Verify file exists on disk
      const diskContent = await fs.readFile(path.join(testDir, 'hello.txt'), 'utf-8')
      expect(diskContent).toBe('Hello, World!')
    })

    it('should create a file with binary content', async () => {
      const binaryContent = new TextEncoder().encode('Binary content')
      const file = await vfs.createFile('/binary.bin', binaryContent.buffer)

      expect(file.name).toBe('binary.bin')
      expect(file.type).toBe('bin')
      expect(file.size).toBe(binaryContent.length)
    })

    it('should create parent directories automatically', async () => {
      const file = await vfs.createFile('/deep/nested/path/file.txt', 'nested content')

      expect(file.path).toBe('/deep/nested/path/file.txt')

      // Verify directories were created
      const stats = await fs.stat(path.join(testDir, 'deep/nested/path'))
      expect(stats.isDirectory()).toBe(true)
    })

    it('should read a file', async () => {
      // Create file first
      await vfs.createFile('/read-test.txt', 'Content to read')

      // Read it back
      const file = await vfs.readFile('/read-test.txt')

      expect(file.name).toBe('read-test.txt')
      expect(file.content).toBeInstanceOf(ArrayBuffer)
      const content = new TextDecoder().decode(file.content as ArrayBuffer)
      expect(content).toBe('Content to read')
    })

    it('should update a file', async () => {
      // Create file
      await vfs.createFile('/update-test.txt', 'Original content')

      // Update it
      const updated = await vfs.updateFile('/update-test.txt', 'Updated content')

      expect(updated.name).toBe('update-test.txt')

      // Verify on disk
      const diskContent = await fs.readFile(path.join(testDir, 'update-test.txt'), 'utf-8')
      expect(diskContent).toBe('Updated content')
    })

    it('should delete a file', async () => {
      // Create file
      await vfs.createFile('/delete-test.txt', 'To be deleted')

      // Delete it
      await vfs.deleteFile('/delete-test.txt')

      // Verify it's gone
      const exists = await vfs.exists('/delete-test.txt')
      expect(exists).toBe(false)
    })

    it('should check if file exists', async () => {
      expect(await vfs.exists('/nonexistent.txt')).toBe(false)

      await vfs.createFile('/exists-test.txt', 'content')

      expect(await vfs.exists('/exists-test.txt')).toBe(true)
    })

    it('should get file stats', async () => {
      await vfs.createFile('/stats-test.txt', 'Some content')

      const stats = await vfs.stat('/stats-test.txt')

      expect(stats.isFile).toBe(true)
      expect(stats.isDirectory).toBe(false)
      expect(stats.size).toBe(12) // 'Some content'.length
      expect(stats.createdAt).toBeInstanceOf(Date)
      expect(stats.updatedAt).toBeInstanceOf(Date)
    })
  })

  describe('Folder Operations', () => {
    it('should create a folder', async () => {
      const folder = await vfs.createFolder('/my-folder')

      expect(folder.name).toBe('my-folder')
      expect(folder.path).toBe('/my-folder')

      // Verify on disk
      const stats = await fs.stat(path.join(testDir, 'my-folder'))
      expect(stats.isDirectory()).toBe(true)
    })

    it('should create nested folders', async () => {
      const folder = await vfs.createFolder('/a/b/c')

      expect(folder.path).toBe('/a/b/c')

      // Verify all directories exist
      expect((await fs.stat(path.join(testDir, 'a'))).isDirectory()).toBe(true)
      expect((await fs.stat(path.join(testDir, 'a/b'))).isDirectory()).toBe(true)
      expect((await fs.stat(path.join(testDir, 'a/b/c'))).isDirectory()).toBe(true)
    })

    it('should list folder contents', async () => {
      // Create some files and folders
      await vfs.createFile('/folder/file1.txt', 'content1')
      await vfs.createFile('/folder/file2.txt', 'content2')
      await vfs.createFolder('/folder/subfolder')

      const items = await vfs.listFolder('/folder')

      expect(items.length).toBe(3)

      const names = items.map(i => i.name)
      expect(names).toContain('file1.txt')
      expect(names).toContain('file2.txt')
      expect(names).toContain('subfolder')
    })

    it('should delete an empty folder', async () => {
      await vfs.createFolder('/empty-folder')
      await vfs.deleteFolder('/empty-folder')

      expect(await vfs.exists('/empty-folder')).toBe(false)
    })

    it('should delete a folder recursively', async () => {
      await vfs.createFile('/recursive/file1.txt', 'content')
      await vfs.createFile('/recursive/sub/file2.txt', 'content')

      await vfs.deleteFolder('/recursive', true)

      expect(await vfs.exists('/recursive')).toBe(false)
    })

    it('should get folder stats', async () => {
      await vfs.createFolder('/folder-stats')

      const stats = await vfs.stat('/folder-stats')

      expect(stats.isFile).toBe(false)
      expect(stats.isDirectory).toBe(true)
    })
  })

  describe('Move and Copy Operations', () => {
    it('should move a file', async () => {
      await vfs.createFile('/source.txt', 'content')

      await vfs.moveItem('/source.txt', '/destination.txt')

      expect(await vfs.exists('/source.txt')).toBe(false)
      expect(await vfs.exists('/destination.txt')).toBe(true)

      const file = await vfs.readFile('/destination.txt')
      const content = new TextDecoder().decode(file.content as ArrayBuffer)
      expect(content).toBe('content')
    })

    it('should move a file to a different directory', async () => {
      await vfs.createFile('/file.txt', 'content')
      await vfs.createFolder('/target')

      await vfs.moveItem('/file.txt', '/target/file.txt')

      expect(await vfs.exists('/file.txt')).toBe(false)
      expect(await vfs.exists('/target/file.txt')).toBe(true)
    })

    it('should copy a file', async () => {
      await vfs.createFile('/original.txt', 'original content')

      await vfs.copyItem('/original.txt', '/copy.txt')

      expect(await vfs.exists('/original.txt')).toBe(true)
      expect(await vfs.exists('/copy.txt')).toBe(true)

      const original = await vfs.readFile('/original.txt')
      const copy = await vfs.readFile('/copy.txt')

      const originalContent = new TextDecoder().decode(original.content as ArrayBuffer)
      const copyContent = new TextDecoder().decode(copy.content as ArrayBuffer)

      expect(originalContent).toBe(copyContent)
    })
  })

  describe('Event System', () => {
    it('should emit file:created event', async () => {
      const events: unknown[] = []
      vfs.events.on('file:created', (event) => {
        events.push(event)
      })

      await vfs.createFile('/event-test.txt', 'content')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('file:created')
      expect((events[0] as { path: string }).path).toBe('/event-test.txt')
    })

    it('should emit file:updated event', async () => {
      await vfs.createFile('/update-event.txt', 'original')

      const events: unknown[] = []
      vfs.events.on('file:updated', (event) => {
        events.push(event)
      })

      await vfs.updateFile('/update-event.txt', 'updated')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('file:updated')
    })

    it('should emit file:deleted event', async () => {
      await vfs.createFile('/delete-event.txt', 'content')

      const events: unknown[] = []
      vfs.events.on('file:deleted', (event) => {
        events.push(event)
      })

      await vfs.deleteFile('/delete-event.txt')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('file:deleted')
    })

    it('should emit folder:created event', async () => {
      const events: unknown[] = []
      vfs.events.on('folder:created', (event) => {
        events.push(event)
      })

      await vfs.createFolder('/event-folder')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('folder:created')
    })

    it('should emit file:moved event', async () => {
      await vfs.createFile('/move-source.txt', 'content')

      const events: unknown[] = []
      vfs.events.on('file:moved', (event) => {
        events.push(event)
      })

      await vfs.moveItem('/move-source.txt', '/move-dest.txt')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('file:moved')
      expect((events[0] as { fromPath: string }).fromPath).toBe('/move-source.txt')
      expect((events[0] as { toPath: string }).toPath).toBe('/move-dest.txt')
    })

    it('should support once() for one-time event listening', async () => {
      let callCount = 0
      vfs.events.once('file:created', () => {
        callCount++
      })

      await vfs.createFile('/once1.txt', 'content')
      await vfs.createFile('/once2.txt', 'content')

      expect(callCount).toBe(1)
    })

    it('should support onAny() for listening to all events', async () => {
      const events: unknown[] = []
      vfs.events.onAny((event) => {
        events.push(event)
      })

      await vfs.createFile('/any1.txt', 'content')
      await vfs.createFolder('/any-folder')

      expect(events.length).toBe(2)
    })

    it('should emit folder:moved event when moving a folder', async () => {
      await vfs.createFolder('/source-folder')

      const events: unknown[] = []
      vfs.events.on('folder:moved', (event) => {
        events.push(event)
      })

      await vfs.moveItem('/source-folder', '/dest-folder')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('folder:moved')
      expect((events[0] as { fromPath: string }).fromPath).toBe('/source-folder')
      expect((events[0] as { toPath: string }).toPath).toBe('/dest-folder')
    })

    it('should emit recursive events when moving a folder with contents', async () => {
      // Create folder with files and subfolders
      await vfs.createFile('/parent/file1.txt', 'content1')
      await vfs.createFile('/parent/file2.txt', 'content2')
      await vfs.createFile('/parent/sub/file3.txt', 'content3')

      const movedEvents: unknown[] = []
      vfs.events.on('file:moved', (event) => { movedEvents.push(event) })
      vfs.events.on('folder:moved', (event) => { movedEvents.push(event) })

      await vfs.moveItem('/parent', '/new-parent')

      // Should emit events for: parent folder + sub folder + 3 files = 5 events
      expect(movedEvents.length).toBe(5)

      // Verify parent folder moved
      const folderEvents = movedEvents.filter(e => (e as { type: string }).type === 'folder:moved')
      expect(folderEvents.length).toBe(2) // parent and sub

      // Verify files moved
      const fileEvents = movedEvents.filter(e => (e as { type: string }).type === 'file:moved')
      expect(fileEvents.length).toBe(3)
    })

    it('should emit recursive events when deleting a folder with contents', async () => {
      // Create folder with files and subfolders
      await vfs.createFile('/to-delete/file1.txt', 'content1')
      await vfs.createFile('/to-delete/sub/file2.txt', 'content2')

      const deletedEvents: unknown[] = []
      vfs.events.on('file:deleted', (event) => { deletedEvents.push(event) })
      vfs.events.on('folder:deleted', (event) => { deletedEvents.push(event) })

      await vfs.deleteFolder('/to-delete', true)

      // Should emit events for: 2 files + sub folder + parent folder = 4 events
      expect(deletedEvents.length).toBe(4)

      // Verify files deleted
      const fileEvents = deletedEvents.filter(e => (e as { type: string }).type === 'file:deleted')
      expect(fileEvents.length).toBe(2)

      // Verify folders deleted
      const folderEvents = deletedEvents.filter(e => (e as { type: string }).type === 'folder:deleted')
      expect(folderEvents.length).toBe(2)
    })

    it('should emit file:created event when copying a file', async () => {
      await vfs.createFile('/original-copy.txt', 'content')

      const events: unknown[] = []
      vfs.events.on('file:created', (event) => {
        events.push(event)
      })

      await vfs.copyItem('/original-copy.txt', '/copied.txt')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('file:created')
      expect((events[0] as { path: string }).path).toBe('/copied.txt')
    })

    it('should emit folder:deleted event when deleting empty folder', async () => {
      await vfs.createFolder('/empty-folder-event')

      const events: unknown[] = []
      vfs.events.on('folder:deleted', (event) => {
        events.push(event)
      })

      await vfs.deleteFolder('/empty-folder-event')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('folder:deleted')
      expect((events[0] as { path: string }).path).toBe('/empty-folder-event')
    })
  })

  describe('Path Handling', () => {
    it('should handle paths without leading slash', async () => {
      // The Vfs class normalizes paths internally
      await vfs.createFile('no-slash.txt', 'content')

      expect(await vfs.exists('/no-slash.txt')).toBe(true)
    })

    it('should handle paths with multiple slashes', async () => {
      await vfs.createFile('///multiple///slashes.txt', 'content')

      expect(await vfs.exists('/multiple/slashes.txt')).toBe(true)
    })

    it('should handle root path operations', async () => {
      const items = await vfs.listFolder('/')

      // Initially empty or contains only hidden files
      const visibleItems = items.filter(i => !i.name.startsWith('.'))
      expect(visibleItems.length).toBe(0)
    })
  })

  describe('Error Handling', () => {
    it('should throw error when reading non-existent file', async () => {
      await expect(vfs.readFile('/nonexistent.txt')).rejects.toThrow()
    })

    it('should throw error when deleting non-existent file', async () => {
      await expect(vfs.deleteFile('/nonexistent.txt')).rejects.toThrow()
    })

    it('should throw error when deleting non-empty folder without recursive flag', async () => {
      await vfs.createFile('/non-empty/file.txt', 'content')

      await expect(vfs.deleteFolder('/non-empty', false)).rejects.toThrow()
    })

    it('should throw error when VFS is disposed', async () => {
      await vfs.dispose()

      await expect(vfs.createFile('/after-dispose.txt', 'content')).rejects.toThrow('disposed')
    })
  })
})
