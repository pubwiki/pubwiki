import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ListProjectPostsResponse,
  PostDetail,
  CreateProjectPostResponse,
  UpdateProjectPostResponse,
  DeleteProjectPostResponse,
} from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  registerUser,
  projects,
  resourceAcl,
  projectPosts,
  discussions,
  resourceDiscoveryControl,
  PUBLIC_USER_ID,
  eq,
  type TestDb,
} from './helpers';

describe('Project Posts API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  // Helper: 创建测试 project
  async function createTestProject(
    ownerId: string,
    name: string,
    options: { isPrivate?: boolean; isListed?: boolean } = {}
  ): Promise<string> {
    const { isPrivate = false, isListed = true } = options;
    const [project] = await db.insert(projects).values({
      ownerId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      topic: `Topic for ${name}`,
    }).returning();
    
    // Create discovery control record
    await db.insert(resourceDiscoveryControl).values({
      resourceType: 'project',
      resourceId: project.id,
      isListed,
    });
    
    // Create owner ACL (always has full permissions)
    await db.insert(resourceAcl).values({
      resourceType: 'project',
      resourceId: project.id,
      userId: ownerId,
      canRead: true,
      canWrite: true,
      canManage: true,
      grantedBy: ownerId,
    });
    
    // If not private, create public read ACL
    if (!isPrivate) {
      await db.insert(resourceAcl).values({
        resourceType: 'project',
        resourceId: project.id,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
        grantedBy: ownerId,
      });
    }
    
    return project.id;
  }

  // Helper: 添加协作者（通过 ACL 管理权限，可以删除其他人的 post）
  async function addCollaborator(projectId: string, userId: string): Promise<void> {
    await db.insert(resourceAcl).values({
      resourceType: 'project',
      resourceId: projectId,
      userId,
      canRead: true,
      canWrite: true,
      canManage: true,
      grantedBy: userId,
    });
  }

  describe('GET /api/projects/:projectId/posts', () => {
    it('should return empty list when no posts exist', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectPostsResponse>();
      expect(data.posts).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return posts for public project', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createRequest = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'First Post',
          content: '<p>Hello World</p>',
        }),
      });
      await sendRequest(createRequest);

      // 获取 posts 列表
      const request = new Request(`http://localhost/api/projects/${projectId}/posts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectPostsResponse>();
      expect(data.posts).toHaveLength(1);
      expect(data.posts[0].title).toBe('First Post');
      expect(data.posts[0].content).toBe('<p>Hello World</p>');
    });

    it('should return 403 for private project posts without auth', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Private Project', { isPrivate: true, isListed: false });

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`);
      const response = await sendRequest(request);

      // Private resources return 403, not 401
      expect(response.status).toBe(403);
    });

    it('should return posts for unlisted project (unlisted but not private)', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Unlisted Project', { isPrivate: false, isListed: false });

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`);
      const response = await sendRequest(request);

      // Unlisted but not private projects are publicly accessible
      expect(response.status).toBe(200);
    });

    it('should return 404 for non-existent project', async () => {
      const request = new Request('http://localhost/api/projects/00000000-0000-0000-0000-000000000000/posts');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
    });

    it('should paginate posts correctly', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 3 个 posts
      for (let i = 1; i <= 3; i++) {
        await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify({
            title: `Post ${i}`,
            content: `<p>Content ${i}</p>`,
          }),
        }));
      }

      // 获取第一页
      const request = new Request(`http://localhost/api/projects/${projectId}/posts?page=1&limit=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectPostsResponse>();
      expect(data.posts).toHaveLength(2);
      expect(data.pagination.total).toBe(3);
      expect(data.pagination.totalPages).toBe(2);
    });
  });

  describe('POST /api/projects/:projectId/posts', () => {
    it('should create a post as owner', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'New Post',
          content: '<p>Post content</p>',
          coverUrls: ['https://example.com/image.jpg'],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<CreateProjectPostResponse>();
      expect(data.message).toBe('Post created successfully');
      expect(data.post.title).toBe('New Post');
      expect(data.post.content).toBe('<p>Post content</p>');
      expect(data.post.coverUrls).toEqual(['https://example.com/image.jpg']);
      expect(data.post.discussionId).toBeDefined();
    });

    it('should create a post as collaborator with write permission', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const { sessionCookie: collaboratorCookie, userId: collaboratorId } = await registerUser('collaborator');
      const projectId = await createTestProject(ownerId, 'Test Project');
      await addCollaborator(projectId, collaboratorId);

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: collaboratorCookie,
        },
        body: JSON.stringify({
          title: 'Collaborator Post',
          content: '<p>From collaborator</p>',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
    });

    it('should reject post creation from non-member', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const { sessionCookie: otherCookie } = await registerUser('other');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: otherCookie,
        },
        body: JSON.stringify({
          title: 'Unauthorized Post',
          content: '<p>Should fail</p>',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'New Post',
          content: '<p>Content</p>',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should require title', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          content: '<p>Content without title</p>',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
    });

    it('should require content', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Title without content',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/projects/:projectId/posts/:postId', () => {
    it('should return post detail with discussion', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createRequest = new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Post',
          content: '<p>Test content</p>',
        }),
      });
      const createResponse = await sendRequest(createRequest);
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;

      // 获取 post 详情
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<PostDetail>();
      expect(data.id).toBe(postId);
      expect(data.title).toBe('Test Post');
      expect(data.discussion).toBeDefined();
      expect(data.discussion?.targetType).toBe('POST');
    });

    it('should return 404 for non-existent post', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      const request = new Request(`http://localhost/api/projects/${projectId}/posts/00000000-0000-0000-0000-000000000000`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/projects/:projectId/posts/:postId', () => {
    it('should update post as author', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Original Title',
          content: '<p>Original content</p>',
        }),
      }));
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;

      // 更新 post
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Updated Title',
          content: '<p>Updated content</p>',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UpdateProjectPostResponse>();
      expect(data.post.title).toBe('Updated Title');
      expect(data.post.content).toBe('<p>Updated content</p>');
    });

    it('should allow owner to pin post', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Post',
          content: '<p>Content</p>',
        }),
      }));
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;

      // 置顶 post
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          isPinned: true,
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UpdateProjectPostResponse>();
      expect(data.post.isPinned).toBe(true);
    });

    it('should reject update from unauthorized user', async () => {
      const { sessionCookie: ownerCookie, userId: ownerId } = await registerUser('owner');
      const { sessionCookie: otherCookie } = await registerUser('other');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          title: 'Test Post',
          content: '<p>Content</p>',
        }),
      }));
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;

      // 尝试用其他用户更新
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: otherCookie,
        },
        body: JSON.stringify({
          title: 'Hacked Title',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/projects/:projectId/posts/:postId', () => {
    it('should delete post as author', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'To Delete',
          content: '<p>Will be deleted</p>',
        }),
      }));
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;
      const discussionId = createData.post.discussionId;

      // 删除 post
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
        },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<DeleteProjectPostResponse>();
      expect(data.message).toBe('Post deleted successfully');

      // 验证 post 已删除
      const [post] = await db.select().from(projectPosts).where(eq(projectPosts.id, postId));
      expect(post).toBeUndefined();

      // 验证关联的 discussion 也已删除
      const [discussion] = await db.select().from(discussions).where(eq(discussions.id, discussionId!));
      expect(discussion).toBeUndefined();
    });

    it('should allow maintainer to delete post', async () => {
      const { sessionCookie: ownerCookie, userId: ownerId } = await registerUser('owner');
      const { sessionCookie: maintainerCookie, userId: maintainerId } = await registerUser('maintainer');
      const projectId = await createTestProject(ownerId, 'Test Project');
      await addCollaborator(projectId, maintainerId);

      // Owner 创建 post
      const createResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          title: 'Owner Post',
          content: '<p>Content</p>',
        }),
      }));
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;

      // Maintainer 删除 post
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          Cookie: maintainerCookie,
        },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should reject delete from unauthorized user', async () => {
      const { sessionCookie: ownerCookie, userId: ownerId } = await registerUser('owner');
      const { sessionCookie: otherCookie } = await registerUser('other');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 post
      const createResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          title: 'Protected Post',
          content: '<p>Cannot delete</p>',
        }),
      }));
      const createData = await createResponse.json<CreateProjectPostResponse>();
      const postId = createData.post.id;

      // 尝试用其他用户删除
      const request = new Request(`http://localhost/api/projects/${projectId}/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          Cookie: otherCookie,
        },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });
  });

  describe('Pinned posts ordering', () => {
    it('should return pinned posts first', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      const projectId = await createTestProject(ownerId, 'Test Project');

      // 创建 3 个 posts
      for (let i = 1; i <= 3; i++) {
        await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify({
            title: `Post ${i}`,
            content: `<p>Content ${i}</p>`,
          }),
        }));
      }

      // 获取所有 posts
      const listResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`));
      const listData = await listResponse.json<ListProjectPostsResponse>();
      const secondPostId = listData.posts[1].id; // 置顶第二个 post

      // 置顶第二个 post
      await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts/${secondPostId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          isPinned: true,
        }),
      }));

      // 再次获取列表，置顶的应该在最前面
      const finalResponse = await sendRequest(new Request(`http://localhost/api/projects/${projectId}/posts`));
      const finalData = await finalResponse.json<ListProjectPostsResponse>();
      
      expect(finalData.posts[0].id).toBe(secondPostId);
      expect(finalData.posts[0].isPinned).toBe(true);
    });
  });
});
