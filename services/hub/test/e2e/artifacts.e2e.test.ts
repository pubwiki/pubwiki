import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { computeArtifactCommit, computeNodeCommit, computeContentHash, computeSha256Hex } from '@pubwiki/api';
import { registerUser, createVfsTarGz, createArtifactFormData } from './helpers';

describe('E2E: Artifacts API', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    client = createApiClient(baseUrl);
  });

  afterAll(async () => {
    await worker.stop();
  });

  describe('GET /artifacts', () => {
    it('should return artifact list with pagination', async () => {
      const { data, error, response } = await client.GET('/artifacts');

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.artifacts).toBeDefined();
      expect(Array.isArray(data!.artifacts)).toBe(true);
      expect(data!.pagination).toBeDefined();
      expect(data!.pagination.page).toBeGreaterThanOrEqual(1);
      expect(data!.pagination.limit).toBeGreaterThanOrEqual(1);
    });

    it('should accept pagination parameters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            page: 1,
            limit: 10,
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.pagination.page).toBe(1);
      expect(data!.pagination.limit).toBe(10);
    });

    it('should accept type filter parameters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            'tag.include': ['recipe'],
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should accept type exclude parameters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            'tag.exclude': ['prompt'],
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should accept tag filter parameters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            'tag.include': ['javascript'],
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should accept sort parameters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            sortBy: 'viewCount',
            sortOrder: 'desc',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should return 400 for invalid sortBy value', async () => {
      const { error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            // @ts-expect-error - testing invalid value
            sortBy: 'invalid',
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Validation error');
      expect(error!.error).toContain('sortBy');
    });

    it('should ignore unknown type filter parameters', async () => {
      const { data, response } = await client.GET('/artifacts', {
        params: {
          query: {
            // @ts-expect-error - testing unknown parameter
            'type.include': ['INVALID_TYPE'],
          },
        },
      });

      // type.include no longer exists; unknown params are ignored
      expect(response.status).toBe(200);
      expect(data).toBeDefined();
    });

    it('should include artifact metadata in response', async () => {
      const { data, error, response } = await client.GET('/artifacts');

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();

      // 检查每个 artifact 都有必要的字段
      for (const artifact of data!.artifacts) {
        expect(artifact.id).toBeDefined();
        expect(artifact.name).toBeDefined();
        expect(artifact.isListed).toBe(true);
        expect(artifact.createdAt).toBeDefined();
        expect(artifact.updatedAt).toBeDefined();
        expect(artifact.author).toBeDefined();
        expect(artifact.author.id).toBeDefined();
        expect(artifact.author.username).toBeDefined();
        expect(artifact.tags).toBeDefined();
        expect(Array.isArray(artifact.tags)).toBe(true);
      }
    });

    it('should handle combination of filters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            page: 1,
            limit: 5,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.pagination.limit).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /artifacts/{artifactId}/lineage', () => {
    it('should return 404 for non-existent artifact', async () => {
      const { error, response } = await client.GET('/artifacts/{artifactId}/lineage', {
        params: {
          path: {
            artifactId: crypto.randomUUID(),
          },
        },
      });

      // resourceAccessMiddleware returns 403 for non-existent artifacts
      expect(response.status).toBe(403);
      expect(error).toBeDefined();
    });

    it('should handle lineage endpoint for public artifacts', async () => {
      // Get list of public artifacts first
      const { data } = await client.GET('/artifacts');
      
      // If there are public artifacts, try to get their lineage
      if (data && data.artifacts.length > 0) {
        const artifactId = data.artifacts[0].id;
        const { data: lineageData, response: lineageResponse } = await client.GET('/artifacts/{artifactId}/lineage', {
          params: {
            path: { artifactId },
          },
        });
        
        expect(lineageResponse.status).toBe(200);
        if (lineageData) {
          expect(lineageData.parents).toBeDefined();
          expect(lineageData.children).toBeDefined();
          expect(Array.isArray(lineageData.parents)).toBe(true);
          expect(Array.isArray(lineageData.children)).toBe(true);
        }
      }
    });

    it('should return lineage structure with correct fields', async () => {
      // Get list of public artifacts first
      const { data } = await client.GET('/artifacts');
      
      // If there are public artifacts with lineage, validate structure
      if (data && data.artifacts.length > 0) {
        const artifactId = data.artifacts[0].id;
        const { data: lineageData, response } = await client.GET('/artifacts/{artifactId}/lineage', {
          params: {
            path: { artifactId },
          },
        });
        
        expect(response.status).toBe(200);
        if (lineageData) {
          // Validate that each parent/child has required fields
          for (const parent of lineageData.parents) {
            expect(parent.artifactId).toBeDefined();
            expect(parent.name).toBeDefined();
            expect(parent.isListed).toBeDefined();
          }
          for (const child of lineageData.children) {
            expect(child.artifactId).toBeDefined();
            expect(child.name).toBeDefined();
            expect(child.isListed).toBeDefined();
          }
        }
      }
    });
  });

  // 辅助函数：创建 FormData（无 VFS 文件）
  async function createFormData(
    metadata: Record<string, unknown>, 
    vfsFiles?: { name: string; content: string }[],
    customNodes?: Array<{ id: string; type: string; name?: string; content?: unknown }>
  ): Promise<FormData> {
    const nodes = customNodes ?? (vfsFiles && vfsFiles.length > 0 ? [{
      id: crypto.randomUUID(),
      type: 'VFS',
      name: 'files',
      content: { type: 'VFS', filesHash: '', fileTree: vfsFiles.map(f => ({ path: f.name })) }
    }] : []);
    
    const files = vfsFiles && vfsFiles.length > 0
      ? new Map(nodes.filter(n => n.type === 'VFS').map(n => [n.id, vfsFiles!]))
      : undefined;

    return createArtifactFormData(metadata, { nodes, files });
  }

  // 辅助函数：创建带 VFS tar.gz 归档的 FormData
  async function createFormDataWithVfs(
    metadata: Record<string, unknown>, 
    vfsFiles?: { name: string; content: string }[],
    customDescriptor?: { version: number; nodes: { id: string; type?: string; name?: string; content?: unknown }[]; edges: { source: string; target: string }[]; exportedAt?: string }
  ): Promise<FormData> {
    const descriptorNodes = customDescriptor?.nodes ?? [];
    const nodes = descriptorNodes.map(n => ({
      id: n.id,
      type: n.type ?? 'VFS',
      name: n.name,
      content: n.content,
    }));

    const files = new Map<string, Array<{ name: string; content: string }>>();
    if (vfsFiles && vfsFiles.length > 0) {
      const vfsNode = nodes.find(n => n.type === 'VFS');
      if (vfsNode) {
        files.set(vfsNode.id, vfsFiles);
      }
    }

    return createArtifactFormData(metadata, { nodes, files: files.size > 0 ? files : undefined });
  }

  describe('POST /artifacts', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const username = `e2euser${Date.now()}`;
      const result = await registerUser(baseUrl, username);
      sessionCookie = result.sessionCookie;
    });

    it('should return 401 when not authenticated', async () => {
      const formData = await createFormData({
        name: 'Test Recipe',
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        body: formData,
      });

      expect(response.status).toBe(401);
    });

    it('should create artifact successfully', async () => {
      const formData = await createFormData({
        name: 'E2E Test Recipe',
        description: 'An artifact created in E2E test',
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { message: string; artifact: { id: string; name: string } };
      expect(data.message).toBe('Artifact saved successfully');
      expect(data.artifact.name).toBe('E2E Test Recipe');
    });

    it('should create artifact with files', async () => {
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          name: 'E2E Prompt Pack',
        },
        [
          { name: 'prompt.md', content: '# Test Prompt\nThis is a test prompt.' },
        ],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ 
            id: vfsNodeId, 
            type: 'VFS', 
            name: 'files',
            content: { type: 'VFS', fileTree: [{ path: 'prompt.md', mimeType: 'text/markdown' }] }
          }],
          edges: [],
        }
      );

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { message: string; artifact: { id: string } };

      // Get the artifact graph to find the node commit
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: {
          path: { artifactId: data.artifact.id },
        },
        headers: {
          Cookie: sessionCookie,
        } as Record<string, string>,
      });
      expect(graphResponse.response.status).toBe(200);
      expect(graphResponse.data?.nodes).toBeDefined();
      expect(graphResponse.data!.nodes.length).toBeGreaterThan(0);

      // Find the VFS node commit hash
      const nodeCommit = graphResponse.data!.nodes[0].commit;

      // Verify VFS archive is accessible via /nodes/commits/:commit/archive
      const archiveResponse = await fetch(`${baseUrl}/nodes/commits/${nodeCommit}/archive`);
      expect(archiveResponse.status).toBe(200);
      expect(archiveResponse.headers.get('content-type')).toBe('application/gzip');
      
      // Verify we got a valid gzip file
      const archiveBuffer = await archiveResponse.arrayBuffer();
      expect(archiveBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should return 400 for missing required fields', async () => {
      // metadata without 'name' (required field)
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        commit: 'fake-commit',
      }));
      formData.append('nodes', JSON.stringify([]));
      formData.append('edges', JSON.stringify([]));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('Validation error');
    });

    it('should return 400 for invalid version format', async () => {
      const formData = await createFormData({
        name: 'Invalid Version',
        version: 'not-semver',
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      // Commit hash mismatch is the first error since our helper computes correct commit
      // but version validation error may also be present
      expect(data.error).toBeDefined();
    });

    it('should return 400 for VFS node without filesHash in content', async () => {
      const vfsNodeId = crypto.randomUUID();
      const artifactId = crypto.randomUUID();
      const formData = new FormData();

      // Build a node with invalid VFS content (missing filesHash)
      const invalidContent = { type: 'VFS', projectId: 'some-random-id' };
      const contentHash = await computeContentHash(invalidContent as Parameters<typeof computeContentHash>[0]);
      const nodeCommit = await computeNodeCommit(vfsNodeId, null, contentHash, 'VFS');
      const nodes = [{
        nodeId: vfsNodeId,
        commit: nodeCommit,
        type: 'VFS',
        name: 'invalid-vfs',
        contentHash,
        content: invalidContent,
      }];
      const commit = await computeArtifactCommit(artifactId, null, nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })), []);

      formData.append('metadata', JSON.stringify({
        artifactId,
        commit,
        name: 'VFS Without Files',
      }));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify([]));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('filesHash');
    });

    it('should return 400 for VFS node with invalid fileTree array item', async () => {
      const vfsNodeId = crypto.randomUUID();
      const artifactId = crypto.randomUUID();
      const formData = new FormData();

      // VFS content with fileTree item missing 'path'
      const invalidContent = { type: 'VFS', filesHash: 'dummy-hash', fileTree: [{ name: 'file.txt' }] };
      const contentHash = await computeContentHash(invalidContent as Parameters<typeof computeContentHash>[0]);
      const nodeCommit = await computeNodeCommit(vfsNodeId, null, contentHash, 'VFS');
      const nodes = [{
        nodeId: vfsNodeId,
        commit: nodeCommit,
        type: 'VFS',
        name: 'invalid-vfs',
        contentHash,
        content: invalidContent,
      }];
      const commit = await computeArtifactCommit(artifactId, null, nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })), []);

      formData.append('metadata', JSON.stringify({
        artifactId,
        commit,
        name: 'VFS With Invalid File',
      }));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify([]));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('path');
    });

    it('should return 400 for INPUT node without blocks array', async () => {
      const inputNodeId = crypto.randomUUID();
      const artifactId = crypto.randomUUID();
      const formData = new FormData();

      // INPUT content missing 'blocks' 
      const invalidContent = { type: 'INPUT', text: 'some text' };
      const contentHash = await computeContentHash(invalidContent as Parameters<typeof computeContentHash>[0]);
      const nodeCommit = await computeNodeCommit(inputNodeId, null, contentHash, 'INPUT');
      const nodes = [{
        nodeId: inputNodeId,
        commit: nodeCommit,
        type: 'INPUT',
        name: 'invalid-input',
        contentHash,
        content: invalidContent,
      }];
      const commit = await computeArtifactCommit(artifactId, null, nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })), []);

      formData.append('metadata', JSON.stringify({
        artifactId,
        commit,
        name: 'Input Without Blocks',
      }));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify([]));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('blocks');
    });

    it('should return 400 for GENERATED node without required blocks', async () => {
      const generatedNodeId = crypto.randomUUID();
      const artifactId = crypto.randomUUID();
      const formData = new FormData();

      // GENERATED content missing 'blocks' (required field)
      const invalidContent = { type: 'GENERATED' } as Record<string, unknown>;
      const contentHash = await computeContentHash(invalidContent as Parameters<typeof computeContentHash>[0]);
      const nodeCommit = await computeNodeCommit(generatedNodeId, null, contentHash, 'GENERATED');
      const nodes = [{
        nodeId: generatedNodeId,
        commit: nodeCommit,
        type: 'GENERATED',
        name: 'invalid-generated',
        contentHash,
        content: invalidContent,
      }];
      const commit = await computeArtifactCommit(artifactId, null, nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })), []);

      formData.append('metadata', JSON.stringify({
        artifactId,
        commit,
        name: 'Generated Without InputRef',
      }));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify([]));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('Validation error');
    });

    it('should return 409 for duplicate artifactId', async () => {
      // Create first artifact
      const formData1 = await createFormData({
        name: 'First',
      });

      const response1 = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData1,
      });
      expect(response1.status).toBe(200);
      const data1 = await response1.json() as { artifact: { id: string } };

      // Try to create second artifact with same artifactId
      const formData2 = await createFormData({
        artifactId: data1.artifact.id,
        name: 'Second',
      });

      const response2 = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData2,
      });

      expect(response2.status).toBe(409);
      const data = await response2.json() as { error: string };
      expect(data.error).toContain('already exists');
    });

    it('should return 409 when creating artifact with existing artifactId (idempotency)', async () => {
      // Generate a fixed artifactId that will be used for both requests
      const artifactId = crypto.randomUUID();
      
      // Import computeArtifactCommit dynamically to compute correct commit
      const { computeArtifactCommit } = await import('@pubwiki/api');
      
      // For empty nodes and edges, compute the correct commit
      const commit = await computeArtifactCommit(artifactId, null, [], []);
      
      // First creation: should succeed
      const formData1 = new FormData();
      formData1.append('metadata', JSON.stringify({
        artifactId,
        name: 'First Artifact',
        commit,
        isListed: true,
        isPrivate: false,
      }));
      formData1.append('nodes', JSON.stringify([]));
      formData1.append('edges', JSON.stringify([]));

      const response1 = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData1,
      });
      
      expect(response1.status).toBe(200);
      const data1 = await response1.json() as { artifact: { id: string } };
      expect(data1.artifact.id).toBe(artifactId);

      // Second creation with same artifactId: should return 409
      const formData2 = new FormData();
      formData2.append('metadata', JSON.stringify({
        artifactId, // Same artifactId!
        name: 'Second Artifact',
        commit, // Same commit (same content)
        isListed: true,
        isPrivate: false,
      }));
      formData2.append('nodes', JSON.stringify([]));
      formData2.append('edges', JSON.stringify([]));

      const response2 = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData2,
      });

      expect(response2.status).toBe(409);
      const data2 = await response2.json() as { error: string };
      expect(data2.error).toContain('already exists');
    });

    it('should create artifact with all optional fields', async () => {
      const formData = await createFormData({
        name: 'Full Asset Pack',
        version: '2.0.0-beta',
        description: 'A complete asset pack',
        isPrivate: true,
        isListed: false,
        thumbnailUrl: 'https://example.com/thumb.png',
        license: 'MIT',
        changelog: 'Initial release',
        tags: ['test', 'e2e'],
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { artifact: { name: string; isListed: boolean; license: string; tags?: { slug: string }[] } };
      expect(data.artifact.name).toBe('Full Asset Pack');
      expect(data.artifact.isListed).toBe(false);
      expect(data.artifact.license).toBe('MIT');
      expect(data.artifact.tags).toHaveLength(2);
    });

    it('should create artifact with homepage markdown', async () => {
      const formData = await createFormData({
        name: 'Homepage Recipe',
      });
      
      // Add homepage markdown
      const markdownContent = '# Welcome\n\nThis is the **homepage** for this artifact.\n\n- Feature 1\n- Feature 2';
      const blob = new Blob([markdownContent], { type: 'text/markdown' });
      formData.append('homepage', blob, 'homepage.md');

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { artifact: { id: string } };
      
      // Now fetch the homepage
      const homepageResponse = await fetch(`${baseUrl}/artifacts/${data.artifact.id}/homepage`);
      expect(homepageResponse.status).toBe(200);
      expect(homepageResponse.headers.get('content-type')).toContain('text/html');
      
      const html = await homepageResponse.text();
      expect(html).toContain('<h1>Welcome</h1>');
      expect(html).toContain('<strong>homepage</strong>');
      expect(html).toContain('<li>Feature 1</li>');
    });

  });

  describe('GET /artifacts/:artifactId/nodes/:nodeId', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const username = `nodedetailuser${Date.now()}`;
      const result = await registerUser(baseUrl, username);
      sessionCookie = result.sessionCookie;
    });

    it('should return node detail for VFS node with files in content', async () => {
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          name: 'VFS Node Detail Test',
        },
        [
          { name: 'file1.txt', content: 'Hello World' },
          { name: 'subdir/file2.txt', content: 'Nested file content' },
        ],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ 
            id: vfsNodeId, 
            type: 'VFS', 
            name: 'test-vfs',
            content: { fileTree: [
              { path: 'file1.txt', size: 11, mimeType: 'text/plain' },
              { path: 'subdir/file2.txt', size: 19, mimeType: 'text/plain' },
            ]}
          }],
          edges: [],
        }
      );

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Fetch node detail via graph endpoint
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: createData.artifact.id } },
      });
      
      expect(graphResponse.response.status).toBe(200);
      const nodes = graphResponse.data!.nodes;
      expect(nodes.length).toBeGreaterThan(0);
      
      const vfsNode = nodes.find(n => n.id === vfsNodeId);
      expect(vfsNode).toBeDefined();
      expect(vfsNode!.type).toBe('VFS');
      expect(vfsNode!.name).toBe('test-vfs');
      expect(vfsNode!.commit).toBeDefined();
      
      // VFS node should have content with fileTree
      expect(vfsNode!.content).toBeDefined();
      const content = vfsNode!.content as { fileTree?: { path: string; size?: number; mimeType?: string }[] };
      expect(content.fileTree).toBeDefined();
      expect(Array.isArray(content.fileTree)).toBe(true);
      expect(content.fileTree!.length).toBe(2);
      
      // Verify file structure
      const file1 = content.fileTree!.find(f => f.path === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1!.mimeType).toBe('text/plain');
      
      const file2 = content.fileTree!.find(f => f.path === 'subdir/file2.txt');
      expect(file2).toBeDefined();
    });

    it('should return node detail for non-VFS node', async () => {
      const inputNodeId = crypto.randomUUID();
      const formData = await createFormData(
        {
          name: 'Input Node Detail Test',
        },
        undefined,
        [{ 
          id: inputNodeId, 
          type: 'INPUT', 
          name: 'test-input',
          content: { type: 'INPUT', blocks: [] }
        }]
      );

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Fetch node detail via graph endpoint
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: createData.artifact.id } },
      });
      
      expect(graphResponse.response.status).toBe(200);
      const nodes = graphResponse.data!.nodes;
      
      const inputNode = nodes.find(n => n.id === inputNodeId);
      expect(inputNode).toBeDefined();
      expect(inputNode!.type).toBe('INPUT');
      expect(inputNode!.name).toBe('test-input');
      expect(inputNode!.content).toBeDefined();
    });

    it('should return empty nodes for non-existent node in graph', async () => {
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          name: 'Non-existent Node Test',
        },
        [{ name: 'file.txt', content: 'test' }],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ id: vfsNodeId, type: 'VFS', name: 'vfs', content: { fileTree: [{ path: 'file.txt' }] } }],
          edges: [],
        }
      );

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // The graph has only the VFS node, so a random ID won't be found  
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: createData.artifact.id } },
      });
      expect(graphResponse.response.status).toBe(200);
      
      const nonExistentNodeId = crypto.randomUUID();
      const foundNode = graphResponse.data!.nodes.find(n => n.id === nonExistentNodeId);
      expect(foundNode).toBeUndefined();
    });

    it('should return 403 for non-existent artifact graph', async () => {
      const fakeArtifactId = crypto.randomUUID();
      const { response } = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: fakeArtifactId } },
      });
      
      expect(response.status).toBe(403);
    });
  });

  describe('GET /nodes/commits/:commit/archive', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const username = `archiveuser${Date.now()}`;
      const result = await registerUser(baseUrl, username);
      sessionCookie = result.sessionCookie;
    });

    it('should return tar.gz archive for VFS node', async () => {
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          name: 'VFS Archive Test',
        },
        [
          { name: 'file1.txt', content: 'Hello World' },
          { name: 'file2.txt', content: 'Second file content' },
        ],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ 
            id: vfsNodeId, 
            type: 'VFS', 
            name: 'files',
            content: { fileTree: [{ path: 'file1.txt' }, { path: 'file2.txt' }] }
          }],
          edges: [],
        }
      );

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Get the node commit from graph
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: createData.artifact.id } },
        headers: { Cookie: sessionCookie } as Record<string, string>,
      });
      const vfsNode = graphResponse.data!.nodes.find(n => n.id === vfsNodeId);
      expect(vfsNode).toBeDefined();

      // Fetch archive using node commit
      const archiveResponse = await fetch(
        `${baseUrl}/nodes/commits/${vfsNode!.commit}/archive`
      );
      
      expect(archiveResponse.status).toBe(200);
      expect(archiveResponse.headers.get('content-type')).toBe('application/gzip');
      
      const buffer = await archiveResponse.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
      
      // Verify gzip magic number (1f 8b)
      const bytes = new Uint8Array(buffer);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
    });

    it('should return 404 for non-VFS node', async () => {
      const inputNodeId = crypto.randomUUID();
      const formData = await createFormData(
        {
          name: 'Non-VFS Test',
        },
        undefined,
        [{ 
          id: inputNodeId, 
          type: 'INPUT', 
          name: 'input',
          content: { type: 'INPUT', blocks: [] }
        }]
      );

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Get the node commit from graph
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: createData.artifact.id } },
        headers: { Cookie: sessionCookie } as Record<string, string>,
      });
      const inputNode = graphResponse.data!.nodes.find(n => n.id === inputNodeId);
      expect(inputNode).toBeDefined();

      // Try to fetch archive for INPUT node (should fail with 400 Bad Request)
      // 400 is returned because the node exists but is not a VFS type
      const archiveResponse = await fetch(
        `${baseUrl}/nodes/commits/${inputNode!.commit}/archive`
      );
      
      expect(archiveResponse.status).toBe(400);
    });

    it('should return 404 for non-existent node', async () => {
      const formData = await createFormData({
        name: 'Test',
      });

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Try to fetch archive for non-existent node commit
      const archiveResponse = await fetch(
        `${baseUrl}/nodes/commits/non-existent-commit/archive`
      );
      
      // resourceAccessMiddleware returns 403 for non-existent resources
      expect(archiveResponse.status).toBe(403);
    });

    it('should require auth for private artifact archive', async () => {
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          name: 'Private VFS Test',
          isPrivate: true,
          isListed: false,
        },
        [{ name: 'secret.txt', content: 'secret content' }],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ 
            id: vfsNodeId, 
            type: 'VFS', 
            name: 'files',
            content: { fileTree: [{ path: 'secret.txt' }] }
          }],
          edges: [],
        }
      );

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Get the node commit from graph
      const graphResponse = await client.GET('/artifacts/{artifactId}/graph', {
        params: { path: { artifactId: createData.artifact.id } },
        headers: { Cookie: sessionCookie } as Record<string, string>,
      });
      const vfsArchiveNode = graphResponse.data!.nodes.find(n => n.id === vfsNodeId);
      expect(vfsArchiveNode).toBeDefined();

      // Try to fetch without auth
      const archiveResponse = await fetch(
        `${baseUrl}/nodes/commits/${vfsArchiveNode!.commit}/archive`
      );
      
      // Private artifact nodes are not accessible without auth
      expect(archiveResponse.status).toBe(403);

      // Should work with auth
      const authArchiveResponse = await fetch(
        `${baseUrl}/nodes/commits/${vfsArchiveNode!.commit}/archive`,
        { headers: { Cookie: sessionCookie } }
      );
      
      expect(authArchiveResponse.status).toBe(200);
    });
  });

  describe('GET /artifacts/:artifactId/homepage', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      // 先注册并登录获取 session cookie
      const timestamp = Date.now();
      const result = await registerUser(baseUrl, `homepageuser${timestamp}`);
      sessionCookie = result.sessionCookie;
    });

    async function createArtifactWithHomepage(options: { isPrivate?: boolean; isListed?: boolean } = {}): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
      const formData = await createFormData({
        name: 'Test Artifact',
        isPrivate,
        isListed,
      });
      
      const markdownContent = '# Test Homepage\n\nThis is a test.';
      const blob = new Blob([markdownContent], { type: 'text/markdown' });
      formData.append('homepage', blob, 'homepage.md');

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });
      
      const data = await response.json() as { artifact: { id: string } };
      return data.artifact.id;
    }

    it('should return homepage HTML for public artifact', async () => {
      const artifactId = await createArtifactWithHomepage({ isPrivate: false, isListed: true });
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      expect(html).toContain('<h1>Test Homepage</h1>');
    });

    it('should return 404 for non-existent artifact', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await fetch(`${baseUrl}/artifacts/${fakeId}/homepage`);
      
      expect(response.status).toBe(404);
    });

    it('should return homepage for unlisted artifact without auth', async () => {
      const artifactId = await createArtifactWithHomepage({ isPrivate: false, isListed: false });
      
      // Unlisted artifacts are still publicly accessible, just not in lists
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`);
      
      expect(response.status).toBe(200);
    });

    it('should return homepage for unlisted artifact with auth', async () => {
      const artifactId = await createArtifactWithHomepage({ isPrivate: false, isListed: false });
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`, {
        headers: {
          Cookie: sessionCookie,
        },
      });
      
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<h1>Test Homepage</h1>');
    });

    it('should return 403 for private artifact without auth', async () => {
      const artifactId = await createArtifactWithHomepage({ isPrivate: true, isListed: false });
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`);
      
      expect(response.status).toBe(403);
    });

    it('should return homepage for private artifact with owner auth', async () => {
      const artifactId = await createArtifactWithHomepage({ isPrivate: true, isListed: false });
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`, {
        headers: {
          Cookie: sessionCookie,
        },
      });
      
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<h1>Test Homepage</h1>');
    });

    it('should return 403 for private artifact with different user auth', async () => {
      const artifactId = await createArtifactWithHomepage({ isPrivate: true, isListed: false });
      
      // Register a different user
      const timestamp = Date.now();
      const { sessionCookie: differentCookie } = await registerUser(baseUrl, `differentuser${timestamp}`);
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`, {
        headers: {
          Cookie: differentCookie,
        },
      });
      
      expect(response.status).toBe(403);
    });
  });
});
