import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, BatchContext, ArticleService } from '@pubwiki/db';
import type {
  ApiError,
  ArticleDetail,
  Pagination,
  ReaderContent,
} from '@pubwiki/api';
import { ListArticlesByArtifactQueryParams, UpsertArticleBody } from '@pubwiki/api/validate';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { validateQuery, validateBody, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';

export const articlesRoute = new Hono<{ Bindings: Env }>();

// 获取与 artifact 关联的所有文章（分页）
articlesRoute.get('/by-artifact/:artifactId', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const articleService = new ArticleService(ctx);

  const artifactId = c.req.param('artifactId');

  // 验证 UUID 格式
  if (!artifactId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid artifact ID format' }, 400);
  }

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListArticlesByArtifactQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const result = await articleService.listArticlesByArtifactId({
    artifactId,
    ...validated,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<{ articles: ArticleDetail[]; pagination: Pagination }>(result.data);
});

// 获取文章详情
articlesRoute.get('/:articleId', optionalAuthMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const articleService = new ArticleService(ctx);
  const user = c.get('user');

  const articleId = c.req.param('articleId');

  // 验证 UUID 格式
  if (!articleId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid article ID format' }, 400);
  }

  const result = await articleService.getArticle({
    articleId,
    viewerId: user?.id,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<ArticleDetail>(result.data);
});

// 创建或更新文章
articlesRoute.put('/:articleId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const articleService = new ArticleService(ctx);
  const user = c.get('user');

  const articleId = c.req.param('articleId');

  // 验证 UUID 格式
  if (!articleId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid article ID format' }, 400);
  }

  // 使用 zod schema 验证请求体
  const validated = await validateBody(c, UpsertArticleBody);
  if (isValidationError(validated)) return validated;

  const result = await articleService.upsertArticle({
    articleId,
    authorId: user.id,
    data: {
      title: validated.title,
      artifactId: validated.artifactId,
      artifactCommit: validated.artifactCommit,
      content: validated.content as ReaderContent,
      isListed: validated.isListed,
      isPrivate: validated.isPrivate,
    },
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  // Query the full article detail (user is already authenticated and owns the article)
  const detailCtx = new BatchContext(createDb(c.env.DB));
  const detailService = new ArticleService(detailCtx);
  const detailResult = await detailService.getArticle({
    articleId: result.data.articleId,
    viewerId: user.id,
  });

  if (!detailResult.success) {
    return serviceErrorResponse(c, detailResult.error);
  }

  return c.json<ArticleDetail>(detailResult.data);
});

// Delete article
articlesRoute.delete('/:articleId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const articleService = new ArticleService(ctx);
  const user = c.get('user');

  const articleId = c.req.param('articleId');

  // Validate UUID format
  if (!articleId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid article ID format' }, 400);
  }

  const result = await articleService.deleteArticle({
    articleId,
    userId: user.id,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  return c.body(null, 204);
});
