import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { registerUser } from './helpers';
import type { ArticleDetail, ApiError, UpsertArticleRequest } from '@pubwiki/api';

describe('E2E: Articles API', () => {
  let worker: Unstable_DevWorker;
  let baseUrl: string;
  let sessionCookie: string;
  let testUserId: string;
  let testArtifactId: string;
  let testSandboxNodeId: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;

    // 创建测试用户并获取 session cookie
    const username = `article_test_${Date.now()}`;
    const result = await registerUser(baseUrl, username);
    sessionCookie = result.sessionCookie;
    testUserId = result.userId;

    // 生成 ID
    testArtifactId = crypto.randomUUID();
    testSandboxNodeId = crypto.randomUUID();
    const artifactSlug = `test-artifact-${Date.now()}`;

    // 创建测试 artifact 和 SANDBOX node
    const formData = new FormData();
    formData.append('metadata', JSON.stringify({
      artifactId: testArtifactId,
      type: 'GAME',
      name: 'Test Artifact for Articles',
      slug: artifactSlug,
      version: '1.0.0',
      description: 'Test artifact for article e2e tests',
      visibility: 'PUBLIC',
    }));
    formData.append('descriptor', JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: [
        {
          id: testSandboxNodeId,
          type: 'SANDBOX',
          name: 'Test Sandbox Node',
        },
      ],
      edges: [],
    }));
    // 为 SANDBOX node 添加 node.json 文件
    const nodeJson = JSON.stringify({ type: 'SANDBOX', name: 'Test Sandbox Node' });
    formData.append(`nodes[${testSandboxNodeId}]`, new Blob([nodeJson], { type: 'application/json' }), 'node.json');

    const artifactResponse = await fetch(`${baseUrl}/artifacts`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: formData,
    });

    if (!artifactResponse.ok) {
      const errorData = await artifactResponse.json();
      throw new Error(`Failed to create test artifact: ${JSON.stringify(errorData)}`);
    }
  });

  afterAll(async () => {
    await worker.stop();
  });

  // Helper: 创建有效的 article content
  function createTestContent(): UpsertArticleRequest['content'] {
    return [
      {
        type: 'text',
        id: 'text-1',
        text: 'This is a test paragraph for e2e testing',
      },
      {
        type: 'game_ref',
        textId: 'text-1',
        ref: 'save-state-e2e',
      },
    ];
  }

  describe('Complete Article Lifecycle', () => {
    it('should create, get, update, and verify article', async () => {
      const articleId = crypto.randomUUID();

      // Step 1: Create article via PUT
      const createResponse = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'E2E Test Article',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(),
          visibility: 'PUBLIC',
        }),
      });

      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as ArticleDetail;
      expect(createData.id).toBe(articleId);
      expect(createData.title).toBe('E2E Test Article');
      expect(createData.sandboxNodeId).toBe(testSandboxNodeId);
      expect(createData.artifactId).toBe(testArtifactId);
      expect(createData.visibility).toBe('PUBLIC');
      expect(createData.author.id).toBe(testUserId);
      expect(createData.content).toHaveLength(2);
      expect(createData.likes).toBe(0);
      expect(createData.collections).toBe(0);

      // Step 2: Get article via GET
      const getResponse = await fetch(`${baseUrl}/articles/${articleId}`);
      expect(getResponse.status).toBe(200);
      const getData = await getResponse.json() as ArticleDetail;
      expect(getData.id).toBe(articleId);
      expect(getData.title).toBe('E2E Test Article');

      // Step 3: Update article via PUT
      const updateResponse = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Updated E2E Article',
          sandboxNodeId: testSandboxNodeId,
          content: [{ type: 'text', id: 'text-1', text: 'Updated content for e2e' }],
          visibility: 'PRIVATE',
        }),
      });

      expect(updateResponse.status).toBe(200);
      const updateData = await updateResponse.json() as ArticleDetail;
      expect(updateData.title).toBe('Updated E2E Article');
      expect(updateData.visibility).toBe('PRIVATE');
      expect(updateData.content).toHaveLength(1);

      // Step 4: Verify update via GET
      const verifyResponse = await fetch(`${baseUrl}/articles/${articleId}`);
      expect(verifyResponse.status).toBe(200);
      const verifyData = await verifyResponse.json() as ArticleDetail;
      expect(verifyData.title).toBe('Updated E2E Article');
      expect(verifyData.visibility).toBe('PRIVATE');
    });
  });

  describe('GET /api/articles/:articleId', () => {
    it('should return 400 for invalid article ID format', async () => {
      const response = await fetch(`${baseUrl}/articles/invalid-id`);
      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toBe('Invalid article ID format');
    });

    it('should return 404 for non-existent article', async () => {
      const response = await fetch(`${baseUrl}/articles/00000000-0000-0000-0000-000000000000`);
      expect(response.status).toBe(404);
      const data = await response.json() as ApiError;
      expect(data.error).toBe('Article not found');
    });
  });

  describe('PUT /api/articles/:articleId', () => {
    it('should require authentication', async () => {
      const articleId = crypto.randomUUID();
      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          sandboxNodeId: testSandboxNodeId,
          content: [],
        }),
      });
      expect(response.status).toBe(401);
    });

    it('should return 400 for missing required fields', async () => {
      const articleId = crypto.randomUUID();

      // Missing title
      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sandboxNodeId: testSandboxNodeId,
          content: [],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent sandbox node', async () => {
      const articleId = crypto.randomUUID();
      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Article',
          sandboxNodeId: crypto.randomUUID(), // non-existent
          content: createTestContent(),
        }),
      });
      expect(response.status).toBe(404);
    });

    it('should prevent non-author from updating existing article', async () => {
      const articleId = crypto.randomUUID();

      // Create article as original user
      await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Original Article',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(),
        }),
      });

      // Create another user
      const otherUsername = `other_${Date.now()}`;
      const { sessionCookie: otherCookie } = await registerUser(baseUrl, otherUsername);

      // Try to update as different user
      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: otherCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Hijacked Title',
          sandboxNodeId: testSandboxNodeId,
          content: [],
        }),
      });
      expect(response.status).toBe(403);
    });

    it('should handle different visibility settings', async () => {
      // Create PUBLIC article
      const publicArticleId = crypto.randomUUID();
      const publicResponse = await fetch(`${baseUrl}/articles/${publicArticleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Public Article',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(),
          visibility: 'PUBLIC',
        }),
      });
      expect(publicResponse.status).toBe(200);
      const publicData = await publicResponse.json() as ArticleDetail;
      expect(publicData.visibility).toBe('PUBLIC');

      // Create UNLISTED article
      const unlistedArticleId = crypto.randomUUID();
      const unlistedResponse = await fetch(`${baseUrl}/articles/${unlistedArticleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Unlisted Article',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(),
          visibility: 'UNLISTED',
        }),
      });
      expect(unlistedResponse.status).toBe(200);
      const unlistedData = await unlistedResponse.json() as ArticleDetail;
      expect(unlistedData.visibility).toBe('UNLISTED');
    });

    it('should handle complex content with game refs', async () => {
      const articleId = crypto.randomUUID();
      const complexContent: UpsertArticleRequest['content'] = [
        { type: 'text', id: 'text-1', text: '# Introduction' },
        { type: 'game_ref', textId: 'text-1', ref: 'ref-1' },
        { type: 'text', id: 'text-2', text: 'Some middle text' },
        { type: 'game_ref', textId: 'text-2', ref: 'ref-2' },
        { type: 'text', id: 'text-3', text: 'Conclusion' },
      ];

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Complex Content Article',
          sandboxNodeId: testSandboxNodeId,
          content: complexContent,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as ArticleDetail;
      expect(data.content).toHaveLength(5);
      expect(data.content[0].type).toBe('text');
      expect(data.content[1].type).toBe('game_ref');
      expect(data.content[3].type).toBe('game_ref');
    });
  });
});
