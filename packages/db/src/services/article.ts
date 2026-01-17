import { eq, sql, desc, count, and } from 'drizzle-orm';
import type { Database } from '../client';
import { articles, type Article, type NewArticle } from '../schema/articles';
import { artifactNodes } from '../schema/nodes';
import { user } from '../schema/auth';
import type { ServiceError, ServiceResult } from './user';
import type {
  ArticleDetail,
  ArticleAuthor,
  UpsertArticleRequest,
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
  data: UpsertArticleRequest;
}

// 列表查询参数
export interface ListArticlesBySandboxParams {
  sandboxNodeId: string;
  page?: number;
  limit?: number;
}

// 列表响应类型
export interface ListArticlesBySandboxResult {
  articles: ArticleDetail[];
  pagination: Pagination;
}

export class ArticleService {
  constructor(private db: Database) {}

  // 获取作者信息
  private async getAuthor(authorId: string): Promise<AuthorInfo | null> {
    const result = await this.db
      .select({
        id: user.id,
        username: user.username,
        displayName: user.name,
        avatarUrl: user.image,
      })
      .from(user)
      .where(eq(user.id, authorId))
      .limit(1);

    return result[0] ?? null;
  }

  // 通过 sandboxNodeId 获取 artifactId，同时验证 node 类型为 SANDBOX
  async getArtifactIdBySandboxNodeId(sandboxNodeId: string): Promise<{ artifactId: string } | { error: 'NOT_FOUND' | 'NOT_SANDBOX' }> {
    const result = await this.db
      .select({ artifactId: artifactNodes.artifactId, type: artifactNodes.type })
      .from(artifactNodes)
      .where(eq(artifactNodes.id, sandboxNodeId))
      .limit(1);

    if (!result[0]) {
      return { error: 'NOT_FOUND' };
    }

    if (result[0].type !== 'SANDBOX') {
      return { error: 'NOT_SANDBOX' };
    }

    return { artifactId: result[0].artifactId };
  }

  // 转换为 ArticleDetail
  private toDetail(
    article: Article,
    author: AuthorInfo,
    artifactId: string
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
      sandboxNodeId: article.sandboxNodeId,
      artifactId,
      visibility: article.visibility,
      likes: article.likes,
      collections: article.collections,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }

  // 获取文章详情
  async getArticle(articleId: string): Promise<ServiceResult<ArticleDetail>> {
    try {
      const [article] = await this.db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      if (!article) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Article not found' },
        };
      }

      // 获取作者信息
      const author = await this.getAuthor(article.authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      // 获取 artifactId
      const sandboxResult = await this.getArtifactIdBySandboxNodeId(article.sandboxNodeId);
      if ('error' in sandboxResult) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact not found' },
        };
      }

      return {
        success: true,
        data: this.toDetail(article, author, sandboxResult.artifactId),
      };
    } catch (error) {
      console.error('Failed to get article:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get article' },
      };
    }
  }

  // 创建或更新文章
  async upsertArticle(params: UpsertArticleParams): Promise<ServiceResult<ArticleDetail>> {
    const { articleId, authorId, data } = params;

    try {
      // 验证 sandboxNodeId 是否存在且类型为 SANDBOX
      const sandboxResult = await this.getArtifactIdBySandboxNodeId(data.sandboxNodeId);
      if ('error' in sandboxResult) {
        if (sandboxResult.error === 'NOT_FOUND') {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Sandbox node not found' },
          };
        }
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Node is not a sandbox node' },
        };
      }
      const artifactId = sandboxResult.artifactId;

      // 检查文章是否存在
      const [existing] = await this.db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      if (existing) {
        // 更新模式：验证 author
        if (existing.authorId !== authorId) {
          return {
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not the article owner' },
          };
        }

        // 执行更新
        await this.db
          .update(articles)
          .set({
            title: data.title,
            sandboxNodeId: data.sandboxNodeId,
            content: data.content as ReaderContent,
            visibility: data.visibility ?? 'PUBLIC',
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(articles.id, articleId));
      } else {
        // 创建模式
        await this.db.insert(articles).values({
          id: articleId,
          authorId,
          title: data.title,
          sandboxNodeId: data.sandboxNodeId,
          content: data.content as ReaderContent,
          visibility: data.visibility ?? 'PUBLIC',
        });
      }

      // 返回完整的文章详情
      return this.getArticle(articleId);
    } catch (error) {
      console.error('Failed to upsert article:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to upsert article' },
      };
    }
  }

  // 获取与 sandboxNodeId 关联的所有文章（分页）
  async listArticlesBySandboxNodeId(
    params: ListArticlesBySandboxParams
  ): Promise<ServiceResult<ListArticlesBySandboxResult>> {
    const { sandboxNodeId, page = 1, limit = 20 } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 首先验证 sandboxNodeId 存在且类型为 SANDBOX
      const sandboxResult = await this.getArtifactIdBySandboxNodeId(sandboxNodeId);
      if ('error' in sandboxResult) {
        if (sandboxResult.error === 'NOT_FOUND') {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Sandbox node not found' },
          };
        }
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Node is not a sandbox node' },
        };
      }
      const artifactId = sandboxResult.artifactId;

      // 获取总数
      const [countResult] = await this.db
        .select({ count: count() })
        .from(articles)
        .where(
          and(
            eq(articles.sandboxNodeId, sandboxNodeId),
            eq(articles.visibility, 'PUBLIC')
          )
        );

      const total = countResult?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 获取文章列表
      const articleList = await this.db
        .select()
        .from(articles)
        .where(
          and(
            eq(articles.sandboxNodeId, sandboxNodeId),
            eq(articles.visibility, 'PUBLIC')
          )
        )
        .orderBy(desc(articles.createdAt))
        .limit(validLimit)
        .offset(offset);

      // 为每篇文章获取作者信息并转换为 ArticleDetail
      const articleDetails: ArticleDetail[] = [];
      for (const article of articleList) {
        const author = await this.getAuthor(article.authorId);
        if (author) {
          articleDetails.push(this.toDetail(article, author, artifactId));
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
      console.error('Failed to list articles by sandbox node:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list articles' },
      };
    }
  }
}
