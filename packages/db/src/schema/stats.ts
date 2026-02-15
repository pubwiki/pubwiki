import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { artifacts } from './artifacts';
import { user } from './auth';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifact_stats - 统计信息（可选的缓存表）
export const artifactStats = sqliteTable(
  'artifact_stats',
  {
    artifactId: text('artifact_id')
      .primaryKey()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    viewCount: integer('view_count').default(0).notNull(),
    favCount: integer('fav_count').default(0).notNull(),
    refCount: integer('ref_count').default(0).notNull(),
    downloadCount: integer('download_count').default(0).notNull(),
    commentCount: integer('comment_count').default(0).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  }
);

// artifact_stars - 收藏记录
export const artifactFavs = sqliteTable(
  'artifact_favs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.artifactId] }),
    index('idx_stars_user').on(table.userId),
    index('idx_stars_artifact').on(table.artifactId),
  ]
);

// artifact_views - 浏览记录（用于分析）
export const artifactViews = sqliteTable(
  'artifact_views',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    ipHash: text('ip_hash', { length: 64 }), // 匿名用户的 IP hash
    userAgent: text('user_agent', { length: 500 }),
    referer: text('referer', { length: 500 }),
    viewedAt: text('viewed_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_views_artifact').on(table.artifactId),
    index('idx_views_user').on(table.userId),
    index('idx_views_time').on(table.viewedAt),
  ]
);

// Type exports
export type ArtifactStats = typeof artifactStats.$inferSelect;
export type NewArtifactStats = typeof artifactStats.$inferInsert;
export type ArtifactStar = typeof artifactFavs.$inferSelect;
export type NewArtifactStar = typeof artifactFavs.$inferInsert;
export type ArtifactView = typeof artifactViews.$inferSelect;
export type NewArtifactView = typeof artifactViews.$inferInsert;
