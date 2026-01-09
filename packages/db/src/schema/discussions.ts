import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { DiscussionCategory, DiscussionTargetType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// discussions - 讨论/评论 (多态关联设计)
export const discussions = sqliteTable(
  'discussions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    // 多态关联: 支持 ARTIFACT, PROJECT 等多种目标类型
    targetType: text('target_type').$type<DiscussionTargetType>().notNull(),
    targetId: text('target_id').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title', { length: 200 }),
    content: text('content').notNull(),
    category: text('category').$type<DiscussionCategory>().default('GENERAL').notNull(),
    isPinned: integer('is_pinned', { mode: 'boolean' }).default(false).notNull(),
    isLocked: integer('is_locked', { mode: 'boolean' }).default(false).notNull(),
    replyCount: integer('reply_count').default(0).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_discussions_target').on(table.targetType, table.targetId),
    index('idx_discussions_author').on(table.authorId),
    index('idx_discussions_category').on(table.category),
    index('idx_discussions_pinned').on(table.isPinned),
  ]
);

// discussion_replies - 回复
export const discussionReplies = sqliteTable(
  'discussion_replies',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    discussionId: text('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentReplyId: text('parent_reply_id'), // 嵌套回复，自引用稍后处理
    content: text('content').notNull(),
    isAccepted: integer('is_accepted', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_replies_discussion').on(table.discussionId),
    index('idx_replies_author').on(table.authorId),
    index('idx_replies_parent').on(table.parentReplyId),
  ]
);

// Type exports
export type Discussion = typeof discussions.$inferSelect;
export type NewDiscussion = typeof discussions.$inferInsert;
export type DiscussionReply = typeof discussionReplies.$inferSelect;
export type NewDiscussionReply = typeof discussionReplies.$inferInsert;
