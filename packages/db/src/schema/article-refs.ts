import { sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { articles } from './articles';

// ========================================================================
// article_save_refs - Article 引用的 Save 关联表
// ========================================================================
// 从 article 的 content 中的 game_ref blocks 提取的引用关系
// 
// 用于高效查询：
//   1. 某个 article 引用了哪些 saves（出向引用）
//   2. 某个 save 被哪些 articles 引用（入向引用）
//
// 维护时机：
//   - 创建/更新 article 时，解析 content 中的 game_ref blocks
//   - 同步更新此表（在事务中，确保一致性）
//
// 性能优化：
//   - 避免在查询时解析 JSON（content 字段）
//   - 通过 save_commit 索引实现 O(log n) 的反向查询
export const articleSaveRefs = sqliteTable(
  'article_save_refs',
  {
    articleId: text('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    saveCommit: text('save_commit').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.saveCommit] }),
    // 关键索引：按 save_commit 查询哪些 article 引用了它
    index('idx_article_save_refs_save').on(table.saveCommit),
  ]
);

// Type exports
export type ArticleSaveRef = typeof articleSaveRefs.$inferSelect;
export type NewArticleSaveRef = typeof articleSaveRefs.$inferInsert;
