import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

const currentTimestamp = sql`(datetime('now'))`;

/**
 * cloud_saves - 云端存档索引表
 * 用于管理用户的云端存档元数据，实际数据存储在 Durable Objects 中
 * 
 * 注意：currentRef 已移除，版本信息存储在 DO 内部的 version_dag 表中
 * 客户端可通过 getLatestRef() 或 getHistory() 获取版本信息
 */
export const cloudSaves = sqliteTable(
  'cloud_saves',
  {
    // 存档 ID (也是 Durable Object ID)
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    // 所属用户
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // 关联的 state node ID (可选，用于定位)
    stateNodeId: text('state_node_id'),
    // 存档名称
    name: text('name').notNull(),
    // 存档描述
    description: text('description'),
    // 创建时间
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    // 最后更新时间
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
    // 最后同步时间
    lastSyncedAt: text('last_synced_at'),
  },
  (table) => [
    index('idx_cloud_saves_user').on(table.userId),
    index('idx_cloud_saves_state').on(table.stateNodeId),
  ]
);

// 类型推断
export type CloudSave = typeof cloudSaves.$inferSelect;
export type NewCloudSave = typeof cloudSaves.$inferInsert;
