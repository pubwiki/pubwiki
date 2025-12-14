import type {
  VfsFile,
  VfsFolder,
  VfsStat,
  VfsCommit,
  VfsDiff,
} from './types'
import type { VfsProvider } from './interfaces/vfs-provider'
import type { VersionedVfsProvider } from './interfaces/versioned-vfs-provider'
import { isVersionedProvider } from './interfaces'
import { VfsEventBus } from './events'
import {
  getFileName,
  getParentPath,
  getFileExtension,
  normalizePath,
} from './utils/path'

/**
 * 基础 VFS 类
 *
 * 提供文件系统操作和事件监听。
 */
export class Vfs<P extends VfsProvider = VfsProvider> {
  /** 事件总线 */
  readonly events = new VfsEventBus()

  protected disposed = false

  constructor(protected readonly provider: P) {}

  // ========== 生命周期 ==========

  /**
   * 初始化 VFS
   */
  async initialize(): Promise<void> {
    this.checkDisposed()
    if (this.provider.initialize) {
      await this.provider.initialize()
    }
  }

  /**
   * 销毁 VFS，释放资源
   */
  async dispose(): Promise<void> {
    if (this.disposed) return

    this.disposed = true
    this.events.dispose()

    if (this.provider.dispose) {
      await this.provider.dispose()
    }
  }

  // ========== 文件操作 ==========

  /**
   * 创建文件
   */
  async createFile(
    path: string,
    content: ArrayBuffer | string,
  ): Promise<VfsFile> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)
    const buffer = this.toUint8Array(content)

    // 确保父目录存在
    const parentPath = getParentPath(normalizedPath)
    if (parentPath !== '/') {
      await this.provider.mkdir(parentPath, { recursive: true })
    }

    // 写入文件
    await this.provider.writeFile(normalizedPath, buffer)

    // 获取文件信息
    const file = await this.buildFileObject(normalizedPath, content)

    // 发射事件
    await this.events.emit({
      type: 'file:created',
      file,
      path: normalizedPath,
      timestamp: Date.now(),
    })

    return file
  }

  /**
   * 读取文件
   */
  async readFile(path: string): Promise<VfsFile> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)
    const buffer = await this.provider.readFile(normalizedPath)

    return this.buildFileObject(normalizedPath, buffer)
  }

  /**
   * 更新文件内容
   */
  async updateFile(
    path: string,
    content: ArrayBuffer | string
  ): Promise<VfsFile> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)
    const buffer = this.toUint8Array(content)

    // 写入新内容
    await this.provider.writeFile(normalizedPath, buffer)

    // 获取更新后的文件信息
    const file = await this.buildFileObject(normalizedPath, content)

    // 发射事件
    await this.events.emit({
      type: 'file:updated',
      file,
      path: normalizedPath,
      timestamp: Date.now(),
    })

    return file
  }

  /**
   * 删除文件
   */
  async deleteFile(path: string): Promise<void> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)

    // 获取文件 ID（用于事件）
    const fileId = await this.provider.id(normalizedPath)

    // 删除文件
    await this.provider.unlink(normalizedPath)

    // 发射事件
    await this.events.emit({
      type: 'file:deleted',
      fileId,
      path: normalizedPath,
      timestamp: Date.now(),
    })
  }

  // ========== 文件夹操作 ==========

  /**
   * 创建文件夹
   */
  async createFolder(
    path: string,
  ): Promise<VfsFolder> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)

    // 创建目录
    await this.provider.mkdir(normalizedPath, { recursive: true })

    // 获取文件夹信息
    const folder = await this.buildFolderObject(normalizedPath)

    // 发射事件
    await this.events.emit({
      type: 'folder:created',
      folder,
      path: normalizedPath,
      timestamp: Date.now(),
    })

    return folder
  }

  /**
   * 列出文件夹内容
   */
  async listFolder(path: string): Promise<Array<VfsFile | VfsFolder>> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)
    const entries = await this.provider.readdir(normalizedPath)
    const items: Array<VfsFile | VfsFolder> = []

    for (const entry of entries) {
      // 跳过隐藏文件
      if (entry.startsWith('.')) continue

      const entryPath =
        normalizedPath === '/' ? `/${entry}` : `${normalizedPath}/${entry}`

      const stat = await this.provider.stat(entryPath)

      if (stat.isDirectory) {
        items.push(await this.buildFolderObject(entryPath))
      } else {
        items.push(await this.buildFileObject(entryPath))
      }
    }

    return items
  }

  /**
   * 删除文件夹
   */
  async deleteFolder(path: string, recursive: boolean = false): Promise<void> {
    this.checkDisposed()

    const normalizedPath = normalizePath(path)

    // 如果是递归删除，先收集所有子项并发射事件
    if (recursive) {
      await this.emitDeleteEventsRecursive(normalizedPath)
    }

    // 获取文件夹 ID
    const folder = await this.buildFolderObject(normalizedPath)

    // 删除目录
    await this.provider.rmdir(normalizedPath, { recursive })

    // 发射文件夹删除事件
    await this.events.emit({
      type: 'folder:deleted',
      folderId: folder.id,
      path: normalizedPath,
      recursive,
      timestamp: Date.now(),
    })
  }

  /**
   * 递归发射删除事件（用于递归删除文件夹时）
   */
  private async emitDeleteEventsRecursive(folderPath: string): Promise<void> {
    const entries = await this.provider.readdir(folderPath)

    for (const entry of entries) {
      const entryPath = folderPath === '/' ? `/${entry}` : `${folderPath}/${entry}`
      const stat = await this.provider.stat(entryPath)

      if (stat.isDirectory) {
        // 先递归处理子文件夹
        await this.emitDeleteEventsRecursive(entryPath)

        // 发射子文件夹删除事件
        const folderId = await this.provider.id(entryPath)
        await this.events.emit({
          type: 'folder:deleted',
          folderId,
          path: entryPath,
          recursive: false,
          timestamp: Date.now(),
        })
      } else {
        // 发射文件删除事件
        const fileId = await this.provider.id(entryPath)
        await this.events.emit({
          type: 'file:deleted',
          fileId,
          path: entryPath,
          timestamp: Date.now(),
        })
      }
    }
  }

  // ========== 移动/复制 ==========

  /**
   * 移动文件或文件夹
   */
  async moveItem(fromPath: string, toPath: string): Promise<void> {
    this.checkDisposed()

    const normalizedFrom = normalizePath(fromPath)
    const normalizedTo = normalizePath(toPath)

    // 获取原项目信息
    const stat = await this.provider.stat(normalizedFrom)
    const isDirectory = stat.isDirectory

    // 如果是目录，先收集所有子项信息（在移动之前）
    const childItems = isDirectory
      ? await this.collectChildItems(normalizedFrom)
      : []

    // 执行移动
    await this.provider.rename(normalizedFrom, normalizedTo)

    // 发射事件
    if (isDirectory) {
      // 先发射子项的移动事件
      await this.emitMoveEventsForChildren(childItems, normalizedFrom, normalizedTo)

      // 最后发射文件夹移动事件
      const folderId = await this.provider.id(normalizedTo)
      await this.events.emit({
        type: 'folder:moved',
        folderId,
        fromPath: normalizedFrom,
        toPath: normalizedTo,
        timestamp: Date.now(),
      })
    } else {
      const itemId = await this.provider.id(normalizedTo)
      const file = await this.buildFileObject(normalizedTo)
      await this.events.emit({
        type: 'file:moved',
        fileId: itemId,
        fromPath: normalizedFrom,
        toPath: normalizedTo,
        file,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * 收集文件夹中的所有子项（递归）
   */
  private async collectChildItems(
    folderPath: string
  ): Promise<Array<{ path: string; isDirectory: boolean }>> {
    const items: Array<{ path: string; isDirectory: boolean }> = []
    const entries = await this.provider.readdir(folderPath)

    for (const entry of entries) {
      const entryPath = folderPath === '/' ? `/${entry}` : `${folderPath}/${entry}`
      const stat = await this.provider.stat(entryPath)

      items.push({ path: entryPath, isDirectory: stat.isDirectory })

      if (stat.isDirectory) {
        const subItems = await this.collectChildItems(entryPath)
        items.push(...subItems)
      }
    }

    return items
  }

  /**
   * 为子项发射移动事件
   */
  private async emitMoveEventsForChildren(
    childItems: Array<{ path: string; isDirectory: boolean }>,
    fromBase: string,
    toBase: string
  ): Promise<void> {
    for (const item of childItems) {
      const relativePath = item.path.slice(fromBase.length)
      const newPath = toBase + relativePath

      if (item.isDirectory) {
        const folderId = await this.provider.id(newPath)
        await this.events.emit({
          type: 'folder:moved',
          folderId,
          fromPath: item.path,
          toPath: newPath,
          timestamp: Date.now(),
        })
      } else {
        const fileId = await this.provider.id(newPath)
        const file = await this.buildFileObject(newPath)
        await this.events.emit({
          type: 'file:moved',
          fileId,
          fromPath: item.path,
          toPath: newPath,
          file,
          timestamp: Date.now(),
        })
      }
    }
  }

  /**
   * 复制文件
   */
  async copyItem(fromPath: string, toPath: string): Promise<void> {
    this.checkDisposed()

    const normalizedFrom = normalizePath(fromPath)
    const normalizedTo = normalizePath(toPath)

    await this.provider.copyFile(normalizedFrom, normalizedTo)

    // 发射创建事件
    const file = await this.buildFileObject(normalizedTo)
    await this.events.emit({
      type: 'file:created',
      file,
      path: normalizedTo,
      timestamp: Date.now(),
    })
  }

  // ========== 工具方法 ==========

  /**
   * 检查路径是否存在
   */
  async exists(path: string): Promise<boolean> {
    this.checkDisposed()
    return this.provider.exists(normalizePath(path))
  }

  /**
   * 获取文件/目录状态
   */
  async stat(path: string): Promise<VfsStat> {
    this.checkDisposed()
    return this.provider.stat(normalizePath(path))
  }

  // ========== 私有方法 ==========

  protected checkDisposed(): void {
    if (this.disposed) {
      throw new Error('Vfs has been disposed')
    }
  }

  private toUint8Array(content: ArrayBuffer | string): Uint8Array {
    if (typeof content === 'string') {
      return new TextEncoder().encode(content)
    }
    return new Uint8Array(content)
  }

  protected async buildFileObject(
    path: string,
    content?: ArrayBuffer | string | Uint8Array,
  ): Promise<VfsFile> {
    const stat = await this.provider.stat(path)
    const id = await this.provider.id(path)
    const parentPath = getParentPath(path)
    const folderId = await this.provider.id(parentPath)

    // 处理内容
    let fileContent: ArrayBuffer | string | undefined
    if (content !== undefined) {
      if (content instanceof Uint8Array) {
        // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
        const newBuffer = new ArrayBuffer(content.byteLength)
        new Uint8Array(newBuffer).set(content)
        fileContent = newBuffer
      } else {
        fileContent = content
      }
    }

    return {
      id,
      path,
      name: getFileName(path),
      type: getFileExtension(path),
      size: stat.size,
      folderId,
      content: fileContent,
      createdAt: stat.createdAt.toISOString(),
      updatedAt: stat.updatedAt.toISOString(),
    }
  }

  protected async buildFolderObject(
    path: string,
  ): Promise<VfsFolder> {
    const stat = await this.provider.stat(path)
    const id = await this.provider.id(path)
    const parentPath = getParentPath(path)
    const parentFolderId = await this.provider.id(parentPath)

    return {
      id,
      path,
      name: getFileName(path),
      parentFolderId,
      createdAt: stat.createdAt.toISOString(),
      updatedAt: stat.updatedAt.toISOString(),
    }
  }
}

/**
 * 带版本控制的 VFS 类
 *
 * 继承基础 Vfs，添加 Git 风格的版本控制方法。
 */
export class VersionedVfs extends Vfs<VersionedVfsProvider> {
  constructor(provider: VersionedVfsProvider) {
    super(provider)
  }

  /**
   * 提交更改
   */
  async commit(
    message: string,
    options?: { author?: string; email?: string }
  ): Promise<VfsCommit> {
    this.checkDisposed()
    const commit = await this.provider.commit(message, options)

    // 发射事件
    await this.events.emit({
      type: 'version:commit',
      commit,
      timestamp: Date.now(),
    })

    return commit
  }

  /**
   * 获取提交历史
   */
  async getHistory(options?: {
    path?: string
    depth?: number
    ref?: string
  }): Promise<VfsCommit[]> {
    this.checkDisposed()
    return this.provider.getHistory(options)
  }

  /**
   * 获取提交历史（getHistory 的别名）
   */
  async history(depth?: number): Promise<VfsCommit[]> {
    return this.getHistory({ depth })
  }

  /**
   * 检出到指定版本
   */
  async checkout(ref: string): Promise<void> {
    this.checkDisposed()

    // 获取当前 HEAD 和目标之间的差异（在 checkout 之前）
    const currentHead = await this.provider.getHead()
    const diffs = await this.provider.diff(currentHead.hash, ref)

    // 执行 checkout
    await this.provider.checkout(ref)

    // 为每个变更的文件/文件夹发射事件
    await this.emitCheckoutChangeEvents(diffs)

    // 发射 checkout 事件
    await this.events.emit({
      type: 'version:checkout',
      ref,
      timestamp: Date.now(),
    })
  }

  /**
   * 根据 diff 结果发射文件/文件夹变更事件
   */
  private async emitCheckoutChangeEvents(diffs: VfsDiff[]): Promise<void> {
    // 按路径深度排序，确保父文件夹的事件先于子项
    // 对于 added：父文件夹应该先创建
    // 对于 deleted：子项应该先删除
    const sortedDiffs = [...diffs].sort((a, b) => {
      const depthA = a.path.split('/').length
      const depthB = b.path.split('/').length
      // added 按深度升序（父先），deleted 按深度降序（子先）
      if (a.type === 'deleted' && b.type === 'deleted') {
        return depthB - depthA
      }
      return depthA - depthB
    })

    for (const diff of sortedDiffs) {
      const normalizedPath = normalizePath(diff.path)

      if (diff.isDirectory) {
        // 处理文件夹变更
        switch (diff.type) {
          case 'added': {
            const folder = await this.buildFolderObject(normalizedPath)
            await this.events.emit({
              type: 'folder:created',
              folder,
              path: normalizedPath,
              timestamp: Date.now(),
            })
            break
          }
          case 'deleted': {
            const folderId = await this.provider.id(normalizedPath).catch(() => normalizedPath)
            await this.events.emit({
              type: 'folder:deleted',
              folderId: typeof folderId === 'string' ? folderId : normalizedPath,
              path: normalizedPath,
              recursive: false,
              timestamp: Date.now(),
            })
            break
          }
          // 文件夹不会有 'modified' 类型
        }
      } else {
        // 处理文件变更
        switch (diff.type) {
          case 'added': {
            const file = await this.buildFileObject(normalizedPath)
            await this.events.emit({
              type: 'file:created',
              file,
              path: normalizedPath,
              timestamp: Date.now(),
            })
            break
          }
          case 'deleted': {
            const fileId = await this.provider.id(normalizedPath).catch(() => normalizedPath)
            await this.events.emit({
              type: 'file:deleted',
              fileId: typeof fileId === 'string' ? fileId : normalizedPath,
              path: normalizedPath,
              timestamp: Date.now(),
            })
            break
          }
          case 'modified': {
            const file = await this.buildFileObject(normalizedPath)
            await this.events.emit({
              type: 'file:updated',
              file,
              path: normalizedPath,
              timestamp: Date.now(),
            })
            break
          }
        }
      }
    }
  }

  /**
   * 比较两个版本的差异
   */
  async diff(commitA: string, commitB: string): Promise<VfsDiff[]> {
    this.checkDisposed()
    return this.provider.diff(commitA, commitB)
  }

  /**
   * 获取当前分支
   */
  async getCurrentBranch(): Promise<string> {
    this.checkDisposed()
    return this.provider.getCurrentBranch()
  }

  /**
   * 获取 HEAD 提交
   */
  async getHead(): Promise<VfsCommit> {
    this.checkDisposed()
    return this.provider.getHead()
  }

  /**
   * 硬重置到指定提交（丢弃之后的所有提交）
   * 类似于 git reset --hard <ref>
   */
  async revert(ref: string): Promise<void> {
    this.checkDisposed()

    // 获取当前 HEAD 和目标之间的差异（在 revert 之前）
    const currentHead = await this.provider.getHead()
    const diffs = await this.provider.diff(currentHead.hash, ref)

    // 执行 revert
    await this.provider.revert(ref)

    // 为每个变更的文件发射事件
    await this.emitCheckoutChangeEvents(diffs)

    // 发射 revert 事件
    await this.events.emit({
      type: 'version:revert',
      ref,
      timestamp: Date.now(),
    })
  }
}

// ========== 工厂函数 ==========

/**
 * 创建 VFS 实例
 *
 * 根据 Provider 类型自动返回正确类型的 VFS 实例：
 * - 如果是 VersionedVfsProvider，返回 VersionedVfs（包含 Git 方法）
 * - 否则返回基础 Vfs
 */
export function createVfs<P extends VfsProvider>(
  provider: P
): P extends VersionedVfsProvider ? VersionedVfs : Vfs<P> {
  if (isVersionedProvider(provider)) {
    return new VersionedVfs(provider) as P extends VersionedVfsProvider
      ? VersionedVfs
      : Vfs<P>
  }
  return new Vfs(provider) as P extends VersionedVfsProvider
    ? VersionedVfs
    : Vfs<P>
}
