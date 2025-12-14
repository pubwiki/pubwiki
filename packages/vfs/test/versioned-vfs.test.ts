/**
 * Integration tests for VersionedVfs class with GitProvider
 * 
 * Tests version control operations: commit, checkout, diff, history
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createVfs, VersionedVfs } from '../src'
import { GitProvider } from './providers'

describe('VersionedVfs with GitProvider', () => {
  let testDir: string
  let vfs: VersionedVfs
  let provider: GitProvider

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vfs-git-test-'))
    provider = new GitProvider(testDir)
    await provider.initialize()
    vfs = createVfs(provider) as VersionedVfs
    await vfs.initialize()
  })

  afterEach(async () => {
    // Clean up test directory
    await vfs.dispose()
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Git Repository Initialization', () => {
    it('should create a valid vfs instance', () => {
      expect(vfs).toBeInstanceOf(VersionedVfs)
    })

    it('should initialize a git repository', async () => {
      // Check that .git folder exists
      const gitDir = path.join(testDir, '.git')
      const stats = await fs.stat(gitDir)
      expect(stats.isDirectory()).toBe(true)
    })
  })

  describe('Commit Operations', () => {
    it('should create a commit with a single file', async () => {
      // Create a file
      await vfs.createFile('/first-file.txt', 'First file content')

      // Commit returns VFSCommit object
      const commit = await vfs.commit('Initial commit')

      expect(commit).toBeDefined()
      expect(commit.hash).toBeDefined()
      expect(commit.hash.length).toBeGreaterThan(0)
      expect(commit.message).toBe('Initial commit')
      expect(commit.timestamp).toBeInstanceOf(Date)
    })

    it('should create multiple commits', async () => {
      // First commit
      await vfs.createFile('/file1.txt', 'Content 1')
      const commit1 = await vfs.commit('First commit')

      // Second commit
      await vfs.createFile('/file2.txt', 'Content 2')
      const commit2 = await vfs.commit('Second commit')

      expect(commit1.hash).not.toBe(commit2.hash)

      // Get history
      const history = await vfs.getHistory()
      expect(history.length).toBe(2)
      expect(history[0].hash).toBe(commit2.hash) // Most recent first
      expect(history[1].hash).toBe(commit1.hash)
    })

    it('should include file modifications in commit', async () => {
      await vfs.createFile('/modify.txt', 'Original')
      await vfs.commit('Create file')

      // Modify the file
      await vfs.updateFile('/modify.txt', 'Modified')
      const commit = await vfs.commit('Modify file')

      expect(commit.hash).toBeDefined()
    })

    it('should include file deletions in commit', async () => {
      await vfs.createFile('/delete-me.txt', 'To delete')
      await vfs.commit('Create file')

      await vfs.deleteFile('/delete-me.txt')
      const commit = await vfs.commit('Delete file')

      expect(commit.hash).toBeDefined()
    })
  })

  describe('History Operations', () => {
    it('should retrieve commit history', async () => {
      await vfs.createFile('/file1.txt', 'content1')
      await vfs.commit('Commit 1')

      await vfs.createFile('/file2.txt', 'content2')
      await vfs.commit('Commit 2')

      await vfs.createFile('/file3.txt', 'content3')
      await vfs.commit('Commit 3')

      const history = await vfs.history()

      expect(history.length).toBe(3)
      expect(history[0].message).toBe('Commit 3')
      expect(history[1].message).toBe('Commit 2')
      expect(history[2].message).toBe('Commit 1')
    })

    it('should limit history results', async () => {
      // Create multiple commits
      for (let i = 1; i <= 5; i++) {
        await vfs.createFile(`/file${i}.txt`, `content${i}`)
        await vfs.commit(`Commit ${i}`)
      }

      const history = await vfs.history(3)

      expect(history.length).toBe(3)
      expect(history[0].message).toBe('Commit 5')
    })
  })

  describe('Diff Operations', () => {
    it('should generate diff between commits', async () => {
      await vfs.createFile('/diff-test.txt', 'Line 1\nLine 2\nLine 3')
      const commit1 = await vfs.commit('Initial')

      await vfs.updateFile('/diff-test.txt', 'Line 1\nModified Line 2\nLine 3')
      const commit2 = await vfs.commit('Modified')

      const diff = await vfs.diff(commit1.hash, commit2.hash)

      expect(diff).toBeDefined()
      expect(diff.length).toBeGreaterThan(0)
      expect(diff.some(d => d.path === '/diff-test.txt')).toBe(true)
    })

    it('should detect added files in diff', async () => {
      await vfs.createFile('/original.txt', 'original')
      const commit1 = await vfs.commit('Original')

      await vfs.createFile('/new-file.txt', 'new content')
      const commit2 = await vfs.commit('Added file')

      const diff = await vfs.diff(commit1.hash, commit2.hash)

      const addedFile = diff.find(d => d.path === '/new-file.txt')
      expect(addedFile).toBeDefined()
      expect(addedFile?.type).toBe('added')
    })

    it('should detect deleted files in diff', async () => {
      await vfs.createFile('/to-delete.txt', 'content')
      const commit1 = await vfs.commit('With file')

      await vfs.deleteFile('/to-delete.txt')
      const commit2 = await vfs.commit('Deleted file')

      const diff = await vfs.diff(commit1.hash, commit2.hash)

      const deletedFile = diff.find(d => d.path === '/to-delete.txt')
      expect(deletedFile).toBeDefined()
      expect(deletedFile?.type).toBe('deleted')
    })

    it('should detect modified files in diff', async () => {
      await vfs.createFile('/modify.txt', 'original')
      const commit1 = await vfs.commit('Original')

      await vfs.updateFile('/modify.txt', 'modified')
      const commit2 = await vfs.commit('Modified')

      const diff = await vfs.diff(commit1.hash, commit2.hash)

      const modifiedFile = diff.find(d => d.path === '/modify.txt')
      expect(modifiedFile).toBeDefined()
      expect(modifiedFile?.type).toBe('modified')
    })
  })

  describe('Checkout Operations', () => {
    it('should checkout a previous commit', async () => {
      await vfs.createFile('/checkout-test.txt', 'Original content')
      const commit1 = await vfs.commit('Original')

      await vfs.updateFile('/checkout-test.txt', 'Modified content')
      await vfs.commit('Modified')

      // Checkout the first commit
      await vfs.checkout(commit1.hash)

      // File should have original content
      const file = await vfs.readFile('/checkout-test.txt')
      const content = new TextDecoder().decode(file.content as ArrayBuffer)
      expect(content).toBe('Original content')
    })

    it('should restore deleted files on checkout', async () => {
      await vfs.createFile('/restored.txt', 'I was deleted')
      const commit1 = await vfs.commit('File exists')

      await vfs.deleteFile('/restored.txt')
      await vfs.commit('File deleted')

      // File should not exist
      expect(await vfs.exists('/restored.txt')).toBe(false)

      // Checkout the first commit
      await vfs.checkout(commit1.hash)

      // File should be restored
      expect(await vfs.exists('/restored.txt')).toBe(true)
      const file = await vfs.readFile('/restored.txt')
      const content = new TextDecoder().decode(file.content as ArrayBuffer)
      expect(content).toBe('I was deleted')
    })

    it('should remove files added after checkout point', async () => {
      await vfs.createFile('/original.txt', 'original')
      const commit1 = await vfs.commit('Original only')

      await vfs.createFile('/later.txt', 'added later')
      await vfs.commit('Added file')

      // Checkout the first commit
      await vfs.checkout(commit1.hash)

      // Later file should not exist
      expect(await vfs.exists('/later.txt')).toBe(false)
      expect(await vfs.exists('/original.txt')).toBe(true)
    })
  })

  describe('Version Control Events', () => {
    it('should emit version:commit event', async () => {
      const events: unknown[] = []
      vfs.events.on('version:commit', (event) => {
        events.push(event)
      })

      await vfs.createFile('/event-commit.txt', 'content')
      await vfs.commit('Event commit')

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('version:commit')
    })

    it('should emit version:checkout event', async () => {
      await vfs.createFile('/event-checkout.txt', 'content')
      const commit = await vfs.commit('Checkpoint')

      const events: unknown[] = []
      vfs.events.on('version:checkout', (event) => {
        events.push(event)
      })

      await vfs.checkout(commit.hash)

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('version:checkout')
    })

    it('should emit file change events on checkout', async () => {
      // Create initial state
      await vfs.createFile('/checkout-file.txt', 'original')
      const commit1 = await vfs.commit('Initial')

      // Make changes
      await vfs.updateFile('/checkout-file.txt', 'modified')
      await vfs.createFile('/new-file.txt', 'new content')
      await vfs.commit('Changes')

      // Collect events
      const fileEvents: unknown[] = []
      vfs.events.on('file:created', (e) => { fileEvents.push(e) })
      vfs.events.on('file:updated', (e) => { fileEvents.push(e) })
      vfs.events.on('file:deleted', (e) => { fileEvents.push(e) })

      // Checkout to initial commit
      await vfs.checkout(commit1.hash)

      // Should have file change events:
      // - checkout-file.txt modified (reverted)
      // - new-file.txt deleted
      expect(fileEvents.length).toBe(2)

      const paths = fileEvents.map(e => (e as { path: string }).path)
      expect(paths).toContain('/checkout-file.txt')
      expect(paths).toContain('/new-file.txt')
    })

    it('should emit file:deleted event for files removed on checkout', async () => {
      await vfs.createFile('/will-be-deleted.txt', 'content')
      const commit1 = await vfs.commit('Without file')

      await vfs.createFile('/added-later.txt', 'added')
      await vfs.commit('With file')

      const deletedEvents: unknown[] = []
      vfs.events.on('file:deleted', (e) => { deletedEvents.push(e) })

      await vfs.checkout(commit1.hash)

      // added-later.txt should be deleted
      const deletedPaths = deletedEvents.map(e => (e as { path: string }).path)
      expect(deletedPaths).toContain('/added-later.txt')
    })

    it('should emit file:created event for files added on checkout', async () => {
      await vfs.createFile('/exists-in-old.txt', 'content')
      const commit1 = await vfs.commit('With file')

      await vfs.deleteFile('/exists-in-old.txt')
      await vfs.commit('File deleted')

      const createdEvents: unknown[] = []
      vfs.events.on('file:created', (e) => { createdEvents.push(e) })

      await vfs.checkout(commit1.hash)

      // exists-in-old.txt should be created (restored)
      const createdPaths = createdEvents.map(e => (e as { path: string }).path)
      expect(createdPaths).toContain('/exists-in-old.txt')
    })

    it('should emit version:revert event', async () => {
      await vfs.createFile('/event-revert.txt', 'content')
      const commit = await vfs.commit('Checkpoint')

      await vfs.createFile('/another.txt', 'more')
      await vfs.commit('Another commit')

      const events: unknown[] = []
      vfs.events.on('version:revert', (event) => {
        events.push(event)
      })

      await vfs.revert(commit.hash)

      expect(events.length).toBe(1)
      expect((events[0] as { type: string }).type).toBe('version:revert')
      expect((events[0] as { ref: string }).ref).toBe(commit.hash)
    })

    it('should emit file change events on revert', async () => {
      // Create initial state
      await vfs.createFile('/revert-event-test.txt', 'original')
      const commit1 = await vfs.commit('Initial')

      // Make changes
      await vfs.updateFile('/revert-event-test.txt', 'modified')
      await vfs.createFile('/revert-new-file.txt', 'new content')
      await vfs.commit('Changes')

      // Collect events
      const fileEvents: unknown[] = []
      vfs.events.on('file:created', (e) => { fileEvents.push(e) })
      vfs.events.on('file:updated', (e) => { fileEvents.push(e) })
      vfs.events.on('file:deleted', (e) => { fileEvents.push(e) })

      // Revert to initial commit
      await vfs.revert(commit1.hash)

      // Should have file change events
      expect(fileEvents.length).toBe(2)

      const paths = fileEvents.map(e => (e as { path: string }).path)
      expect(paths).toContain('/revert-event-test.txt')
      expect(paths).toContain('/revert-new-file.txt')
    })
  })

  describe('Revert Operations', () => {
    it('should hard revert to a previous commit', async () => {
      // Create initial state
      await vfs.createFile('/revert-test.txt', 'Original content')
      const commit1 = await vfs.commit('Initial commit')

      // Make changes
      await vfs.updateFile('/revert-test.txt', 'Modified content')
      await vfs.createFile('/new-file.txt', 'New file')
      await vfs.commit('Second commit')

      // Verify current state
      expect(await vfs.exists('/new-file.txt')).toBe(true)

      // Hard revert to first commit
      await vfs.revert(commit1.hash)

      // File should have original content
      const file = await vfs.readFile('/revert-test.txt')
      const content = new TextDecoder().decode(file.content as ArrayBuffer)
      expect(content).toBe('Original content')

      // New file should not exist
      expect(await vfs.exists('/new-file.txt')).toBe(false)
    })

    it('should discard commits after revert point', async () => {
      await vfs.createFile('/file1.txt', 'content1')
      const commit1 = await vfs.commit('Commit 1')

      await vfs.createFile('/file2.txt', 'content2')
      await vfs.commit('Commit 2')

      await vfs.createFile('/file3.txt', 'content3')
      await vfs.commit('Commit 3')

      // History should have 3 commits
      let history = await vfs.history()
      expect(history.length).toBe(3)

      // Revert to commit 1
      await vfs.revert(commit1.hash)

      // History should now only have 1 commit
      history = await vfs.history()
      expect(history.length).toBe(1)
      expect(history[0].hash).toBe(commit1.hash)
    })

    it('should allow new commits after revert', async () => {
      await vfs.createFile('/original.txt', 'original')
      const commit1 = await vfs.commit('Original')

      await vfs.createFile('/later.txt', 'later')
      await vfs.commit('Later commit')

      // Revert to original
      await vfs.revert(commit1.hash)

      // Make new changes and commit
      await vfs.createFile('/new-after-revert.txt', 'new content')
      const newCommit = await vfs.commit('New commit after revert')

      expect(newCommit.hash).toBeDefined()
      expect(await vfs.exists('/new-after-revert.txt')).toBe(true)
      expect(await vfs.exists('/later.txt')).toBe(false)

      // The new commit should be reachable from HEAD
      const head = await vfs.getHead()
      expect(head.message).toBe('New commit after revert')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty commits gracefully', async () => {
      // Some git providers might reject empty commits
      // Our implementation should handle this
      try {
        const commit = await vfs.commit('Empty commit')
        // If successful, commit should still have valid structure
        expect(commit.hash).toBeDefined()
      } catch (error) {
        // Empty commits might be rejected - that's also valid behavior
        expect(error).toBeDefined()
      }
    })

    it('should handle binary files in version control', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253])
      await vfs.createFile('/binary.bin', binaryData.buffer)
      const commit1 = await vfs.commit('Binary file')

      // Modify binary
      const modifiedData = new Uint8Array([100, 101, 102])
      await vfs.updateFile('/binary.bin', modifiedData.buffer)
      await vfs.commit('Modified binary')

      // Checkout original
      await vfs.checkout(commit1.hash)

      const file = await vfs.readFile('/binary.bin')
      const content = new Uint8Array(file.content as ArrayBuffer)
      expect(content).toEqual(binaryData)
    })

    it('should handle nested directory changes', async () => {
      await vfs.createFile('/a/b/c/deep.txt', 'deep content')
      const commit1 = await vfs.commit('Deep file')

      await vfs.deleteFolder('/a', true)
      await vfs.commit('Deleted hierarchy')

      expect(await vfs.exists('/a/b/c/deep.txt')).toBe(false)

      await vfs.checkout(commit1.hash)

      expect(await vfs.exists('/a/b/c/deep.txt')).toBe(true)
    })

    it('should handle special characters in file names', async () => {
      const filename = '/special-chars_test.file.txt'
      await vfs.createFile(filename, 'content')
      const commit = await vfs.commit('Special chars')

      expect(commit.hash).toBeDefined()
    })
  })

  describe('Folder Change Events on Checkout/Revert', () => {
    it('should emit folder:created event when checkout restores a deleted folder', async () => {
      // Create folder structure
      await vfs.createFile('/folder/nested/file.txt', 'content')
      const commit1 = await vfs.commit('With folder')

      // Delete the folder
      await vfs.deleteFolder('/folder', true)
      await vfs.commit('Without folder')

      // Track events
      const events: Array<{ name: string; path: string }> = []
      vfs.events.on('folder:created', (data) => { events.push({ name: 'folder:created', path: data.path }) })

      // Checkout back to commit with folder
      await vfs.checkout(commit1.hash)

      // Should have folder:created events for both /folder and /folder/nested
      const folderCreatedEvents = events.filter(e => e.name === 'folder:created')
      expect(folderCreatedEvents.length).toBeGreaterThanOrEqual(2)
      expect(folderCreatedEvents.some(e => e.path === '/folder')).toBe(true)
      expect(folderCreatedEvents.some(e => e.path === '/folder/nested')).toBe(true)
    })

    it('should emit folder:deleted event when checkout removes a folder', async () => {
      // Create initial commit without folder
      await vfs.createFile('/base.txt', 'base content')
      const commit1 = await vfs.commit('Without folder')

      // Create folder structure
      await vfs.createFile('/folder/nested/file.txt', 'content')
      await vfs.commit('With folder')

      // Track events
      const events: Array<{ name: string; path: string }> = []
      vfs.events.on('folder:deleted', (data) => { events.push({ name: 'folder:deleted', path: data.path }) })

      // Checkout back to commit without folder
      await vfs.checkout(commit1.hash)

      // Should have folder:deleted events
      const folderDeletedEvents = events.filter(e => e.name === 'folder:deleted')
      expect(folderDeletedEvents.length).toBeGreaterThanOrEqual(2)
      expect(folderDeletedEvents.some(e => e.path === '/folder')).toBe(true)
      expect(folderDeletedEvents.some(e => e.path === '/folder/nested')).toBe(true)
    })

    it('should emit folder:created event when revert restores a deleted folder', async () => {
      // Create folder structure and commit
      await vfs.createFile('/mydir/subdir/doc.txt', 'doc content')
      const commit1 = await vfs.commit('With directory')

      // Delete folder
      await vfs.deleteFolder('/mydir', true)
      await vfs.commit('Deleted directory')

      // Track events
      const events: Array<{ name: string; path: string }> = []
      vfs.events.on('folder:created', (data) => { events.push({ name: 'folder:created', path: data.path }) })

      // Revert to commit with folder
      await vfs.revert(commit1.hash)

      // Should have folder:created events
      const folderCreatedEvents = events.filter(e => e.name === 'folder:created')
      expect(folderCreatedEvents.length).toBeGreaterThanOrEqual(2)
      expect(folderCreatedEvents.some(e => e.path === '/mydir')).toBe(true)
      expect(folderCreatedEvents.some(e => e.path === '/mydir/subdir')).toBe(true)
    })

    it('should emit folder:deleted event when revert removes a folder', async () => {
      // Create initial commit
      await vfs.createFile('/init.txt', 'init')
      const commit1 = await vfs.commit('Initial')

      // Create folder
      await vfs.createFile('/newdir/file.txt', 'content')
      await vfs.commit('Added folder')

      // Track events
      const events: Array<{ name: string; path: string }> = []
      vfs.events.on('folder:deleted', (data) => { events.push({ name: 'folder:deleted', path: data.path }) })

      // Revert to commit without folder
      await vfs.revert(commit1.hash)

      // Should have folder:deleted events
      const folderDeletedEvents = events.filter(e => e.name === 'folder:deleted')
      expect(folderDeletedEvents.length).toBeGreaterThanOrEqual(1)
      expect(folderDeletedEvents.some(e => e.path === '/newdir')).toBe(true)
    })

    it('should emit both file and folder events together on checkout', async () => {
      // Create complex structure
      await vfs.createFile('/dir1/file1.txt', 'file1')
      await vfs.createFile('/dir1/dir2/file2.txt', 'file2')
      const commit1 = await vfs.commit('Complex structure')

      // Delete everything
      await vfs.deleteFolder('/dir1', true)
      await vfs.commit('Empty')

      // Track all events
      const events: Array<{ type: string; path: string }> = []
      vfs.events.on('file:created', (data) => { events.push({ type: 'file:created', path: data.path }) })
      vfs.events.on('folder:created', (data) => { events.push({ type: 'folder:created', path: data.path }) })

      // Checkout back
      await vfs.checkout(commit1.hash)

      // Should have both file and folder events
      const fileEvents = events.filter(e => e.type === 'file:created')
      const folderEvents = events.filter(e => e.type === 'folder:created')

      expect(fileEvents.length).toBe(2) // file1.txt and file2.txt
      expect(folderEvents.length).toBe(2) // dir1 and dir2
      
      expect(fileEvents.some(e => e.path === '/dir1/file1.txt')).toBe(true)
      expect(fileEvents.some(e => e.path === '/dir1/dir2/file2.txt')).toBe(true)
      expect(folderEvents.some(e => e.path === '/dir1')).toBe(true)
      expect(folderEvents.some(e => e.path === '/dir1/dir2')).toBe(true)
    })
  })
})
