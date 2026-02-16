import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { ReaderContent } from '@pubwiki/api';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// articles - 文章表
// 访问控制通过 resource_access_control 表管理 (isPrivate + isListed)
export const articles = sqliteTable(
  'articles',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Associated artifact and version
    artifactId: text('artifact_id').notNull(),
    artifactCommit: text('artifact_commit').notNull(),
    title: text('title', { length: 200 }).notNull(),
    content: text('content', { mode: 'json' }).$type<ReaderContent>().notNull(),
    likes: integer('likes').default(0).notNull(),
    collections: integer('collections').default(0).notNull(),
    // Optimistic lock version (no state pointer field in this table)
    version: integer('version').default(1).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_articles_author').on(table.authorId),
    index('idx_articles_artifact').on(table.artifactId),
    index('idx_articles_artifact_commit').on(table.artifactId, table.artifactCommit),
    index('idx_articles_created').on(table.createdAt),
  ]
);

// Type exports
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
