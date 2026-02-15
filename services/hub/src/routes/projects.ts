import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, ProjectService, PostService, type ListProjectsParams, type ListProjectArtifactsParams, type ListPostsParams } from '@pubwiki/db';
import type { ListProjectsResponse, ApiError, ProjectDetail, CreateProjectMetadata, CreateProjectResponse, ProjectArtifact, ProjectPageDetail, PostListItem, PostDetail, CreatePostRequest, UpdatePostRequest, ListProjectPostsResponse, CreateProjectPostResponse, GetProjectPostResponse, UpdateProjectPostResponse, DeleteProjectPostResponse } from '@pubwiki/api';
import { ListProjectsQueryParams, CreateProjectBody, ListProjectArtifactsQueryParams, ListProjectPostsQueryParams } from '@pubwiki/api/validate';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { checkResourceAccess, requireResourceOwner } from '../lib/access-control';
import { validateQuery, validateBody, isValidationError } from '../lib/validate';

const projectsRoute = new Hono<{ Bindings: Env }>();

// 获取公开 project 列表
projectsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListProjectsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const result = await projectService.listPublicProjects(validated);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ListProjectsResponse>(result.data);
});

// 创建 project
projectsRoute.post('/', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const user = c.get('user');

  // 使用 zod schema 校验请求体
  const validated = await validateBody(c, CreateProjectBody);
  if (isValidationError(validated)) return validated;

  // 创建 project
  const result = await projectService.createProject({
    ownerId: user.id,
    metadata: validated,
  });

  if (!result.success) {
    if (result.error.code === 'CONFLICT') {
      return c.json<ApiError>({ error: result.error.message }, 409);
    }
    if (result.error.code === 'NOT_FOUND' || result.error.code === 'VALIDATION_ERROR') {
      return c.json<ApiError>({ error: result.error.message }, 400);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<CreateProjectResponse>({
    message: 'Project created successfully',
    project: result.data,
  }, 201);
});

// 获取 project 详情
projectsRoute.get('/:projectId', resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const projectId = c.req.param('projectId');

  // 先获取 project 详情（检查是否存在）
  const result = await projectService.getProjectDetails(projectId);
  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'project not found' }, 404);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  // 再检查权限
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  return c.json<ProjectDetail>(result.data);
});

// 获取 project page 详情
// 获取 project page 详情
projectsRoute.get('/:projectId/pages/:pageId', resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const projectId = c.req.param('projectId');
  const pageId = c.req.param('pageId');

  // 先检查 project 是否存在
  const projectResult = await projectService.getProjectDetails(projectId);
  if (!projectResult.success) {
    if (projectResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'project not found' }, 404);
    }
    return c.json<ApiError>({ error: projectResult.error.message }, 500);
  }

  // 再检查权限
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  // 获取 page 详情
  const pageResult = await projectService.getProjectPage(projectId, pageId);
  if (!pageResult.success) {
    if (pageResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Page not found' }, 404);
    }
    return c.json<ApiError>({ error: pageResult.error.message }, 500);
  }

  return c.json<ProjectPageDetail>(pageResult.data);
});

// 获取 project 的 artifact 列表
projectsRoute.get('/:projectId/artifacts', async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const projectId = c.req.param('projectId');

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListProjectArtifactsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  // 处理 roleId 参数（'null' 字符串表示无角色）
  const params: ListProjectArtifactsParams = {
    ...validated,
    roleId: validated.roleId === 'null' ? null : validated.roleId,
  };

  const result = await projectService.listProjectArtifacts(projectId, params);

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json(result.data);
});

// 将 artifact 链接到 project
projectsRoute.post('/:projectId/artifacts', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const projectId = c.req.param('projectId');
  const user = c.get('user');

  // 解析请求体
  let body: { artifactId: string; roleId: string; isOfficial?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证必填字段
  if (!body.artifactId) {
    return c.json<ApiError>({ error: 'artifactId is required' }, 400);
  }

  if (!body.roleId) {
    return c.json<ApiError>({ error: 'roleId is required' }, 400);
  }

  const result = await projectService.linkArtifactToProject({
    projectId,
    artifactId: body.artifactId,
    roleId: body.roleId,
    isOfficial: body.isOfficial,
    userId: user.id,
  });

  if (!result.success) {
    switch (result.error.code) {
      case 'NOT_FOUND':
        return c.json<ApiError>({ error: result.error.message }, 404);
      case 'CONFLICT':
        return c.json<ApiError>({ error: result.error.message }, 409);
      case 'FORBIDDEN':
        return c.json<ApiError>({ error: result.error.message }, 403);
      case 'VALIDATION_ERROR':
        return c.json<ApiError>({ error: result.error.message }, 400);
      default:
        return c.json<ApiError>({ error: result.error.message }, 500);
    }
  }

  return c.json<{ message: string; projectArtifact: ProjectArtifact }>({
    message: 'Artifact linked to project successfully',
    projectArtifact: result.data,
  }, 201);
});

// ========== Project Posts API ==========

// 获取 project 的 posts 列表
projectsRoute.get('/:projectId/posts', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');

  // 先检查 project 是否存在
  const projectResult = await projectService.getProjectDetails(projectId);
  if (!projectResult.success) {
    if (projectResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'project not found' }, 404);
    }
    return c.json<ApiError>({ error: projectResult.error.message }, 500);
  }

  // 访问控制检查
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListProjectPostsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const result = await postService.listPosts(projectId, validated);
  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ListProjectPostsResponse>(result.data);
});

// 创建 post
projectsRoute.post('/:projectId/posts', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');
  const user = c.get('user');

  // 检查 project 是否存在并验证权限
  const projectResult = await postService.getProject(projectId);
  if (!projectResult.success) {
    if (projectResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Project not found' }, 404);
    }
    return c.json<ApiError>({ error: projectResult.error.message }, 500);
  }

  // 检查是否是 owner 或 maintainer
  const memberResult = await postService.isProjectMember(projectId, user.id);
  if (!memberResult.success) {
    return c.json<ApiError>({ error: memberResult.error.message }, 500);
  }

  const { isOwner, isMaintainer } = memberResult.data;
  if (!isOwner && !isMaintainer) {
    return c.json<ApiError>({ error: 'Only owner or maintainer can create posts' }, 403);
  }

  // 解析请求体
  let body: CreatePostRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证必填字段
  if (!body.title || body.title.trim() === '') {
    return c.json<ApiError>({ error: 'title is required' }, 400);
  }
  if (!body.content) {
    return c.json<ApiError>({ error: 'content is required' }, 400);
  }

  // 创建 post
  const result = await postService.createPost({
    projectId,
    authorId: user.id,
    data: body,
  });

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<CreateProjectPostResponse>({
    message: 'Post created successfully',
    post: result.data,
  }, 201);
});

// 获取 post 详情
projectsRoute.get('/:projectId/posts/:postId', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');
  const postId = c.req.param('postId');

  // 访问控制检查
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  // 获取 post 详情
  const result = await postService.getPost(projectId, postId);
  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Post not found' }, 404);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<PostDetail>(result.data);
});

// 更新 post
projectsRoute.patch('/:projectId/posts/:postId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');
  const postId = c.req.param('postId');
  const user = c.get('user');

  // 解析请求体
  let body: UpdatePostRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 更新 post
  const result = await postService.updatePost(projectId, postId, user.id, body);
  if (!result.success) {
    switch (result.error.code) {
      case 'NOT_FOUND':
        return c.json<ApiError>({ error: result.error.message }, 404);
      case 'FORBIDDEN':
        return c.json<ApiError>({ error: result.error.message }, 403);
      default:
        return c.json<ApiError>({ error: result.error.message }, 500);
    }
  }

  return c.json<UpdateProjectPostResponse>({
    message: 'Post updated successfully',
    post: result.data,
  });
});

// 删除 post
projectsRoute.delete('/:projectId/posts/:postId', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');
  const postId = c.req.param('postId');
  const user = c.get('user');

  const result = await postService.deletePost(projectId, postId, user.id);
  if (!result.success) {
    switch (result.error.code) {
      case 'NOT_FOUND':
        return c.json<ApiError>({ error: result.error.message }, 404);
      case 'FORBIDDEN':
        return c.json<ApiError>({ error: result.error.message }, 403);
      default:
        return c.json<ApiError>({ error: result.error.message }, 500);
    }
  }

  return c.json<DeleteProjectPostResponse>({
    message: 'Post deleted successfully',
  });
});

export { projectsRoute };
