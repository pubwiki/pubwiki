/**
 * GameSave Worker - Cloudflare Worker 入口
 * 
 * 纯 Checkpoint 存储模式：
 * - 不维护当前状态，只存储 checkpoint 快照
 * - createCheckpoint 直接传入完整的 quads 数组
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Quad } from '@pubwiki/api';
import type { 
  SaveMetadata, 
  CreateCheckpointOptions,
  CheckpointInfo,
  ExportCheckpointResult,
  CheckpointVisibility,
  GameSaveRPC,
} from './types';
import { CloudSaveObject } from './object';

// 导出 Durable Object 类
export { CloudSaveObject };

// 导出 RPC 接口类型
export type { GameSaveRPC };

/**
 * GameSave Worker Entrypoint
 * 提供 RPC 方法供 hub 调用
 */
export default class GameSaveWorker extends WorkerEntrypoint<Env> implements GameSaveRPC {
  /**
   * 获取存档的 Durable Object stub
   */
  private getSaveStub(saveId: string) {
    const id = this.env.CLOUD_SAVE.idFromName(saveId);
    return this.env.CLOUD_SAVE.get(id) as DurableObjectStub<CloudSaveObject>;
  }

  // ============ 存档初始化与元数据 ============

  /**
   * 初始化存档
   */
  async initializeSave(saveId: string, userId: string, stateNodeId: string): Promise<void> {
    const stub = this.getSaveStub(saveId);
    await stub.initialize(userId, stateNodeId);
  }

  /**
   * 获取存档元数据
   */
  async getMetadata(saveId: string): Promise<SaveMetadata | null> {
    const stub = this.getSaveStub(saveId);
    return stub.getMetadata();
  }

  /**
   * 清空存档（删除所有 checkpoints）
   */
  async clearSave(saveId: string): Promise<void> {
    const stub = this.getSaveStub(saveId);
    await stub.clear();
  }

  // ============ Checkpoint API ============

  /**
   * 创建 checkpoint - 直接传入完整的 quads 快照
   * @returns checkpoint ID
   */
  async createCheckpoint(saveId: string, quads: Quad[], options?: CreateCheckpointOptions): Promise<string> {
    const stub = this.getSaveStub(saveId);
    return stub.createCheckpoint(quads, options);
  }

  /**
   * 列出所有 checkpoints
   */
  async listCheckpoints(saveId: string, accessLevel?: 'owner' | 'public'): Promise<CheckpointInfo[]> {
    const stub = this.getSaveStub(saveId);
    return stub.listCheckpoints(accessLevel);
  }

  /**
   * 按 ID 获取 checkpoint 信息
   */
  async getCheckpoint(saveId: string, checkpointId: string): Promise<CheckpointInfo | null> {
    const stub = this.getSaveStub(saveId);
    return stub.getCheckpoint(checkpointId);
  }

  /**
   * 导出 checkpoint 数据
   */
  async exportCheckpoint(saveId: string, checkpointId: string): Promise<ExportCheckpointResult | null> {
    const stub = this.getSaveStub(saveId);
    return stub.exportCheckpoint(checkpointId);
  }

  /**
   * 更新 checkpoint 可见性
   */
  async updateCheckpointVisibility(saveId: string, checkpointId: string, visibility: CheckpointVisibility): Promise<boolean> {
    const stub = this.getSaveStub(saveId);
    return stub.updateCheckpointVisibility(checkpointId, visibility);
  }

  /**
   * 按 ID 删除 checkpoint
   */
  async deleteCheckpoint(saveId: string, checkpointId: string): Promise<boolean> {
    const stub = this.getSaveStub(saveId);
    return stub.deleteCheckpoint(checkpointId);
  }

  /**
   * 获取 checkpoint 总数
   */
  async getCheckpointCount(saveId: string): Promise<number> {
    const stub = this.getSaveStub(saveId);
    return stub.getCheckpointCount();
  }
}
