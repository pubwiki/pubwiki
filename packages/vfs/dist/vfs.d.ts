import type { VfsFile, VfsFolder, VfsStat, VfsCommit, VfsDiff } from './types';
import type { VfsProvider } from './interfaces/vfs-provider';
import type { VersionedVfsProvider } from './interfaces/versioned-vfs-provider';
import { VfsEventBus } from './events';
/**
 * 基础 VFS 类
 *
 * 提供文件系统操作和事件监听。
 */
export declare class Vfs<P extends VfsProvider = VfsProvider> {
    protected readonly provider: P;
    /** 事件总线 */
    readonly events: VfsEventBus;
    protected disposed: boolean;
    constructor(provider: P);
    /**
     * 初始化 VFS
     */
    initialize(): Promise<void>;
    /**
     * 销毁 VFS，释放资源
     */
    dispose(): Promise<void>;
    /**
     * 创建文件
     */
    createFile(path: string, content: ArrayBuffer | string): Promise<VfsFile>;
    /**
     * 读取文件
     */
    readFile(path: string): Promise<VfsFile>;
    /**
     * 更新文件内容
     */
    updateFile(path: string, content: ArrayBuffer | string): Promise<VfsFile>;
    /**
     * 删除文件
     */
    deleteFile(path: string): Promise<void>;
    /**
     * 创建文件夹
     */
    createFolder(path: string): Promise<VfsFolder>;
    /**
     * 列出文件夹内容
     */
    listFolder(path: string): Promise<Array<VfsFile | VfsFolder>>;
    /**
     * 删除文件夹
     */
    deleteFolder(path: string, recursive?: boolean): Promise<void>;
    /**
     * 递归发射删除事件（用于递归删除文件夹时）
     */
    private emitDeleteEventsRecursive;
    /**
     * 移动文件或文件夹
     */
    moveItem(fromPath: string, toPath: string): Promise<void>;
    /**
     * 收集文件夹中的所有子项（递归）
     */
    private collectChildItems;
    /**
     * 为子项发射移动事件
     */
    private emitMoveEventsForChildren;
    /**
     * 复制文件
     */
    copyItem(fromPath: string, toPath: string): Promise<void>;
    /**
     * 检查路径是否存在
     */
    exists(path: string): Promise<boolean>;
    /**
     * 获取文件/目录状态
     */
    stat(path: string): Promise<VfsStat>;
    protected checkDisposed(): void;
    private toUint8Array;
    protected buildFileObject(path: string, content?: ArrayBuffer | string | Uint8Array): Promise<VfsFile>;
    protected buildFolderObject(path: string): Promise<VfsFolder>;
}
/**
 * 带版本控制的 VFS 类
 *
 * 继承基础 Vfs，添加 Git 风格的版本控制方法。
 */
export declare class VersionedVfs extends Vfs<VersionedVfsProvider> {
    constructor(provider: VersionedVfsProvider);
    /**
     * 提交更改
     */
    commit(message: string, options?: {
        author?: string;
        email?: string;
    }): Promise<VfsCommit>;
    /**
     * 获取提交历史
     */
    getHistory(options?: {
        path?: string;
        depth?: number;
        ref?: string;
    }): Promise<VfsCommit[]>;
    /**
     * 获取提交历史（getHistory 的别名）
     */
    history(depth?: number): Promise<VfsCommit[]>;
    /**
     * 检出到指定版本
     */
    checkout(ref: string): Promise<void>;
    /**
     * 根据 diff 结果发射文件变更事件
     */
    private emitCheckoutChangeEvents;
    /**
     * 比较两个版本的差异
     */
    diff(commitA: string, commitB: string): Promise<VfsDiff[]>;
    /**
     * 获取当前分支
     */
    getCurrentBranch(): Promise<string>;
    /**
     * 获取 HEAD 提交
     */
    getHead(): Promise<VfsCommit>;
    /**
     * 硬重置到指定提交（丢弃之后的所有提交）
     * 类似于 git reset --hard <ref>
     */
    revert(ref: string): Promise<void>;
}
/**
 * 创建 VFS 实例
 *
 * 根据 Provider 类型自动返回正确类型的 VFS 实例：
 * - 如果是 VersionedVfsProvider，返回 VersionedVfs（包含 Git 方法）
 * - 否则返回基础 Vfs
 */
export declare function createVfs<P extends VfsProvider>(provider: P): P extends VersionedVfsProvider ? VersionedVfs : Vfs<P>;
//# sourceMappingURL=vfs.d.ts.map