import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, BatchContext, ArticleService } from '@pubwiki/db';
import type {
  ArticleDetail,
  Pagination,
  ReaderContent,
} from '@pubwiki/api';
import { ListArticlesByArtifactQueryParams, UpsertArticleBody } from '@pubwiki/api/validate';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { validateQuery, validateBody, isValidationError } from '../lib/validate';
import { serviceErrorResponse, badRequest, notFound, commitWithConflictHandling } from '../lib/service-error';
import { createAuditLogger } from '../lib/audit';

export const articlesRoute = new Hono<{ Bindings: Env }>();

// 获取与 artifact 关联的所有文章（分页）
// Access control: user must be able to read the artifact
articlesRoute.get('/by-artifact/:artifactId', resourceAccessMiddleware, async (c) => {
  const { resourceAccess } = c.var;
  const artifactId = c.req.param('artifactId');

  // 验证 UUID 格式
  if (!artifactId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return badRequest(c, 'Invalid artifact ID format');
  }

  // Check if user can read the artifact
  const canRead = await resourceAccess.canRead({ type: 'artifact', id: artifactId });
  if (!canRead) {
    return notFound(c, 'Artifact not found or no permission');
  }

  const ctx = new BatchContext(createDb(c.env.DB));
  const articleService = new ArticleService(ctx);

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
    return badRequest(c, 'Invalid article ID format');
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
    return badRequest(c, 'Invalid article ID format');
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
  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Article was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

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

  // Audit log (upsert - may be create or update)
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.update('article', articleId, { artifactId: validated.artifactId });

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
    return badRequest(c, 'Invalid article ID format');
  }

  const result = await articleService.deleteArticle({
    articleId,
    userId: user.id,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Article was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.delete('article', articleId);

  return c.body(null, 204);
});
