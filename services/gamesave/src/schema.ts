/**
 * Durable Object SQLite Schema for CloudSaveObject
 * 
 * 使用 Drizzle ORM 定义存储在 Durable Object 内部 SQLite 的表结构
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Quads 存储表
 * 存储 RDF 四元组数据（当前状态）
 */
export const quads = sqliteTable(
  'quads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Subject: N3 格式 '<uri>' 或 '_:blank'
    subject: text('subject').notNull(),
    // Predicate: N3 格式 '<uri>'
    predicate: text('predicate').notNull(),
    // Object: URI 用 '<uri>', Literal 只存 value
    object: text('object').notNull(),
    // Literal 的 datatype URI (不带尖括号，如 'http://www.w3.org/2001/XMLSchema#integer')
    objectDatatype: text('object_datatype'),
    // Literal 的语言标签 (如 'en', 'zh-CN')
    objectLanguage: text('object_language'),
    // 图名称，空字符串表示 default graph
    graph: text('graph').notNull().default(''),
  },
  (table) => [
    // 唯一索引：确保相同的 quad 不会重复
    uniqueIndex('idx_quads_unique').on(
      table.subject,
      table.predicate,
      table.object,
      table.objectDatatype,
      table.graph
    ),
    // 查询优化索引
    index('idx_quads_subject').on(table.subject),
    index('idx_quads_predicate').on(table.predicate),
    index('idx_quads_graph').on(table.graph),
    // 复合索引用于常见查询模式
    index('idx_quads_sp').on(table.subject, table.predicate),
  ]
);

/**
 * Checkpoint 元数据表
 * 存储 checkpoint 信息，用于加速历史版本恢复
 * 一个 ref 可以有多个 checkpoint，quad 数据按 ref 存储
 */
export const checkpoints = sqliteTable('checkpoints', {
  // Checkpoint 唯一标识
  id: text('id').primaryKey(),
  // 对应的版本 ref
  ref: text('ref').notNull(),
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
}, (table) => [
  // ref 索引用于查询和引用计数
  index('idx_checkpoints_ref').on(table.ref),
]);

/**
 * Checkpoint Quads 表
 * 存储 checkpoint 时刻的完整数据快照
 */
export const checkpointQuads = sqliteTable(
  'checkpoint_quads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // 所属 checkpoint 的 ref
    checkpointRef: text('checkpoint_ref').notNull(),
    // Subject: N3 格式 '<uri>' 或 '_:blank'
    subject: text('subject').notNull(),
    // Predicate: N3 格式 '<uri>'
    predicate: text('predicate').notNull(),
    // Object: URI 用 '<uri>', Literal 只存 value
    object: text('object').notNull(),
    // Literal 的 datatype URI
    objectDatatype: text('object_datatype'),
    // Literal 的语言标签
    objectLanguage: text('object_language'),
    // 图名称
    graph: text('graph').notNull().default(''),
  },
  (table) => [
    index('idx_checkpoint_quads_ref').on(table.checkpointRef),
  ]
);

/**
 * Version DAG 表
 * 记录操作历史，支持版本追踪
 */
export const versionDag = sqliteTable('version_dag', {
  // 版本引用 (hash)
  ref: text('ref').primaryKey(),
  // 父版本引用 (null 表示 root)
  parent: text('parent'),
  // 操作内容 (JSON 序列化的 SerializedOperation)
  operation: text('operation').notNull(),
  // 操作时间戳
  timestamp: integer('timestamp').notNull(),
});

/**
 * 元数据表
 * 存储存档的关键配置信息（不再存储 currentRef）
 */
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// 类型推断
export type QuadRow = typeof quads.$inferSelect;
export type NewQuadRow = typeof quads.$inferInsert;
export type VersionDagRow = typeof versionDag.$inferSelect;
export type NewVersionDagRow = typeof versionDag.$inferInsert;
export type MetadataRow = typeof metadata.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;
export type NewCheckpointRow = typeof checkpoints.$inferInsert;
export type CheckpointQuadRow = typeof checkpointQuads.$inferSelect;
export type NewCheckpointQuadRow = typeof checkpointQuads.$inferInsert;
