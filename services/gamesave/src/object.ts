/**
 * CloudSaveObject - Durable Object for Cloud Save Storage
 * 
 * 使用 Cloudflare Durable Object 的 SQLite backend 存储 RDF quads
 * 每个存档实例拥有独立的 SQLite 数据库
 * 
 * 支持区块链式可验证状态同步:
 * - 确定性 ref 生成: ref = SHA256(parentRef + canonical(operation))[0:16]
 * - 链式验证: 客户端和服务端使用相同算法生成 ref
 * - 分叉检测: 通过 baseRef 验证状态一致性
 * 
 * 设计理念：
 * - 移除 currentRef 概念，每个 ref 都是独立的状态点
 * - 使用 checkpoint 机制加速历史版本恢复
 */

import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import * as schema from './schema';
import { quads, versionDag, metadata, checkpoints, checkpointQuads } from './schema';
import type {
  Quad, 
  Operation, 
  QuadPattern, 
  SaveMetadata, 
  RefNode, 
  ExportResult,
  OperationWithRef,
  SyncOperationsResponse,
  CheckpointMetadata,
  CheckpointInfo,
  CheckpointVisibility,
  NearestCheckpointResult,
} from './types';
import { ROOT_REF, generateRef, quadsToJsonl, normalizeQuad, quadKey } from './serialization';
import migrations from './drizzle/migrations';

/** 自动创建 checkpoint 的操作间隔 */
const CHECKPOINT_INTERVAL = 100;


export class CloudSaveObject extends DurableObject<Env> {
  private db: DrizzleSqliteDODatabase<typeof schema>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });

    // 在接受请求前完成迁移
    ctx.blockConcurrencyWhile(async () => {
      await this.migrate();
    });
  }

  /**
   * 执行 Drizzle 迁移
   */
  private async migrate(): Promise<void> {
    migrate(this.db, migrations);
  }

  /**
   * 初始化存档 (关联用户和 sandbox node)
   * cachedRef 记录 quads 表当前缓存的是哪个 ref 的状态
   */
  async initialize(userId: string, stateNodeId: string): Promise<void> {
    const now = Date.now();
    
    // 使用事务插入初始元数据
    // cachedRef: quads 表当前缓存的状态对应的 ref（初始为 ROOT_REF = 空状态）
    await this.db.insert(metadata).values([
      { key: 'userId', value: userId },
      { key: 'stateNodeId', value: stateNodeId },
      { key: 'cachedRef', value: ROOT_REF },
      { key: 'createdAt', value: String(now) },
      { key: 'updatedAt', value: String(now) },
    ]).onConflictDoNothing();
  }

  /**
   * 获取元数据
   */
  async getMetadata(): Promise<SaveMetadata | null> {
    const rows = await this.db.select().from(metadata);
    if (rows.length === 0) return null;
    
    const data: Record<string, string> = {};
    for (const row of rows) {
      data[row.key] = row.value;
    }
    
    return {
      userId: data['userId'] || '',
      // 兼容旧数据：优先读取 stateNodeId，如果不存在则读取旧的 sandboxNodeId
      stateNodeId: data['stateNodeId'] || data['sandboxNodeId'] || '',
      createdAt: parseInt(data['createdAt'] || '0', 10),
      updatedAt: parseInt(data['updatedAt'] || '0', 10),
    };
  }

  // ============ Blockchain-style Verifiable Sync ============

  /**
   * 检查 ref 是否存在于服务端历史中
   */
  async refExists(ref: string): Promise<boolean> {
    if (ref === ROOT_REF) return true;
    const node = await this.db
      .select()
      .from(versionDag)
      .where(eq(versionDag.ref, ref))
      .limit(1);
    return node.length > 0;
  }

  /**
   * 获取 quads 表当前缓存的 ref
   * quads 表是某个 ref 状态的缓存，用于加速增量操作
   */
  async getCachedRef(): Promise<string> {
    const row = await this.db.select().from(metadata)
      .where(eq(metadata.key, 'cachedRef'))
      .limit(1);
    return row[0]?.value || ROOT_REF;
  }

  /**
   * Checkout 到指定 ref 的状态
   * 使用 exportAtRef 构建目标状态，然后替换 quads 表
   */
  private async checkoutToRef(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    targetRef: string
  ): Promise<void> {
    // 如果是 ROOT_REF，清空 quads 表即可
    if (targetRef === ROOT_REF) {
      await tx.delete(quads);
      await tx.update(metadata)
        .set({ value: ROOT_REF })
        .where(eq(metadata.key, 'cachedRef'));
      return;
    }

    // 构建目标 ref 的状态（在内存中）
    const exportResult = await this.exportAtRef(targetRef);
    const targetQuads = exportResult.data
      ? exportResult.data.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Quad)
      : [];

    // 清空当前 quads 表并插入目标状态
    await tx.delete(quads);
    
    if (targetQuads.length > 0) {
      const values = targetQuads.map(q => {
        const normalized = normalizeQuad(q);
        return {
          subject: normalized.subject,
          predicate: normalized.predicate,
          object: normalized.object,
          objectDatatype: normalized.objectDatatype,
          objectLanguage: normalized.objectLanguage,
          graph: normalized.graph,
        };
      });
      await tx.insert(quads).values(values).onConflictDoNothing();
    }

    // 更新 cachedRef
    await tx.update(metadata)
      .set({ value: targetRef })
      .where(eq(metadata.key, 'cachedRef'));
  }

  /**
   * 可验证的批量同步操作
   * 
   * 验证流程:
   * 1. 检查 baseRef 是否存在于服务端历史
   * 2. 对每个操作验证客户端提供的 ref 是否正确
   * 3. 如果 baseRef != cachedRef，先 checkout 到 baseRef 的状态
   * 4. 应用操作并记录到 version DAG
   * 5. 更新 cachedRef 为最终的 ref
   * 
   * quads 表语义：上一次 syncOperations 后的状态缓存
   * 
   * 使用事务确保原子性：验证失败或执行失败时回滚所有更改
   * 
   * @param baseRef - 操作基于的 ref
   * @param operations - 带有客户端计算的 ref 的操作列表
   * @returns 同步结果
   */
  async syncOperations(
    baseRef: string,
    operations: OperationWithRef[]
  ): Promise<SyncOperationsResponse> {
    // 0. 输入验证
    if (!baseRef || typeof baseRef !== 'string') {
      return {
        success: false,
        error: 'INVALID_OPERATION',
        message: 'baseRef is required and must be a string',
      };
    }

    if (!Array.isArray(operations)) {
      return {
        success: false,
        error: 'INVALID_OPERATION',
        message: 'operations must be an array',
      };
    }

    // 验证每个 OperationWithRef 的格式
    for (let i = 0; i < operations.length; i++) {
      const opWithRef = operations[i];
      if (!opWithRef || typeof opWithRef !== 'object') {
        return {
          success: false,
          error: 'INVALID_OPERATION',
          message: `Operation at index ${i} must be an object`,
        };
      }
      if (!opWithRef.operation || typeof opWithRef.operation !== 'object') {
        return {
          success: false,
          error: 'INVALID_OPERATION',
          message: `Operation at index ${i} must have an 'operation' field`,
        };
      }
      if (!opWithRef.ref || typeof opWithRef.ref !== 'string') {
        return {
          success: false,
          error: 'INVALID_OPERATION',
          message: `Operation at index ${i} must have a 'ref' field`,
        };
      }
      const op = opWithRef.operation;
      if (!op.type || !['insert', 'delete', 'batch-insert', 'batch-delete', 'patch'].includes(op.type)) {
        return {
          success: false,
          error: 'INVALID_OPERATION',
          message: `Operation at index ${i} has invalid type '${op.type}'. Expected one of: insert, delete, batch-insert, batch-delete, patch`,
        };
      }
    }

    // 1. 验证 baseRef 是否存在（在事务外检查，避免不必要的事务开销）
    const baseExists = await this.refExists(baseRef);
    if (!baseExists) {
      return {
        success: false,
        error: 'UNKNOWN_BASE_REF',
        message: `The baseRef '${baseRef}' does not exist in server history`,
      };
    }

    if (operations.length === 0) {
      return {
        success: true,
        finalRef: baseRef,
        affectedCount: 0,
      };
    }

    const timestamp = Date.now();

    // 2. 在事务外预先验证所有 ref（避免应用操作后才发现 ref 不匹配）
    let currentRef = baseRef;
    for (let i = 0; i < operations.length; i++) {
      const { operation, ref: clientRef } = operations[i];
      const serverRef = await generateRef(currentRef, operation);
      
      if (serverRef !== clientRef) {
        return {
          success: false,
          error: 'REF_MISMATCH',
          message: `Ref mismatch at operation ${i}`,
          mismatch: {
            index: i,
            expected: serverRef,
            received: clientRef,
          },
        };
      }
      currentRef = serverRef;
    }

    // 3. 获取当前缓存的 ref，判断是否需要 checkout
    const cachedRef = await this.getCachedRef();

    // 4. 验证通过后，在事务中执行所有操作
    try {
      const result = await this.db.transaction(async (tx) => {
        // 如果 baseRef 与 cachedRef 不同，需要先 checkout 到 baseRef 的状态
        // 这处理了分叉场景：客户端基于早期版本同步操作
        if (baseRef !== cachedRef) {
          await this.checkoutToRef(tx, baseRef);
        }

        let totalAffected = 0;
        let txCurrentRef = baseRef;

        for (const { operation, ref } of operations) {
          // 应用操作
          const affected = await this.applyOperationInTx(tx, operation);
          totalAffected += affected;

          // 记录到 version DAG
          await tx.insert(versionDag).values({
            ref,
            parent: txCurrentRef,
            operation: JSON.stringify(operation),
            timestamp,
          });
          txCurrentRef = ref;
        }

        // 更新 cachedRef 为最终的 ref
        await tx.update(metadata)
          .set({ value: txCurrentRef })
          .where(eq(metadata.key, 'cachedRef'));

        // 更新 updatedAt
        await tx.update(metadata)
          .set({ value: String(timestamp) })
          .where(eq(metadata.key, 'updatedAt'));

        return { finalRef: txCurrentRef, totalAffected };
      });

      // 自动创建 checkpoint（每 CHECKPOINT_INTERVAL 个操作）
      const versionCount = await this.getVersionCount();
      if (versionCount % CHECKPOINT_INTERVAL === 0 && versionCount > 0) {
        // 异步创建 checkpoint，不阻塞响应
        this.createCheckpointInternal(result.finalRef).catch(err => {
          console.error('Auto-checkpoint failed:', err);
        });
      }

      return {
        success: true,
        finalRef: result.finalRef,
        affectedCount: result.totalAffected,
      };
    } catch (error) {
      console.error('Transaction failed in syncOperations:', error);
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Transaction failed while applying operations',
      };
    }
  }

  /**
   * 应用单个操作到数据库（在事务中）
   * @param tx - Drizzle 事务实例
   * @param operation - 要执行的操作
   */
  private async applyOperationInTx(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    operation: Operation
  ): Promise<number> {
    switch (operation.type) {
      case 'insert': {
        const quad = normalizeQuad(operation.quad);
        try {
          await tx.insert(quads).values({
            subject: quad.subject,
            predicate: quad.predicate,
            object: quad.object,
            objectDatatype: quad.objectDatatype,
            objectLanguage: quad.objectLanguage,
            graph: quad.graph,
          }).onConflictDoNothing();
          return 1;
        } catch {
          return 0;
        }
      }

      case 'delete': {
        const quad = normalizeQuad(operation.quad);
        await tx.delete(quads).where(
          and(
            eq(quads.subject, quad.subject),
            eq(quads.predicate, quad.predicate),
            eq(quads.object, quad.object),
            eq(quads.objectDatatype, quad.objectDatatype),
            eq(quads.graph, quad.graph)
          )
        );
        return 1;
      }

      case 'batch-insert': {
        const values = operation.quads.map(q => {
          const quad = normalizeQuad(q);
          return {
            subject: quad.subject,
            predicate: quad.predicate,
            object: quad.object,
            objectDatatype: quad.objectDatatype,
            objectLanguage: quad.objectLanguage,
            graph: quad.graph,
          };
        });
        if (values.length === 0) return 0;
        await tx.insert(quads).values(values).onConflictDoNothing();
        return values.length;
      }

      case 'batch-delete': {
        let deleted = 0;
        for (const q of operation.quads) {
          const quad = normalizeQuad(q);
          await tx.delete(quads).where(
            and(
              eq(quads.subject, quad.subject),
              eq(quads.predicate, quad.predicate),
              eq(quads.object, quad.object),
              eq(quads.objectDatatype, quad.objectDatatype),
              eq(quads.graph, quad.graph)
            )
          );
          deleted += 1;
        }
        return deleted;
      }

      case 'patch': {
        // Patch 操作：查找匹配的 Literal，应用文本补丁
        const rows = await tx.select().from(quads).where(
          and(
            eq(quads.subject, operation.subject),
            eq(quads.predicate, operation.predicate)
          )
        );
        
        if (rows.length === 0) return 0;

        // 对每个匹配的 quad 应用补丁
        for (const row of rows) {
          // 只对 Literal 类型应用补丁
          if (!row.object.startsWith('<') && !row.object.startsWith('_:')) {
            const newValue = applyTextPatch(row.object, operation.patch);
            await tx.update(quads)
              .set({ object: newValue })
              .where(eq(quads.id, row.id));
          }
        }
        return rows.length;
      }

      default:
        return 0;
    }
  }

  /**
   * 获取版本历史
   */
  async getHistory(limit: number = 50): Promise<RefNode[]> {
    const rows = await this.db.select().from(versionDag)
      .orderBy(desc(versionDag.timestamp), sql`rowid DESC`)
      .limit(limit);

    return rows.map(row => ({
      ref: row.ref,
      parent: row.parent,
      operation: JSON.parse(row.operation) as Operation,
      timestamp: row.timestamp,
    }));
  }

  /**
   * 获取 quad 数量
   */
  async getQuadCount(): Promise<number> {
    const result = await this.db.select({ count: count() }).from(quads);
    return result[0]?.count ?? 0;
  }

  /**
   * 获取版本数量
   */
  async getVersionCount(): Promise<number> {
    const result = await this.db.select({ count: count() }).from(versionDag);
    return result[0]?.count ?? 0;
  }

  /**
   * 清空所有数据 (危险操作)
   * 重置 cachedRef 为 ROOT_REF
   */
  async clear(): Promise<void> {
    await this.db.delete(quads);
    await this.db.delete(versionDag);
    await this.db.delete(checkpoints);
    await this.db.delete(checkpointQuads);
    // 重置 cachedRef 为 ROOT_REF
    await this.db.update(metadata)
      .set({ value: ROOT_REF })
      .where(eq(metadata.key, 'cachedRef'));
  }

  // ============ Checkpoint 机制 ============

  /**
   * 获取 version DAG 中的某个节点
   */
  private async getNode(ref: string): Promise<RefNode | null> {
    const rows = await this.db.select().from(versionDag)
      .where(eq(versionDag.ref, ref))
      .limit(1);
    
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      ref: row.ref,
      parent: row.parent,
      operation: JSON.parse(row.operation) as Operation,
      timestamp: row.timestamp,
    };
  }

  /**
   * 获取从 ROOT 到目标 ref 的路径
   * 返回 ref 列表，从 ROOT 之后的第一个节点开始，到目标 ref 结束
   */
  private async getPathToRef(targetRef: string): Promise<string[]> {
    if (targetRef === ROOT_REF) return [];
    
    const path: string[] = [];
    let current: string | null = targetRef;
    
    while (current && current !== ROOT_REF) {
      path.unshift(current);
      const node = await this.getNode(current);
      if (!node) break;
      current = node.parent;
    }
    
    return path;
  }

  /**
   * 查找从 ROOT 到目标 ref 路径上最近的 checkpoint
   */
  async findNearestCheckpoint(targetRef: string): Promise<NearestCheckpointResult> {
    if (targetRef === ROOT_REF) {
      return { checkpointRef: ROOT_REF, pathFromCheckpoint: [] };
    }

    // 获取完整路径
    const fullPath = await this.getPathToRef(targetRef);
    if (fullPath.length === 0) {
      return { checkpointRef: ROOT_REF, pathFromCheckpoint: [] };
    }

    // 获取所有 checkpoint 的 ref
    const allCheckpoints = await this.db.select({ ref: checkpoints.ref }).from(checkpoints);
    const checkpointSet = new Set(allCheckpoints.map(c => c.ref));

    // 从目标向 ROOT 方向找最近的 checkpoint
    for (let i = fullPath.length - 1; i >= 0; i--) {
      const ref = fullPath[i];
      if (checkpointSet.has(ref)) {
        return {
          checkpointRef: ref,
          pathFromCheckpoint: fullPath.slice(i + 1),
        };
      }
    }

    // 没有找到 checkpoint，从 ROOT 开始
    return { checkpointRef: ROOT_REF, pathFromCheckpoint: fullPath };
  }

  /**
   * 加载 checkpoint 的 quads
   */
  private async loadCheckpointQuads(checkpointRef: string): Promise<Quad[]> {
    const rows = await this.db.select().from(checkpointQuads)
      .where(eq(checkpointQuads.checkpointRef, checkpointRef));
    
    return rows.map(row => ({
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      objectDatatype: row.objectDatatype ?? undefined,
      objectLanguage: row.objectLanguage ?? undefined,
      graph: row.graph,
    }));
  }

  /**
   * 在内存中应用操作（不修改数据库）
   */
  private applyOperationInMemory(quadsMap: Map<string, Quad>, op: Operation): void {
    switch (op.type) {
      case 'insert': {
        const normalized = normalizeQuad(op.quad);
        const key = quadKey(normalized);
        quadsMap.set(key, op.quad);
        break;
      }
      case 'delete': {
        const normalized = normalizeQuad(op.quad);
        const key = quadKey(normalized);
        quadsMap.delete(key);
        break;
      }
      case 'batch-insert': {
        for (const q of op.quads) {
          const normalized = normalizeQuad(q);
          const key = quadKey(normalized);
          quadsMap.set(key, q);
        }
        break;
      }
      case 'batch-delete': {
        for (const q of op.quads) {
          const normalized = normalizeQuad(q);
          const key = quadKey(normalized);
          quadsMap.delete(key);
        }
        break;
      }
      case 'patch': {
        // 查找匹配的 Literal 并应用补丁
        for (const [key, quad] of quadsMap.entries()) {
          if (quad.subject === op.subject && quad.predicate === op.predicate) {
            // 只对 Literal 类型应用补丁
            if (!quad.object.startsWith('<') && !quad.object.startsWith('_:')) {
              const newValue = applyTextPatch(quad.object, op.patch);
              const newQuad = { ...quad, object: newValue };
              quadsMap.set(key, newQuad);
            }
          }
        }
        break;
      }
    }
  }

  /**
   * 构建任意 ref 处的 Quad 数组（内部方法）
   * 
   * 优先级：
   * 1. quads 表缓存（如果 cachedRef === targetRef）
   * 2. checkpoint + 重放操作
   */
  private async buildQuadsAtRef(targetRef: string): Promise<Quad[]> {
    // 如果是 ROOT_REF，返回空数组
    if (targetRef === ROOT_REF) {
      return [];
    }

    // 优先检查 quads 表是否已经缓存了目标状态
    const cachedRef = await this.getCachedRef();
    if (cachedRef === targetRef) {
      // 直接从 quads 表读取，这是最快的路径
      const rows = await this.db.select().from(quads);
      return rows.map(row => ({
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        objectDatatype: row.objectDatatype ?? undefined,
        objectLanguage: row.objectLanguage ?? undefined,
        graph: row.graph,
      }));
    }

    // 1. 找到最近的 checkpoint
    const checkpointInfo = await this.findNearestCheckpoint(targetRef);
    
    // 2. 在内存中构建 quad 集合
    const quadsMap = new Map<string, Quad>();
    
    // 3. 加载 checkpoint 数据到内存
    if (checkpointInfo.checkpointRef !== ROOT_REF) {
      const loadedQuads = await this.loadCheckpointQuads(checkpointInfo.checkpointRef);
      for (const quad of loadedQuads) {
        const normalized = normalizeQuad(quad);
        quadsMap.set(quadKey(normalized), quad);
      }
    }
    
    // 4. 在内存中重放操作
    for (const ref of checkpointInfo.pathFromCheckpoint) {
      const node = await this.getNode(ref);
      if (node) {
        this.applyOperationInMemory(quadsMap, node.operation);
      }
    }
    
    return [...quadsMap.values()];
  }

  /**
   * 导出任意 ref 处的数据
   */
  async exportAtRef(targetRef: string): Promise<ExportResult> {
    // 检查 targetRef 是否存在
    if (targetRef !== ROOT_REF) {
      const exists = await this.refExists(targetRef);
      if (!exists) {
        throw new Error(`Ref '${targetRef}' does not exist`);
      }
    }

    const quadsArray = await this.buildQuadsAtRef(targetRef);
    return {
      data: quadsToJsonl(quadsArray),
      ref: targetRef,
      quadCount: quadsArray.length,
    };
  }

  /**
   * 在指定 ref 处创建 checkpoint
   * 这需要先构建出该 ref 的完整数据，然后保存
   */
  async createCheckpoint(ref: string, meta?: CheckpointMetadata): Promise<void> {
    // 检查 checkpoint 是否已存在
    const existing = await this.db.select().from(checkpoints)
      .where(eq(checkpoints.ref, ref))
      .limit(1);
    
    if (existing.length > 0) {
      throw new Error(`Checkpoint at ref '${ref}' already exists`);
    }

    await this.createCheckpointInternal(ref, meta);
  }

  /**
   * 内部方法：创建 checkpoint
   */
  private async createCheckpointInternal(ref: string, meta?: CheckpointMetadata): Promise<void> {
    // 直接获取该 ref 的 Quad 数组
    const quadsArray = await this.buildQuadsAtRef(ref);

    const now = Date.now();

    // 在事务中保存 checkpoint
    await this.db.transaction(async (tx) => {
      // 插入 checkpoint 元数据
      await tx.insert(checkpoints).values({
        ref,
        timestamp: now,
        quadCount: quadsArray.length,
        name: meta?.name ?? null,
        description: meta?.description ?? null,
        visibility: meta?.visibility ?? 'PRIVATE',
      });

      // 批量插入 checkpoint quads
      if (quadsArray.length > 0) {
        const values = quadsArray.map(q => {
          const normalized = normalizeQuad(q);
          return {
            checkpointRef: ref,
            subject: normalized.subject,
            predicate: normalized.predicate,
            object: normalized.object,
            objectDatatype: normalized.objectDatatype,
            objectLanguage: normalized.objectLanguage,
            graph: normalized.graph,
          };
        });
        await tx.insert(checkpointQuads).values(values);
      }
    });
  }

  /**
   * 获取 checkpoint 信息
   * @param accessLevel - 'owner' 返回所有 checkpoint，'public' 仅返回 PUBLIC 的
   */
  async listCheckpoints(accessLevel: 'owner' | 'public' = 'owner'): Promise<CheckpointInfo[]> {
    const rows = accessLevel === 'public'
      ? await this.db.select().from(checkpoints)
          .where(eq(checkpoints.visibility, 'PUBLIC'))
          .orderBy(desc(checkpoints.timestamp))
      : await this.db.select().from(checkpoints)
          .orderBy(desc(checkpoints.timestamp));
    
    return rows.map(row => ({
      ref: row.ref,
      timestamp: row.timestamp,
      quadCount: row.quadCount,
      name: row.name ?? undefined,
      description: row.description ?? undefined,
      visibility: row.visibility as CheckpointVisibility,
    }));
  }

  /**
   * 获取单个 checkpoint 信息
   */
  async getCheckpoint(ref: string): Promise<CheckpointInfo | null> {
    const [row] = await this.db.select()
      .from(checkpoints)
      .where(eq(checkpoints.ref, ref))
      .limit(1);
    
    if (!row) return null;
    
    return {
      ref: row.ref,
      timestamp: row.timestamp,
      quadCount: row.quadCount,
      name: row.name ?? undefined,
      description: row.description ?? undefined,
      visibility: row.visibility as CheckpointVisibility,
    };
  }

  /**
   * 更新 checkpoint 的可见性
   */
  async updateCheckpointVisibility(ref: string, visibility: CheckpointVisibility): Promise<boolean> {
    const result = await this.db.update(checkpoints)
      .set({ visibility })
      .where(eq(checkpoints.ref, ref))
      .returning();
    
    return result.length > 0;
  }

  /**
   * 删除指定的 checkpoint
   */
  async deleteCheckpoint(ref: string): Promise<boolean> {
    const deleted = await this.db.delete(checkpoints)
      .where(eq(checkpoints.ref, ref))
      .returning();
    
    if (deleted.length > 0) {
      await this.db.delete(checkpointQuads)
        .where(eq(checkpointQuads.checkpointRef, ref));
      return true;
    }
    return false;
  }
}

/**
 * 应用文本补丁
 */
function applyTextPatch(original: string, patch: { originalLength: number; hunks: { start: number; deleteCount: number; insert: string }[] }): string {
  if (original.length !== patch.originalLength) {
    // 长度不匹配，返回原始值
    return original;
  }

  let result = original;
  let offset = 0;

  for (const hunk of patch.hunks) {
    const start = hunk.start + offset;
    const before = result.substring(0, start);
    const after = result.substring(start + hunk.deleteCount);
    result = before + hunk.insert + after;
    offset += hunk.insert.length - hunk.deleteCount;
  }

  return result;
}
