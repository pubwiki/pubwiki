import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import type { CreateProjectMetadata, CreateProjectRole, CreateProjectPage } from '@pubwiki/api';

describe('E2E: Projects API', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    client = createApiClient(baseUrl);

    // 创建测试用户并获取 token
    const username = `project_test_${Date.now()}`;
    const { data } = await client.POST('/auth/register', {
      body: {
        username,
        email: `${username}@example.com`,
        password: 'password123',
      },
    });
    authToken = data!.token;
    testUserId = data!.user.id;
  });

  afterAll(async () => {
    await worker.stop();
  });

  // Helper function to create JSON body for project creation
  function createProjectBody(
    metadata: CreateProjectMetadata,
    pages?: CreateProjectPage[]
  ): CreateProjectMetadata & { pages?: CreateProjectPage[] } {
    return pages ? { ...metadata, pages } : metadata;
  }

  // Helper to create artifact via fetch (for tests that need artifacts)
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
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
    const data = await response.json() as { artifact: { id: string } };
    return data.artifact.id;
  }

  describe('POST /projects', () => {
    it('should create a project with basic metadata', async () => {
      const slug = `test-project-${Date.now()}`;
      const body = createProjectBody({
        name: 'Test Project',
        slug,
        topic: 'testing',
        description: 'A test project',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { project: { name: string; slug: string; topic: string; visibility: string; owner: { id: string } } };
      expect(data.project.name).toBe('Test Project');
      expect(data.project.slug).toBe(slug);
      expect(data.project.topic).toBe('testing');
      expect(data.project.visibility).toBe('PUBLIC');
      expect(data.project.owner.id).toBe(testUserId);
    });

    it('should create a project with roles', async () => {
      const slug = `project-with-roles-${Date.now()}`;
      const body = createProjectBody({
        name: 'Project With Roles',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Admin', description: 'Administrator role' },
          { name: 'Editor', description: 'Editor role' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { project: { roles: { name: string }[] } };
      expect(data.project.roles).toHaveLength(2);
      expect(data.project.roles.map((r) => r.name).sort()).toEqual(['Admin', 'Editor']);
    });

    it('should create a project with roles in tree structure', async () => {
      const slug = `project-with-role-tree-${Date.now()}`;
      const body = createProjectBody({
        name: 'Project With Role Tree',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Root Role', description: 'Root role' },
          { name: 'Child Role 1', parentName: 'Root Role' },
          { name: 'Child Role 2', parentName: 'Root Role' },
          { name: 'Grandchild', parentName: 'Child Role 1' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { project: { roles: { id: string; name: string; parentRoleId: string | null }[] } };
      expect(data.project.roles).toHaveLength(4);

      // Verify parent-child relationships
      const roles = data.project.roles;
      const rootRole = roles.find((r) => r.name === 'Root Role');
      const child1 = roles.find((r) => r.name === 'Child Role 1');
      const child2 = roles.find((r) => r.name === 'Child Role 2');
      const grandchild = roles.find((r) => r.name === 'Grandchild');

      expect(rootRole).toBeDefined();
      expect(rootRole!.parentRoleId).toBeNull();

      expect(child1).toBeDefined();
      expect(child1!.parentRoleId).toBe(rootRole!.id);

      expect(child2).toBeDefined();
      expect(child2!.parentRoleId).toBe(rootRole!.id);

      expect(grandchild).toBeDefined();
      expect(grandchild!.parentRoleId).toBe(child1!.id);
    });

    it('should create a project with artifacts and set isOfficial to true', async () => {
      // First, create an artifact to link
      const artifactId = await createTestArtifact();

      const slug = `project-with-artifacts-${Date.now()}`;
      const body = createProjectBody({
        name: 'Project With Artifacts',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        artifacts: [{ artifactId, roleName: 'Default Role' }],
        roles: [
          { name: 'Default Role' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { project: { artifacts: { artifact: { id: string }; isOfficial: boolean }[] } };
      expect(data.project.artifacts).toHaveLength(1);
      expect(data.project.artifacts[0].artifact.id).toBe(artifactId);
      expect(data.project.artifacts[0].isOfficial).toBe(true);
    });

    it('should create a project with all features combined', async () => {
      // Create artifacts to link
      const artifact1Id = await createTestArtifact();
      const artifact2Id = await createTestArtifact();

      const slug = `full-project-${Date.now()}`;
      const body = createProjectBody({
        name: 'Full Featured Project',
        slug,
        topic: 'advanced',
        description: 'A project with all features',
        visibility: 'PUBLIC',
        license: 'MIT',
        coverUrls: ['https://example.com/cover.jpg'],
        artifacts: [
          { artifactId: artifact1Id, roleName: 'User' },
          { artifactId: artifact2Id, roleName: 'User' },
        ],
        roles: [
          { name: 'Administrator' },
          { name: 'Moderator', parentName: 'Administrator' },
          { name: 'User', parentName: 'Moderator' },
        ],
        pages: [
          { name: 'Homepage', icon: '🏠', content: '<h1>Welcome</h1>' },
          { name: 'About', icon: '📖', content: '<h1>About</h1>' },
        ],
        homepageIndex: 0,
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { 
        project: { 
          name: string; 
          description: string; 
          license: string; 
          coverUrls: string[]; 
          artifacts: { isOfficial: boolean }[]; 
          roles: { name: string }[];
          pages: { name: string; icon: string; order: number }[];
          homepageId: string | null;
        } 
      };
      expect(data.project.name).toBe('Full Featured Project');
      expect(data.project.description).toBe('A project with all features');
      expect(data.project.license).toBe('MIT');
      expect(data.project.coverUrls).toEqual(['https://example.com/cover.jpg']);
      expect(data.project.artifacts).toHaveLength(2);
      expect(data.project.artifacts.every((a) => a.isOfficial === true)).toBe(true);
      expect(data.project.roles).toHaveLength(3);
      expect(data.project.pages).toHaveLength(2);
      expect(data.project.homepageId).not.toBeNull();
    });

    it('should return 400 for invalid parentName reference', async () => {
      const slug = `invalid-parent-${Date.now()}`;
      const body = createProjectBody({
        name: 'Invalid Parent Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Child Role', parentName: 'Nonexistent Parent' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('not found');
    });

    it('should return 400 for circular role reference', async () => {
      const slug = `circular-ref-${Date.now()}`;
      const body = createProjectBody({
        name: 'Circular Reference Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Role 1', parentName: 'Role 2' },
          { name: 'Role 2', parentName: 'Role 1' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(400);
    });

    it('should return 401 when not authenticated', async () => {
      const slug = `unauth-project-${Date.now()}`;
      const body = createProjectBody({
        name: 'Unauthorized Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(401);
    });

    it('should return 409 for duplicate slug', async () => {
      const slug = `duplicate-slug-${Date.now()}`;
      
      // Create first project
      const body1 = createProjectBody({
        name: 'First Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
      });
      await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body1),
      });

      // Try to create second project with same slug
      const body2 = createProjectBody({
        name: 'Second Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
      });
      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body2),
      });

      expect(response.status).toBe(409);
    });

    it('should return 400 when required fields are missing', async () => {
      const body = createProjectBody({
        name: 'Missing Fields Project',
        // missing slug and topic
      } as CreateProjectMetadata);

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(400);
    });

    it('should create a project with pages', async () => {
      const slug = `project-with-pages-${Date.now()}`;
      const body = createProjectBody({
        name: 'Project With Pages',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
        pages: [
          { name: 'Home', icon: '🏠', content: '<h1>Welcome to our project</h1>' },
          { name: 'Documentation', icon: '📚', content: '<h1>Documentation</h1><p>Learn more...</p>' },
          { name: 'FAQ', icon: '❓', content: '<h1>FAQ</h1>' },
        ],
        homepageIndex: 0,
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { 
        project: { 
          pages: { id: string; name: string; icon: string; order: number }[];
          homepageId: string | null;
        } 
      };
      expect(data.project.pages).toHaveLength(3);
      expect(data.project.pages.map((p) => p.name).sort()).toEqual(['Documentation', 'FAQ', 'Home']);
      expect(data.project.homepageId).not.toBeNull();
      // The homepage should be the page marked with isHomepage: true
      const homePage = data.project.pages.find(p => p.name === 'Home');
      expect(homePage).toBeDefined();
      expect(data.project.homepageId).toBe(homePage!.id);
    });

    it('should return 400 when homepageIndex is out of range', async () => {
      const slug = `invalid-homepage-${Date.now()}`;
      const body = createProjectBody({
        name: 'Invalid Homepage Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
        pages: [
          { name: 'Home 1', content: '<h1>Home 1</h1>' },
          { name: 'Home 2', content: '<h1>Home 2</h1>' },
        ],
        homepageIndex: 10, // Out of range
      });

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /projects', () => {
    it('should return project list with pagination', async () => {
      const { data, error, response } = await client.GET('/projects');

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.projects).toBeDefined();
      expect(Array.isArray(data!.projects)).toBe(true);
      expect(data!.pagination).toBeDefined();
      expect(data!.pagination.page).toBeGreaterThanOrEqual(1);
      expect(data!.pagination.limit).toBeGreaterThanOrEqual(1);
    });

    it('should accept pagination parameters', async () => {
      const { data, error, response } = await client.GET('/projects', {
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

    it('should accept topic filter parameter', async () => {
      const { data, error, response } = await client.GET('/projects', {
        params: {
          query: {
            topic: 'test-topic',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      // All returned projects should have the specified topic
      for (const project of data!.projects) {
        expect(project.topic).toBe('test-topic');
      }
    });

    it('should accept sort parameters', async () => {
      const { data, error, response } = await client.GET('/projects', {
        params: {
          query: {
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should return 400 for invalid sortBy value', async () => {
      const { data, error, response } = await client.GET('/projects', {
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

    it('should return 400 for invalid sortOrder value', async () => {
      const { data, error, response } = await client.GET('/projects', {
        params: {
          query: {
            // @ts-expect-error - testing invalid value
            sortOrder: 'invalid',
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Invalid sortOrder');
    });
  });

  describe('GET /projects/{projectId}/pages/{pageId}', () => {
    it('should return page content for public project', async () => {
      // Create a project with pages first
      const slug = `pages-test-${Date.now()}`;
      const body = createProjectBody({
        name: 'Pages Test Project',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
        pages: [
          { name: 'Test Page', icon: '📄', content: '<h1>Test Page Content</h1>' },
        ],
        homepageIndex: 0,
      });

      const createResponse = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      expect(createResponse.status).toBe(201);
      const createData = await createResponse.json() as { project: { id: string; pages: { id: string }[] } };
      const projectId = createData.project.id;
      const pageId = createData.project.pages[0].id;

      // Get the page content
      const { data, error, response } = await client.GET('/projects/{projectId}/pages/{pageId}', {
        params: {
          path: { projectId, pageId },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.content).toBe('<h1>Test Page Content</h1>');
      expect(data!.name).toBe('Test Page');
      expect(data!.icon).toBe('📄');
    });

    it('should return 404 for non-existent project', async () => {
      const { data, error, response } = await client.GET('/projects/{projectId}/pages/{pageId}', {
        params: {
          path: {
            projectId: '00000000-0000-0000-0000-000000000000',
            pageId: '00000000-0000-0000-0000-000000000001',
          },
        },
      });

      expect(response.status).toBe(404);
      expect(error).toBeDefined();
    });

    it('should return 404 for non-existent page', async () => {
      // Create a project first
      const slug = `page-not-found-test-${Date.now()}`;
      const body = createProjectBody({
        name: 'Page Not Found Test',
        slug,
        topic: 'testing',
        visibility: 'PUBLIC',
        roles: [
          { name: 'Default Role' },
        ],
      });

      const createResponse = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const createData = await createResponse.json() as { project: { id: string } };
      const projectId = createData.project.id;

      const { data, error, response } = await client.GET('/projects/{projectId}/pages/{pageId}', {
        params: {
          path: { projectId, pageId: '00000000-0000-0000-0000-000000000000' },
        },
      });

      expect(response.status).toBe(404);
      expect(error).toBeDefined();
    });
  });
});
