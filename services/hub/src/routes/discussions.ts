import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, DiscussionService, type ListDiscussionsParams, type ListRepliesParams } from '@pubwiki/db';
import type {
  ApiError,
  ListDiscussionsResponse,
  CreateDiscussionResponse,
  UpdateDiscussionResponse,
  ListDiscussionRepliesResponse,
  CreateDiscussionReplyResponse,
  DiscussionDetail,
  DiscussionReplyItem,
  DiscussionTargetType,
  DiscussionCategory,
  CreateDiscussionRequest,
  UpdateDiscussionRequest,
  CreateDiscussionReplyRequest,
} from '@pubwiki/api';
import { authMiddleware } from '../middleware/auth';

const discussionsRoute = new Hono<{ Bindings: Env }>();

// 验证 targetType
function isValidTargetType(value: string): value is DiscussionTargetType {
  return ['ARTIFACT', 'PROJECT'].includes(value);
}

// 验证 category
function isValidCategory(value: string): value is DiscussionCategory {
  return ['QUESTION', 'FEEDBACK', 'BUG_REPORT', 'FEATURE_REQUEST', 'GENERAL'].includes(value);
}

// 获取讨论列表
discussionsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);

  const query = c.req.query();

  // 验证必填参数
  if (!query.targetType || !query.targetId) {
    return c.json<ApiError>({ error: 'targetType and targetId are required' }, 400);
  }

  if (!isValidTargetType(query.targetType)) {
    return c.json<ApiError>({ error: 'Invalid targetType. Must be ARTIFACT or PROJECT' }, 400);
  }

  // 验证 category（如果提供）
  if (query.category && !isValidCategory(query.category)) {
    return c.json<ApiError>({ error: 'Invalid category' }, 400);
  }

  // 验证排序参数
  const validSortBy = ['createdAt', 'updatedAt', 'replyCount'];
  const validSortOrder = ['asc', 'desc'];

  if (query.sortBy && !validSortBy.includes(query.sortBy)) {
    return c.json<ApiError>({ error: `Invalid sortBy. Must be one of: ${validSortBy.join(', ')}` }, 400);
  }
  if (query.sortOrder && !validSortOrder.includes(query.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  const params: ListDiscussionsParams = {
    target: {
      type: query.targetType,
      id: query.targetId,
    },
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    category: query.category as DiscussionCategory | undefined,
    sortBy: query.sortBy as ListDiscussionsParams['sortBy'],
    sortOrder: query.sortOrder as ListDiscussionsParams['sortOrder'],
  };

  const result = await discussionService.listDiscussions(params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ListDiscussionsResponse>(result.data);
});

// 创建讨论
discussionsRoute.post('/', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);
  const user = c.get('user');

  const query = c.req.query();

  // 验证必填参数
  if (!query.targetType || !query.targetId) {
    return c.json<ApiError>({ error: 'targetType and targetId are required' }, 400);
  }

  if (!isValidTargetType(query.targetType)) {
    return c.json<ApiError>({ error: 'Invalid targetType. Must be ARTIFACT or PROJECT' }, 400);
  }

  // 解析请求体
  let body: CreateDiscussionRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.content || body.content.trim().length === 0) {
    return c.json<ApiError>({ error: 'content is required' }, 400);
  }

  // 验证 category（如果提供）
  if (body.category && !isValidCategory(body.category)) {
    return c.json<ApiError>({ error: 'Invalid category' }, 400);
  }

  const result = await discussionService.createDiscussion(
    { type: query.targetType, id: query.targetId },
    user.id,
    body
  );

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json<CreateDiscussionResponse>({
    message: 'Discussion created successfully',
    discussion: result.data,
  }, 201);
});

// 获取讨论详情
discussionsRoute.get('/:discussionId', async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);

  const discussionId = c.req.param('discussionId');

  const result = await discussionService.getDiscussion(discussionId);

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json<DiscussionDetail>(result.data);
});

// 更新讨论
discussionsRoute.patch('/:discussionId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);
  const user = c.get('user');

  const discussionId = c.req.param('discussionId');

  // 解析请求体
  let body: UpdateDiscussionRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证 category（如果提供）
  if (body.category && !isValidCategory(body.category)) {
    return c.json<ApiError>({ error: 'Invalid category' }, 400);
  }

  const result = await discussionService.updateDiscussion(discussionId, user.id, body);

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 :
                       result.error.code === 'FORBIDDEN' ? 403 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json<UpdateDiscussionResponse>({
    message: 'Discussion updated successfully',
    discussion: result.data,
  });
});

// 删除讨论
discussionsRoute.delete('/:discussionId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);
  const user = c.get('user');

  const discussionId = c.req.param('discussionId');

  const result = await discussionService.deleteDiscussion(discussionId, user.id);

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 :
                       result.error.code === 'FORBIDDEN' ? 403 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json({ message: 'Discussion deleted successfully' });
});

// ========== 回复相关路由 ==========

// 获取讨论回复列表
discussionsRoute.get('/:discussionId/replies', async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);

  const discussionId = c.req.param('discussionId');
  const query = c.req.query();

  // 验证排序参数
  const validSortOrder = ['asc', 'desc'];
  if (query.sortOrder && !validSortOrder.includes(query.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  const params: ListRepliesParams = {
    discussionId,
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    sortOrder: query.sortOrder as ListRepliesParams['sortOrder'],
  };

  const result = await discussionService.listReplies(params);

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json<ListDiscussionRepliesResponse>(result.data);
});

// 创建回复
discussionsRoute.post('/:discussionId/replies', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);
  const user = c.get('user');

  const discussionId = c.req.param('discussionId');

  // 解析请求体
  let body: CreateDiscussionReplyRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.content || body.content.trim().length === 0) {
    return c.json<ApiError>({ error: 'content is required' }, 400);
  }

  const result = await discussionService.createReply(discussionId, user.id, body);

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 :
                       result.error.code === 'FORBIDDEN' ? 403 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json<CreateDiscussionReplyResponse>({
    message: 'Reply created successfully',
    reply: result.data,
  }, 201);
});

// 删除回复
discussionsRoute.delete('/replies/:replyId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const discussionService = new DiscussionService(db);
  const user = c.get('user');

  const replyId = c.req.param('replyId');

  const result = await discussionService.deleteReply(replyId, user.id);

  if (!result.success) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 :
                       result.error.code === 'FORBIDDEN' ? 403 : 500;
    return c.json<ApiError>({ error: result.error.message }, statusCode);
  }

  return c.json({ message: 'Reply deleted successfully' });
});

export { discussionsRoute };
