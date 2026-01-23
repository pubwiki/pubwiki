/**
 * GameSave Worker RPC 接口类型
 * 此文件专门用于导出 RPC 类型给其他包使用
 * 不依赖任何 Cloudflare Worker 特定类型
 */

/**
 * RPC 接口使用的 Operation 类型
 * 使用宽松类型以兼容 OpenAPI 生成的类型和 rdfsync 的类型
 */
export interface RPCOperation {
  type: 'insert' | 'delete' | 'batch-insert' | 'batch-delete' | 'patch';
  quad?: {
    subject: string;
    predicate: string;
    object: string;
    objectDatatype?: string | null;
    objectLanguage?: string | null;
    graph?: string;
  };
  quads?: Array<{
    subject: string;
    predicate: string;
    object: string;
    objectDatatype?: string | null;
    objectLanguage?: string | null;
    graph?: string;
  }>;
  subject?: string;
  predicate?: string;
  patch?: {
    originalLength: number;
    hunks: Array<{
      start: number;
      deleteCount: number;
      insert: string;
    }>;
  };
}

/**
 * RPC 接口使用的 OperationWithRef 类型
 */
export interface RPCOperationWithRef {
  operation: RPCOperation;
  ref: string;
}

/**
 * 同步操作响应类型
 */
export interface RPCSyncOperationsResponse {
  success: boolean;
  finalRef?: string;
  error?: 'UNKNOWN_BASE_REF' | 'REF_MISMATCH' | 'INVALID_OPERATION' | 'INTERNAL_ERROR';
  message?: string;
  mismatch?: {
    index: number;
    expected: string;
    received: string;
  };
  affectedCount?: number;
}

/**
 * 存档元数据
 */
export interface SaveMetadata {
  userId: string;
  stateNodeId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Version DAG 节点
 */
export interface RefNode {
  ref: string;
  parent: string | null;
  operation: unknown; // 使用 unknown 避免导入复杂类型
  timestamp: number;
}

/**
 * 导出结果
 */
export interface ExportResult {
  data: string;
  ref: string;
  quadCount: number;
}

/**
 * Checkpoint 元数据
 */
export interface CheckpointMetadata {
  name?: string;
  description?: string;
  visibility?: CheckpointVisibility;
}

/**
 * Checkpoint 可见性
 */
export type CheckpointVisibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';

/**
 * Checkpoint 信息
 */
export interface CheckpointInfo {
  ref: string;
  timestamp: number;
  quadCount: number;
  name?: string;
  description?: string;
  visibility: CheckpointVisibility;
}

/**
 * GameSave Worker RPC 接口类型
 * 用于 Service Binding 调用
 */
export interface GameSaveRPC {
  initializeSave(saveId: string, userId: string, stateNodeId: string): Promise<void>;
  getMetadata(saveId: string): Promise<SaveMetadata | null>;
  // ============ Blockchain-style Verifiable Sync ============
  syncOperations(
    saveId: string,
    baseRef: string,
    operations: RPCOperationWithRef[]
  ): Promise<RPCSyncOperationsResponse>;
  refExists(saveId: string, ref: string): Promise<boolean>;
  // ============ 版本历史 ============
  getHistory(saveId: string, limit?: number): Promise<RefNode[]>;
  getQuadCount(saveId: string): Promise<number>;
  getVersionCount(saveId: string): Promise<number>;
  clearSave(saveId: string): Promise<void>;
  // ============ 历史版本导出 ============
  exportAtRef(saveId: string, ref: string): Promise<ExportResult>;
  // ============ Checkpoint API ============
  createCheckpoint(saveId: string, ref: string, metadata?: CheckpointMetadata): Promise<void>;
  listCheckpoints(saveId: string, accessLevel?: 'owner' | 'public'): Promise<CheckpointInfo[]>;
  getCheckpoint(saveId: string, ref: string): Promise<CheckpointInfo | null>;
  updateCheckpointVisibility(saveId: string, ref: string, visibility: CheckpointVisibility): Promise<boolean>;
  deleteCheckpoint(saveId: string, ref: string): Promise<boolean>;
}
