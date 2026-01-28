/**
 * CloudSaveObject - Durable Object for Checkpoint Storage
 * 
 * 纯 Checkpoint 存储模式：
 * - 不维护当前状态，只存储 checkpoint 快照
 * - createCheckpoint 直接传入完整的 quads 数组
 */

import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import { eq, desc, count, sql } from 'drizzle-orm';
import * as schema from './schema';
import { metadata, checkpoints, checkpointQuads } from './schema';
import type {
  Quad,
  SaveMetadata,
  CreateCheckpointOptions,
  CheckpointInfo,
  ExportCheckpointResult,
  CheckpointVisibility,
} from './types';
import migrations from './drizzle/migrations';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/** Cloudflare SQLite 每个查询最多绑定参数数量 */
const MAX_BIND_PARAMS = 100;

/**
 * 分批插入数据以遵守 Cloudflare SQLite 的参数限制
 */
async function batchInsert<T extends Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: { insert: (table: SQLiteTable) => any },
  table: SQLiteTable,
  values: T[],
  fieldsPerRow: number
): Promise<void> {
  if (values.length === 0) return;
  
  const batchSize = Math.floor(MAX_BIND_PARAMS / fieldsPerRow);
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);
    await tx.insert(table).values(batch);
  }
}


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

  // ============ 存档初始化与元数据 ============

  /**
   * 初始化存档 (关联用户和 state node)
   */
  async initialize(userId: string, stateNodeId: string): Promise<void> {
    const now = Date.now();
    
    await this.db.insert(metadata).values([
      { key: 'userId', value: userId },
      { key: 'stateNodeId', value: stateNodeId },
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

    const map = new Map(rows.map(r => [r.key, r.value]));
    
    const userId = map.get('userId');
    const stateNodeId = map.get('stateNodeId');
    const createdAt = map.get('createdAt');
    const updatedAt = map.get('updatedAt');

    if (!userId || !stateNodeId || !createdAt || !updatedAt) return null;

    return {
      userId,
      stateNodeId,
      createdAt: Number(createdAt),
      updatedAt: Number(updatedAt),
    };
  }

  /**
   * 清空存档（删除所有 checkpoints）
   */
  async clear(): Promise<void> {
    await this.db.delete(checkpointQuads);
    await this.db.delete(checkpoints);
    await this.db.delete(metadata);
  }

  // ============ Checkpoint API ============

  /**
   * 创建 checkpoint - 直接传入完整的 quads 快照
   */
  async createCheckpoint(quads: Quad[], options?: CreateCheckpointOptions): Promise<string> {
    const checkpointId = options?.id ?? crypto.randomUUID();
    const now = Date.now();

    await this.db.transaction(async (tx) => {
      // 创建 checkpoint 记录
      await tx.insert(checkpoints).values({
        id: checkpointId,
        timestamp: now,
        quadCount: quads.length,
        name: options?.name,
        description: options?.description,
        visibility: options?.visibility ?? 'PRIVATE',
      });

      // 存储 quads
      if (quads.length > 0) {
        const quadRows = quads.map(q => ({
          checkpointId,
          subject: q.subject,
          predicate: q.predicate,
          object: q.object,
          graph: q.graph ?? '',
        }));

        // 分批插入 (每行 5 个字段)
        await batchInsert(tx, checkpointQuads, quadRows, 5);
      }
    });

    // 更新 updatedAt
    await this.db.update(metadata)
      .set({ value: String(now) })
      .where(eq(metadata.key, 'updatedAt'));

    return checkpointId;
  }

  /**
   * 列出所有 checkpoints
   */
  async listCheckpoints(accessLevel: 'owner' | 'public' = 'owner'): Promise<CheckpointInfo[]> {
    let query = this.db.select().from(checkpoints).orderBy(desc(checkpoints.timestamp));
    
    if (accessLevel === 'public') {
      query = query.where(eq(checkpoints.visibility, 'PUBLIC')) as typeof query;
    }

    const rows = await query;

    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      quadCount: r.quadCount,
      name: r.name ?? undefined,
      description: r.description ?? undefined,
      visibility: r.visibility as CheckpointVisibility,
    }));
  }

  /**
   * 按 ID 获取 checkpoint 信息
   */
  async getCheckpoint(checkpointId: string): Promise<CheckpointInfo | null> {
    const [row] = await this.db.select()
      .from(checkpoints)
      .where(eq(checkpoints.id, checkpointId))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      timestamp: row.timestamp,
      quadCount: row.quadCount,
      name: row.name ?? undefined,
      description: row.description ?? undefined,
      visibility: row.visibility as CheckpointVisibility,
    };
  }

  /**
   * 导出 checkpoint 数据
   */
  async exportCheckpoint(checkpointId: string): Promise<ExportCheckpointResult | null> {
    // 检查 checkpoint 是否存在
    const [checkpoint] = await this.db.select()
      .from(checkpoints)
      .where(eq(checkpoints.id, checkpointId))
      .limit(1);

    if (!checkpoint) return null;

    // 获取所有 quads
    const rows = await this.db.select()
      .from(checkpointQuads)
      .where(eq(checkpointQuads.checkpointId, checkpointId));

    const quads: Quad[] = rows.map(r => ({
      subject: r.subject,
      predicate: r.predicate,
      object: r.object,
      graph: r.graph,
    }));

    return {
      quads,
      quadCount: quads.length,
    };
  }

  /**
   * 更新 checkpoint 可见性
   */
  async updateCheckpointVisibility(checkpointId: string, visibility: CheckpointVisibility): Promise<boolean> {
    // 先检查 checkpoint 是否存在
    const [existing] = await this.db.select()
      .from(checkpoints)
      .where(eq(checkpoints.id, checkpointId))
      .limit(1);

    if (!existing) return false;

    await this.db.update(checkpoints)
      .set({ visibility })
      .where(eq(checkpoints.id, checkpointId));

    return true;
  }

  /**
   * 按 ID 删除 checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    // 先检查 checkpoint 是否存在
    const [existing] = await this.db.select()
      .from(checkpoints)
      .where(eq(checkpoints.id, checkpointId))
      .limit(1);

    if (!existing) return false;

    // 先删除关联的 quads
    await this.db.delete(checkpointQuads)
      .where(eq(checkpointQuads.checkpointId, checkpointId));

    // 再删除 checkpoint 记录
    await this.db.delete(checkpoints)
      .where(eq(checkpoints.id, checkpointId));

    return true;
  }

  /**
   * 获取 checkpoint 总数
   */
  async getCheckpointCount(): Promise<number> {
    const [result] = await this.db.select({ value: count() }).from(checkpoints);
    return result?.value ?? 0;
  }
}
