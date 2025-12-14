/**
 * VFS 操作类型
 */
export type VfsOperationType = 'create' | 'update' | 'delete' | 'move' | 'copy';
/**
 * VFS 操作目标类型
 */
export type VfsOperationTargetType = 'file' | 'folder';
/**
 * VFS 操作记录
 */
export interface VfsOperation {
    /** 操作唯一标识 */
    id: string;
    /** 操作类型 */
    type: VfsOperationType;
    /** 目标类型 */
    targetType: VfsOperationTargetType;
    /** 目标路径 */
    targetPath: string;
    /** 操作时间戳 */
    timestamp: Date;
    /** 操作用户 ID */
    userId?: string;
    /** 操作相关数据 */
    payload: unknown;
}
/**
 * VFS 提交记录（Git 风格）
 */
export interface VfsCommit {
    /** 提交哈希 */
    hash: string;
    /** 提交信息 */
    message: string;
    /** 作者 */
    author: string;
    /** 提交时间 */
    timestamp: Date;
    /** 变更列表 */
    changes: VfsCommitChange[];
}
/**
 * 提交变更项
 */
export interface VfsCommitChange {
    /** 变更类型 */
    type: 'added' | 'modified' | 'deleted';
    /** 文件路径 */
    path: string;
}
/**
 * VFS Diff 结果
 */
export interface VfsDiff {
    /** Diff 类型 */
    type: 'added' | 'modified' | 'deleted';
    /** 文件路径 */
    path: string;
    /** 旧内容 */
    oldContent?: string;
    /** 新内容 */
    newContent?: string;
}
//# sourceMappingURL=operation.d.ts.map