import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { artifacts } from './artifacts';
import { user } from './auth';
import type { CollaboratorRole, VisibilityType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifact_collaborators - 协作者
export const artifactCollaborators = sqliteTable(
  'artifact_collaborators',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<CollaboratorRole>().default('VIEWER').notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.userId] }),
    index('idx_collaborators_artifact').on(table.artifactId),
    index('idx_collaborators_user').on(table.userId),
  ]
);

// collections - 用户收藏夹
export const collections = sqliteTable(
  'collections',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name', { length: 100 }).notNull(),
    description: text('description'),
    visibility: text('visibility').$type<VisibilityType>().default('PRIVATE').notNull(),
    itemCount: integer('item_count').default(0).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_collections_user').on(table.userId),
    index('idx_collections_visibility').on(table.visibility),
  ]
);

// collection_items - 收藏项
export const collectionItems = sqliteTable(
  'collection_items',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    note: text('note'),
    order: integer('order').default(0).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.artifactId] }),
    index('idx_collection_items_collection').on(table.collectionId),
    index('idx_collection_items_artifact').on(table.artifactId),
  ]
);

// Type exports
export type ArtifactCollaborator = typeof artifactCollaborators.$inferSelect;
export type NewArtifactCollaborator = typeof artifactCollaborators.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type NewCollectionItem = typeof collectionItems.$inferInsert;
