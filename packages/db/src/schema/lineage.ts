import { sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { artifacts, artifactVersions } from './artifacts';
import type { LineageType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifact_lineage - 依赖/派生关系
export const artifactLineage = sqliteTable(
  'artifact_lineage',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    childArtifactId: text('child_artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    parentArtifactId: text('parent_artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    lineageType: text('lineage_type').$type<LineageType>().notNull(),
    description: text('description'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_lineage_child').on(table.childArtifactId),
    index('idx_lineage_parent').on(table.parentArtifactId),
    index('idx_lineage_type').on(table.lineageType),
  ]
);

// artifact_generation_params - AI 生成参数
export const artifactGenerationParams = sqliteTable(
  'artifact_generation_params',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    versionId: text('version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    modelProvider: text('model_provider', { length: 50 }).notNull(), // openai, anthropic, etc.
    modelName: text('model_name', { length: 100 }).notNull(),
    // JSON 字段存储为文本
    parameters: text('parameters', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_gen_params_version').on(table.versionId),
    index('idx_gen_params_model').on(table.modelProvider, table.modelName),
  ]
);

// Type exports
export type ArtifactLineage = typeof artifactLineage.$inferSelect;
export type NewArtifactLineage = typeof artifactLineage.$inferInsert;
export type ArtifactGenerationParams = typeof artifactGenerationParams.$inferSelect;
export type NewArtifactGenerationParams = typeof artifactGenerationParams.$inferInsert;
