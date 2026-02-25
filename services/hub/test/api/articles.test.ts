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
  async function createTestArtifact(
    ownerId: string,
    name: string = 'Test Artifact',
    options: { isPrivate?: boolean } = {}
  ): Promise<string> {
    const { isPrivate = false } = options;
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
    
    // Grant public read access only if not private
    if (!isPrivate) {
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
      });
    }
    
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

    // 设置 artifact 的 latestVersion
    await db.update(artifacts).set({ latestVersion: version.id }).where(eq(artifacts.id, artifactId));

    return nodeId;
  }

  // Helper: 创建测试 article 并添加访问控制记录
  async function createTestArticle(
    authorId: string,
    artifactId: string,
    title: string = 'Test Article',
    options: { isListed?: boolean; isPrivate?: boolean } = {}
  ): Promise<string> {
    const { isListed = true, isPrivate = false } = options;
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

    // Grant public read access only if not private
    if (!isPrivate) {
      await db.insert(resourceAcl).values({
        resourceType: 'article',
        resourceId: articleId,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
      });
    }

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

  // Helper: 创建有效的 article content (with game_ref - requires valid saveCommit)
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

  // Helper: 创建简单的 article content (text only, no game_ref)
  function createSimpleContent(): UpsertArticleRequest['content'] {
    return [
      {
        type: 'text',
        id: 'text-1',
        text: 'This is a test paragraph',
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

      // 使用 helper 创建文章（带 ACL 记录）
      const articleId = await createTestArticle(userId, artifactId, 'Test Article');

      const request = new Request(`http://localhost/api/articles/${articleId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ArticleDetail>();
      expect(data.id).toBe(articleId);
      expect(data.title).toBe('Test Article');
      expect(data.artifactId).toBe(artifactId);
      expect(data.author.id).toBe(userId);
    });

    it('should return 404 for private article when not authenticated', async () => {
      const { userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);

      // 创建私有文章
      const articleId = await createTestArticle(userId, artifactId, 'Private Article', { isPrivate: true });

      const request = new Request(`http://localhost/api/articles/${articleId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Article not found');
    });

    it('should return private article for owner', async () => {
      const { userId, sessionCookie } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);

      // 创建私有文章
      const articleId = await createTestArticle(userId, artifactId, 'Private Article', { isPrivate: true });

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ArticleDetail>();
      expect(data.id).toBe(articleId);
      expect(data.title).toBe('Private Article');
    });

    it('should return 404 for private article accessed by another user', async () => {
      const { userId: authorId } = await registerUser('author');
      const { sessionCookie: otherUserCookie } = await registerUser('other');
      const artifactId = await createTestArtifact(authorId);

      // 创建私有文章
      const articleId = await createTestArticle(authorId, artifactId, 'Private Article', { isPrivate: true });

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        headers: { Cookie: otherUserCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Article not found');
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

    it('should return 400 for invalid isListed value', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      const artifactId = await createTestArtifact(userId);
      await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();
      
      // Get the artifact version commit
      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId)).limit(1);

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Article',
          artifactId,
          artifactCommit: version.commitHash,
          content: createTestContent(),
          isListed: 'INVALID', // should be boolean
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('isListed');
    });

    it('should return 400 when creating public article for private artifact', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      // Create a PRIVATE artifact
      const artifactId = await createTestArtifact(userId, 'Private Artifact', { isPrivate: true });
      await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();

      // Get the artifact version commit
      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId)).limit(1);

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Article',
          artifactId,
          artifactCommit: version.commitHash,
          content: createSimpleContent(),
          isPrivate: false, // Trying to create PUBLIC article
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('private artifact');
    });

    it('should allow creating private article for private artifact', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      // Create a PRIVATE artifact
      const artifactId = await createTestArtifact(userId, 'Private Artifact', { isPrivate: true });
      await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();

      // Get the artifact version commit
      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId)).limit(1);

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Article',
          artifactId,
          artifactCommit: version.commitHash,
          content: createSimpleContent(),
          isPrivate: true, // Creating PRIVATE article
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ArticleDetail>();
      expect(data.title).toBe('Test Article');
    });

    it('should allow creating public article for public artifact', async () => {
      const { sessionCookie, userId } = await registerUser('author');
      // Create a PUBLIC artifact
      const artifactId = await createTestArtifact(userId);
      await createTestSandboxNode(artifactId);
      const articleId = crypto.randomUUID();

      // Get the artifact version commit
      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId)).limit(1);

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: 'Test Article',
          artifactId,
          artifactCommit: version.commitHash,
          content: createSimpleContent(),
          isPrivate: false, // Creating PUBLIC article (default)
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ArticleDetail>();
      expect(data.title).toBe('Test Article');
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

    it('should return 404 for non-existent artifact', async () => {
      const request = new Request('http://localhost/api/articles/by-artifact/00000000-0000-0000-0000-000000000000');
      const response = await sendRequest(request);

      // Non-existent artifact has no ACL records, so canRead returns false
      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Artifact not found or no permission');
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

  describe('DELETE /api/articles/:articleId', () => {
    it('should return 400 for invalid article ID format', async () => {
      const { sessionCookie } = await registerUser('author');
      
      const request = new Request('http://localhost/api/articles/invalid-id', {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid article ID format');
    });

    it('should return 401 for unauthenticated user', async () => {
      const request = new Request(`http://localhost/api/articles/${crypto.randomUUID()}`, {
        method: 'DELETE',
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent article', async () => {
      const { sessionCookie } = await registerUser('author');
      
      const request = new Request(`http://localhost/api/articles/${crypto.randomUUID()}`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Article not found');
    });

    it('should return 403 when user does not have manage permission', async () => {
      const { userId: ownerId } = await registerUser('owner');
      const { sessionCookie: otherSessionCookie } = await registerUser('other');
      
      const artifactId = await createTestArtifact(ownerId);
      const articleId = await createTestArticle(ownerId, artifactId, 'Test Article');

      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'DELETE',
        headers: { Cookie: otherSessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('No permission to delete this article');
    });

    it('should delete article with manage permission', async () => {
      const { userId, sessionCookie } = await registerUser('author');
      
      const artifactId = await createTestArtifact(userId);
      const articleId = await createTestArticle(userId, artifactId, 'Test Article');

      // Verify article exists
      const [beforeDelete] = await db.select().from(articles).where(eq(articles.id, articleId));
      expect(beforeDelete).toBeDefined();

      // Delete article
      const request = new Request(`http://localhost/api/articles/${articleId}`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(204);

      // Verify article is deleted
      const [afterDelete] = await db.select().from(articles).where(eq(articles.id, articleId));
      expect(afterDelete).toBeUndefined();

      // Verify ACL records are deleted
      const aclRecords = await db.select().from(resourceAcl)
        .where(eq(resourceAcl.resourceId, articleId));
      expect(aclRecords).toHaveLength(0);

      // Verify discovery control record is deleted
      const discoveryRecords = await db.select().from(resourceDiscoveryControl)
        .where(eq(resourceDiscoveryControl.resourceId, articleId));
      expect(discoveryRecords).toHaveLength(0);
    });
  });
});
