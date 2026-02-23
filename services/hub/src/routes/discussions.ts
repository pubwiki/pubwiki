import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, DiscussionService, eq, type ListDiscussionsParams, type ListRepliesParams } from '@pubwiki/db';
import { projectPosts } from '@pubwiki/db/schema';
import type {
  ListDiscussionsResponse,
  CreateDiscussionResponse,
  UpdateDiscussionResponse,
  ListDiscussionRepliesResponse,
  CreateDiscussionReplyResponse,
  DiscussionDetail,
  DiscussionTargetType,
} from '@pubwiki/api';
import { ListDiscussionsQueryParams, ListDiscussionRepliesQueryParams, CreateDiscussionQueryParams, CreateDiscussionBody, UpdateDiscussionBody, CreateDiscussionReplyBody } from '@pubwiki/api/validate';
import { authMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { validateQuery, validateBody, isValidationError } from '../lib/validate';
import { serviceErrorResponse, forbidden, notFound, commitWithConflictHandling } from '../lib/service-error';
import { createAuditLogger } from '../lib/audit';
import type { ResourceRef } from '@pubwiki/db/services';

const discussionsRoute = new Hono<{ Bindings: Env }>();

/**
 * Convert discussion target to ACL resource reference.
 * For POST targets, we need to check the parent project's ACL.
 */
async function getTargetResourceRef(
  targetType: DiscussionTargetType,
  targetId: string,
  db: ReturnType<typeof createDb>
): Promise<ResourceRef | null> {
  switch (targetType) {
    case 'ARTIFACT':
      return { type: 'artifact', id: targetId };
    case 'PROJECT':
      return { type: 'project', id: targetId };
    case 'POST': {
      // POST belongs to a project, check project ACL
      const [post] = await db.select({ projectId: projectPosts.projectId })
        .from(projectPosts)
        .where(eq(projectPosts.id, targetId))
        .limit(1);
      if (!post) return null;
      return { type: 'project', id: post.projectId };
    }
    default:
      return null;
  }
}

// 获取讨论列表
discussionsRoute.get('/', resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const ctx = new BatchContext(db);
  const discussionService = new DiscussionService(ctx);
  const { canRead } = c.get('resourceAccess');

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListDiscussionsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  // Check if user can read the target resource
  const targetRef = await getTargetResourceRef(validated.targetType, validated.targetId, db);
  if (!targetRef) {
    return notFound(c, 'Target resource not found');
  }
  const allowed = await canRead(targetRef);
  if (!allowed) {
    return forbidden(c);
  }

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
    return serviceErrorResponse(c, result.error);
  }

  return c.json<ListDiscussionsResponse>(result.data);
});

// 创建讨论
discussionsRoute.post('/', authMiddleware, resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const ctx = new BatchContext(db);
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');
  const { canRead } = c.get('resourceAccess');

  // 使用 zod schema 校验查询参数
  const validatedQuery = validateQuery(c, CreateDiscussionQueryParams, c.req.query());
  if (isValidationError(validatedQuery)) return validatedQuery;

  // Check if user can read the target resource (can read = can comment)
  const targetRef = await getTargetResourceRef(validatedQuery.targetType, validatedQuery.targetId, db);
  if (!targetRef) {
    return notFound(c, 'Target resource not found');
  }
  const allowed = await canRead(targetRef);
  if (!allowed) {
    return forbidden(c);
  }

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

  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Discussion was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Fetch the created discussion
  const discussionResult = await discussionService.getDiscussion(result.data.discussionId);
  if (!discussionResult.success) {
    return serviceErrorResponse(c, discussionResult.error);
  }

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.create('discussion', result.data.discussionId, { targetType: validatedQuery.targetType, targetId: validatedQuery.targetId });

  return c.json<CreateDiscussionResponse>({
    message: 'Discussion created successfully',
    discussion: discussionResult.data,
  }, 201);
});

// 获取讨论详情
discussionsRoute.get('/:discussionId', resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const ctx = new BatchContext(db);
  const discussionService = new DiscussionService(ctx);
  const { canRead } = c.get('resourceAccess');

  const discussionId = c.req.param('discussionId');

  // First get the discussion to find its target
  const result = await discussionService.getDiscussion(discussionId);
  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Check if user can read the target resource
  const targetRef = await getTargetResourceRef(result.data.targetType, result.data.targetId, db);
  if (!targetRef) {
    return notFound(c, 'Target resource not found');
  }
  const allowed = await canRead(targetRef);
  if (!allowed) {
    return forbidden(c);
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

  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Discussion was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Fetch the updated discussion
  const discussionResult = await discussionService.getDiscussion(result.data.discussionId);
  if (!discussionResult.success) {
    return serviceErrorResponse(c, discussionResult.error);
  }

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.update('discussion', discussionId);

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

  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Discussion was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.delete('discussion', discussionId);

  return c.json({ message: 'Discussion deleted successfully' });
});

// ========== 回复相关路由 ==========

// 获取讨论回复列表
discussionsRoute.get('/:discussionId/replies', resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const ctx = new BatchContext(db);
  const discussionService = new DiscussionService(ctx);
  const { canRead } = c.get('resourceAccess');

  const discussionId = c.req.param('discussionId');

  // First get the discussion to find its target
  const discussion = await discussionService.getDiscussion(discussionId);
  if (!discussion.success) {
    return serviceErrorResponse(c, discussion.error);
  }

  // Check if user can read the target resource
  const targetRef = await getTargetResourceRef(discussion.data.targetType, discussion.data.targetId, db);
  if (!targetRef) {
    return notFound(c, 'Target resource not found');
  }
  const allowed = await canRead(targetRef);
  if (!allowed) {
    return forbidden(c);
  }

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
discussionsRoute.post('/:discussionId/replies', authMiddleware, resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const ctx = new BatchContext(db);
  const discussionService = new DiscussionService(ctx);
  const user = c.get('user');
  const { canRead } = c.get('resourceAccess');

  const discussionId = c.req.param('discussionId');

  // First get the discussion to find its target
  const discussion = await discussionService.getDiscussion(discussionId);
  if (!discussion.success) {
    return serviceErrorResponse(c, discussion.error);
  }

  // Check if user can read the target resource (can read = can reply)
  const targetRef = await getTargetResourceRef(discussion.data.targetType, discussion.data.targetId, db);
  if (!targetRef) {
    return notFound(c, 'Target resource not found');
  }
  const allowed = await canRead(targetRef);
  if (!allowed) {
    return forbidden(c);
  }

  // Validate request body with zod schema
  const validated = await validateBody(c, CreateDiscussionReplyBody);
  if (isValidationError(validated)) return validated;

  const result = await discussionService.createReply(discussionId, user.id, validated);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Reply was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.create('discussion_reply', result.data.id, { discussionId });

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

  const conflictResponse = await commitWithConflictHandling(c, ctx, 'Reply was modified concurrently. Please retry.');
  if (conflictResponse) return conflictResponse;

  // Audit log
  const audit = createAuditLogger({ userId: user.id, ip: c.req.header('CF-Connecting-IP') });
  audit.delete('discussion_reply', replyId);

  return c.json({ message: 'Reply deleted successfully' });
});

export { discussionsRoute };
