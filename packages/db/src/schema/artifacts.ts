import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { VisibilityType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// Entrypoint 类型：指定启动流图时的初始程序状态
export interface ArtifactEntrypoint {
  saveCommit: string;
  sandboxNodeId: string;
}

// artifacts - 主内容表
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name', { length: 100 }).notNull(),
    description: text('description'),
    visibility: text('visibility').$type<VisibilityType>().default('PUBLIC').notNull(),
    currentVersionId: text('current_version_id'), // 稍后设置引用
    thumbnailUrl: text('thumbnail_url', { length: 500 }),
    license: text('license', { length: 50 }),
    repositoryUrl: text('repository_url', { length: 500 }),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_artifacts_author').on(table.authorId),
    index('idx_artifacts_visibility').on(table.visibility),
  ]
);

// artifact_versions - 版本控制
export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: text('version', { length: 50 }), // optional semver
    commitHash: text('commit_hash').notNull(), // SHA-256 前8位
    changelog: text('changelog'),
    publishedAt: text('published_at'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    // JSON 字段存储为文本
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    checksum: text('checksum', { length: 64 }),
    // 入口点：指定启动流图时的初始程序状态
    entrypoint: text('entrypoint', { mode: 'json' }).$type<ArtifactEntrypoint>(),
    // 弱版本标记：weak 版本不对 node 产生引用计数
    isWeak: integer('is_weak', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => [
    index('idx_artifact_versions_artifact').on(table.artifactId),
    index('idx_artifact_versions_version').on(table.artifactId, table.version),
    uniqueIndex('idx_artifact_versions_commit').on(table.artifactId, table.commitHash),
  ]
);

// artifact_commit_tags - commitTag 多对一关联表
// 一个 commit 可以有多个 tag，但每个 tag 在同一 artifact 内唯一
export const artifactCommitTags = sqliteTable(
  'artifact_commit_tags',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    commitHash: text('commit_hash')
      .notNull(),
    tag: text('tag').notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    // 同一 artifact 内 tag 名唯一（tag 只能指向一个版本）
    uniqueIndex('idx_artifact_commit_tags_unique').on(table.artifactId, table.tag),
    index('idx_artifact_commit_tags_version').on(table.commitHash),
  ]
);

// tags - 标签表
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text('name', { length: 50 }).notNull().unique(),
    slug: text('slug', { length: 50 }).notNull().unique(),
    description: text('description'),
    color: text('color', { length: 7 }), // #RRGGBB
    usageCount: integer('usage_count').default(0).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_tags_slug').on(table.slug),
    index('idx_tags_usage').on(table.usageCount),
  ]
);

// artifact_tags - 多对多关系
export const artifactTags = sqliteTable(
  'artifact_tags',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.tagId] }),
    index('idx_artifact_tags_artifact').on(table.artifactId),
    index('idx_artifact_tags_tag').on(table.tagId),
  ]
);

// Type exports
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type ArtifactVersion = typeof artifactVersions.$inferSelect;
export type NewArtifactVersion = typeof artifactVersions.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ArtifactTag = typeof artifactTags.$inferSelect;
export type NewArtifactTag = typeof artifactTags.$inferInsert;
export type ArtifactCommitTag = typeof artifactCommitTags.$inferSelect;
export type NewArtifactCommitTag = typeof artifactCommitTags.$inferInsert;
