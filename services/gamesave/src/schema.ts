/**
 * Durable Object SQLite Schema for CloudSaveObject
 * 
 * 纯 Checkpoint 存储模式 - 不维护当前状态
 * gamesave DO 仅存储 checkpoint 快照，不再有 quads 表
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Checkpoint 元数据表
 * 存储 checkpoint 信息
 */
export const checkpoints = sqliteTable('checkpoints', {
  // Checkpoint 唯一标识
  id: text('id').primaryKey(),
  // 创建时间戳
  timestamp: integer('timestamp').notNull(),
  // checkpoint 时刻的 quad 数量
  quadCount: integer('quad_count').notNull(),
  // 可选的 checkpoint 名称
  name: text('name'),
  // 可选的描述
  description: text('description'),
  // 可见性：PRIVATE (仅 owner), UNLISTED (知道链接可访问), PUBLIC (公开可列举)
  visibility: text('visibility').notNull().default('PRIVATE'),
});

/**
 * Checkpoint Quads 表
 * 存储 checkpoint 时刻的完整数据快照
 */
export const checkpointQuads = sqliteTable(
  'checkpoint_quads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // 所属 checkpoint 的 ID
    checkpointId: text('checkpoint_id').notNull(),
    // Subject: N3 格式 '<uri>' 或 '_:blank'
    subject: text('subject').notNull(),
    // Predicate: N3 格式 '<uri>'
    predicate: text('predicate').notNull(),
    // Object: N3 格式 (URI: '<uri>', Literal: '"value"^^<type>' 或 '"value"@lang')
    object: text('object').notNull(),
    // 图名称，空字符串表示 default graph
    graph: text('graph').notNull().default(''),
  },
  (table) => [
    index('idx_checkpoint_quads_id').on(table.checkpointId),
  ]
);

/**
 * 元数据表
 * 存储存档的关键配置信息
 */
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// 类型推断
export type MetadataRow = typeof metadata.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;
export type NewCheckpointRow = typeof checkpoints.$inferInsert;
export type CheckpointQuadRow = typeof checkpointQuads.$inferSelect;
export type NewCheckpointQuadRow = typeof checkpointQuads.$inferInsert;
