/**
 * GameSave Worker RPC 接口类型
 * 此文件专门用于导出 RPC 类型给其他包使用
 * 不依赖任何 Cloudflare Worker 特定类型
 * 
 * 纯 Checkpoint 存储模式：
 * - 不维护当前状态，只存储 checkpoint 快照
 * - createCheckpoint 直接传入完整的 quads 数组
 * - 类型定义与 OpenAPI 中的 Quad 类型保持一致
 */

import type { Quad, CheckpointVisibility } from '@pubwiki/api';

// Re-export for consumers
export type { Quad, CheckpointVisibility };

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
 * Checkpoint 创建选项
 */
export interface CreateCheckpointOptions {
  /** 用户自定义 ID，不传则自动生成 UUID */
  id?: string;
  name?: string;
  description?: string;
  visibility?: CheckpointVisibility;
}

/**
 * Checkpoint 信息
 */
export interface CheckpointInfo {
  id: string;
  timestamp: number;
  quadCount: number;
  name?: string;
  description?: string;
  visibility: CheckpointVisibility;
}

/**
 * 导出 Checkpoint 结果
 */
export interface ExportCheckpointResult {
  quads: Quad[];
  quadCount: number;
}

/**
 * GameSave Worker RPC 接口类型
 * 用于 Service Binding 调用
 * 
 * 纯 Checkpoint 存储模式 API:
 * - 不维护当前状态
 * - createCheckpoint 直接传入 quads 数组创建快照
 */
export interface GameSaveRPC {
  // ============ 存档初始化与元数据 ============
  /** 初始化存档 */
  initializeSave(saveId: string, userId: string, stateNodeId: string): Promise<void>;
  /** 获取存档元数据 */
  getMetadata(saveId: string): Promise<SaveMetadata | null>;
  /** 清空存档（删除所有 checkpoints） */
  clearSave(saveId: string): Promise<void>;
  
  // ============ Checkpoint API ============
  /** 
   * 创建 checkpoint - 直接传入完整的 quads 快照
   * @param saveId 存档 ID
   * @param quads 完整的 RDF quad 数据（与 OpenAPI Quad 类型一致）
   * @param options 可选的元数据（id, name, description, visibility）
   * @returns 创建的 checkpoint ID
   */
  createCheckpoint(saveId: string, quads: Quad[], options?: CreateCheckpointOptions): Promise<string>;
  
  /** 列出所有 checkpoints */
  listCheckpoints(saveId: string, accessLevel?: 'owner' | 'public'): Promise<CheckpointInfo[]>;
  
  /** 按 ID 获取 checkpoint 信息 */
  getCheckpoint(saveId: string, checkpointId: string): Promise<CheckpointInfo | null>;
  
  /** 导出 checkpoint 数据 */
  exportCheckpoint(saveId: string, checkpointId: string): Promise<ExportCheckpointResult | null>;
  
  /** 更新 checkpoint 可见性 */
  updateCheckpointVisibility(saveId: string, checkpointId: string, visibility: CheckpointVisibility): Promise<boolean>;
  
  /** 按 ID 删除 checkpoint */
  deleteCheckpoint(saveId: string, checkpointId: string): Promise<boolean>;
  
  /** 获取 checkpoint 总数 */
  getCheckpointCount(saveId: string): Promise<number>;
}
