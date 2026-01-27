import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, ArticleService } from '@pubwiki/db';
import type {
  ApiError,
  ArticleDetail,
  UpsertArticleRequest,
  Pagination,
} from '@pubwiki/api';
import { authMiddleware } from '../middleware/auth';

export const articlesRoute = new Hono<{ Bindings: Env }>();

// 获取与 sandbox node 关联的所有文章（分页）
articlesRoute.get('/by-sandbox/:sandboxNodeId', async (c) => {
  const db = createDb(c.env.DB);
  const articleService = new ArticleService(db);

  const sandboxNodeId = c.req.param('sandboxNodeId');
  const query = c.req.query();

  // 验证 UUID 格式
  if (!sandboxNodeId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid sandbox node ID format' }, 400);
  }

  const result = await articleService.listArticlesBySandboxNodeId({
    sandboxNodeId,
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
  });

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    if (result.error.code === 'BAD_REQUEST') {
      return c.json<ApiError>({ error: result.error.message }, 400);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<{ articles: ArticleDetail[]; pagination: Pagination }>(result.data);
});

// 获取文章详情
articlesRoute.get('/:articleId', async (c) => {
  const db = createDb(c.env.DB);
  const articleService = new ArticleService(db);

  const articleId = c.req.param('articleId');

  // 验证 UUID 格式
  if (!articleId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid article ID format' }, 400);
  }

  const result = await articleService.getArticle(articleId);

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ArticleDetail>(result.data);
});

// 创建或更新文章
articlesRoute.put('/:articleId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const articleService = new ArticleService(db);
  const user = c.get('user');

  const articleId = c.req.param('articleId');

  // 验证 UUID 格式
  if (!articleId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid article ID format' }, 400);
  }

  let body: UpsertArticleRequest;
  try {
    body = await c.req.json<UpsertArticleRequest>();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证必填字段
  if (!body.title || typeof body.title !== 'string') {
    return c.json<ApiError>({ error: 'title is required and must be a string' }, 400);
  }
  if (body.title.length < 1 || body.title.length > 200) {
    return c.json<ApiError>({ error: 'title must be between 1 and 200 characters' }, 400);
  }
  if (!body.sandboxNodeId || typeof body.sandboxNodeId !== 'string') {
    return c.json<ApiError>({ error: 'sandboxNodeId is required and must be a string' }, 400);
  }
  if (!body.saveId || typeof body.saveId !== 'string') {
    return c.json<ApiError>({ error: 'saveId is required and must be a string' }, 400);
  }
  if (!body.content || !Array.isArray(body.content)) {
    return c.json<ApiError>({ error: 'content is required and must be an array' }, 400);
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
      if (typeof b.textId !== 'string' || typeof b.checkpointId !== 'string') {
        return c.json<ApiError>({ error: 'GameRef requires textId (string) and checkpointId (string)' }, 400);
      }
    } else {
      return c.json<ApiError>({ error: `Invalid content block type: ${b.type}` }, 400);
    }
  }

  // 验证 visibility
  if (body.visibility && !['PUBLIC', 'PRIVATE', 'UNLISTED'].includes(body.visibility)) {
    return c.json<ApiError>({ error: 'Invalid visibility value' }, 400);
  }

  const articleVisibility = body.visibility || 'PUBLIC';
  const visibilityOrder = { 'PRIVATE': 0, 'UNLISTED': 1, 'PUBLIC': 2 } as const;
  const articleVisibilityLevel = visibilityOrder[articleVisibility];

  // 验证 saveId 存在
  const saveMetadata = await c.env.GAMESAVE.getMetadata(body.saveId);
  if (!saveMetadata) {
    return c.json<ApiError>({ error: `Save ${body.saveId} not found` }, 400);
  }

  // 验证每个 game_ref 的 checkpointId
  const gameRefs = body.content.filter((b): b is { type: 'game_ref'; textId: string; checkpointId: string } => 
    (b as Record<string, unknown>).type === 'game_ref'
  );

  for (const gameRef of gameRefs) {
    const checkpoint = await c.env.GAMESAVE.getCheckpoint(body.saveId, gameRef.checkpointId);
    if (!checkpoint) {
      return c.json<ApiError>({ 
        error: `Checkpoint ${gameRef.checkpointId} not found in save ${body.saveId}` 
      }, 400);
    }

    // 验证 checkpoint visibility 不低于 article visibility
    const checkpointVisibilityLevel = visibilityOrder[checkpoint.visibility];
    if (checkpointVisibilityLevel < articleVisibilityLevel) {
      return c.json<ApiError>({ 
        error: `Checkpoint ${gameRef.checkpointId} visibility (${checkpoint.visibility}) is lower than article visibility (${articleVisibility}). Checkpoint must be at least ${articleVisibility}.` 
      }, 400);
    }
  }

  const result = await articleService.upsertArticle({
    articleId,
    authorId: user.id,
    data: body,
  });

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    if (result.error.code === 'FORBIDDEN') {
      return c.json<ApiError>({ error: result.error.message }, 403);
    }
    if (result.error.code === 'BAD_REQUEST') {
      return c.json<ApiError>({ error: result.error.message }, 400);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ArticleDetail>(result.data);
});
