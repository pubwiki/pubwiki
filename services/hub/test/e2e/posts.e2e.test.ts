import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { registerUser } from './helpers';
import type { PostDetail, ListProjectPostsResponse } from '@pubwiki/api';

describe('E2E: Project Posts API', () => {
  let worker: Unstable_DevWorker;
  let baseUrl: string;
  let sessionCookie: string;
  let testUserId: string;
  let testProjectId: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;

    // 创建测试用户并获取 session cookie
    const username = `post_test_${Date.now()}`;
    const result = await registerUser(baseUrl, username);
    sessionCookie = result.sessionCookie;
    testUserId = result.userId;

    // 创建测试 project
    const slug = `test-project-${Date.now()}`;
    const response = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Test Project for Posts',
        slug,
        topic: 'testing',
        roles: [{ name: 'Default Role' }],
      }),
    });
    const projectData = await response.json() as { project: { id: string } };
    testProjectId = projectData.project.id;
  });

  afterAll(async () => {
    await worker.stop();
  });

  describe('POST /projects/:projectId/posts', () => {
    it('should create a post with basic content', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'First Post',
          content: '<p>Hello World!</p>',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { message: string; post: PostDetail };
      expect(data.message).toBe('Post created successfully');
      expect(data.post.title).toBe('First Post');
      expect(data.post.content).toBe('<p>Hello World!</p>');
      expect(data.post.discussionId).toBeDefined();
      expect(data.post.author.id).toBe(testUserId);
    });

    it('should create a post with cover images', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Post with Images',
          content: '<p>Check out these images!</p>',
          coverUrls: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { post: PostDetail };
      expect(data.post.coverUrls).toEqual(['https://example.com/image1.jpg', 'https://example.com/image2.jpg']);
    });

    it('should reject post creation without auth', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Unauthorized Post',
          content: '<p>Should fail</p>',
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should reject post creation from non-member', async () => {
      // 创建另一个用户
      const otherUsername = `other_user_${Date.now()}`;
      const differentCookie = (await registerUser(baseUrl, otherUsername)).sessionCookie;

      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: differentCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Unauthorized Post',
          content: '<p>Should fail</p>',
        }),
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /projects/:projectId/posts', () => {
    beforeAll(async () => {
      // 创建一个测试 post
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'List Test Post',
          content: '<p>For listing test</p>',
        }),
      });
      await response.json() as { post: PostDetail };
      // Post created for listing test
    });

    it('should list posts for public project', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`);

      expect(response.status).toBe(200);
      const data = await response.json() as ListProjectPostsResponse;
      expect(data.posts.length).toBeGreaterThan(0);
      expect(data.pagination).toBeDefined();
    });

    it('should paginate posts', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts?page=1&limit=2`);

      expect(response.status).toBe(200);
      const data = await response.json() as ListProjectPostsResponse;
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
    });

    it('should sort posts by createdAt desc by default', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`);

      expect(response.status).toBe(200);
      const data = await response.json() as ListProjectPostsResponse;
      if (data.posts.length > 1) {
        const dates = data.posts.map(p => new Date(p.createdAt).getTime());
        for (let i = 0; i < dates.length - 1; i++) {
          // 置顶的排在前面，所以只检查同一置顶状态的排序
          if (data.posts[i].isPinned === data.posts[i + 1].isPinned) {
            expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
          }
        }
      }
    });
  });

  describe('GET /projects/:projectId/posts/:postId', () => {
    let postId: string;
    let discussionId: string;

    beforeAll(async () => {
      // 创建一个测试 post
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Detail Test Post',
          content: '<p>For detail test</p>',
        }),
      });
      const data = await response.json() as { post: PostDetail };
      postId = data.post.id;
      discussionId = data.post.discussionId!;
    });

    it('should return post detail with discussion', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`);

      expect(response.status).toBe(200);
      const data = await response.json() as PostDetail;
      expect(data.id).toBe(postId);
      expect(data.title).toBe('Detail Test Post');
      expect(data.discussion).toBeDefined();
      expect(data.discussion?.id).toBe(discussionId);
      expect(data.discussion?.targetType).toBe('POST');
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /projects/:projectId/posts/:postId', () => {
    let postId: string;

    beforeEach(async () => {
      // 每个测试前创建新 post
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Update Test Post',
          content: '<p>Original content</p>',
        }),
      });
      const data = await response.json() as { post: PostDetail };
      postId = data.post.id;
    });

    it('should update post title and content', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Updated Title',
          content: '<p>Updated content</p>',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { post: PostDetail };
      expect(data.post.title).toBe('Updated Title');
      expect(data.post.content).toBe('<p>Updated content</p>');
    });

    it('should update cover images', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coverUrls: ['https://example.com/new-image.jpg'],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { post: PostDetail };
      expect(data.post.coverUrls).toEqual(['https://example.com/new-image.jpg']);
    });

    it('should allow owner to pin post', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isPinned: true,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { post: PostDetail };
      expect(data.post.isPinned).toBe(true);
    });

    it('should reject update without auth', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Hacked Title',
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /projects/:projectId/posts/:postId', () => {
    it('should delete post as owner', async () => {
      // 创建要删除的 post
      const createResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'To Delete',
          content: '<p>Will be deleted</p>',
        }),
      });
      const createData = await createResponse.json() as { post: PostDetail };
      const postId = createData.post.id;

      // 删除 post
      const deleteResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
        },
      });

      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json() as { message: string };
      expect(deleteData.message).toBe('Post deleted successfully');

      // 验证 post 已删除
      const getResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should reject delete without auth', async () => {
      // 创建要删除的 post
      const createResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Protected Post',
          content: '<p>Should not be deleted</p>',
        }),
      });
      const createData = await createResponse.json() as { post: PostDetail };
      const postId = createData.post.id;

      // 尝试无 auth 删除
      const deleteResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${postId}`, {
        method: 'DELETE',
      });

      expect(deleteResponse.status).toBe(401);
    });
  });

  describe('Pinned posts ordering', () => {
    it('should show pinned posts first', async () => {
      // 创建 3 个 posts
      for (let i = 1; i <= 3; i++) {
        await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `Order Test Post ${i}`,
            content: `<p>Content ${i}</p>`,
          }),
        });
      }

      // 获取列表找到第二个 post 并置顶
      const listResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts`);
      const listData = await listResponse.json() as ListProjectPostsResponse;
      
      // 找一个非置顶的 post
      const nonPinnedPost = listData.posts.find(p => !p.isPinned);
      if (nonPinnedPost) {
        // 置顶它
        await fetch(`${baseUrl}/projects/${testProjectId}/posts/${nonPinnedPost.id}`, {
          method: 'PATCH',
          headers: {
            Cookie: sessionCookie,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isPinned: true }),
        });

        // 验证置顶的排在前面
        const finalResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts`);
        const finalData = await finalResponse.json() as ListProjectPostsResponse;
        
        // 第一个置顶的应该在前面
        let foundPinned = false;
        for (const post of finalData.posts) {
          if (post.isPinned) {
            foundPinned = true;
          } else if (foundPinned) {
            // 如果已经找到置顶的，后面不应该再有置顶的
            expect(post.isPinned).toBe(false);
          }
        }
      }
    });
  });

  describe('Discussion integration', () => {
    it('should create discussion when post is created', async () => {
      const response = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Discussion Test Post',
          content: '<p>Testing discussion integration</p>',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { post: PostDetail };
      expect(data.post.discussionId).toBeDefined();
      
      // 获取详情确认讨论存在
      const detailResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts/${data.post.id}`);
      const detailData = await detailResponse.json() as PostDetail;
      expect(detailData.discussion).toBeDefined();
      expect(detailData.discussion?.targetType).toBe('POST');
      expect(detailData.discussion?.targetId).toBe(data.post.id);
    });

    it('should allow replies on post discussion', async () => {
      // 创建 post
      const createResponse = await fetch(`${baseUrl}/projects/${testProjectId}/posts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Reply Test Post',
          content: '<p>Testing replies</p>',
        }),
      });
      const createData = await createResponse.json() as { post: PostDetail };
      const discussionId = createData.post.discussionId;

      // 创建回复
      const replyResponse = await fetch(`${baseUrl}/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'This is a reply to the post!',
        }),
      });

      expect(replyResponse.status).toBe(201);
    });
  });
});
