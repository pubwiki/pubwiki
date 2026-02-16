import { eq, sql, desc, count, and, inArray } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { articles, type Article } from '../schema/articles';
import { artifactVersions } from '../schema/artifacts';
import { nodeVersions } from '../schema/node-versions';
import { user } from '../schema/auth';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { resourceAcl, PUBLIC_USER_ID } from '../schema/acl';
import type { ServiceResult } from './user';
import type {
  ArticleDetail,
  ReaderContent,
  Pagination,
} from '@pubwiki/api';

// 重新导出类型
export type { ArticleDetail };

// 作者信息
interface AuthorInfo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// Upsert 参数
export interface UpsertArticleParams {
  articleId: string;
  authorId: string;
  data: {
    title: string;
    artifactId: string;
    artifactCommit: string;
    content: ReaderContent;
    isListed?: boolean;
  };
}

// 列表查询参数
export interface ListArticlesByArtifactParams {
  artifactId: string;
  page?: number;
  limit?: number;
}

// 列表响应类型
export interface ListArticlesByArtifactResult {
  articles: ArticleDetail[];
  pagination: Pagination;
}

export class ArticleService {
  constructor(private ctx: BatchContext) {}

  // 获取作者信息
  private async getAuthor(authorId: string): Promise<AuthorInfo | null> {
    const result = await this.ctx.select({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      })
      .from(user)
      .where(eq(user.id, authorId))
      .limit(1);

    return result[0] ?? null;
  }

  // 转换为 ArticleDetail
  private toDetail(
    article: Article,
    author: AuthorInfo,
    discoveryControl: { isListed: boolean }
  ): ArticleDetail {
    return {
      id: article.id,
      title: article.title,
      content: article.content as ReaderContent,
      author: {
        id: author.id,
        username: author.username,
        displayName: author.displayName ?? undefined,
        avatarUrl: author.avatarUrl ?? undefined,
      },
      artifactId: article.artifactId,
      artifactCommit: article.artifactCommit,
      isListed: discoveryControl.isListed,
      likes: article.likes,
      collections: article.collections,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }

  // 获取文章详情
  async getArticle(articleId: string): Promise<ServiceResult<ArticleDetail>> {
    try {
      // 获取文章及其发现控制信息
      const result = await this.ctx.select({
          article: articles,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(articles)
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'article'),
            eq(resourceDiscoveryControl.resourceId, articles.id)
          )
        )
        .where(eq(articles.id, articleId))
        .limit(1);

      const row = result[0];
      if (!row) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Article not found' },
        };
      }

      // 获取作者信息
      const author = await this.getAuthor(row.article.authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      return {
        success: true,
        data: this.toDetail(row.article, author, {
          isListed: row.isListed ?? false,
        }),
      };
    } catch (error) {
      console.error('Failed to get article:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get article' },
      };
    }
  }

  /**
   * Create or update an article.
   * Returns only articleId - caller should commit and then call getArticle to get full detail.
   */
  async upsertArticle(params: UpsertArticleParams): Promise<ServiceResult<{ articleId: string }>> {
    const { articleId, authorId, data } = params;

    try {
      // 验证 (artifactId, artifactCommit) 对应的 artifact 版本存在
      const [version] = await this.ctx.select({ id: artifactVersions.id })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.artifactId, data.artifactId),
            eq(artifactVersions.commitHash, data.artifactCommit)
          )
        )
        .limit(1);

      if (!version) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact version not found' },
        };
      }

      // 验证 content 中所有 game_ref 引用的 saveCommit 存在
      const gameRefs = data.content.filter(
        (block): block is Extract<typeof block, { type: 'game_ref' }> =>
          block.type === 'game_ref'
      );

      if (gameRefs.length > 0) {
        const saveCommits = [...new Set(gameRefs.map(ref => ref.saveCommit))];
        const existingSaves = await this.ctx.select({ commit: nodeVersions.commit })
          .from(nodeVersions)
          .where(
            and(
              inArray(nodeVersions.commit, saveCommits),
              eq(nodeVersions.type, 'SAVE')
            )
          );

        const existingCommits = new Set(existingSaves.map(s => s.commit));
        const missingCommits = saveCommits.filter(c => !existingCommits.has(c));

        if (missingCommits.length > 0) {
          return {
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: `Referenced save commits do not exist: ${missingCommits.join(', ')}`,
            },
          };
        }
      }

      // 检查文章是否存在
      const [existing] = await this.ctx.select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      // 确定发现控制设置
      const isListed = data.isListed ?? true;     // 默认列出

      if (existing) {
        // 更新模式：验证 author
        if (existing.authorId !== authorId) {
          return {
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not the article owner' },
          };
        }

        // 收集更新操作
        this.ctx.modify(db =>
          db.update(articles)
            .set({
              title: data.title,
              artifactId: data.artifactId,
              artifactCommit: data.artifactCommit,
              content: data.content as ReaderContent,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(articles.id, articleId))
        );

        // 更新发现控制（使用 upsert 模式）
        this.ctx.modify(db =>
          db.insert(resourceDiscoveryControl)
            .values({
              resourceType: 'article',
              resourceId: articleId,
              isListed,
            })
            .onConflictDoUpdate({
              target: [resourceDiscoveryControl.resourceType, resourceDiscoveryControl.resourceId],
              set: {
                isListed,
                updatedAt: sql`(datetime('now'))`,
              },
            })
        );
      } else {
        // 创建模式
        this.ctx.modify(db =>
          db.insert(articles).values({
            id: articleId,
            authorId,
            title: data.title,
            artifactId: data.artifactId,
            artifactCommit: data.artifactCommit,
            content: data.content as ReaderContent,
          })
        );

        // 创建发现控制记录
        this.ctx.modify(db =>
          db.insert(resourceDiscoveryControl).values({
            resourceType: 'article',
            resourceId: articleId,
            isListed,
          })
        );

        // 创建 owner ACL（manage + write + read）
        this.ctx.modify(db =>
          db.insert(resourceAcl).values({
            resourceType: 'article',
            resourceId: articleId,
            userId: authorId,
            canRead: true,
            canWrite: true,
            canManage: true,
            grantedBy: authorId,
          })
        );

        // 默认创建公开读取 ACL
        this.ctx.modify(db =>
          db.insert(resourceAcl).values({
            resourceType: 'article',
            resourceId: articleId,
            userId: PUBLIC_USER_ID,
            canRead: true,
            canWrite: false,
            canManage: false,
            grantedBy: authorId,
          })
        );
      }

      // Return articleId - caller should commit and then call getArticle
      return { success: true, data: { articleId } };
    } catch (error) {
      console.error('Failed to upsert article:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to upsert article' },
      };
    }
  }

  // 获取与 artifactId 关联的所有文章（分页）
  async listArticlesByArtifactId(
    params: ListArticlesByArtifactParams
  ): Promise<ServiceResult<ListArticlesByArtifactResult>> {
    const { artifactId, page = 1, limit = 20 } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 获取总数（仅列出的文章）
      const [countResult] = await this.ctx.select({ count: count() })
        .from(articles)
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'article'),
            eq(resourceDiscoveryControl.resourceId, articles.id)
          )
        )
        .where(
          and(
            eq(articles.artifactId, artifactId),
            eq(resourceDiscoveryControl.isListed, true)
          )
        );

      const total = countResult?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 获取文章列表
      const articleList = await this.ctx.select({
          article: articles,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(articles)
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'article'),
            eq(resourceDiscoveryControl.resourceId, articles.id)
          )
        )
        .where(
          and(
            eq(articles.artifactId, artifactId),
            eq(resourceDiscoveryControl.isListed, true)
          )
        )
        .orderBy(desc(articles.createdAt))
        .limit(validLimit)
        .offset(offset);

      // 为每篇文章获取作者信息并转换为 ArticleDetail
      const articleDetails: ArticleDetail[] = [];
      for (const row of articleList) {
        const author = await this.getAuthor(row.article.authorId);
        if (author) {
          articleDetails.push(this.toDetail(row.article, author, {
            isListed: row.isListed ?? false,
          }));
        }
      }

      return {
        success: true,
        data: {
          articles: articleDetails,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Failed to list articles by artifact:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list articles' },
      };
    }
  }
}
