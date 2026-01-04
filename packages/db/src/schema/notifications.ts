import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import type { NotificationType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// notifications - 通知
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<NotificationType>().notNull(),
    title: text('title', { length: 200 }).notNull(),
    content: text('content'),
    // JSON 字段存储为文本
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(), // 存储相关 ID 等
    isRead: integer('is_read', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_notifications_user').on(table.userId),
    index('idx_notifications_unread').on(table.userId, table.isRead),
    index('idx_notifications_type').on(table.type),
  ]
);

// Type exports
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
