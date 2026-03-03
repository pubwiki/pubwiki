import type { VfsProvider } from './vfs-provider'
import type { VfsCommit as VfsCommit, VfsDiff as VfsDiff } from '../types'

/**
 * 带版本控制的 VFS Provider 接口
 *
 * 扩展基础 VfsProvider，添加 Git 风格的版本控制功能。
 */
export interface VersionedVfsProvider extends VfsProvider {
  // ========== Git 操作 ==========

  /**
   * 提交当前更改
   * @param message 提交信息
   * @param options.author 作者名称
   * @param options.email 作者邮箱
   * @param options.skipChangeDetails If true, the returned VfsCommit may have an empty `changes` array.
   *   This skips the expensive post-commit diff and is useful for bulk/sync commits.
   * @returns 提交对象
   */
  commit(
    message: string,
    options?: {
      author?: string
      email?: string
      skipChangeDetails?: boolean
    }
  ): Promise<VfsCommit>

  /**
   * 获取提交历史
   * @param options.path 指定路径的历史（可选）
   * @param options.depth 最大返回数量
   * @param options.ref 分支/标签引用
   */
  getHistory(options?: {
    path?: string
    depth?: number
    ref?: string
  }): Promise<VfsCommit[]>

  /**
   * 检出到指定提交
   * @param ref 提交哈希、分支名或标签
   */
  checkout(ref: string): Promise<void>

  /**
   * 比较两个提交的差异
   * @param commitA 提交 A
   * @param commitB 提交 B
   */
  diff(commitA: string, commitB: string): Promise<VfsDiff[]>

  /**
   * 获取当前分支名
   */
  getCurrentBranch(): Promise<string>

  /**
   * 获取当前 HEAD 提交
   */
  getHead(): Promise<VfsCommit>

  /**
   * 硬重置到指定提交（丢弃之后的所有提交）
   * 类似于 git reset --hard <ref>
   * @param ref 目标提交哈希、分支名或标签
   */
  revert(ref: string): Promise<void>

  // ========== 可选的高级操作 ==========

  /**
   * 创建分支
   * @param name 分支名
   * @param ref 基于的引用（默认 HEAD）
   */
  createBranch?(name: string, ref?: string): Promise<void>

  /**
   * 删除分支
   * @param name 分支名
   */
  deleteBranch?(name: string): Promise<void>

  /**
   * 列出所有分支
   */
  listBranches?(): Promise<string[]>

  /**
   * 暂存文件
   * @param path 文件路径
   */
  stage?(path: string): Promise<void>

  /**
   * 取消暂存
   * @param path 文件路径
   */
  unstage?(path: string): Promise<void>

  /**
   * 获取工作区状态
   */
  status?(): Promise<
    Array<{
      path: string
      status: 'added' | 'modified' | 'deleted' | 'untracked'
      staged: boolean
    }>
  >
}

/**
 * 检查 Provider 是否支持版本控制
 */
export function isVersionedProvider(
  provider: VfsProvider
): provider is VersionedVfsProvider {
  return (
    'commit' in provider &&
    'getHistory' in provider &&
    'checkout' in provider &&
    'diff' in provider &&
    'revert' in provider
  )
}
