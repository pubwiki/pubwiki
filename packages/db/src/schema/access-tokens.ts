import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { ResourceType } from '../services/access-control';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// ========================================================================
// resource_access_tokens - 资源访问令牌表
// ========================================================================
// Token 机制提供简单的只读访问能力授予：
// - 持有有效 token 的用户可以访问对应的私有资源
// - Token 只授予只读访问权限，不需要复杂的权限系统
// - 支持过期时间和使用次数限制
export const resourceAccessTokens = sqliteTable(
  'resource_access_tokens',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

    // 关联的资源（外键指向 resource_access_control）
    resourceType: text('resource_type').$type<ResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),

    // 令牌值（用于 URL 或 Header）
    token: text('token').notNull().unique(),

    // 创建者（必须是资源 owner）
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // 生命周期控制
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    expiresAt: text('expires_at'),                      // NULL 表示永不过期
    usageLimit: integer('usage_limit'),                 // NULL 表示无限制
    usageCount: integer('usage_count').default(0).notNull(),

    // 管理标签
    label: text('label'),
  },
  (table) => [
    index('idx_access_tokens_resource').on(table.resourceType, table.resourceId),
    index('idx_access_tokens_token').on(table.token),
    index('idx_access_tokens_creator').on(table.createdBy),
  ]
);

// Type exports
export type AccessToken = typeof resourceAccessTokens.$inferSelect;
export type NewAccessToken = typeof resourceAccessTokens.$inferInsert;
