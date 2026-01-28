import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ArticleDetail,
  ApiError,
  UpsertArticleRequest,
} from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  registerUser,
  artifacts,
  artifactNodes,
  eq,
  type TestDb,
} from './helpers';
import { articles } from '@pubwiki/db';

describe('Articles API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  // Helper: 创建测试 artifact
  async function createTestArtifact(ownerId: string, name: string = 'Test Artifact'): Promise<string> {
    const [artifact] = await db.insert(artifacts).values({
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      authorId: ownerId,
      type: 'GAME',
      visibility: 'PUBLIC',
    }).returning();
    return artifact.id;
  }

  // Helper: 创建测试 sandbox node
  async function createTestSandboxNode(artifactId: string, name: string = 'Test Node'): Promise<string> {
    const [node] = await db.insert(artifactNodes).values({
      artifactId,
      type: 'SANDBOX',
      name,
    }).returning();
    return node.id;
  }

  // Helper: 创建测试非 sandbox node
  async function createTestNonSandboxNode(artifactId: string, name: string = 'Test Non-Sandbox Node'): Promise<string> {
    const [node] = await db.insert(artifactNodes).values({
      artifactId,
      type: 'GENERATED',
      name,
    }).returning();
    return node.id;
  }

  // Helper: 创建有效的 article content
  function createTestContent(): UpsertArticleRequest['content'] {
    return [
      {
        type: 'text',
        id: 'text-1',
        text: 'This is a test paragraph',
      },
      {
        type: 'game_ref',
        textId: 'text-1',
        checkpointId: 'checkpoint-1',
      },
    ];
  }

  // Helper: 创建测试用 saveId
  function createTestSaveId(): string {
    return crypto.randomUUID();
  }

  describe('GET /api/articles/:articleId', () => {
    it('should return 400 for invalid article ID format', async () => {
      const request = new Request('http://localhost/api/articles/invalid-id');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid article ID format');
    });

    it('should return 404 for non-existent article', async () => {
      const request = new Request('http://localhost/api/articles/00000000-0000-0000-0000-000000000000');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Article not found');
    });

    it('should return article details for existing article', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);

      // 直接创建文章
      const articleId = crypto.randomUUID();
      const saveId = createTestSaveId();
      await db.insert(articles).values({
        id: articleId,
        authorId: userId,
        sandboxNodeId,
        saveId,
        title: 'Test Article',
        content: createTestContent(),
        visibility: 'PUBLIC',
      });

      const request = new Request(`http://localhost/api/articles/${articleId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ArticleDetail>();
      expect(data.id).toBe(articleId);
      expect(data.title).toBe('Test Article');
      expect(data.sandboxNodeId).toBe(sandboxNodeId);
      expect(data.artifactId).toBe(artifactId);
      expect(data.visibility).toBe('PUBLIC');
      expect(data.author.id).toBe(userId);
      expect(data.content).toHaveLength(2);
    });
  });

  describe('PUT /api/articles/:articleId', () => {
    it('should require authentication', async () => {
      const articleId = crypto.randomUUID();
      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          sandboxNodeId: 'test',
          content: [],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid article ID format', async () => {
      const { sessionCookie } = await registerUser('author');

      const request = new Request('http://localhost/api/articles/invalid-id', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test',
          sandboxNodeId: 'test',
          content: [],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid article ID format');
    });

    it('should return 400 for missing required fields', async () => {
      const { sessionCookie } = await registerUser('author');
      const articleId = crypto.randomUUID();

      // Missing title
      const request1 = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          sandboxNodeId: 'test',
          content: [],
        }),
      });
      const response1 = await sendRequest(request1);
      expect(response1.status).toBe(400);

      // Missing sandboxNodeId
      const request2 = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test',
          content: [],
        }),
      });
      const response2 = await sendRequest(request2);
      expect(response2.status).toBe(400);

      // Missing content
      const request3 = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test',
          sandboxNodeId: 'test',
        }),
      });
      const response3 = await sendRequest(request3);
      expect(response3.status).toBe(400);
    });

    it('should return 400 for invalid title length', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();

      // Empty title
      const request1 = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: '',
          sandboxNodeId,
          content: [],
        }),
      });
      const response1 = await sendRequest(request1);
      expect(response1.status).toBe(400);

      // Title too long (> 200 chars)
      const request2 = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'a'.repeat(201),
          sandboxNodeId,
          content: [],
        }),
      });
      const response2 = await sendRequest(request2);
      expect(response2.status).toBe(400);
    });

    it('should return 400 for invalid visibility value', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Article',
          sandboxNodeId,
          saveId: createTestSaveId(),
          content: createTestContent(),
          visibility: 'INVALID',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid visibility value');
    });
  });

  describe('GET /api/articles/by-sandbox/:sandboxNodeId', () => {
    it('should return 400 for invalid sandbox node ID format', async () => {
      const request = new Request('http://localhost/api/articles/by-sandbox/invalid-id');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid sandbox node ID format');
    });

    it('should return 404 for non-existent sandbox node', async () => {
      const request = new Request('http://localhost/api/articles/by-sandbox/00000000-0000-0000-0000-000000000000');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Sandbox node not found');
    });

    it('should return 400 for non-sandbox node type', async () => {
      const { userId } = await registerUser('owner');
      const artifactId = await createTestArtifact(userId);
      const nonSandboxNodeId = await createTestNonSandboxNode(artifactId);

      const request = new Request(`http://localhost/api/articles/by-sandbox/${nonSandboxNodeId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Node is not a sandbox node');
    });

    it('should return empty list for sandbox with no articles', async () => {
      const { userId } = await registerUser('owner');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);

      const request = new Request(`http://localhost/api/articles/by-sandbox/${sandboxNodeId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toEqual([]);
      expect(data.pagination.total).toBe(0);
      expect(data.pagination.page).toBe(1);
    });

    it('should return articles for a sandbox node', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);

      // Create articles directly in database (bypassing GAMESAVE validation)
      const articleId1 = crypto.randomUUID();
      await db.insert(articles).values({
        id: articleId1,
        authorId: userId,
        sandboxNodeId,
        saveId: createTestSaveId(),
        title: 'Article 1',
        content: createTestContent(),
        visibility: 'PUBLIC',
      });

      const articleId2 = crypto.randomUUID();
      await db.insert(articles).values({
        id: articleId2,
        authorId: userId,
        sandboxNodeId,
        saveId: createTestSaveId(),
        title: 'Article 2',
        content: createTestContent(),
        visibility: 'PUBLIC',
      });

      const request = new Request(`http://localhost/api/articles/by-sandbox/${sandboxNodeId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toHaveLength(2);
      expect(data.pagination.total).toBe(2);
      expect(data.pagination.page).toBe(1);
    });

    it('should support pagination', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);

      // Create 3 articles directly in database
      for (let i = 0; i < 3; i++) {
        const articleId = crypto.randomUUID();
        await db.insert(articles).values({
          id: articleId,
          authorId: userId,
          sandboxNodeId,
          saveId: createTestSaveId(),
          title: `Article ${i + 1}`,
          content: createTestContent(),
          visibility: 'PUBLIC',
        });
      }

      // Get first page with limit 2
      const request = new Request(`http://localhost/api/articles/by-sandbox/${sandboxNodeId}?page=1&limit=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toHaveLength(2);
      expect(data.pagination.total).toBe(3);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.totalPages).toBe(2);

      // Get second page
      const request2 = new Request(`http://localhost/api/articles/by-sandbox/${sandboxNodeId}?page=2&limit=2`);
      const response2 = await sendRequest(request2);

      expect(response2.status).toBe(200);
      const data2 = await response2.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data2.articles).toHaveLength(1);
      expect(data2.pagination.page).toBe(2);
    });

    it('should only return public articles', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      const sandboxNodeId = await createTestSandboxNode(artifactId);

      // Create public article directly in database
      const publicArticleId = crypto.randomUUID();
      await db.insert(articles).values({
        id: publicArticleId,
        authorId: userId,
        sandboxNodeId,
        saveId: createTestSaveId(),
        title: 'Public Article',
        content: createTestContent(),
        visibility: 'PUBLIC',
      });

      // Create private article directly in database
      const privateArticleId = crypto.randomUUID();
      await db.insert(articles).values({
        id: privateArticleId,
        authorId: userId,
        sandboxNodeId,
        saveId: createTestSaveId(),
        title: 'Private Article',
        content: createTestContent(),
        visibility: 'PRIVATE',
      });

      const request = new Request(`http://localhost/api/articles/by-sandbox/${sandboxNodeId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toHaveLength(1);
      expect(data.articles[0].title).toBe('Public Article');
    });
  });
});
