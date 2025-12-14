import { isVersionedProvider } from './interfaces';
import { VfsEventBus } from './events';
import { getFileName, getParentPath, getFileExtension, normalizePath, } from './utils/path';
/**
 * 基础 VFS 类
 *
 * 提供文件系统操作和事件监听。
 */
export class Vfs {
    provider;
    /** 事件总线 */
    events = new VfsEventBus();
    disposed = false;
    constructor(provider) {
        this.provider = provider;
    }
    // ========== 生命周期 ==========
    /**
     * 初始化 VFS
     */
    async initialize() {
        this.checkDisposed();
        if (this.provider.initialize) {
            await this.provider.initialize();
        }
    }
    /**
     * 销毁 VFS，释放资源
     */
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.events.dispose();
        if (this.provider.dispose) {
            await this.provider.dispose();
        }
    }
    // ========== 文件操作 ==========
    /**
     * 创建文件
     */
    async createFile(path, content) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        const buffer = this.toUint8Array(content);
        // 确保父目录存在
        const parentPath = getParentPath(normalizedPath);
        if (parentPath !== '/') {
            await this.provider.mkdir(parentPath, { recursive: true });
        }
        // 写入文件
        await this.provider.writeFile(normalizedPath, buffer);
        // 获取文件信息
        const file = await this.buildFileObject(normalizedPath, content);
        // 发射事件
        await this.events.emit({
            type: 'file:created',
            file,
            path: normalizedPath,
            timestamp: Date.now(),
        });
        return file;
    }
    /**
     * 读取文件
     */
    async readFile(path) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        const buffer = await this.provider.readFile(normalizedPath);
        return this.buildFileObject(normalizedPath, buffer);
    }
    /**
     * 更新文件内容
     */
    async updateFile(path, content) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        const buffer = this.toUint8Array(content);
        // 写入新内容
        await this.provider.writeFile(normalizedPath, buffer);
        // 获取更新后的文件信息
        const file = await this.buildFileObject(normalizedPath, content);
        // 发射事件
        await this.events.emit({
            type: 'file:updated',
            file,
            path: normalizedPath,
            timestamp: Date.now(),
        });
        return file;
    }
    /**
     * 删除文件
     */
    async deleteFile(path) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        // 获取文件 ID（用于事件）
        const fileId = await this.provider.id(normalizedPath);
        // 删除文件
        await this.provider.unlink(normalizedPath);
        // 发射事件
        await this.events.emit({
            type: 'file:deleted',
            fileId,
            path: normalizedPath,
            timestamp: Date.now(),
        });
    }
    // ========== 文件夹操作 ==========
    /**
     * 创建文件夹
     */
    async createFolder(path) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        // 创建目录
        await this.provider.mkdir(normalizedPath, { recursive: true });
        // 获取文件夹信息
        const folder = await this.buildFolderObject(normalizedPath);
        // 发射事件
        await this.events.emit({
            type: 'folder:created',
            folder,
            path: normalizedPath,
            timestamp: Date.now(),
        });
        return folder;
    }
    /**
     * 列出文件夹内容
     */
    async listFolder(path) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        const entries = await this.provider.readdir(normalizedPath);
        const items = [];
        for (const entry of entries) {
            // 跳过隐藏文件
            if (entry.startsWith('.'))
                continue;
            const entryPath = normalizedPath === '/' ? `/${entry}` : `${normalizedPath}/${entry}`;
            const stat = await this.provider.stat(entryPath);
            if (stat.isDirectory) {
                items.push(await this.buildFolderObject(entryPath));
            }
            else {
                items.push(await this.buildFileObject(entryPath));
            }
        }
        return items;
    }
    /**
     * 删除文件夹
     */
    async deleteFolder(path, recursive = false) {
        this.checkDisposed();
        const normalizedPath = normalizePath(path);
        // 如果是递归删除，先收集所有子项并发射事件
        if (recursive) {
            await this.emitDeleteEventsRecursive(normalizedPath);
        }
        // 获取文件夹 ID
        const folder = await this.buildFolderObject(normalizedPath);
        // 删除目录
        await this.provider.rmdir(normalizedPath, { recursive });
        // 发射文件夹删除事件
        await this.events.emit({
            type: 'folder:deleted',
            folderId: folder.id,
            path: normalizedPath,
            recursive,
            timestamp: Date.now(),
        });
    }
    /**
     * 递归发射删除事件（用于递归删除文件夹时）
     */
    async emitDeleteEventsRecursive(folderPath) {
        const entries = await this.provider.readdir(folderPath);
        for (const entry of entries) {
            const entryPath = folderPath === '/' ? `/${entry}` : `${folderPath}/${entry}`;
            const stat = await this.provider.stat(entryPath);
            if (stat.isDirectory) {
                // 先递归处理子文件夹
                await this.emitDeleteEventsRecursive(entryPath);
                // 发射子文件夹删除事件
                const folderId = await this.provider.id(entryPath);
                await this.events.emit({
                    type: 'folder:deleted',
                    folderId,
                    path: entryPath,
                    recursive: false,
                    timestamp: Date.now(),
                });
            }
            else {
                // 发射文件删除事件
                const fileId = await this.provider.id(entryPath);
                await this.events.emit({
                    type: 'file:deleted',
                    fileId,
                    path: entryPath,
                    timestamp: Date.now(),
                });
            }
        }
    }
    // ========== 移动/复制 ==========
    /**
     * 移动文件或文件夹
     */
    async moveItem(fromPath, toPath) {
        this.checkDisposed();
        const normalizedFrom = normalizePath(fromPath);
        const normalizedTo = normalizePath(toPath);
        // 获取原项目信息
        const stat = await this.provider.stat(normalizedFrom);
        const isDirectory = stat.isDirectory;
        // 如果是目录，先收集所有子项信息（在移动之前）
        const childItems = isDirectory
            ? await this.collectChildItems(normalizedFrom)
            : [];
        // 执行移动
        await this.provider.rename(normalizedFrom, normalizedTo);
        // 发射事件
        if (isDirectory) {
            // 先发射子项的移动事件
            await this.emitMoveEventsForChildren(childItems, normalizedFrom, normalizedTo);
            // 最后发射文件夹移动事件
            const folderId = await this.provider.id(normalizedTo);
            await this.events.emit({
                type: 'folder:moved',
                folderId,
                fromPath: normalizedFrom,
                toPath: normalizedTo,
                timestamp: Date.now(),
            });
        }
        else {
            const itemId = await this.provider.id(normalizedTo);
            const file = await this.buildFileObject(normalizedTo);
            await this.events.emit({
                type: 'file:moved',
                fileId: itemId,
                fromPath: normalizedFrom,
                toPath: normalizedTo,
                file,
                timestamp: Date.now(),
            });
        }
    }
    /**
     * 收集文件夹中的所有子项（递归）
     */
    async collectChildItems(folderPath) {
        const items = [];
        const entries = await this.provider.readdir(folderPath);
        for (const entry of entries) {
            const entryPath = folderPath === '/' ? `/${entry}` : `${folderPath}/${entry}`;
            const stat = await this.provider.stat(entryPath);
            items.push({ path: entryPath, isDirectory: stat.isDirectory });
            if (stat.isDirectory) {
                const subItems = await this.collectChildItems(entryPath);
                items.push(...subItems);
            }
        }
        return items;
    }
    /**
     * 为子项发射移动事件
     */
    async emitMoveEventsForChildren(childItems, fromBase, toBase) {
        for (const item of childItems) {
            const relativePath = item.path.slice(fromBase.length);
            const newPath = toBase + relativePath;
            if (item.isDirectory) {
                const folderId = await this.provider.id(newPath);
                await this.events.emit({
                    type: 'folder:moved',
                    folderId,
                    fromPath: item.path,
                    toPath: newPath,
                    timestamp: Date.now(),
                });
            }
            else {
                const fileId = await this.provider.id(newPath);
                const file = await this.buildFileObject(newPath);
                await this.events.emit({
                    type: 'file:moved',
                    fileId,
                    fromPath: item.path,
                    toPath: newPath,
                    file,
                    timestamp: Date.now(),
                });
            }
        }
    }
    /**
     * 复制文件
     */
    async copyItem(fromPath, toPath) {
        this.checkDisposed();
        const normalizedFrom = normalizePath(fromPath);
        const normalizedTo = normalizePath(toPath);
        await this.provider.copyFile(normalizedFrom, normalizedTo);
        // 发射创建事件
        const file = await this.buildFileObject(normalizedTo);
        await this.events.emit({
            type: 'file:created',
            file,
            path: normalizedTo,
            timestamp: Date.now(),
        });
    }
    // ========== 工具方法 ==========
    /**
     * 检查路径是否存在
     */
    async exists(path) {
        this.checkDisposed();
        return this.provider.exists(normalizePath(path));
    }
    /**
     * 获取文件/目录状态
     */
    async stat(path) {
        this.checkDisposed();
        return this.provider.stat(normalizePath(path));
    }
    // ========== 私有方法 ==========
    checkDisposed() {
        if (this.disposed) {
            throw new Error('Vfs has been disposed');
        }
    }
    toUint8Array(content) {
        if (typeof content === 'string') {
            return new TextEncoder().encode(content);
        }
        return new Uint8Array(content);
    }
    async buildFileObject(path, content) {
        const stat = await this.provider.stat(path);
        const id = await this.provider.id(path);
        const parentPath = getParentPath(path);
        const folderId = await this.provider.id(parentPath);
        // 处理内容
        let fileContent;
        if (content !== undefined) {
            if (content instanceof Uint8Array) {
                // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
                const newBuffer = new ArrayBuffer(content.byteLength);
                new Uint8Array(newBuffer).set(content);
                fileContent = newBuffer;
            }
            else {
                fileContent = content;
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
        };
    }
    async buildFolderObject(path) {
        const stat = await this.provider.stat(path);
        const id = await this.provider.id(path);
        const parentPath = getParentPath(path);
        const parentFolderId = await this.provider.id(parentPath);
        return {
            id,
            path,
            name: getFileName(path),
            parentFolderId,
            createdAt: stat.createdAt.toISOString(),
            updatedAt: stat.updatedAt.toISOString(),
        };
    }
}
/**
 * 带版本控制的 VFS 类
 *
 * 继承基础 Vfs，添加 Git 风格的版本控制方法。
 */
export class VersionedVfs extends Vfs {
    constructor(provider) {
        super(provider);
    }
    /**
     * 提交更改
     */
    async commit(message, options) {
        this.checkDisposed();
        const commit = await this.provider.commit(message, options);
        // 发射事件
        await this.events.emit({
            type: 'version:commit',
            commit,
            timestamp: Date.now(),
        });
        return commit;
    }
    /**
     * 获取提交历史
     */
    async getHistory(options) {
        this.checkDisposed();
        return this.provider.getHistory(options);
    }
    /**
     * 获取提交历史（getHistory 的别名）
     */
    async history(depth) {
        return this.getHistory({ depth });
    }
    /**
     * 检出到指定版本
     */
    async checkout(ref) {
        this.checkDisposed();
        // 获取当前 HEAD 和目标之间的差异（在 checkout 之前）
        const currentHead = await this.provider.getHead();
        const diffs = await this.provider.diff(currentHead.hash, ref);
        // 执行 checkout
        await this.provider.checkout(ref);
        // 为每个变更的文件/文件夹发射事件
        await this.emitCheckoutChangeEvents(diffs);
        // 发射 checkout 事件
        await this.events.emit({
            type: 'version:checkout',
            ref,
            timestamp: Date.now(),
        });
    }
    /**
     * 根据 diff 结果发射文件变更事件
     */
    async emitCheckoutChangeEvents(diffs) {
        for (const diff of diffs) {
            const normalizedPath = normalizePath(diff.path);
            switch (diff.type) {
                case 'added': {
                    // 文件被添加（checkout 后存在）
                    const file = await this.buildFileObject(normalizedPath);
                    await this.events.emit({
                        type: 'file:created',
                        file,
                        path: normalizedPath,
                        timestamp: Date.now(),
                    });
                    break;
                }
                case 'deleted': {
                    // 文件被删除（checkout 后不存在）
                    const fileId = await this.provider.id(normalizedPath).catch(() => normalizedPath);
                    await this.events.emit({
                        type: 'file:deleted',
                        fileId: typeof fileId === 'string' ? fileId : normalizedPath,
                        path: normalizedPath,
                        timestamp: Date.now(),
                    });
                    break;
                }
                case 'modified': {
                    // 文件被修改
                    const file = await this.buildFileObject(normalizedPath);
                    await this.events.emit({
                        type: 'file:updated',
                        file,
                        path: normalizedPath,
                        timestamp: Date.now(),
                    });
                    break;
                }
            }
        }
    }
    /**
     * 比较两个版本的差异
     */
    async diff(commitA, commitB) {
        this.checkDisposed();
        return this.provider.diff(commitA, commitB);
    }
    /**
     * 获取当前分支
     */
    async getCurrentBranch() {
        this.checkDisposed();
        return this.provider.getCurrentBranch();
    }
    /**
     * 获取 HEAD 提交
     */
    async getHead() {
        this.checkDisposed();
        return this.provider.getHead();
    }
    /**
     * 硬重置到指定提交（丢弃之后的所有提交）
     * 类似于 git reset --hard <ref>
     */
    async revert(ref) {
        this.checkDisposed();
        // 获取当前 HEAD 和目标之间的差异（在 revert 之前）
        const currentHead = await this.provider.getHead();
        const diffs = await this.provider.diff(currentHead.hash, ref);
        // 执行 revert
        await this.provider.revert(ref);
        // 为每个变更的文件发射事件
        await this.emitCheckoutChangeEvents(diffs);
        // 发射 revert 事件
        await this.events.emit({
            type: 'version:revert',
            ref,
            timestamp: Date.now(),
        });
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
export function createVfs(provider) {
    if (isVersionedProvider(provider)) {
        return new VersionedVfs(provider);
    }
    return new Vfs(provider);
}
//# sourceMappingURL=vfs.js.map