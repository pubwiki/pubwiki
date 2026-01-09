import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { projects } from './projects';
import { discussions } from './discussions';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// project_posts - 项目动态表
export const projectPosts = sqliteTable(
  'project_posts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    discussionId: text('discussion_id')
      .references(() => discussions.id, { onDelete: 'set null' }),
    title: text('title', { length: 200 }).notNull(),
    content: text('content').notNull(), // HTML content
    coverUrls: text('cover_urls'), // JSON array of cover image URLs
    isPinned: integer('is_pinned', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_project_posts_project').on(table.projectId),
    index('idx_project_posts_author').on(table.authorId),
    index('idx_project_posts_discussion').on(table.discussionId),
    index('idx_project_posts_pinned').on(table.projectId, table.isPinned),
    index('idx_project_posts_created').on(table.projectId, table.createdAt),
  ]
);

// Type exports
export type ProjectPost = typeof projectPosts.$inferSelect;
export type NewProjectPost = typeof projectPosts.$inferInsert;
