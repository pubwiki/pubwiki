/**
 * GitProvider - VersionedVfsProvider implementation using isomorphic-git
 * 
 * This provider extends NodeFsProvider with Git version control capabilities
 * using isomorphic-git library.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import git from 'isomorphic-git'
import { NodeFsProvider } from './node-fs-provider'
import type { VersionedVfsProvider, VfsCommit, VfsDiff } from '../../src'

/**
 * VersionedVfsProvider implementation using isomorphic-git
 */
export class GitProvider extends NodeFsProvider implements VersionedVfsProvider {
  private readonly author: { name: string; email: string }

  constructor(
    rootDir: string,
    options?: { author?: { name: string; email: string } }
  ) {
    super(rootDir)
    this.author = options?.author ?? { name: 'Test User', email: 'test@example.com' }
  }

  private get dir(): string {
    return (this as unknown as { rootDir: string }).rootDir
  }

  async initialize(): Promise<void> {
    await super.initialize()
    
    // Initialize git repository if not already initialized
    const gitDir = path.join(this.dir, '.git')
    try {
      await fs.promises.access(gitDir)
    } catch {
      await git.init({ fs, dir: this.dir, defaultBranch: 'main' })
    }
  }

  async commit(
    message: string,
    options?: { author?: string; email?: string }
  ): Promise<VfsCommit> {
    const authorInfo = {
      name: options?.author ?? this.author.name,
      email: options?.email ?? this.author.email,
    }

    // Add all changes to staging
    await git.statusMatrix({ fs, dir: this.dir }).then(async (status) => {
      for (const [filepath, , worktreeStatus] of status) {
        if (worktreeStatus === 0) {
          // File deleted
          await git.remove({ fs, dir: this.dir, filepath })
        } else {
          // File added or modified
          await git.add({ fs, dir: this.dir, filepath })
        }
      }
    })

    // Create commit
    const sha = await git.commit({
      fs,
      dir: this.dir,
      message,
      author: authorInfo,
    })

    // Return VFSCommit object
    return {
      hash: sha,
      message,
      author: `${authorInfo.name} <${authorInfo.email}>`,
      timestamp: new Date(),
      changes: [], // Would need to compute from status matrix
    }
  }

  async getHistory(options?: {
    path?: string
    depth?: number
    ref?: string
  }): Promise<VfsCommit[]> {
    const commits = await git.log({
      fs,
      dir: this.dir,
      depth: options?.depth ?? 100,
      ref: options?.ref ?? 'HEAD',
    })

    return commits.map((commit) => ({
      hash: commit.oid,
      message: commit.commit.message.trim(),
      author: `${commit.commit.author.name} <${commit.commit.author.email}>`,
      timestamp: new Date(commit.commit.author.timestamp * 1000),
      changes: [], // Would need to compare with parent to get changes
    }))
  }

  async checkout(ref: string): Promise<void> {
    await git.checkout({
      fs,
      dir: this.dir,
      ref,
      force: true,
    })
  }

  async diff(commitA: string, commitB: string): Promise<VfsDiff[]> {
    const diffs: VfsDiff[] = []

    // Get trees for both commits
    const [treeA, treeB] = await Promise.all([
      this.getTreeFiles(commitA),
      this.getTreeFiles(commitB),
    ])

    // Find added and modified files
    for (const [filepath, contentB] of treeB.files) {
      const contentA = treeA.files.get(filepath)
      const normalizedPath = filepath.startsWith('/') ? filepath : `/${filepath}`
      if (contentA === undefined) {
        diffs.push({
          type: 'added',
          path: normalizedPath,
          newContent: contentB,
          isDirectory: false,
        })
      } else if (contentA !== contentB) {
        diffs.push({
          type: 'modified',
          path: normalizedPath,
          oldContent: contentA,
          newContent: contentB,
          isDirectory: false,
        })
      }
    }

    // Find deleted files
    for (const [filepath, contentA] of treeA.files) {
      if (!treeB.files.has(filepath)) {
        const normalizedPath = filepath.startsWith('/') ? filepath : `/${filepath}`
        diffs.push({
          type: 'deleted',
          path: normalizedPath,
          oldContent: contentA,
          isDirectory: false,
        })
      }
    }

    // Find added folders
    for (const folderPath of treeB.folders) {
      if (!treeA.folders.has(folderPath)) {
        const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`
        diffs.push({
          type: 'added',
          path: normalizedPath,
          isDirectory: true,
        })
      }
    }

    // Find deleted folders
    for (const folderPath of treeA.folders) {
      if (!treeB.folders.has(folderPath)) {
        const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`
        diffs.push({
          type: 'deleted',
          path: normalizedPath,
          isDirectory: true,
        })
      }
    }

    return diffs
  }

  private async getTreeFiles(ref: string): Promise<{ files: Map<string, string>; folders: Set<string> }> {
    const files = new Map<string, string>()
    const folders = new Set<string>()

    try {
      const commitOid = await git.resolveRef({ fs, dir: this.dir, ref })
      const { commit } = await git.readCommit({ fs, dir: this.dir, oid: commitOid })

      await this.walkTree(commit.tree, '', files, folders)
    } catch {
      // If ref doesn't exist, return empty collections
    }

    return { files, folders }
  }

  private async walkTree(
    treeOid: string,
    prefix: string,
    files: Map<string, string>,
    folders: Set<string>
  ): Promise<void> {
    const tree = await git.readTree({ fs, dir: this.dir, oid: treeOid })

    for (const entry of tree.tree) {
      const filepath = prefix ? `${prefix}/${entry.path}` : entry.path

      if (entry.type === 'blob') {
        try {
          const { blob } = await git.readBlob({ fs, dir: this.dir, oid: entry.oid })
          files.set(filepath, new TextDecoder().decode(blob))
        } catch {
          // Skip binary or unreadable files
        }
      } else if (entry.type === 'tree') {
        folders.add(filepath)
        await this.walkTree(entry.oid, filepath, files, folders)
      }
    }
  }

  async getCurrentBranch(): Promise<string> {
    return await git.currentBranch({ fs, dir: this.dir }) ?? 'main'
  }

  async getHead(): Promise<VfsCommit> {
    const oid = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' })
    const { commit } = await git.readCommit({ fs, dir: this.dir, oid })
    
    return {
      hash: oid,
      message: commit.message.trim(),
      author: `${commit.author.name} <${commit.author.email}>`,
      timestamp: new Date(commit.author.timestamp * 1000),
      changes: [],
    }
  }

  async revert(ref: string): Promise<void> {
    // 解析目标提交
    const targetOid = await git.resolveRef({ fs, dir: this.dir, ref })

    // 获取当前分支
    const branch = await git.currentBranch({ fs, dir: this.dir })
    if (!branch) {
      throw new Error('Not on a branch, cannot revert')
    }

    // 硬重置：将分支指向目标提交
    // 1. 更新分支引用
    await git.writeRef({
      fs,
      dir: this.dir,
      ref: `refs/heads/${branch}`,
      value: targetOid,
      force: true,
    })

    // 2. 检出工作区到目标提交的状态（使用分支名保持在分支上）
    await git.checkout({
      fs,
      dir: this.dir,
      ref: branch,
      force: true,
    })
  }

  // Optional advanced operations

  async createBranch(name: string, ref?: string): Promise<void> {
    await git.branch({
      fs,
      dir: this.dir,
      ref: name,
      object: ref,
    })
  }

  async deleteBranch(name: string): Promise<void> {
    await git.deleteBranch({
      fs,
      dir: this.dir,
      ref: name,
    })
  }

  async listBranches(): Promise<string[]> {
    return await git.listBranches({ fs, dir: this.dir })
  }

  async stage(filepath: string): Promise<void> {
    await git.add({ fs, dir: this.dir, filepath })
  }

  async unstage(filepath: string): Promise<void> {
    await git.resetIndex({ fs, dir: this.dir, filepath })
  }

  async status(): Promise<
    Array<{
      path: string
      status: 'added' | 'modified' | 'deleted' | 'untracked'
      staged: boolean
    }>
  > {
    const statusMatrix = await git.statusMatrix({ fs, dir: this.dir })
    const results: Array<{
      path: string
      status: 'added' | 'modified' | 'deleted' | 'untracked'
      staged: boolean
    }> = []

    for (const [filepath, headStatus, stageStatus, worktreeStatus] of statusMatrix) {
      // Skip unchanged files
      if (headStatus === 1 && stageStatus === 1 && worktreeStatus === 1) continue

      let status: 'added' | 'modified' | 'deleted' | 'untracked'
      let staged = false

      if (headStatus === 0 && stageStatus === 0 && worktreeStatus === 2) {
        status = 'untracked'
      } else if (headStatus === 0 && stageStatus === 2) {
        status = 'added'
        staged = true
      } else if (headStatus === 1 && worktreeStatus === 0) {
        status = 'deleted'
        staged = stageStatus === 0
      } else if (headStatus === 1 && (stageStatus === 2 || worktreeStatus === 2)) {
        status = 'modified'
        staged = stageStatus === 2
      } else {
        continue // Unknown status
      }

      results.push({ path: filepath, status, staged })
    }

    return results
  }
}
