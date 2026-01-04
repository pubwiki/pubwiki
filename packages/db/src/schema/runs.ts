import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { artifacts, artifactVersions } from './artifacts';
import { users } from './users';
import type { RunStatus } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifact_runs - 运行记录（适用于 RECIPE, GAME）
export const artifactRuns = sqliteTable(
  'artifact_runs',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').$type<RunStatus>().default('PENDING').notNull(),
    // JSON 字段存储为文本
    inputParams: text('input_params', { mode: 'json' }).$type<Record<string, unknown>>(),
    outputParams: text('output_params', { mode: 'json' }).$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_runs_artifact').on(table.artifactId),
    index('idx_runs_version').on(table.versionId),
    index('idx_runs_user').on(table.userId),
    index('idx_runs_status').on(table.status),
  ]
);

// Type exports
export type ArtifactRun = typeof artifactRuns.$inferSelect;
export type NewArtifactRun = typeof artifactRuns.$inferInsert;
