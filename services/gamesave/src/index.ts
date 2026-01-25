/**
 * GameSave Worker - Cloudflare Worker 入口
 * 
 * 使用 WorkerEntrypoint 提供 RPC 接口，供 hub 通过 Service Binding 调用
 * 
 * 支持区块链式可验证状态同步:
 * - syncOperations: 可验证同步 API，验证客户端计算的 ref
 * 
 * 设计变更：
 * - 移除 currentRef 概念，每个 ref 都是独立的状态点
 * - 新增 checkpoint 机制加速历史版本恢复
 * - 新增 exportAtRef 支持导出任意历史版本
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import type {
  Quad,
  QuadPattern, 
  SaveMetadata, 
  RefNode, 
  ExportResult,
  OperationWithRef,
  SyncOperationsResponse,
  CheckpointMetadata,
  CheckpointInfo,
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

  // ============ Blockchain-style Verifiable Sync ============

  /**
   * 可验证的批量同步操作
   * 
   * 验证流程:
   * 1. 检查 baseRef 是否存在于服务端历史
   * 2. 对每个操作验证客户端计算的 ref 是否正确
   * 3. 应用操作并记录到 version DAG
   * 
   * @param saveId - 存档 ID
   * @param baseRef - 操作基于的 ref
   * @param operations - 带有客户端计算的 ref 的操作列表
   * @returns 同步结果
   */
  async syncOperations(
    saveId: string,
    baseRef: string,
    operations: OperationWithRef[]
  ): Promise<SyncOperationsResponse> {
    const stub = this.getSaveStub(saveId);
    return stub.syncOperations(baseRef, operations);
  }

  /**
   * 检查 ref 是否存在于服务端历史
   */
  async refExists(saveId: string, ref: string): Promise<boolean> {
    const stub = this.getSaveStub(saveId);
    return stub.refExists(ref);
  }

  /**
   * 导出任意 ref 处的数据
   */
  async exportAtRef(saveId: string, ref: string): Promise<ExportResult> {
    const stub = this.getSaveStub(saveId);
    return stub.exportAtRef(ref);
  }

  /**
   * 获取版本历史
   */
  async getHistory(saveId: string, limit?: number): Promise<RefNode[]> {
    const stub = this.getSaveStub(saveId);
    return stub.getHistory(limit);
  }

  /**
   * 获取 quad 数量
   */
  async getQuadCount(saveId: string): Promise<number> {
    const stub = this.getSaveStub(saveId);
    return stub.getQuadCount();
  }

  /**
   * 获取版本数量
   */
  async getVersionCount(saveId: string): Promise<number> {
    const stub = this.getSaveStub(saveId);
    return stub.getVersionCount();
  }

  /**
   * 清空存档数据
   */
  async clearSave(saveId: string): Promise<void> {
    const stub = this.getSaveStub(saveId);
    await stub.clear();
  }

  // ============ Checkpoint API ============

  /**
   * 在指定 ref 处创建 checkpoint
   * @returns checkpoint ID
   */
  async createCheckpoint(saveId: string, ref: string, metadata?: CheckpointMetadata): Promise<string> {
    const stub = this.getSaveStub(saveId);
    return stub.createCheckpoint(ref, metadata);
  }

  /**
   * 获取 checkpoint 列表
   * @param accessLevel - 'owner' 返回所有 checkpoint，'public' 仅返回 PUBLIC 的
   */
  async listCheckpoints(saveId: string, accessLevel: 'owner' | 'public' = 'owner'): Promise<CheckpointInfo[]> {
    const stub = this.getSaveStub(saveId);
    return stub.listCheckpoints(accessLevel);
  }

  /**
   * 按 ID 获取单个 checkpoint 信息
   */
  async getCheckpoint(saveId: string, checkpointId: string): Promise<CheckpointInfo | null> {
    const stub = this.getSaveStub(saveId);
    return stub.getCheckpoint(checkpointId);
  }

  /**
   * 按 ID 更新 checkpoint 的可见性
   */
  async updateCheckpointVisibility(saveId: string, checkpointId: string, visibility: CheckpointVisibility): Promise<boolean> {
    const stub = this.getSaveStub(saveId);
    return stub.updateCheckpointVisibility(checkpointId, visibility);
  }

  /**
   * 按 ID 删除指定的 checkpoint
   */
  async deleteCheckpoint(saveId: string, checkpointId: string): Promise<boolean> {
    const stub = this.getSaveStub(saveId);
    return stub.deleteCheckpoint(checkpointId);
  }

  /**
   * 检查指定 ref 是否有非 PRIVATE 的 checkpoint（可公开访问）
   */
  async isRefPubliclyAccessible(saveId: string, ref: string): Promise<boolean> {
    const stub = this.getSaveStub(saveId);
    return stub.isRefPubliclyAccessible(ref);
  }

  /**
   * HTTP 请求处理 (可选，用于直接访问 worker)
   */
  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({
      service: 'pubwiki-gamesave',
      message: 'Use Service Binding RPC to access this worker',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
