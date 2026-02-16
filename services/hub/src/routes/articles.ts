import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, BatchContext, ArticleService } from '@pubwiki/db';
import type {
  ApiError,
  ArticleDetail,
  Pagination,
  ReaderContent,
} from '@pubwiki/api';
import { ListArticlesByArtifactQueryParams } from '@pubwiki/api/validate';
import { authMiddleware } from '../middleware/auth';
import { validateQuery, isValidationError } from '../lib/validate';
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
articlesRoute.get('/:articleId', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const articleService = new ArticleService(ctx);

  const articleId = c.req.param('articleId');

  // 验证 UUID 格式
  if (!articleId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid article ID format' }, 400);
  }

  const result = await articleService.getArticle(articleId);

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

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证必填字段
  if (!body.title || typeof body.title !== 'string') {
    return c.json<ApiError>({ error: 'title is required and must be a string' }, 400);
  }
  if ((body.title as string).length < 1 || (body.title as string).length > 200) {
    return c.json<ApiError>({ error: 'title must be between 1 and 200 characters' }, 400);
  }
  if (!body.artifactId || typeof body.artifactId !== 'string') {
    return c.json<ApiError>({ error: 'artifactId is required and must be a string' }, 400);
  }
  if (!body.artifactCommit || typeof body.artifactCommit !== 'string') {
    return c.json<ApiError>({ error: 'artifactCommit is required and must be a string' }, 400);
  }
  if (!body.content || !Array.isArray(body.content)) {
    return c.json<ApiError>({ error: 'content is required and must be an array' }, 400);
  }

  // 验证 isPrivate 和 isListed 类型（如果提供）
  if (body.isPrivate !== undefined && typeof body.isPrivate !== 'boolean') {
    return c.json<ApiError>({ error: 'isPrivate must be a boolean' }, 400);
  }
  if (body.isListed !== undefined && typeof body.isListed !== 'boolean') {
    return c.json<ApiError>({ error: 'isListed must be a boolean' }, 400);
  }

  // 验证 content 中每个元素的结构
  for (const block of body.content) {
    const b = block as Record<string, unknown>;
    if (!b || typeof b !== 'object' || !b.type) {
      return c.json<ApiError>({ error: 'Each content block must have a type' }, 400);
    }
    if (b.type === 'text') {
      if (typeof b.id !== 'string' || typeof b.text !== 'string') {
        return c.json<ApiError>({ error: 'TextContent requires id (string) and text (string)' }, 400);
      }
    } else if (b.type === 'game_ref') {
      if (typeof b.textId !== 'string' || typeof b.saveCommit !== 'string') {
        return c.json<ApiError>({ error: 'GameRef requires textId (string) and saveCommit (string)' }, 400);
      }
    } else {
      return c.json<ApiError>({ error: `Invalid content block type: ${b.type}` }, 400);
    }
  }

  const result = await articleService.upsertArticle({
    articleId,
    authorId: user.id,
    data: {
      title: body.title as string,
      artifactId: body.artifactId as string,
      artifactCommit: body.artifactCommit as string,
      content: body.content as ReaderContent,
      isListed: body.isListed as boolean | undefined,
    },
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  // Query the full article detail
  const detailCtx = new BatchContext(createDb(c.env.DB));
  const detailService = new ArticleService(detailCtx);
  const detailResult = await detailService.getArticle(result.data.articleId);

  if (!detailResult.success) {
    return serviceErrorResponse(c, detailResult.error);
  }

  return c.json<ArticleDetail>(detailResult.data);
});
