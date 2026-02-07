import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { registerUser, createVfsTarGz } from './helpers';

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
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            // @ts-expect-error - testing invalid value
            sortBy: 'invalid',
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Invalid sortBy');
    });

    it('should return 400 for invalid type value', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            // @ts-expect-error - testing invalid value
            'type.include': ['INVALID_TYPE'],
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Invalid type');
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
        expect(artifact.visibility).toBe('PUBLIC');
        expect(artifact.isArchived).toBe(false);
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
            artifactId: 'non-existent-uuid-12345',
          },
        },
      });

      expect(response.status).toBe(404);
      expect(error).toBeDefined();
      expect(error!.error).toBe('Artifact not found');
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
            expect(parent.visibility).toBeDefined();
          }
          for (const child of lineageData.children) {
            expect(child.artifactId).toBeDefined();
            expect(child.name).toBeDefined();
            expect(child.visibility).toBeDefined();
          }
        }
      }
    });
  });

  // 辅助函数：创建 FormData（无 VFS 文件）
  function createFormData(
    metadata: Record<string, unknown>, 
    vfsFiles?: { name: string; content: string }[],
    customDescriptor?: { version: number; nodes: { id: string; type?: string; name?: string; content?: unknown }[]; edges: { source: string; target: string }[]; exportedAt?: string }
  ): FormData {
    const formData = new FormData();
    // 如果未提供 artifactId，则自动生成一个
    const metadataWithId = {
      artifactId: crypto.randomUUID(),
      ...metadata,
    };
    formData.append('metadata', JSON.stringify(metadataWithId));
    
    // 生成默认的 descriptor
    const defaultNodeId = crypto.randomUUID();
    const descriptor = customDescriptor || {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: vfsFiles && vfsFiles.length > 0 ? [{ 
        id: defaultNodeId, 
        type: 'VFS', 
        name: 'files',
        content: { files: vfsFiles.map(f => ({ path: f.name })) }
      }] : [],
      edges: [],
    };
    formData.append('descriptor', JSON.stringify(descriptor));
    
    // VFS 文件将在外部异步处理，因为需要创建 tar.gz
    return formData;
  }

  // 辅助函数：创建带 VFS tar.gz 归档的 FormData
  async function createFormDataWithVfs(
    metadata: Record<string, unknown>, 
    vfsFiles?: { name: string; content: string }[],
    customDescriptor?: { version: number; nodes: { id: string; type?: string; name?: string; content?: unknown }[]; edges: { source: string; target: string }[]; exportedAt?: string }
  ): Promise<FormData> {
    const formData = new FormData();
    // 如果未提供 artifactId，则自动生成一个
    const metadataWithId = {
      artifactId: crypto.randomUUID(),
      ...metadata,
    };
    formData.append('metadata', JSON.stringify(metadataWithId));
    
    // 生成默认的 descriptor
    const defaultNodeId = crypto.randomUUID();
    const descriptor = customDescriptor || {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: vfsFiles && vfsFiles.length > 0 ? [{ 
        id: defaultNodeId, 
        type: 'VFS', 
        name: 'files',
        content: { files: vfsFiles.map(f => ({ path: f.name })) }
      }] : [],
      edges: [],
    };
    formData.append('descriptor', JSON.stringify(descriptor));
    
    // 为 VFS 节点创建 tar.gz 归档
    if (vfsFiles && vfsFiles.length > 0) {
      const nodeId = customDescriptor?.nodes.find(n => n.type === 'VFS')?.id || defaultNodeId;
      const tarGz = await createVfsTarGz(vfsFiles);
      const blob = new Blob([tarGz], { type: 'application/gzip' });
      formData.append(`vfs[${nodeId}]`, blob, 'archive.tar.gz');
    }
    
    return formData;
  }

  describe('POST /artifacts', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const username = `e2euser${Date.now()}`;
      const result = await registerUser(baseUrl, username);
      sessionCookie = result.sessionCookie;
    });

    it('should return 401 when not authenticated', async () => {
      const formData = createFormData({
        type: 'RECIPE',
        name: 'Test Recipe',
        slug: `e2e-test-${Date.now()}`,
        version: '1.0.0',
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        body: formData,
      });

      expect(response.status).toBe(401);
    });

    it('should create artifact successfully', async () => {
      const slug = `e2e-test-artifact-${Date.now()}`;
      const formData = createFormData({
        type: 'RECIPE',
        name: 'E2E Test Recipe',
        slug,
        version: '1.0.0',
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
      const data = await response.json() as { message: string; artifact: { id: string; name: string; slug: string; type: string } };
      expect(data.message).toBe('Artifact saved successfully');
      expect(data.artifact.name).toBe('E2E Test Recipe');
      expect(data.artifact.slug).toBe(slug);
      expect(data.artifact.type).toBe('RECIPE');
    });

    it('should create artifact with files', async () => {
      const slug = `e2e-test-with-files-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          type: 'PROMPT',
          name: 'E2E Prompt Pack',
          slug,
          version: '1.0.0',
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
            content: { files: [{ path: 'prompt.md', mimeType: 'text/markdown' }] }
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
      const data = await response.json() as { message: string; artifact: { id: string; slug: string } };
      expect(data.artifact.slug).toBe(slug);

      // Get the artifact graph to find the node ID
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

      // Find the VFS node that contains our file
      const nodeId = graphResponse.data!.nodes[0].id;

      // Verify VFS archive is accessible via new /archive endpoint
      const archiveResponse = await fetch(`${baseUrl}/artifacts/${data.artifact.id}/nodes/${nodeId}/archive`);
      expect(archiveResponse.status).toBe(200);
      expect(archiveResponse.headers.get('content-type')).toBe('application/gzip');
      
      // Verify we got a valid gzip file
      const archiveBuffer = await archiveResponse.arrayBuffer();
      expect(archiveBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should return 400 for missing required fields', async () => {
      const formData = createFormData({
        type: 'RECIPE',
        name: 'Incomplete',
        // Missing slug and version
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
      expect(data.error).toContain('required');
    });

    it('should return 400 for invalid slug format', async () => {
      const formData = createFormData({
        type: 'RECIPE',
        name: 'Invalid Slug',
        slug: 'INVALID SLUG',
        version: '1.0.0',
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
      expect(data.error).toContain('slug');
    });

    it('should return 400 for invalid version format', async () => {
      const formData = createFormData({
        type: 'RECIPE',
        name: 'Invalid Version',
        slug: `invalid-version-${Date.now()}`,
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
      expect(data.error).toContain('semver');
    });

    it('should return 400 for VFS node without files array in content', async () => {
      const slug = `vfs-no-files-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'VFS Without Files',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [{ 
          id: vfsNodeId, 
          type: 'VFS', 
          name: 'invalid-vfs',
          // Invalid content - missing 'files' array, has random projectId instead
          content: { projectId: 'some-random-id' }
        }],
        edges: [],
      }));

      // Add a dummy archive so it doesn't fail on missing archive
      const dummyArchive = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);
      const archiveBlob = new Blob([dummyArchive], { type: 'application/gzip' });
      formData.append(`vfs[${vfsNodeId}]`, archiveBlob, 'archive.tar.gz');

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('files');
    });

    it('should return 400 for VFS node with invalid files array item', async () => {
      const slug = `vfs-invalid-file-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'VFS With Invalid File',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [{ 
          id: vfsNodeId, 
          type: 'VFS', 
          name: 'invalid-vfs',
          // Invalid content - files array item missing 'path'
          content: { files: [{ name: 'file.txt' }] }
        }],
        edges: [],
      }));

      const dummyArchive = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);
      const archiveBlob = new Blob([dummyArchive], { type: 'application/gzip' });
      formData.append(`vfs[${vfsNodeId}]`, archiveBlob, 'archive.tar.gz');

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
      const slug = `input-no-blocks-${Date.now()}`;
      const inputNodeId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Input Without Blocks',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [{ 
          id: inputNodeId, 
          type: 'INPUT', 
          name: 'invalid-input',
          // Invalid content - missing 'blocks' array
          content: { text: 'some text' }
        }],
        edges: [],
      }));

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

    it('should return 400 for GENERATED node without inputRef', async () => {
      const slug = `generated-no-inputref-${Date.now()}`;
      const generatedNodeId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Generated Without InputRef',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [{ 
          id: generatedNodeId, 
          type: 'GENERATED', 
          name: 'invalid-generated',
          // Invalid content - missing 'inputRef'
          content: { blocks: [] }
        }],
        edges: [],
      }));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('inputRef');
    });

    it('should return 409 for duplicate slug from same user', async () => {
      const slug = `duplicate-test-${Date.now()}`;
      
      // Create first artifact
      const formData1 = createFormData({
        type: 'RECIPE',
        name: 'First',
        slug,
        version: '1.0.0',
      });

      const response1 = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData1,
      });
      expect(response1.status).toBe(200);

      // Try to create second artifact with same slug
      const formData2 = createFormData({
        type: 'GAME',
        name: 'Second',
        slug,
        version: '1.0.0',
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
      expect(data.error).toContain('slug already exists');
    });

    it('should create artifact with all optional fields', async () => {
      const slug = `full-artifact-${Date.now()}`;
      const formData = createFormData({
        type: 'ASSET_PACK',
        name: 'Full Asset Pack',
        slug,
        version: '2.0.0-beta',
        description: 'A complete asset pack',
        visibility: 'PRIVATE',
        thumbnailUrl: 'https://example.com/thumb.png',
        license: 'MIT',
        repositoryUrl: 'https://github.com/example/repo',
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
      const data = await response.json() as { artifact: { type: string; name: string; visibility: string; license: string; tags?: { slug: string }[] } };
      expect(data.artifact.type).toBe('ASSET_PACK');
      expect(data.artifact.name).toBe('Full Asset Pack');
      expect(data.artifact.visibility).toBe('PRIVATE');
      expect(data.artifact.license).toBe('MIT');
      expect(data.artifact.tags).toHaveLength(2);
    });

    it('should create artifact with homepage markdown', async () => {
      const slug = `homepage-artifact-${Date.now()}`;
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Homepage Recipe',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      }));
      
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

    describe('Update artifact (with artifactId)', () => {
      it('should update artifact successfully when artifactId is provided', async () => {
        const slug = `update-test-${Date.now()}`;
        
        // First create an artifact
        const formDataForCreate = createFormData({
          type: 'RECIPE',
          name: 'Original Name',
          slug,
          version: '1.0.0',
          description: 'Original description',
        });

        const createResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForCreate,
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json() as { artifact: { id: string } };
        const artifactId = createData.artifact.id;

        // Now update the artifact
        const formDataForUpdate = createFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated Name',
          slug,
          version: '2.0.0',
          description: 'Updated description',
        });

        const updateResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForUpdate,
        });

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json() as { message: string; artifact: { id: string; name: string; description?: string } };
        expect(updateData.message).toBe('Artifact saved successfully');
        expect(updateData.artifact.id).toBe(artifactId);
        expect(updateData.artifact.name).toBe('Updated Name');
      });

      it('should create new artifact when artifactId does not exist in database', async () => {
        const newArtifactId = crypto.randomUUID();
        const formData = createFormData({
          artifactId: newArtifactId,
          type: 'RECIPE',
          name: 'New Artifact',
          slug: `new-artifact-${Date.now()}`,
          version: '1.0.0',
        });

        const response = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formData,
        });

        expect(response.status).toBe(200);
        const data = await response.json() as { artifact: { id: string; name: string } };
        expect(data.artifact.id).toBe(newArtifactId);
        expect(data.artifact.name).toBe('New Artifact');
      });

      it('should return 403 when trying to update artifact owned by another user', async () => {
        const slug = `update-other-user-${Date.now()}`;
        
        // Create artifact with current user
        const formDataForCreate = createFormData({
          type: 'RECIPE',
          name: 'Original',
          slug,
          version: '1.0.0',
        });

        const createResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForCreate,
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json() as { artifact: { id: string } };
        const artifactId = createData.artifact.id;

        // Register a different user
        const differentUser = `differentuser${Date.now()}`;
        const { sessionCookie: differentCookie } = await registerUser(baseUrl, differentUser);

        // Try to update with different user
        const formDataForUpdate = createFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Hacked Name',
          slug,
          version: '2.0.0',
        });

        const updateResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: differentCookie,
          },
          body: formDataForUpdate,
        });

        expect(updateResponse.status).toBe(403);
        const data = await updateResponse.json() as { error: string };
        expect(data.error).toContain('permission');
      });

      it('should return 409 when updated slug conflicts with another artifact', async () => {
        const timestamp = Date.now();
        const slug1 = `conflict-slug1-${timestamp}`;
        const slug2 = `conflict-slug2-${timestamp}`;
        
        // Create first artifact
        const formDataForFirst = createFormData({
          type: 'RECIPE',
          name: 'First',
          slug: slug1,
          version: '1.0.0',
        });

        await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForFirst,
        });

        // Create second artifact
        const formDataForSecond = createFormData({
          type: 'RECIPE',
          name: 'Second',
          slug: slug2,
          version: '1.0.0',
        });

        const createResponse2 = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForSecond,
        });
        const createData2 = await createResponse2.json() as { artifact: { id: string } };
        const artifactId2 = createData2.artifact.id;

        // Try to update second artifact with first artifact's slug
        const formDataForUpdate = createFormData({
          artifactId: artifactId2,
          type: 'RECIPE',
          name: 'Second Updated',
          slug: slug1, // Conflict!
          version: '2.0.0',
        });

        const updateResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForUpdate,
        });

        expect(updateResponse.status).toBe(409);
        const data = await updateResponse.json() as { error: string };
        expect(data.error).toContain('slug already exists');
      });

      it('should allow updating slug to the same value', async () => {
        const slug = `same-slug-test-${Date.now()}`;
        
        // Create artifact
        const formDataForCreate = createFormData({
          type: 'RECIPE',
          name: 'Original',
          slug,
          version: '1.0.0',
        });

        const createResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForCreate,
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json() as { artifact: { id: string } };
        const artifactId = createData.artifact.id;

        // Update with same slug
        const formDataForUpdate = createFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated Name',
          slug, // Same slug
          version: '2.0.0',
        });

        const updateResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForUpdate,
        });

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json() as { artifact: { name: string; slug: string } };
        expect(updateData.artifact.name).toBe('Updated Name');
        expect(updateData.artifact.slug).toBe(slug);
      });

      it('should preserve stats when updating artifact', async () => {
        const slug = `stats-test-${Date.now()}`;
        
        // Create artifact
        const formDataForCreate = createFormData({
          type: 'RECIPE',
          name: 'Original',
          slug,
          version: '1.0.0',
        });

        const createResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForCreate,
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json() as { artifact: { id: string; viewCount: number; likeCount: number } };
        const artifactId = createData.artifact.id;
        const initialViewCount = createData.artifact.viewCount;
        const initialLikeCount = createData.artifact.likeCount;

        // Update artifact
        const formDataForUpdate = createFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated',
          slug,
          version: '2.0.0',
        });

        const updateResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
          },
          body: formDataForUpdate,
        });

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json() as { artifact: { viewCount: number; likeCount: number } };
        expect(updateData.artifact.viewCount).toBe(initialViewCount);
        expect(updateData.artifact.likeCount).toBe(initialLikeCount);
      });
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
      const slug = `vfs-node-detail-test-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          type: 'RECIPE',
          name: 'VFS Node Detail Test',
          slug,
          version: '1.0.0',
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
            content: { files: [
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

      // Fetch node detail
      const nodeDetailResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${vfsNodeId}?version=latest`
      );
      
      expect(nodeDetailResponse.status).toBe(200);
      
      const nodeDetail = await nodeDetailResponse.json() as Record<string, unknown>;
      expect(nodeDetail.id).toBe(vfsNodeId);
      expect(nodeDetail.type).toBe('VFS');
      expect(nodeDetail.name).toBe('test-vfs');
      expect(nodeDetail.version).toBeDefined();
      expect((nodeDetail.version as Record<string, unknown>).commitHash).toBeDefined();
      
      // VFS node should have content with files array
      expect(nodeDetail.content).toBeDefined();
      // content should be VfsNodeContent with files
      const content = nodeDetail.content as { files?: { path: string; size?: number; mimeType?: string }[] };
      expect(content.files).toBeDefined();
      expect(Array.isArray(content.files)).toBe(true);
      expect(content.files!.length).toBe(2);
      
      // Verify file structure
      const file1 = content.files!.find(f => f.path === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1!.mimeType).toBe('text/plain');
      
      const file2 = content.files!.find(f => f.path === 'subdir/file2.txt');
      expect(file2).toBeDefined();
    });

    it('should return node detail for non-VFS node', async () => {
      const slug = `input-node-detail-test-${Date.now()}`;
      const inputNodeId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Input Node Detail Test',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [{ 
          id: inputNodeId, 
          type: 'INPUT', 
          name: 'test-input',
          content: { blocks: [] }
        }],
        edges: [],
      }));

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Fetch node detail
      const nodeDetailResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${inputNodeId}?version=latest`
      );
      
      expect(nodeDetailResponse.status).toBe(200);
      
      const nodeDetail = await nodeDetailResponse.json() as Record<string, unknown>;
      expect(nodeDetail.id).toBe(inputNodeId);
      expect(nodeDetail.type).toBe('INPUT');
      expect(nodeDetail.name).toBe('test-input');
      expect(nodeDetail.content).toBeDefined();
    });

    it('should return 404 for non-existent node', async () => {
      const slug = `non-existent-node-test-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          type: 'RECIPE',
          name: 'Non-existent Node Test',
          slug,
          version: '1.0.0',
        },
        [{ name: 'file.txt', content: 'test' }],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ id: vfsNodeId, type: 'VFS', name: 'vfs', content: { files: [{ path: 'file.txt' }] } }],
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

      // Fetch non-existent node
      const nonExistentNodeId = crypto.randomUUID();
      const nodeDetailResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${nonExistentNodeId}?version=latest`
      );
      
      expect(nodeDetailResponse.status).toBe(404);
    });

    it('should return 404 for non-existent artifact', async () => {
      const fakeArtifactId = crypto.randomUUID();
      const fakeNodeId = crypto.randomUUID();
      const nodeDetailResponse = await fetch(
        `${baseUrl}/artifacts/${fakeArtifactId}/nodes/${fakeNodeId}?version=latest`
      );
      
      expect(nodeDetailResponse.status).toBe(404);
    });
  });

  describe('GET /artifacts/:artifactId/nodes/:nodeId/archive', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const username = `archiveuser${Date.now()}`;
      const result = await registerUser(baseUrl, username);
      sessionCookie = result.sessionCookie;
    });

    it('should return tar.gz archive for VFS node', async () => {
      const slug = `vfs-archive-test-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          type: 'RECIPE',
          name: 'VFS Archive Test',
          slug,
          version: '1.0.0',
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
            content: { files: [{ path: 'file1.txt' }, { path: 'file2.txt' }] }
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

      // Fetch archive
      const archiveResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${vfsNodeId}/archive`
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
      const slug = `non-vfs-archive-test-${Date.now()}`;
      const inputNodeId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Non-VFS Test',
        slug,
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [{ 
          id: inputNodeId, 
          type: 'INPUT', 
          name: 'input',
          content: { blocks: [] }
        }],
        edges: [],
      }));

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Try to fetch archive for INPUT node (should fail with 400 Bad Request)
      // 400 is returned because the node exists but is not a VFS type
      const archiveResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${inputNodeId}/archive`
      );
      
      expect(archiveResponse.status).toBe(400);
    });

    it('should return 404 for non-existent node', async () => {
      const slug = `archive-nonexistent-${Date.now()}`;
      const formData = createFormData({
        type: 'RECIPE',
        name: 'Test',
        slug,
        version: '1.0.0',
      });

      const createResponse = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json() as { artifact: { id: string } };

      // Try to fetch archive for non-existent node
      const archiveResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/non-existent-node/archive`
      );
      
      expect(archiveResponse.status).toBe(404);
    });

    it('should require auth for private artifact archive', async () => {
      const slug = `private-archive-test-${Date.now()}`;
      const vfsNodeId = crypto.randomUUID();
      const formData = await createFormDataWithVfs(
        {
          type: 'RECIPE',
          name: 'Private VFS Test',
          slug,
          version: '1.0.0',
          visibility: 'PRIVATE',
        },
        [{ name: 'secret.txt', content: 'secret content' }],
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: [{ 
            id: vfsNodeId, 
            type: 'VFS', 
            name: 'files',
            content: { files: [{ path: 'secret.txt' }] }
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

      // Try to fetch without auth
      const archiveResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${vfsNodeId}/archive`
      );
      
      expect(archiveResponse.status).toBe(401);

      // Should work with auth
      const authArchiveResponse = await fetch(
        `${baseUrl}/artifacts/${createData.artifact.id}/nodes/${vfsNodeId}/archive`,
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

    async function createArtifactWithHomepage(visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC'): Promise<string> {
      const slug = `homepage-test-${Date.now()}`;
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Test Artifact',
        slug,
        version: '1.0.0',
        visibility,
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      }));
      
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
      const artifactId = await createArtifactWithHomepage('PUBLIC');
      
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

    it('should return 401 for unlisted artifact without auth', async () => {
      const artifactId = await createArtifactWithHomepage('UNLISTED');
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`);
      
      expect(response.status).toBe(401);
    });

    it('should return homepage for unlisted artifact with auth', async () => {
      const artifactId = await createArtifactWithHomepage('UNLISTED');
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`, {
        headers: {
          Cookie: sessionCookie,
        },
      });
      
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<h1>Test Homepage</h1>');
    });

    it('should return 401 for private artifact without auth', async () => {
      const artifactId = await createArtifactWithHomepage('PRIVATE');
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`);
      
      expect(response.status).toBe(401);
    });

    it('should return homepage for private artifact with owner auth', async () => {
      const artifactId = await createArtifactWithHomepage('PRIVATE');
      
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
      const artifactId = await createArtifactWithHomepage('PRIVATE');
      
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
