import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';

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
            'type.include': ['RECIPE', 'GAME'],
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      // 所有返回的 artifact 应该是 RECIPE 或 GAME 类型
      for (const artifact of data!.artifacts) {
        expect(['RECIPE', 'GAME']).toContain(artifact.type);
      }
    });

    it('should accept type exclude parameters', async () => {
      const { data, error, response } = await client.GET('/artifacts', {
        params: {
          query: {
            'type.exclude': ['PROMPT'],
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      // 所有返回的 artifact 不应该是 PROMPT 类型
      for (const artifact of data!.artifacts) {
        expect(artifact.type).not.toBe('PROMPT');
      }
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
        expect(artifact.type).toBeDefined();
        expect(artifact.name).toBeDefined();
        expect(artifact.slug).toBeDefined();
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
            'type.include': ['RECIPE'],
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.pagination.limit).toBeLessThanOrEqual(5);
      
      // 所有返回的应该是 RECIPE 类型
      for (const artifact of data!.artifacts) {
        expect(artifact.type).toBe('RECIPE');
      }
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
            expect(parent.id).toBeDefined();
            expect(parent.lineageType).toBeDefined();
            expect(parent.createdAt).toBeDefined();
            expect(parent.artifact).toBeDefined();
            expect(parent.artifact.id).toBeDefined();
            expect(parent.artifact.name).toBeDefined();
            expect(parent.artifact.slug).toBeDefined();
            expect(parent.artifact.type).toBeDefined();
            expect(parent.artifact.visibility).toBeDefined();
          }
          for (const child of lineageData.children) {
            expect(child.id).toBeDefined();
            expect(child.lineageType).toBeDefined();
            expect(child.createdAt).toBeDefined();
            expect(child.artifact).toBeDefined();
          }
        }
      }
    });
  });

  describe('POST /artifacts', () => {
    let authToken: string;

    async function registerAndLogin(username: string): Promise<string> {
      const registerResponse = await client.POST('/auth/register', {
        body: {
          username,
          email: `${username}@example.com`,
          password: 'password123',
        },
      });
      return registerResponse.data?.token ?? '';
    }

    function createFormData(
      metadata: Record<string, unknown>, 
      files?: { name: string; content: string }[],
      customDescriptor?: { version: number; nodes: { id: string; type?: string; name?: string; external?: boolean }[]; edges: { source: string; target: string }[]; exportedAt?: string }
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
        nodes: files && files.length > 0 ? [{ id: defaultNodeId, type: 'VFS', name: 'files' }] : [],
        edges: [],
      };
      formData.append('descriptor', JSON.stringify(descriptor));
      
      if (files) {
        const nodeId = customDescriptor?.nodes[0]?.id || defaultNodeId;
        for (const file of files) {
          const blob = new Blob([file.content], { type: 'text/plain' });
          formData.append(`nodes[${nodeId}]`, blob, file.name);
        }
      }
      
      return formData;
    }

    beforeEach(async () => {
      const username = `e2euser${Date.now()}`;
      authToken = await registerAndLogin(username);
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
          Authorization: `Bearer ${authToken}`,
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
      const formData = createFormData(
        {
          type: 'PROMPT',
          name: 'E2E Prompt Pack',
          slug,
          version: '1.0.0',
        },
        [
          { name: 'prompt.md', content: '# Test Prompt\nThis is a test prompt.' },
        ]
      );

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
        } as Record<string, string>,
      });
      expect(graphResponse.response.status).toBe(200);
      expect(graphResponse.data?.nodes).toBeDefined();
      expect(graphResponse.data!.nodes.length).toBeGreaterThan(0);

      // Find the VFS node that contains our file
      const nodeId = graphResponse.data!.nodes[0].id;

      // Verify file is accessible via new node-based path
      const fileResponse = await fetch(`${baseUrl}/artifacts/${data.artifact.id}/nodes/${nodeId}/files/prompt.md`);
      expect(fileResponse.status).toBe(200);
      const fileContent = await fileResponse.text();
      expect(fileContent).toBe('# Test Prompt\nThis is a test prompt.');
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
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('semver');
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
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
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
        isPrerelease: true,
        tags: ['test', 'e2e'],
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
          },
          body: formDataForCreate,
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json() as { artifact: { id: string } };
        const artifactId = createData.artifact.id;

        // Register a different user
        const differentUser = `differentuser${Date.now()}`;
        const registerResponse = await client.POST('/auth/register', {
          body: {
            username: differentUser,
            email: `${differentUser}@example.com`,
            password: 'password123',
          },
        });
        const differentToken = registerResponse.data?.token ?? '';

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
            Authorization: `Bearer ${differentToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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
            Authorization: `Bearer ${authToken}`,
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

  describe('GET /artifacts/:artifactId/homepage', () => {
    let authToken: string;

    beforeEach(async () => {
      // 先注册并登录获取 token
      const timestamp = Date.now();
      const registerResponse = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: `homepageuser${timestamp}`,
          email: `homepageuser${timestamp}@example.com`,
          password: 'testpassword123',
        }),
      });
      const registerData = await registerResponse.json() as { token: string };
      authToken = registerData.token;
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
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
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
      const registerResponse = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: `differentuser${timestamp}`,
          email: `differentuser${timestamp}@example.com`,
          password: 'testpassword123',
        }),
      });
      const registerData = await registerResponse.json() as { token: string };
      const differentToken = registerData.token;
      
      const response = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`, {
        headers: {
          Authorization: `Bearer ${differentToken}`,
        },
      });
      
      expect(response.status).toBe(403);
    });
  });
});
