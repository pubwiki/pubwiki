import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ArticleDetail,
  ApiError,
  UpsertArticleRequest,
} from '@pubwiki/api';
import { computeNodeCommit } from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  registerUser,
  artifacts,
  artifactVersions,
  artifactVersionNodes,
  nodeVersions,
  resourceDiscoveryControl,
  resourceAcl,
  PUBLIC_USER_ID,
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
      authorId: ownerId,
    }).returning();
    
    // Create discovery control and ACL records for the artifact
    await db.insert(resourceDiscoveryControl).values({
      resourceType: 'artifact',
      resourceId: artifact.id,
      isListed: true,
    });
    
    // Grant public read access
    await db.insert(resourceAcl).values({
      resourceType: 'artifact',
      resourceId: artifact.id,
      userId: PUBLIC_USER_ID,
      canRead: true,
      canWrite: false,
      canManage: false,
    });
    
    // Grant owner full access
    await db.insert(resourceAcl).values({
      resourceType: 'artifact',
      resourceId: artifact.id,
      userId: ownerId,
      canRead: true,
      canWrite: true,
      canManage: true,
    });
    
    return artifact.id;
  }

  // Helper: 创建测试 sandbox node（使用新 node_versions 架构，并创建 artifact_version_nodes 关联）
  async function createTestSandboxNode(artifactId: string, name: string = 'Test Node'): Promise<string> {
    const nodeId = crypto.randomUUID();
    const contentHash = crypto.randomUUID().substring(0, 16);
    const commit = await computeNodeCommit(nodeId, null, contentHash, 'SANDBOX');
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
    
    // 创建 node version
    await db.insert(nodeVersions).values({
      nodeId,
      commit,
      authorId: artifact.authorId,
      type: 'SANDBOX',
      name,
      contentHash,
      sourceArtifactId: artifactId,
    });

    // 创建 artifact version
    const [version] = await db.insert(artifactVersions).values({
      artifactId,
      version: '1.0.0',
      commitHash: crypto.randomUUID().substring(0, 8),
    }).returning();

    // 关联 node 到 artifact version
    await db.insert(artifactVersionNodes).values({
      commitHash: version.commitHash,
      nodeId,
      nodeCommit: commit,
    });

    // 设置 artifact 的 currentVersionId
    await db.update(artifacts).set({ currentVersionId: version.id }).where(eq(artifacts.id, artifactId));

    return nodeId;
  }

  // Helper: 创建测试 article 并添加访问控制记录
  async function createTestArticle(
    authorId: string,
    artifactId: string,
    title: string = 'Test Article',
    options: { isListed?: boolean } = {}
  ): Promise<string> {
    const { isListed = true } = options;
    const articleId = crypto.randomUUID();
    
    await db.insert(articles).values({
      id: articleId,
      authorId,
      artifactId,
      artifactCommit: crypto.randomUUID().substring(0, 8),
      title,
      content: createTestContent(),
    });
    
    await db.insert(resourceDiscoveryControl).values({
      resourceType: 'article',
      resourceId: articleId,
      isListed,
    });

    // Grant public read access
    await db.insert(resourceAcl).values({
      resourceType: 'article',
      resourceId: articleId,
      userId: PUBLIC_USER_ID,
      canRead: true,
      canWrite: false,
      canManage: false,
    });

    // Grant author full access
    await db.insert(resourceAcl).values({
      resourceType: 'article',
      resourceId: articleId,
      userId: authorId,
      canRead: true,
      canWrite: true,
      canManage: true,
    });
    
    return articleId;
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
        saveCommit: crypto.randomUUID().substring(0, 8),
      },
    ];
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
      await createTestSandboxNode(artifactId);

      // 直接创建文章
      const articleId = crypto.randomUUID();
      const artifactCommit = crypto.randomUUID().substring(0, 8);
      await db.insert(articles).values({
        id: articleId,
        authorId: userId,
        artifactId,
        artifactCommit,
        title: 'Test Article',
        content: createTestContent(),
      });

      const request = new Request(`http://localhost/api/articles/${articleId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ArticleDetail>();
      expect(data.id).toBe(articleId);
      expect(data.title).toBe('Test Article');
      expect(data.artifactId).toBe(artifactId);
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
          artifactId: 'test',
          artifactCommit: 'test',
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
          artifactId: 'test',
          artifactCommit: 'test',
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
          artifactId: 'test',
          artifactCommit: 'test',
          content: [],
        }),
      });
      const response1 = await sendRequest(request1);
      expect(response1.status).toBe(400);

      // Missing artifactId
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
          artifactId: 'test',
          artifactCommit: 'test',
        }),
      });
      const response3 = await sendRequest(request3);
      expect(response3.status).toBe(400);
    });

    it('should return 400 for invalid title length', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();
      const artifactCommit = crypto.randomUUID().substring(0, 8);

      // Empty title
      const request1 = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: '',
          artifactId,
          artifactCommit,
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
          artifactId,
          artifactCommit,
          content: [],
        }),
      });
      const response2 = await sendRequest(request2);
      expect(response2.status).toBe(400);
    });

    it('should return 400 for invalid isPrivate/isListed value', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();
      const artifactCommit = crypto.randomUUID().substring(0, 8);

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Article',
          artifactId,
          artifactCommit,
          content: createTestContent(),
          isPrivate: 'INVALID',
          isListed: true,
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('isPrivate');
    });
  });

  describe('GET /api/articles/by-artifact/:artifactId', () => {
    it('should return 400 for invalid artifact ID format', async () => {
      const request = new Request('http://localhost/api/articles/by-artifact/invalid-id');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid artifact ID format');
    });

    it('should return empty list for non-existent artifact', async () => {
      const request = new Request('http://localhost/api/articles/by-artifact/00000000-0000-0000-0000-000000000000');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toEqual([]);
      expect(data.pagination.total).toBe(0);
    });

    it('should return empty list for artifact with no articles', async () => {
      const { userId } = await registerUser('owner');
      const artifactId = await createTestArtifact(userId);

      const request = new Request(`http://localhost/api/articles/by-artifact/${artifactId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toEqual([]);
      expect(data.pagination.total).toBe(0);
      expect(data.pagination.page).toBe(1);
    });

    it('should return articles for an artifact', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);

      // Create articles with access control
      await createTestArticle(userId, artifactId, 'Article 1');
      await createTestArticle(userId, artifactId, 'Article 2');

      const request = new Request(`http://localhost/api/articles/by-artifact/${artifactId}`);
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

      // Create 3 articles with access control
      for (let i = 0; i < 3; i++) {
        await createTestArticle(userId, artifactId, `Article ${i + 1}`);
      }

      // Get first page with limit 2
      const request = new Request(`http://localhost/api/articles/by-artifact/${artifactId}?page=1&limit=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toHaveLength(2);
      expect(data.pagination.total).toBe(3);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.totalPages).toBe(2);

      // Get second page
      const request2 = new Request(`http://localhost/api/articles/by-artifact/${artifactId}?page=2&limit=2`);
      const response2 = await sendRequest(request2);

      expect(response2.status).toBe(200);
      const data2 = await response2.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data2.articles).toHaveLength(1);
      expect(data2.pagination.page).toBe(2);
    });

    // Note: Access control tests should be in a separate file that sets up resourceAcl records
    it('should return all articles for artifact', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);

      // Create articles with access control
      await createTestArticle(userId, artifactId, 'Article 1');
      await createTestArticle(userId, artifactId, 'Article 2');

      const request = new Request(`http://localhost/api/articles/by-artifact/${artifactId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ articles: ArticleDetail[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>();
      expect(data.articles).toHaveLength(2);
    });
  });
});
