import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { artifacts } from './artifacts';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// projects - 企划表
// 访问控制通过 resource_access_control 表管理 (isPrivate + isListed)
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name', { length: 100 }).notNull(),
    slug: text('slug', { length: 100 }).notNull().unique(),
    topic: text('topic', { length: 100 }).notNull(), // hashtag
    description: text('description'),
    license: text('license', { length: 50 }),
    coverUrls: text('cover_urls'), // JSON array of cover image URLs
    homepageId: text('homepage_id'), // Reference to the homepage in projectPages
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false).notNull(),
    // Optimistic lock version (no state pointer field in this table)
    version: integer('version').default(1).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_projects_owner').on(table.ownerId),
    index('idx_projects_topic').on(table.topic),
    index('idx_projects_slug').on(table.slug),
  ]
);

// project_pages - project页面
export const projectPages = sqliteTable(
  'project_pages',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name', { length: 100 }).notNull(),
    icon: text('icon', { length: 50 }), // Emoji or icon identifier
    content: text('content'), // HTML content
    order: integer('order').default(0).notNull(), // Display order
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_project_pages_project').on(table.projectId),
    index('idx_project_pages_order').on(table.projectId, table.order),
  ]
);

// project_roles - project定义的artifact角色
export const projectRoles = sqliteTable(
  'project_roles',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentRoleId: text('parent_role_id'),
    name: text('name', { length: 50 }).notNull(),
    description: text('description'),
    isLeaf: integer('is_leaf', { mode: 'boolean' }).default(true).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_project_roles_project').on(table.projectId),
    index('idx_project_roles_parent').on(table.parentRoleId),
  ]
);

// project_artifacts - project关联的artifact及其角色（多对多）
export const projectArtifacts = sqliteTable(
  'project_artifacts',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .references(() => projectRoles.id, { onDelete: 'set null' }),
    isOfficial: integer('is_official', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.artifactId] }),
    index('idx_project_artifacts_project').on(table.projectId),
    index('idx_project_artifacts_artifact').on(table.artifactId),
    index('idx_project_artifacts_role').on(table.roleId),
  ]
);

// Type exports
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectPage = typeof projectPages.$inferSelect;
export type NewProjectPage = typeof projectPages.$inferInsert;
export type ProjectRole = typeof projectRoles.$inferSelect;
export type NewProjectRole = typeof projectRoles.$inferInsert;
export type ProjectArtifact = typeof projectArtifacts.$inferSelect;
export type NewProjectArtifact = typeof projectArtifacts.$inferInsert;
