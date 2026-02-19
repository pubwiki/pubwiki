import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ListDiscussionsResponse,
  DiscussionDetail,
  ListDiscussionRepliesResponse,
  DiscussionReplyItem,
  ApiError,
} from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  createTestUser,
  registerUser,
  discussions,
  discussionReplies,
  artifacts,
  projects,
  eq,
  type TestDb,
} from './helpers';

describe('Discussions API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  // Helper: 创建测试 artifact
  async function createTestArtifact(authorId: string, name: string = 'Test Artifact'): Promise<string> {
    const [artifact] = await db.insert(artifacts).values({
      authorId,
      name,
    }).returning();
    return artifact.id;
  }

  // Helper: 创建测试 project
  async function createTestProject(ownerId: string, name: string = 'Test Project'): Promise<string> {
    const [project] = await db.insert(projects).values({
      ownerId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      topic: 'test-topic',
    }).returning();
    return project.id;
  }

  // Helper: 直接在数据库创建讨论
  async function createTestDiscussion(
    targetType: 'ARTIFACT' | 'PROJECT',
    targetId: string,
    authorId: string,
    title?: string,
    content: string = 'Test content',
    category: 'GENERAL' | 'QUESTION' = 'GENERAL'
  ): Promise<string> {
    const discussionId = crypto.randomUUID();
    await db.insert(discussions).values({
      id: discussionId,
      targetType,
      targetId,
      authorId,
      title,
      content,
      category,
    });
    return discussionId;
  }

  // Helper: 直接在数据库创建回复
  async function createTestReply(
    discussionId: string,
    authorId: string,
    content: string = 'Test reply'
  ): Promise<string> {
    const replyId = crypto.randomUUID();
    await db.insert(discussionReplies).values({
      id: replyId,
      discussionId,
      authorId,
      content,
    });
    
    // 更新回复计数
    await db.update(discussions)
      .set({ replyCount: 1 })
      .where(eq(discussions.id, discussionId));
    
    return replyId;
  }

  describe('GET /api/discussions', () => {
    it('should return 400 when targetType is missing', async () => {
      const request = new Request('http://localhost/api/discussions?targetId=123');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('targetType');
    });

    it('should return 400 when targetId is missing', async () => {
      const request = new Request('http://localhost/api/discussions?targetType=ARTIFACT');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('targetId');
    });

    it('should return 400 for invalid targetType', async () => {
      const request = new Request('http://localhost/api/discussions?targetType=INVALID&targetId=123');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('targetType');
    });

    it('should return empty list when no discussions exist', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);

      const request = new Request(`http://localhost/api/discussions?targetType=ARTIFACT&targetId=${artifactId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionsResponse>();
      expect(data.discussions).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return discussions for an artifact', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);
      await createTestDiscussion('ARTIFACT', artifactId, userId, 'First Discussion', 'Content 1');
      await createTestDiscussion('ARTIFACT', artifactId, userId, 'Second Discussion', 'Content 2');

      const request = new Request(`http://localhost/api/discussions?targetType=ARTIFACT&targetId=${artifactId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionsResponse>();
      expect(data.discussions).toHaveLength(2);
      expect(data.pagination.total).toBe(2);
    });

    it('should return discussions for a project', async () => {
      const userId = await createTestUser(db, 'testuser');
      const projectId = await createTestProject(userId);
      await createTestDiscussion('PROJECT', projectId, userId, 'Project Discussion');

      const request = new Request(`http://localhost/api/discussions?targetType=PROJECT&targetId=${projectId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionsResponse>();
      expect(data.discussions).toHaveLength(1);
      expect(data.discussions[0].targetType).toBe('PROJECT');
    });

    it('should filter by category', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);
      await createTestDiscussion('ARTIFACT', artifactId, userId, 'General', 'Content', 'GENERAL');
      await createTestDiscussion('ARTIFACT', artifactId, userId, 'Question', 'Content', 'QUESTION');

      const request = new Request(`http://localhost/api/discussions?targetType=ARTIFACT&targetId=${artifactId}&category=QUESTION`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionsResponse>();
      expect(data.discussions).toHaveLength(1);
      expect(data.discussions[0].category).toBe('QUESTION');
    });

    it('should paginate correctly', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);
      
      for (let i = 1; i <= 5; i++) {
        await createTestDiscussion('ARTIFACT', artifactId, userId, `Discussion ${i}`);
      }

      const request = new Request(`http://localhost/api/discussions?targetType=ARTIFACT&targetId=${artifactId}&page=1&limit=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionsResponse>();
      expect(data.discussions).toHaveLength(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });
  });

  describe('POST /api/discussions', () => {
    it('should return 401 when not authenticated', async () => {
      const request = new Request('http://localhost/api/discussions?targetType=ARTIFACT&targetId=123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test' }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should create a discussion', async () => {
      const { sessionCookie } = await registerUser('testuser');

      // 创建一个新用户和 artifact 用于测试
      const testUserId = await createTestUser(db, 'creator');
      const artifactId = await createTestArtifact(testUserId);

      const request = new Request(`http://localhost/api/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'New Discussion',
          content: 'Discussion content',
          category: 'QUESTION',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<{ message: string; discussion: DiscussionDetail }>();
      expect(data.message).toBe('Discussion created successfully');
      expect(data.discussion.title).toBe('New Discussion');
      expect(data.discussion.content).toBe('Discussion content');
      expect(data.discussion.category).toBe('QUESTION');
      expect(data.discussion.targetType).toBe('ARTIFACT');
    });

    it('should return 400 when content is empty', async () => {
      const { sessionCookie } = await registerUser('testuser');
      const userId = await createTestUser(db, 'creator');
      const artifactId = await createTestArtifact(userId);

      const request = new Request(`http://localhost/api/discussions?targetType=ARTIFACT&targetId=${artifactId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({ content: '' }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/discussions/:discussionId', () => {
    it('should return discussion detail', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, userId, 'Test Title', 'Test Content');

      const request = new Request(`http://localhost/api/discussions/${discussionId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<DiscussionDetail>();
      expect(data.id).toBe(discussionId);
      expect(data.title).toBe('Test Title');
      expect(data.content).toBe('Test Content');
    });

    it('should return 404 for non-existent discussion', async () => {
      const request = new Request('http://localhost/api/discussions/non-existent-id');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/discussions/:discussionId', () => {
    it('should update discussion by author', async () => {
      const { sessionCookie, userId: authorId } = await registerUser('author');

      // 用注册用户创建讨论
      const artifactId = await createTestArtifact(authorId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, authorId, 'Original');

      const request = new Request(`http://localhost/api/discussions/${discussionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Updated Title',
          content: 'Updated content',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ message: string; discussion: DiscussionDetail }>();
      expect(data.discussion.title).toBe('Updated Title');
      expect(data.discussion.content).toBe('Updated content');
    });

    it('should return 403 when updating others discussion', async () => {
      const { sessionCookie } = await registerUser('user1');
      const otherUserId = await createTestUser(db, 'otheruser');
      const artifactId = await createTestArtifact(otherUserId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, otherUserId);

      const request = new Request(`http://localhost/api/discussions/${discussionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({ content: 'Hacked!' }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/discussions/:discussionId', () => {
    it('should delete discussion by author', async () => {
      const { sessionCookie, userId: authorId } = await registerUser('author');

      const artifactId = await createTestArtifact(authorId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, authorId);

      const request = new Request(`http://localhost/api/discussions/${discussionId}`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);

      // 验证已删除
      const [deleted] = await db.select().from(discussions).where(eq(discussions.id, discussionId));
      expect(deleted).toBeUndefined();
    });
  });

  describe('GET /api/discussions/:discussionId/replies', () => {
    it('should return empty list when no replies exist', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, userId);

      const request = new Request(`http://localhost/api/discussions/${discussionId}/replies`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionRepliesResponse>();
      expect(data.replies).toHaveLength(0);
    });

    it('should return replies for a discussion', async () => {
      const userId = await createTestUser(db, 'testuser');
      const artifactId = await createTestArtifact(userId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, userId);
      await createTestReply(discussionId, userId, 'First reply');

      const request = new Request(`http://localhost/api/discussions/${discussionId}/replies`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListDiscussionRepliesResponse>();
      expect(data.replies).toHaveLength(1);
      expect(data.replies[0].content).toBe('First reply');
    });

    it('should return 404 for non-existent discussion', async () => {
      const request = new Request('http://localhost/api/discussions/non-existent-id/replies');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/discussions/:discussionId/replies', () => {
    it('should create a reply', async () => {
      const { sessionCookie } = await registerUser('replier');
      const userId = await createTestUser(db, 'owner');
      const artifactId = await createTestArtifact(userId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, userId);

      const request = new Request(`http://localhost/api/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({ content: 'This is my reply' }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<{ message: string; reply: DiscussionReplyItem }>();
      expect(data.reply.content).toBe('This is my reply');
    });

    it('should return 403 when discussion is locked', async () => {
      const { sessionCookie } = await registerUser('replier');
      const userId = await createTestUser(db, 'owner');
      const artifactId = await createTestArtifact(userId);
      const discussionId = await createTestDiscussion('ARTIFACT', artifactId, userId);

      // 锁定讨论
      await db.update(discussions).set({ isLocked: true }).where(eq(discussions.id, discussionId));

      const request = new Request(`http://localhost/api/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({ content: 'Trying to reply' }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });
  });

});
