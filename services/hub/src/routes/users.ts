import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, ArtifactService, ProjectService, UserService, type ListUserArtifactsParams, type ListUserProjectsParams } from '@pubwiki/db';
import type { GetUserArtifactsResponse, GetUserProjectsResponse, ApiError } from '@pubwiki/api';
import { GetUserArtifactsQueryParams, GetUserProjectsQueryParams } from '@pubwiki/api/validate';
import { optionalAuthMiddleware } from '../middleware/auth';
import { validateQuery, isValidationError } from '../lib/validate';

const usersRoute = new Hono<{ Bindings: Env }>();

// 获取用户的 artifact 列表
usersRoute.get('/:userId/artifacts', optionalAuthMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const userService = new UserService(ctx);
  const userId = c.req.param('userId');
  const currentUser = c.get('user');

  // 验证用户是否存在
  const userResult = await userService.getUserById(userId);
  if (!userResult.success) {
    return c.json<ApiError>({ error: 'User not found' }, 404);
  }

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, GetUserArtifactsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const params: ListUserArtifactsParams = {
    ...validated,
    viewerId: currentUser?.id,
  };

  const result = await artifactService.listUserArtifacts(userId, params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<GetUserArtifactsResponse>(result.data);
});

// 获取用户的 project 列表（own 或 maintain 的）
usersRoute.get('/:userId/projects', optionalAuthMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const userService = new UserService(ctx);
  const userId = c.req.param('userId');
  const currentUser = c.get('user');

  // 验证用户是否存在
  const userResult = await userService.getUserById(userId);
  if (!userResult.success) {
    return c.json<ApiError>({ error: 'User not found' }, 404);
  }

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, GetUserProjectsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const params: ListUserProjectsParams = {
    ...validated,
    viewerId: currentUser?.id,
  };

  const result = await projectService.listUserProjects(userId, params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<GetUserProjectsResponse>(result.data);
});

export { usersRoute };
