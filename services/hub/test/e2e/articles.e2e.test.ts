import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { registerUser, createCloudSave, createCheckpoint } from './helpers';
import type { ArticleDetail, ApiError, UpsertArticleRequest } from '@pubwiki/api';

describe('E2E: Articles API', () => {
  let worker: Unstable_DevWorker;
  let baseUrl: string;
  let sessionCookie: string;
  let testUserId: string;
  let testArtifactId: string;
  let testSandboxNodeId: string;
  let testStateNodeId: string;
  let testSaveId: string;
  let testCheckpointId: string;

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
    testStateNodeId = crypto.randomUUID();
    const artifactSlug = `test-artifact-${Date.now()}`;

    // 先创建云端存档（使用随机的 stateNodeId，不需要关联到真实的 STATE 节点）
    testSaveId = await createCloudSave(baseUrl, sessionCookie, testStateNodeId);

    // 创建 PUBLIC checkpoint
    testCheckpointId = await createCheckpoint(baseUrl, sessionCookie, testSaveId, 'test-checkpoint-public', 'PUBLIC');

    // 创建测试 artifact，只包含 SANDBOX node（不包含 STATE 节点以避免循环依赖）
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
          content: {
            entryFile: 'index.html',
          },
        },
      ],
      edges: [],
    }));

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

  // Helper: 创建有效的 article content（使用真实的 checkpointId）
  function createTestContent(checkpointId: string = testCheckpointId): UpsertArticleRequest['content'] {
    return [
      {
        type: 'text',
        id: 'text-1',
        text: 'This is a test paragraph for e2e testing',
      },
      {
        type: 'game_ref',
        textId: 'text-1',
        checkpointId,
      },
    ];
  }

  describe('Complete Article Lifecycle', () => {
    it('should create, get, update, and verify article with real save and checkpoint', async () => {
      const articleId = crypto.randomUUID();

      // Step 1: Create article via PUT with real saveId and checkpointId
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
          saveId: testSaveId,
        }),
      });

      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as ArticleDetail;
      expect(createData.id).toBe(articleId);
      expect(createData.title).toBe('E2E Test Article');
      expect(createData.sandboxNodeId).toBe(testSandboxNodeId);
      expect(createData.artifactId).toBe(testArtifactId);
      expect(createData.visibility).toBe('PUBLIC');
      expect(createData.saveId).toBe(testSaveId);
      expect(createData.author.id).toBe(testUserId);
      expect(createData.content).toHaveLength(2);

      // Step 2: Get article via GET
      const getResponse = await fetch(`${baseUrl}/articles/${articleId}`);
      expect(getResponse.status).toBe(200);
      const getData = await getResponse.json() as ArticleDetail;
      expect(getData.id).toBe(articleId);
      expect(getData.saveId).toBe(testSaveId);

      // Step 3: Update article via PUT (only text content, no game_ref)
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
          saveId: testSaveId,
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

  describe('SaveId and CheckpointId Validation', () => {
    it('should return 400 for non-existent saveId', async () => {
      const articleId = crypto.randomUUID();
      const fakeSaveId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Article',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(),
          saveId: fakeSaveId,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain(fakeSaveId);
      expect(data.error).toContain('not found');
    });

    it('should return 400 for non-existent checkpointId', async () => {
      const articleId = crypto.randomUUID();
      const fakeCheckpointId = 'non-existent-checkpoint';

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Article',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(fakeCheckpointId),
          saveId: testSaveId,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain(fakeCheckpointId);
      expect(data.error).toContain('not found');
    });

    it('should reject PUBLIC article with PRIVATE checkpoint', async () => {
      // 创建 PRIVATE checkpoint
      const privateCheckpointId = await createCheckpoint(
        baseUrl, 
        sessionCookie, 
        testSaveId, 
        `private-cp-${Date.now()}`, 
        'PRIVATE'
      );

      const articleId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Public Article with Private Checkpoint',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(privateCheckpointId),
          visibility: 'PUBLIC',
          saveId: testSaveId,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain('visibility');
      expect(data.error).toContain('PRIVATE');
    });

    it('should reject UNLISTED article with PRIVATE checkpoint', async () => {
      // 创建 PRIVATE checkpoint
      const privateCheckpointId = await createCheckpoint(
        baseUrl, 
        sessionCookie, 
        testSaveId, 
        `private-cp-unlisted-${Date.now()}`, 
        'PRIVATE'
      );

      const articleId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Unlisted Article with Private Checkpoint',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(privateCheckpointId),
          visibility: 'UNLISTED',
          saveId: testSaveId,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain('visibility');
    });

    it('should allow PRIVATE article with PRIVATE checkpoint', async () => {
      // 创建 PRIVATE checkpoint
      const privateCheckpointId = await createCheckpoint(
        baseUrl, 
        sessionCookie, 
        testSaveId, 
        `private-cp-allowed-${Date.now()}`, 
        'PRIVATE'
      );

      const articleId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Private Article with Private Checkpoint',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(privateCheckpointId),
          visibility: 'PRIVATE',
          saveId: testSaveId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as ArticleDetail;
      expect(data.visibility).toBe('PRIVATE');
    });

    it('should allow PUBLIC article with PUBLIC checkpoint', async () => {
      const articleId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Public Article with Public Checkpoint',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(testCheckpointId), // testCheckpointId is PUBLIC
          visibility: 'PUBLIC',
          saveId: testSaveId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as ArticleDetail;
      expect(data.visibility).toBe('PUBLIC');
    });

    it('should allow UNLISTED article with PUBLIC checkpoint', async () => {
      const articleId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Unlisted Article with Public Checkpoint',
          sandboxNodeId: testSandboxNodeId,
          content: createTestContent(testCheckpointId),
          visibility: 'UNLISTED',
          saveId: testSaveId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as ArticleDetail;
      expect(data.visibility).toBe('UNLISTED');
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
          saveId: testSaveId,
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
          saveId: testSaveId,
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing saveId', async () => {
      const articleId = crypto.randomUUID();

      const response = await fetch(`${baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Article',
          sandboxNodeId: testSandboxNodeId,
          content: [],
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain('saveId');
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
          content: [],
          saveId: testSaveId,
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
          content: [],
          saveId: testSaveId,
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
          saveId: testSaveId,
        }),
      });
      expect(response.status).toBe(403);
    });

    it('should handle different visibility settings with proper checkpoints', async () => {
      // Create PUBLIC article with PUBLIC checkpoint
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
          saveId: testSaveId,
        }),
      });
      expect(publicResponse.status).toBe(200);
      const publicData = await publicResponse.json() as ArticleDetail;
      expect(publicData.visibility).toBe('PUBLIC');

      // Create UNLISTED article with PUBLIC checkpoint
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
          saveId: testSaveId,
        }),
      });
      expect(unlistedResponse.status).toBe(200);
      const unlistedData = await unlistedResponse.json() as ArticleDetail;
      expect(unlistedData.visibility).toBe('UNLISTED');
    });

    it('should handle complex content with multiple game refs', async () => {
      // 创建多个 PUBLIC checkpoints
      const cp1 = await createCheckpoint(baseUrl, sessionCookie, testSaveId, `cp1-${Date.now()}`, 'PUBLIC');
      const cp2 = await createCheckpoint(baseUrl, sessionCookie, testSaveId, `cp2-${Date.now()}`, 'PUBLIC');

      const articleId = crypto.randomUUID();
      const complexContent: UpsertArticleRequest['content'] = [
        { type: 'text', id: 'text-1', text: '# Introduction' },
        { type: 'game_ref', textId: 'text-1', checkpointId: cp1 },
        { type: 'text', id: 'text-2', text: 'Some middle text' },
        { type: 'game_ref', textId: 'text-2', checkpointId: cp2 },
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
          saveId: testSaveId,
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
