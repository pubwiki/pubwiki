/**
 * Re-export sync types from rdfsync
 */
export type {
  Quad,
  TextPatch,
  PatchHunk,
  Operation,
  OperationWithRef,
  SyncOperationsRequest,
  SyncOperationsResponse,
  SyncErrorType,
  RefMismatchInfo,
} from '@pubwiki/rdfsync';

import type { Operation } from '@pubwiki/rdfsync';

/**
 * 从 rpc-types 导入并重新导出共用类型
 */
export type {
  SaveMetadata,
  ExportResult,
  CheckpointMetadata,
  CheckpointInfo,
  CheckpointVisibility,
  GameSaveRPC,
} from './rpc-types';

/**
 * Quad 查询模式（仅内部使用）
 */
export interface QuadPattern {
  subject?: string;
  predicate?: string;
  object?: string;
  graph?: string;
}

/**
 * Version DAG 节点（内部使用精确的 Operation 类型）
 */
export interface RefNode {
  ref: string;
  parent: string | null;
  operation: Operation;
  timestamp: number;
}

/**
 * 查找最近 checkpoint 的结果（仅内部使用）
 */
export interface NearestCheckpointResult {
  /** 最近的 checkpoint ref（如果没有则为 ROOT_REF） */
  checkpointRef: string;
  /** 从 checkpoint 到目标 ref 需要重放的 ref 列表（不包含 checkpoint 本身） */
  pathFromCheckpoint: string[];
}
