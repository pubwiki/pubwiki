import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, ProjectService, PostService, type ListProjectArtifactsParams } from '@pubwiki/db';
import type { ListProjectsResponse, ApiError, ProjectDetail, CreateProjectResponse, ProjectArtifact, ProjectPageDetail, PostDetail, CreatePostRequest, UpdatePostRequest, ListProjectPostsResponse, CreateProjectPostResponse, UpdateProjectPostResponse, DeleteProjectPostResponse } from '@pubwiki/api';
import { ListProjectsQueryParams, CreateProjectBody, ListProjectArtifactsQueryParams, ListProjectPostsQueryParams } from '@pubwiki/api/validate';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { checkResourceAccess } from '../lib/access-control';
import { validateQuery, validateBody, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';

const projectsRoute = new Hono<{ Bindings: Env }>();

// 获取公开 project 列表
projectsRoute.get('/', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);

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
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const user = c.get('user');

  // 使用 zod schema 校验请求体
  const validated = await validateBody(c, CreateProjectBody);
  if (isValidationError(validated)) return validated;

  // 创建 project (collects writes into batch)
  const result = await projectService.createProject({
    ownerId: user.id,
    metadata: validated,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  // Now query the full project detail
  const detailCtx = new BatchContext(createDb(c.env.DB));
  const detailService = new ProjectService(detailCtx);
  const detailResult = await detailService.getProjectDetails(result.data.projectId);

  if (!detailResult.success) {
    // Should not happen since we just created it
    return serviceErrorResponse(c, detailResult.error);
  }

  return c.json<CreateProjectResponse>({
    message: 'Project created successfully',
    project: detailResult.data,
  }, 201);
});

// 获取 project 详情
projectsRoute.get('/:projectId', resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const projectId = c.req.param('projectId');

  // 先获取 project 详情（检查是否存在）
  const result = await projectService.getProjectDetails(projectId);
  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // 再检查权限
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  return c.json<ProjectDetail>(result.data);
});

// DELETE: Delete project
projectsRoute.delete('/:projectId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Validate UUID format
  if (!projectId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid project ID format' }, 400);
  }

  const result = await projectService.deleteProject({
    projectId,
    userId: user.id,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  return c.body(null, 204);
});

// 获取 project page 详情
// 获取 project page 详情
projectsRoute.get('/:projectId/pages/:pageId', resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const projectId = c.req.param('projectId');
  const pageId = c.req.param('pageId');

  // 先检查 project 是否存在
  const projectResult = await projectService.getProjectDetails(projectId);
  if (!projectResult.success) {
    return serviceErrorResponse(c, projectResult.error);
  }

  // 再检查权限
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  // 获取 page 详情
  const pageResult = await projectService.getProjectPage(projectId, pageId);
  if (!pageResult.success) {
    return serviceErrorResponse(c, pageResult.error);
  }

  return c.json<ProjectPageDetail>(pageResult.data);
});

// 获取 project 的 artifact 列表
projectsRoute.get('/:projectId/artifacts', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const projectId = c.req.param('projectId');

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListProjectArtifactsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  // 处理 roleId 参数（'null' 字符串表示无角色）
  // 需要类型断言：route 层接收字符串 'null'，数据库层需要 null 来表示"无角色"
  const params = {
    ...validated,
    roleId: validated.roleId === 'null' ? null : validated.roleId,
  } as ListProjectArtifactsParams & { roleId: string | null | undefined };

  const result = await projectService.listProjectArtifacts(projectId, params);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json(result.data);
});

// 将 artifact 链接到 project
projectsRoute.post('/:projectId/artifacts', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
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
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();
  return c.json<{ message: string; projectArtifact: ProjectArtifact }>({
    message: 'Artifact linked to project successfully',
    projectArtifact: result.data,
  }, 201);
});

// ========== Project Posts API ==========

// 获取 project 的 posts 列表
projectsRoute.get('/:projectId/posts', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const projectService = new ProjectService(ctx);
  const postService = new PostService(ctx);
  const projectId = c.req.param('projectId');

  // 先检查 project 是否存在
  const projectResult = await projectService.getProjectDetails(projectId);
  if (!projectResult.success) {
    return serviceErrorResponse(c, projectResult.error);
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
  const ctx = new BatchContext(createDb(c.env.DB));
  const postService = new PostService(ctx);
  const projectId = c.req.param('projectId');
  const user = c.get('user');

  // 检查 project 是否存在并验证权限
  const projectResult = await postService.getProject(projectId);
  if (!projectResult.success) {
    return serviceErrorResponse(c, projectResult.error);
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

  // Commit the batch to persist changes
  await ctx.commit();

  // Query the full post detail
  const detailCtx = new BatchContext(createDb(c.env.DB));
  const detailService = new PostService(detailCtx);
  const detailResult = await detailService.getPost(projectId, result.data.postId);

  if (!detailResult.success) {
    return serviceErrorResponse(c, detailResult.error);
  }

  return c.json<CreateProjectPostResponse>({
    message: 'Post created successfully',
    post: detailResult.data,
  }, 201);
});

// 获取 post 详情
projectsRoute.get('/:projectId/posts/:postId', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const postService = new PostService(ctx);
  const projectId = c.req.param('projectId');
  const postId = c.req.param('postId');

  // 访问控制检查
  const accessError = await checkResourceAccess(c, { type: 'project', id: projectId });
  if (accessError) return accessError;

  // 获取 post 详情
  const result = await postService.getPost(projectId, postId);
  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<PostDetail>(result.data);
});

// 更新 post
projectsRoute.patch('/:projectId/posts/:postId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const postService = new PostService(ctx);
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
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  // Query the full post detail
  const detailCtx = new BatchContext(createDb(c.env.DB));
  const detailService = new PostService(detailCtx);
  const detailResult = await detailService.getPost(projectId, result.data.postId);

  if (!detailResult.success) {
    return serviceErrorResponse(c, detailResult.error);
  }

  return c.json<UpdateProjectPostResponse>({
    message: 'Post updated successfully',
    post: detailResult.data,
  });
});

// 删除 post
projectsRoute.delete('/:projectId/posts/:postId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const postService = new PostService(ctx);
  const projectId = c.req.param('projectId');
  const postId = c.req.param('postId');
  const user = c.get('user');

  const result = await postService.deletePost(projectId, postId, user.id);
  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  await ctx.commit();
  return c.json<DeleteProjectPostResponse>({
    message: 'Post deleted successfully',
  });
});

export { projectsRoute };
