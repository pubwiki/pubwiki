import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { registerUser } from './helpers';

describe('E2E: Discussions API', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;
  let sessionCookie: string;
  let testUserId: string;
  let secondUserCookie: string;
  let secondUserId: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    client = createApiClient(baseUrl);

    // 创建测试用户并获取 session cookie
    const username = `discussion_test_${Date.now()}`;
    const result = await registerUser(baseUrl, username);
    sessionCookie = result.sessionCookie;
    testUserId = result.userId;

    // 创建第二个用户
    const username2 = `discussion_test2_${Date.now()}`;
    const result2 = await registerUser(baseUrl, username2);
    secondUserCookie = result2.sessionCookie;
    secondUserId = result2.userId;
  });

  afterAll(async () => {
    await worker.stop();
  });

  // Helper to create a test artifact
  async function createTestArtifact(): Promise<string> {
    const slug = `test-artifact-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const formData = new FormData();
    formData.append('metadata', JSON.stringify({
      artifactId: crypto.randomUUID(),
      type: 'RECIPE',
      name: 'Test Artifact',
      slug,
      version: '1.0.0',
    }));
    formData.append('descriptor', JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
    }));
    
    const response = await fetch(`${baseUrl}/artifacts`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: formData,
    });
    const data = await response.json() as { artifact: { id: string } };
    return data.artifact.id;
  }

  // Helper to create a test project
  async function createTestProject(): Promise<string> {
    const slug = `test-project-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    const response = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Test Project',
        slug,
        topic: 'testing',
        isListed: true,
        roles: [
          { name: 'Default Role' },
        ],
        pages: [
          { name: 'Home', icon: '🏠', content: '<p>Welcome</p>' }
        ],
        homepageIndex: 0,
      }),
    });
    const data = await response.json() as { project: { id: string } };
    return data.project.id;
  }

  describe('POST /discussions', () => {
    it('should create a discussion on an artifact', async () => {
      const artifactId = await createTestArtifact();

      const response = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Discussion on Artifact',
          content: 'This is a test discussion content',
          category: 'QUESTION',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { discussion: { title: string; content: string; category: string; targetType: string; targetId: string; author: { id: string } } };
      expect(data.discussion.title).toBe('Test Discussion on Artifact');
      expect(data.discussion.content).toBe('This is a test discussion content');
      expect(data.discussion.category).toBe('QUESTION');
      expect(data.discussion.targetType).toBe('ARTIFACT');
      expect(data.discussion.targetId).toBe(artifactId);
      expect(data.discussion.author.id).toBe(testUserId);
    });

    it('should create a discussion on a project', async () => {
      const projectId = await createTestProject();

      const response = await fetch(`${baseUrl}/discussions?targetType=PROJECT&targetId=${projectId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Discussion on Project',
          content: 'This is a test discussion on project',
          category: 'FEEDBACK',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { discussion: { title: string; targetType: string; targetId: string } };
      expect(data.discussion.title).toBe('Test Discussion on Project');
      expect(data.discussion.targetType).toBe('PROJECT');
      expect(data.discussion.targetId).toBe(projectId);
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=some-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test',
          content: 'Test',
          category: 'QUESTION',
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /discussions', () => {
    it('should list discussions for a target', async () => {
      const artifactId = await createTestArtifact();

      // Create multiple discussions
      await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Discussion 1',
          content: 'Content 1',
          category: 'QUESTION',
        }),
      });

      await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Discussion 2',
          content: 'Content 2',
          category: 'BUG_REPORT',
        }),
      });

      const response = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`);
      expect(response.status).toBe(200);
      
      const data = await response.json() as { discussions: { title: string }[]; pagination: { total: number } };
      expect(data.discussions.length).toBeGreaterThanOrEqual(2);
      expect(data.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter discussions by category', async () => {
      const artifactId = await createTestArtifact();

      // Create discussions with different categories
      await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Question Discussion',
          content: 'Question content',
          category: 'QUESTION',
        }),
      });

      await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Bug Discussion',
          content: 'Bug content',
          category: 'BUG_REPORT',
        }),
      });

      const response = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}&category=QUESTION`);
      expect(response.status).toBe(200);
      
      const data = await response.json() as { discussions: { category: string }[] };
      // All items should have category QUESTION
      data.discussions.forEach((item) => {
        expect(item.category).toBe('QUESTION');
      });
    });
  });

  describe('GET /discussions/:id', () => {
    it('should get a discussion by id', async () => {
      const artifactId = await createTestArtifact();

      // Create a discussion
      const createResponse = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Discussion to Get',
          content: 'Content to get',
          category: 'QUESTION',
        }),
      });
      const createData = await createResponse.json() as { discussion: { id: string } };
      const discussionId = createData.discussion.id;

      const response = await fetch(`${baseUrl}/discussions/${discussionId}`);
      expect(response.status).toBe(200);
      
      const data = await response.json() as { id: string; title: string };
      expect(data.id).toBe(discussionId);
      expect(data.title).toBe('Discussion to Get');
    });

    it('should return 404 for non-existent discussion', async () => {
      const response = await fetch(`${baseUrl}/discussions/non-existent-id`);
      expect(response.status).toBe(404);
    });
  });

  describe('POST /discussions/:id/replies', () => {
    it('should create a reply to a discussion', async () => {
      const artifactId = await createTestArtifact();

      // Create a discussion
      const createResponse = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Discussion for Reply',
          content: 'Content for reply',
          category: 'QUESTION',
        }),
      });
      const createData = await createResponse.json() as { discussion: { id: string } };
      const discussionId = createData.discussion.id;

      // Create a reply
      const replyResponse = await fetch(`${baseUrl}/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: {
          Cookie: secondUserCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'This is a reply',
        }),
      });

      expect(replyResponse.status).toBe(201);
      const replyData = await replyResponse.json() as { reply: { content: string; author: { id: string } } };
      expect(replyData.reply.content).toBe('This is a reply');
      expect(replyData.reply.author.id).toBe(secondUserId);
    });

    it('should return 401 for unauthenticated reply', async () => {
      const response = await fetch(`${baseUrl}/discussions/some-id/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Unauthorized reply',
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /discussions/:id/replies', () => {
    it('should list replies for a discussion', async () => {
      const artifactId = await createTestArtifact();

      // Create a discussion
      const createResponse = await fetch(`${baseUrl}/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Discussion for Replies List',
          content: 'Content',
          category: 'QUESTION',
        }),
      });
      const createData = await createResponse.json() as { discussion: { id: string } };
      const discussionId = createData.discussion.id;

      // Create multiple replies
      await fetch(`${baseUrl}/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Reply 1' }),
      });

      await fetch(`${baseUrl}/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: {
          Cookie: secondUserCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Reply 2' }),
      });

      const response = await fetch(`${baseUrl}/discussions/${discussionId}/replies`);
      expect(response.status).toBe(200);
      
      const data = await response.json() as { replies: { content: string }[]; pagination: { total: number } };
      expect(data.replies.length).toBeGreaterThanOrEqual(2);
      expect(data.pagination.total).toBeGreaterThanOrEqual(2);
    });
  });

});
