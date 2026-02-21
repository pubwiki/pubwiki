import { eq, sql, desc, count, and, inArray } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { articles, type Article } from '../schema/articles';
import { artifactVersions } from '../schema/artifacts';
import { nodeVersions } from '../schema/node-versions';
import { user } from '../schema/auth';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import type { ServiceResult } from './user';
import type {
  ArticleDetail,
  ArticleAuthor,
  ReaderContent,
  ListArticlesByArtifactResponse,
  UpsertArticleRequest,
  operations,
} from '@pubwiki/api';
import { AclService, DiscoveryService } from './access-control';

// Re-export types
export type { ArticleDetail };

// Upsert parameters: path params + auth context + request body
export interface UpsertArticleParams {
  articleId: operations['upsertArticle']['parameters']['path']['articleId'];
  authorId: string; // from auth context
  data: UpsertArticleRequest;
}

// Get parameters: path params + optional auth context
export interface GetArticleParams {
  articleId: operations['getArticle']['parameters']['path']['articleId'];
  /** Optional viewer ID for permission checking. If not provided, only public articles are accessible. */
  viewerId?: string;
}

// List query parameters: path + query params
type ListArticlesPathParams = operations['listArticlesByArtifact']['parameters']['path'];
type ListArticlesQueryParams = NonNullable<operations['listArticlesByArtifact']['parameters']['query']>;
export type ListArticlesByArtifactParams = ListArticlesPathParams & ListArticlesQueryParams;

// List response type - directly use API response type
export type ListArticlesByArtifactResult = ListArticlesByArtifactResponse;

// Delete parameters: path params + auth context
export interface DeleteArticleParams {
  articleId: operations['deleteArticle']['parameters']['path']['articleId'];
  userId: string; // from auth context
}

export class ArticleService {
  private readonly aclService: AclService;
  private readonly discoveryService: DiscoveryService;

  constructor(private ctx: BatchContext) {
    this.aclService = new AclService(ctx);
    this.discoveryService = new DiscoveryService(ctx);
  }

  // Get author info
  private async getAuthor(authorId: string): Promise<ArticleAuthor | null> {
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

  // Convert to ArticleDetail
  private toDetail(
    article: Article,
    author: ArticleAuthor,
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
  async getArticle(params: GetArticleParams): Promise<ServiceResult<ArticleDetail>> {
    const { articleId, viewerId } = params;
    const articleRef = { type: 'article' as const, id: articleId };

    try {
      // Step 1: Get article record
      const [row] = await this.ctx.select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      if (!row) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Article not found' },
        };
      }

      // Step 2: Check read permission using AclService
      const canRead = await this.aclService.canRead(articleRef, viewerId);
      if (!canRead) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Article not found' },
        };
      }

      // Step 3: Get discovery control using DiscoveryService
      const discoveryRecord = await this.discoveryService.get(articleRef);
      const isListed = discoveryRecord?.isListed ?? false;

      // Step 4: Get author info
      const author = await this.getAuthor(row.authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      return {
        success: true,
        data: this.toDetail(row, author, { isListed }),
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
   * 
   * Privacy constraint: If isPrivate=false (public article), the artifact must also be public.
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

      // Determine privacy setting (default to false = public)
      const isPrivate = data.isPrivate ?? false;

      // Check artifact privacy: public article requires public artifact
      if (!isPrivate) {
        const artifactRef = { type: 'artifact' as const, id: data.artifactId };
        const artifactIsPublic = await this.aclService.isPublic(artifactRef);
        if (!artifactIsPublic) {
          return {
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'Cannot create public article for private artifact. Set isPrivate=true or make the artifact public first.',
            },
          };
        }
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
      const articleRef = { type: 'article' as const, id: articleId };

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

        // Update discovery control using DiscoveryService
        const existingDiscovery = await this.discoveryService.get(articleRef);
        if (existingDiscovery) {
          this.discoveryService.setListed(articleRef, isListed);
        } else {
          this.discoveryService.create(articleRef, isListed);
        }

        // Update ACL based on isPrivate (one-way relaxation: private->public allowed, public->private needs check)
        const currentIsPublic = await this.aclService.isPublic(articleRef);
        if (isPrivate && currentIsPublic) {
          // public -> private: remove public ACL
          this.aclService.setPrivate(articleRef);
        } else if (!isPrivate && !currentIsPublic) {
          // private -> public: add public ACL (artifact check already done above)
          this.aclService.setPublic(articleRef, authorId);
        }
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

        // Create discovery control using DiscoveryService
        this.discoveryService.create(articleRef, isListed);

        // Create owner ACL using AclService
        this.aclService.grantOwner(articleRef, authorId);

        // Create public read ACL only if not private
        if (!isPrivate) {
          this.aclService.setPublic(articleRef, authorId);
        }
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

  /**
   * Delete an article.
   * Requires manage permission on the article.
   */
  async deleteArticle(params: DeleteArticleParams): Promise<ServiceResult<void>> {
    const { articleId, userId } = params;
    const articleRef = { type: 'article' as const, id: articleId };

    try {
      // Step 1: Check article exists
      const [existing] = await this.ctx.select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      if (!existing) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Article not found' },
        };
      }

      // Step 2: Check manage permission
      const canManage = await this.aclService.canManage(articleRef, userId);
      if (!canManage) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'No permission to delete this article' },
        };
      }

      // Step 3: Delete article record
      this.ctx.modify(db =>
        db.delete(articles).where(eq(articles.id, articleId))
      );

      // Step 4: Delete ACL records
      this.aclService.deleteAllAcls(articleRef);

      // Step 5: Delete discovery control record
      this.discoveryService.delete(articleRef);

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Failed to delete article:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete article' },
      };
    }
  }
}
