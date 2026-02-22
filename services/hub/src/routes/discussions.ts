import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, DiscussionService, type ListDiscussionsParams, type ListRepliesParams } from '@pubwiki/db';
import type {
  ApiError,
  ListDiscussionsResponse,
  CreateDiscussionResponse,
  UpdateDiscussionResponse,
  ListDiscussionRepliesResponse,
  CreateDiscussionReplyResponse,
  DiscussionDetail,
} from '@pubwiki/api';
import { ListDiscussionsQueryParams, ListDiscussionRepliesQueryParams, CreateDiscussionQueryParams, CreateDiscussionBody, UpdateDiscussionBody, CreateDiscussionReplyBody } from '@pubwiki/api/validate';
import { authMiddleware } from '../middleware/auth';
import { validateQuery, validateBody, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';

const discussionsRoute = new Hono<{ Bindings: Env }>();

// 获取讨论列表
discussionsRoute.get('/', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListDiscussionsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const params: ListDiscussionsParams = {
    target: {
      type: validated.targetType,
      id: validated.targetId,
    },
    page: validated.page,
    limit: validated.limit,
    category: validated.category,
    sortBy: validated.sortBy,
    sortOrder: validated.sortOrder,
  };

  const result = await discussionService.listDiscussions(params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ListDiscussionsResponse>(result.data);
});

// 创建讨论
discussionsRoute.post('/', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');

  // 使用 zod schema 校验查询参数
  const validatedQuery = validateQuery(c, CreateDiscussionQueryParams, c.req.query());
  if (isValidationError(validatedQuery)) return validatedQuery;

  // 使用 zod schema 校验请求体
  const validatedBody = await validateBody(c, CreateDiscussionBody);
  if (isValidationError(validatedBody)) return validatedBody;

  const result = await discussionService.createDiscussion(
    { type: validatedQuery.targetType, id: validatedQuery.targetId },
    user.id,
    validatedBody
  );

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();

  // Fetch the created discussion
  const discussionResult = await discussionService.getDiscussion(result.data.discussionId);
  if (!discussionResult.success) {
    return serviceErrorResponse(c, discussionResult.error);
  }

  return c.json<CreateDiscussionResponse>({
    message: 'Discussion created successfully',
    discussion: discussionResult.data,
  }, 201);
});

// 获取讨论详情
discussionsRoute.get('/:discussionId', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);

  const discussionId = c.req.param('discussionId');

  const result = await discussionService.getDiscussion(discussionId);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<DiscussionDetail>(result.data);
});

// 更新讨论
discussionsRoute.patch('/:discussionId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');

  const discussionId = c.req.param('discussionId');

  // 使用 zod schema 校验请求体
  const validatedBody = await validateBody(c, UpdateDiscussionBody);
  if (isValidationError(validatedBody)) return validatedBody;

  const result = await discussionService.updateDiscussion(discussionId, user.id, validatedBody);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();

  // Fetch the updated discussion
  const discussionResult = await discussionService.getDiscussion(result.data.discussionId);
  if (!discussionResult.success) {
    return serviceErrorResponse(c, discussionResult.error);
  }

  return c.json<UpdateDiscussionResponse>({
    message: 'Discussion updated successfully',
    discussion: discussionResult.data,
  });
});

// 删除讨论
discussionsRoute.delete('/:discussionId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');

  const discussionId = c.req.param('discussionId');

  const result = await discussionService.deleteDiscussion(discussionId, user.id);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();
  return c.json({ message: 'Discussion deleted successfully' });
});

// ========== 回复相关路由 ==========

// 获取讨论回复列表
discussionsRoute.get('/:discussionId/replies', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);

  const discussionId = c.req.param('discussionId');

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListDiscussionRepliesQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const params: ListRepliesParams = {
    discussionId,
    ...validated,
  };

  const result = await discussionService.listReplies(params);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<ListDiscussionRepliesResponse>(result.data);
});

// 创建回复
discussionsRoute.post('/:discussionId/replies', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');

  const discussionId = c.req.param('discussionId');

  // Validate request body with zod schema
  const validated = await validateBody(c, CreateDiscussionReplyBody);
  if (isValidationError(validated)) return validated;

  const result = await discussionService.createReply(discussionId, user.id, validated);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();
  return c.json<CreateDiscussionReplyResponse>({
    message: 'Reply created successfully',
    reply: result.data,
  }, 201);
});

// 删除回复
discussionsRoute.delete('/replies/:replyId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');

  const replyId = c.req.param('replyId');

  const result = await discussionService.deleteReply(replyId, user.id);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();
  return c.json({ message: 'Reply deleted successfully' });
});

export { discussionsRoute };
