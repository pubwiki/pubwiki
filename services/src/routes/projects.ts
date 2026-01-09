import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, ProjectService, PostService, type ListProjectsParams, type ListProjectArtifactsParams, type ListPostsParams } from '@pubwiki/db';
import type { ListProjectsResponse, ApiError, ProjectDetail, CreateProjectMetadata, CreateProjectResponse, ProjectArtifact, ProjectPageDetail, PostListItem, PostDetail, CreatePostRequest, UpdatePostRequest, ListProjectPostsResponse, CreateProjectPostResponse, GetProjectPostResponse, UpdateProjectPostResponse, DeleteProjectPostResponse } from '@pubwiki/api';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';

const projectsRoute = new Hono<{ Bindings: Env }>();

// 获取公开 project 列表
projectsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);

  // 解析查询参数
  const query = c.req.query();

  const params: ListProjectsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    topic: query.topic,
    sortBy: query.sortBy as ListProjectsParams['sortBy'],
    sortOrder: query.sortOrder as ListProjectsParams['sortOrder'],
  };

  // 验证排序参数
  const validSortBy = ['createdAt', 'updatedAt'];
  const validSortOrder = ['asc', 'desc'];
  
  if (params.sortBy && !validSortBy.includes(params.sortBy)) {
    return c.json<ApiError>({ error: `Invalid sortBy value. Must be one of: ${validSortBy.join(', ')}` }, 400);
  }
  if (params.sortOrder && !validSortOrder.includes(params.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder value. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  const result = await projectService.listPublicProjects(params);

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

  // 解析 JSON body
  let metadata: CreateProjectMetadata;
  try {
    metadata = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  // 验证必填字段
  if (!metadata.name || !metadata.slug || !metadata.topic) {
    return c.json<ApiError>({ error: 'name, slug, and topic are required' }, 400);
  }

  // 验证 slug 格式
  const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!slugPattern.test(metadata.slug)) {
    return c.json<ApiError>({ error: 'slug must be URL-friendly (lowercase letters, numbers, and hyphens only)' }, 400);
  }

  // 验证 visibility（如果提供）
  if (metadata.visibility) {
    const validVisibilities = ['PUBLIC', 'PRIVATE', 'UNLISTED'];
    if (!validVisibilities.includes(metadata.visibility)) {
      return c.json<ApiError>({ error: `Invalid visibility. Must be one of: ${validVisibilities.join(', ')}` }, 400);
    }
  }

  // 创建 project
  const result = await projectService.createProject({
    ownerId: user.id,
    metadata,
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
projectsRoute.get('/:projectId', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const projectId = c.req.param('projectId');
  const user = c.get('user');

  // 获取 project 详情
  const result = await projectService.getProjectDetails(projectId);
  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Project not found' }, 404);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  const projectDetail = result.data;

  // 权限检查
  // PUBLIC: 所有人可访问
  // UNLISTED: 仅注册用户可访问
  // PRIVATE: 仅 owner 和 maintainer 可访问
  if (projectDetail.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted project' }, 401);
  }
  if (projectDetail.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private project' }, 401);
    }
    // 检查是否是owner或maintainer
    const isOwner = user.id === projectDetail.owner.id;
    const isMaintainer = projectDetail.maintainers.some(m => m.id === user.id);
    if (!isOwner && !isMaintainer) {
      return c.json<ApiError>({ error: 'You do not have permission to access this project' }, 403);
    }
  }

  return c.json<ProjectDetail>(projectDetail);
});

// 获取 project page 详情
projectsRoute.get('/:projectId/pages/:pageId', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const projectId = c.req.param('projectId');
  const pageId = c.req.param('pageId');
  const user = c.get('user');

  // 获取 project 信息进行权限检查
  const projectResult = await projectService.getProjectById(projectId);
  if (!projectResult.success) {
    if (projectResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Project not found' }, 404);
    }
    return c.json<ApiError>({ error: projectResult.error.message }, 500);
  }

  const { project } = projectResult.data;

  // 权限检查
  // PUBLIC: 所有人可访问
  // UNLISTED: 仅注册用户可访问
  // PRIVATE: 仅 owner 和 maintainer 可访问
  if (project.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted project' }, 401);
  }
  if (project.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private project' }, 401);
    }
    // 检查是否是owner或maintainer
    const isOwner = user.id === project.ownerId;
    const isMaintainer = await projectService.isMaintainer(projectId, user.id);
    if (!isOwner && !isMaintainer) {
      return c.json<ApiError>({ error: 'You do not have permission to access this project' }, 403);
    }
  }

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

  // 解析查询参数
  const query = c.req.query();

  const params: ListProjectArtifactsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    sortOrder: query.sortOrder as 'asc' | 'desc' | undefined,
  };

  // 处理 roleId 参数
  if (query.roleId !== undefined) {
    if (query.roleId === 'null') {
      params.roleId = null; // 表示无角色的 artifacts
    } else {
      params.roleId = query.roleId;
    }
  }

  // 处理 isOfficial 参数
  if (query.isOfficial !== undefined) {
    params.isOfficial = query.isOfficial === 'true';
  }

  // 验证排序参数
  const validSortOrder = ['asc', 'desc'];
  if (params.sortOrder && !validSortOrder.includes(params.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder value. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

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
projectsRoute.get('/:projectId/posts', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');
  const user = c.get('user');

  // 获取 project 信息进行权限检查
  const projectResult = await postService.getProject(projectId);
  if (!projectResult.success) {
    if (projectResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Project not found' }, 404);
    }
    return c.json<ApiError>({ error: projectResult.error.message }, 500);
  }

  const project = projectResult.data;

  // 权限检查
  if (project.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted project' }, 401);
  }
  if (project.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private project' }, 401);
    }
    const isOwner = user.id === project.ownerId;
    const isMaintainer = await projectService.isMaintainer(projectId, user.id);
    if (!isOwner && !isMaintainer) {
      return c.json<ApiError>({ error: 'You do not have permission to access this project' }, 403);
    }
  }

  // 解析查询参数
  const query = c.req.query();
  const params: ListPostsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    sortBy: query.sortBy as ListPostsParams['sortBy'],
    sortOrder: query.sortOrder as ListPostsParams['sortOrder'],
  };

  // 验证排序参数
  const validSortBy = ['createdAt', 'updatedAt'];
  const validSortOrder = ['asc', 'desc'];
  
  if (params.sortBy && !validSortBy.includes(params.sortBy)) {
    return c.json<ApiError>({ error: `Invalid sortBy value. Must be one of: ${validSortBy.join(', ')}` }, 400);
  }
  if (params.sortOrder && !validSortOrder.includes(params.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder value. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  const result = await postService.listPosts(projectId, params);
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
projectsRoute.get('/:projectId/posts/:postId', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const projectService = new ProjectService(db);
  const postService = new PostService(db);
  const projectId = c.req.param('projectId');
  const postId = c.req.param('postId');
  const user = c.get('user');

  // 获取 project 信息进行权限检查
  const projectResult = await postService.getProject(projectId);
  if (!projectResult.success) {
    if (projectResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Project not found' }, 404);
    }
    return c.json<ApiError>({ error: projectResult.error.message }, 500);
  }

  const project = projectResult.data;

  // 权限检查
  if (project.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted project' }, 401);
  }
  if (project.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private project' }, 401);
    }
    const isOwner = user.id === project.ownerId;
    const isMaintainer = await projectService.isMaintainer(projectId, user.id);
    if (!isOwner && !isMaintainer) {
      return c.json<ApiError>({ error: 'You do not have permission to access this project' }, 403);
    }
  }

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
