import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ResourceType } from '../services/access-control';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// ========================================================================
// resource_discovery_control - 资源可发现性控制表
// ========================================================================
// 原 resource_access_control，移除 isPrivate 和 ownerId
// 仅控制资源是否出现在公开列表/搜索结果中
//
// 注意：访问权限控制已迁移到 resource_acl 表
export const resourceDiscoveryControl = sqliteTable(
  'resource_discovery_control',
  {
    // 复合主键：资源类型 + 资源ID
    resourceType: text('resource_type').$type<ResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),

    // 可发现性：是否出现在公开列表/搜索结果中
    isListed: integer('is_listed', { mode: 'boolean' }).default(false).notNull(),

    // 元数据
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceType, table.resourceId] }),
    index('idx_rdc_listing').on(table.resourceType, table.isListed),
  ]
);

// Type exports
export type ResourceDiscoveryControlRecord = typeof resourceDiscoveryControl.$inferSelect;
export type NewResourceDiscoveryControlRecord = typeof resourceDiscoveryControl.$inferInsert;
