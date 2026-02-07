import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, ArtifactService, ProjectService, UserService, type ListUserArtifactsParams, type ListUserProjectsParams } from '@pubwiki/db';
import type { GetUserArtifactsResponse, GetUserProjectsResponse, ApiError, UserProjectRole, VisibilityType } from '@pubwiki/api';
import { optionalAuthMiddleware } from '../middleware/auth';

const usersRoute = new Hono<{ Bindings: Env }>();

// 获取用户的 artifact 列表
usersRoute.get('/:userId/artifacts', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const userService = new UserService(db);
  const userId = c.req.param('userId');
  const currentUser = c.get('user');

  // 验证用户是否存在
  const userResult = await userService.getUserById(userId);
  if (!userResult.success) {
    return c.json<ApiError>({ error: 'User not found' }, 404);
  }

  // 解析查询参数
  const query = c.req.query();

  // 验证排序参数
  const validSortBy = ['createdAt', 'updatedAt', 'viewCount', 'starCount'];
  const validSortOrder = ['asc', 'desc'];
  
  if (query.sortBy && !validSortBy.includes(query.sortBy)) {
    return c.json<ApiError>({ error: `Invalid sortBy value. Must be one of: ${validSortBy.join(', ')}` }, 400);
  }
  if (query.sortOrder && !validSortOrder.includes(query.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder value. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  // 确定可见性过滤
  // - 未认证用户：只能看到 PUBLIC
  // - 已认证用户查看他人：可以看到 PUBLIC 和 UNLISTED
  // - 已认证用户查看自己：可以看到所有
  let visibilityFilter: VisibilityType[];
  if (!currentUser) {
    visibilityFilter = ['PUBLIC'];
  } else if (currentUser.id === userId) {
    visibilityFilter = ['PUBLIC', 'UNLISTED', 'PRIVATE'];
  } else {
    visibilityFilter = ['PUBLIC', 'UNLISTED'];
  }

  const params: ListUserArtifactsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    sortBy: query.sortBy as ListUserArtifactsParams['sortBy'],
    sortOrder: query.sortOrder as ListUserArtifactsParams['sortOrder'],
    visibilityFilter,
  };

  const result = await artifactService.listUserArtifacts(userId, params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<GetUserArtifactsResponse>(result.data);
});

// 获取用户的 project 列表（own 或 maintain 的）
usersRoute.get('/:userId/projects', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const userService = new UserService(db);
  const userId = c.req.param('userId');
  const currentUser = c.get('user');

  // 验证用户是否存在
  const userResult = await userService.getUserById(userId);
  if (!userResult.success) {
    return c.json<ApiError>({ error: 'User not found' }, 404);
  }

  // 解析查询参数
  const query = c.req.query();

  // 验证 role 参数
  const validRoles = ['owner', 'maintainer'];
  if (query.role && !validRoles.includes(query.role)) {
    return c.json<ApiError>({ error: `Invalid role value. Must be one of: ${validRoles.join(', ')}` }, 400);
  }

  // 验证排序参数
  const validSortBy = ['createdAt', 'updatedAt'];
  const validSortOrder = ['asc', 'desc'];
  
  if (query.sortBy && !validSortBy.includes(query.sortBy)) {
    return c.json<ApiError>({ error: `Invalid sortBy value. Must be one of: ${validSortBy.join(', ')}` }, 400);
  }
  if (query.sortOrder && !validSortOrder.includes(query.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder value. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  // 确定可见性过滤
  // - 未认证用户：只能看到 PUBLIC
  // - 已认证用户查看他人：可以看到 PUBLIC 和 UNLISTED
  // - 已认证用户查看自己：可以看到所有
  let visibilityFilter: VisibilityType[];
  if (!currentUser) {
    visibilityFilter = ['PUBLIC'];
  } else if (currentUser.id === userId) {
    visibilityFilter = ['PUBLIC', 'UNLISTED', 'PRIVATE'];
  } else {
    visibilityFilter = ['PUBLIC', 'UNLISTED'];
  }

  const params: ListUserProjectsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    role: query.role as UserProjectRole | undefined,
    sortBy: query.sortBy as ListUserProjectsParams['sortBy'],
    sortOrder: query.sortOrder as ListUserProjectsParams['sortOrder'],
    visibilityFilter,
  };

  const result = await projectService.listUserProjects(userId, params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<GetUserProjectsResponse>(result.data);
});

export { usersRoute };
