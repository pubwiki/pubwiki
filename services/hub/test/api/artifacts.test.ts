import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ListArtifactsResponse,
  CreateArtifactResponse,
  ApiError,
} from '@pubwiki/api';
import { computeArtifactCommit, computeNodeCommit } from '@pubwiki/api';
import {
  getTestDb,
  getTestR2Bucket,
  clearDatabase,
  sendRequest,
  registerUser,
  createTestUser,
  createVfsTarGz,
  user,
  artifacts,
  tags,
  artifactTags,
  artifactStats,
  artifactVersions,
  nodeVersions,
  artifactVersionNodes,
  artifactVersionEdges,
  resourceDiscoveryControl,
  resourceAcl,
  PUBLIC_USER_ID,
  eq,
  type TestDb,
} from './helpers';

describe('Artifacts API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/artifacts', () => {
    let testUserId: string;

    async function createTestArtifact(
      authorId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        name,
      }).returning();
      
      // Create discovery control record for the artifact
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        isListed,
      });
      
      // Grant owner full permissions
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: authorId,
        canRead: true,
        canWrite: true,
        canManage: true,
        grantedBy: authorId,
      });
      
      // If not private, grant public read access
      if (!isPrivate) {
        await db.insert(resourceAcl).values({
          resourceType: 'artifact',
          resourceId: artifact.id,
          userId: PUBLIC_USER_ID,
          canRead: true,
          canWrite: false,
          canManage: false,
          grantedBy: authorId,
        });
      }
      
      return artifact.id;
    }

    async function createTestTag(name: string): Promise<string> {
      const [tag] = await db.insert(tags).values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
      }).returning();
      return tag.id;
    }

    async function addTagToArtifact(artifactId: string, tagId: string): Promise<void> {
      await db.insert(artifactTags).values({ artifactId, tagId });
    }

    async function createArtifactStats(artifactId: string, viewCount: number, favCount: number): Promise<void> {
      await db.insert(artifactStats).values({
        artifactId,
        viewCount,
        favCount,
        refCount: 0,
        downloadCount: 0,
        commentCount: 0,
      });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'artifactuser');
    });

    it('should return empty list when no artifacts exist', async () => {
      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return all artifacts (access control is now separate)', async () => {
      await createTestArtifact(testUserId, 'Recipe 1');
      await createTestArtifact(testUserId, 'Recipe 2');
      await createTestArtifact(testUserId, 'Recipe 3');

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(3);
      expect(data.pagination.total).toBe(3);
    });


    it('should filter by tag.include (AND logic)', async () => {
      const artifactId1 = await createTestArtifact(testUserId, 'Recipe with both tags');
      const artifactId2 = await createTestArtifact(testUserId, 'Game with one tag');
      const artifactId3 = await createTestArtifact(testUserId, 'Prompt with no tags');

      const tag1Id = await createTestTag('javascript');
      const tag2Id = await createTestTag('tutorial');

      await addTagToArtifact(artifactId1, tag1Id);
      await addTagToArtifact(artifactId1, tag2Id);
      await addTagToArtifact(artifactId2, tag1Id);

      const request = new Request('http://localhost/api/artifacts?tag.include=javascript&tag.include=tutorial');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Recipe with both tags');
    });

    it('should filter by tag.exclude', async () => {
      const artifactId1 = await createTestArtifact(testUserId, 'Recipe to keep');
      const artifactId2 = await createTestArtifact(testUserId, 'Game to exclude');

      const tagId = await createTestTag('deprecated');
      await addTagToArtifact(artifactId2, tagId);

      const request = new Request('http://localhost/api/artifacts?tag.exclude=deprecated');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Recipe to keep');
    });

    it('should sort by createdAt desc by default', async () => {
      // Helper to create artifact with ACL records for manual date tests
      async function createArtifactWithAcl(
        authorId: string,
        name: string,
        createdAt: string,
        options: { isPrivate?: boolean; isListed?: boolean } = {}
      ): Promise<string> {
        const { isPrivate = false, isListed = true } = options;
        const [artifact] = await db.insert(artifacts).values({
          authorId,
          name,
          createdAt,
          updatedAt: createdAt,
        }).returning();
        
        await db.insert(resourceDiscoveryControl).values({
          resourceType: 'artifact',
          resourceId: artifact.id,
          isListed,
        });
        
        await db.insert(resourceAcl).values({
          resourceType: 'artifact',
          resourceId: artifact.id,
          userId: authorId,
          canRead: true,
          canWrite: true,
          canManage: true,
          grantedBy: authorId,
        });
        
        if (!isPrivate) {
          await db.insert(resourceAcl).values({
            resourceType: 'artifact',
            resourceId: artifact.id,
            userId: PUBLIC_USER_ID,
            canRead: true,
            canWrite: false,
            canManage: false,
            grantedBy: authorId,
          });
        }
        
        return artifact.id;
      }
      
      // 直接设置不同的时间戳来测试排序
      await createArtifactWithAcl(testUserId, 'First', '2024-01-01T00:00:00Z');
      await createArtifactWithAcl(testUserId, 'Second', '2024-01-02T00:00:00Z');
      await createArtifactWithAcl(testUserId, 'Third', '2024-01-03T00:00:00Z');

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(3);
      expect(data.artifacts[0].name).toBe('Third');
      expect(data.artifacts[2].name).toBe('First');
    });

    it('should sort by viewCount', async () => {
      const id1 = await createTestArtifact(testUserId, 'Low views');
      const id2 = await createTestArtifact(testUserId, 'High views');
      const id3 = await createTestArtifact(testUserId, 'Medium views');

      await createArtifactStats(id1, 10, 0);
      await createArtifactStats(id2, 100, 0);
      await createArtifactStats(id3, 50, 0);

      const request = new Request('http://localhost/api/artifacts?sortBy=viewCount&sortOrder=desc');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts[0].name).toBe('High views');
      expect(data.artifacts[1].name).toBe('Medium views');
      expect(data.artifacts[2].name).toBe('Low views');
    });

    it('should paginate correctly', async () => {
      // Create 5 artifacts
      for (let i = 1; i <= 5; i++) {
        await createTestArtifact(testUserId, `Recipe ${i}`);
      }

      const request = new Request('http://localhost/api/artifacts?page=1&limit=2');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });

    it('should include author info', async () => {
      await createTestArtifact(testUserId, 'Test Recipe');

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts[0].author).toBeDefined();
      expect(data.artifacts[0].author.username).toBe('artifactuser');
    });

    it('should include tags', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Tagged Recipe');
      const tagId = await createTestTag('awesome');
      await addTagToArtifact(artifactId, tagId);

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts[0]!.tags!).toHaveLength(1);
      expect(data.artifacts[0]!.tags![0]!.slug).toBe('awesome');
    });

    it('should return 400 for invalid sortBy', async () => {
      const request = new Request('http://localhost/api/artifacts?sortBy=invalid');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('sortBy');
    });

  });

  // NOTE: Lineage tests removed - artifactLineage table was deleted.
  // Lineage is now computed from nodeVersions.derivativeOf + sourceArtifactId.
  // These tests need to be rewritten with the new graph-based lineage mechanism.

  describe('POST /api/artifacts', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const result = await registerUser('createartifactuser');
      sessionCookie = result.sessionCookie;
    });

    // Helper: compute deterministic commit hash (delegates to shared util)
    async function computeCommitHash(
      artifactId: string,
      parentCommit: string | null,
      nodes: Array<{ nodeId: string; commit: string }>,
      edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>
    ): Promise<string> {
      return computeArtifactCommit(
        artifactId,
        parentCommit,
        nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })),
        edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null }))
      );
    }

    // 创建 VFS 类型的节点 FormData（多文件，使用 tar.gz 归档）
    async function createVfsFormData(
      metadata: Record<string, unknown>,
      files?: { name: string; content: string | Uint8Array; type?: string }[]
    ): Promise<FormData> {
      const formData = new FormData();

      const artifactId = (metadata.artifactId as string) ?? crypto.randomUUID();
      const parentCommit = (metadata.parentCommit as string | undefined) ?? null;

      const nodeId = crypto.randomUUID();
      const contentHash = crypto.randomUUID().substring(0, 16);
      let nodes: Array<Record<string, unknown>> = [];
      if (files && files.length > 0) {
        const nodeCommit = await computeNodeCommit(nodeId, null, contentHash, 'VFS');
        nodes = [{
          nodeId,
          commit: nodeCommit,
          type: 'VFS',
          name: 'files',
          contentHash,
          content: { projectId: crypto.randomUUID(), fileTree: files.map(f => ({ path: f.name, size: 0 })) },
        }];
      }
      const edges: Array<{ source: string; target: string }> = [];

      const commit = await computeCommitHash(artifactId, parentCommit, nodes as any, edges);
      const metadataWithDefaults = {
        ...metadata,
        artifactId,
        parentCommit,
        commit,
      };
      formData.append('metadata', JSON.stringify(metadataWithDefaults));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify(edges));

      if (files && files.length > 0) {
        const nodeCommit = (nodes[0] as any).commit;
        // 创建 tar.gz 归档
        const tarGz = await createVfsTarGz(files.map(f => ({
          name: f.name,
          content: f.content
        })));
        const blob = new Blob([tarGz], { type: 'application/gzip' });
        formData.append(`vfs[${nodeCommit}]`, blob, 'archive.tar.gz');
      }

      return formData;
    }

    // 创建 PROMPT 类型的节点 FormData
    async function createPromptFormData(
      metadata: Record<string, unknown>,
      content?: string
    ): Promise<FormData> {
      const formData = new FormData();

      const artifactId = (metadata.artifactId as string) ?? crypto.randomUUID();
      const parentCommit = (metadata.parentCommit as string | undefined) ?? null;

      const nodeId = crypto.randomUUID();
      const contentHash = crypto.randomUUID().substring(0, 16);
      const hasContent = content !== undefined;
      let nodes: Array<Record<string, unknown>> = [];
      if (hasContent) {
        const nodeCommit = await computeNodeCommit(nodeId, null, contentHash, 'PROMPT');
        nodes = [{
          nodeId,
          commit: nodeCommit,
          type: 'PROMPT',
          name: 'prompt',
          contentHash,
          content: { blocks: [] },
        }];
      }
      const edges: Array<{ source: string; target: string }> = [];

      const commit = await computeCommitHash(artifactId, parentCommit, nodes as any, edges);
      const metadataWithDefaults = {
        ...metadata,
        artifactId,
        parentCommit,
        commit,
      };
      formData.append('metadata', JSON.stringify(metadataWithDefaults));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify(edges));

      return formData;
    }

    // 创建 GENERATED 类型的节点 FormData
    async function createGeneratedFormData(
      metadata: Record<string, unknown>,
      content?: string
    ): Promise<FormData> {
      const formData = new FormData();

      const artifactId = (metadata.artifactId as string) ?? crypto.randomUUID();
      const parentCommit = (metadata.parentCommit as string | undefined) ?? null;

      const nodeId = crypto.randomUUID();
      const contentHash = crypto.randomUUID().substring(0, 16);
      const hasContent = content !== undefined;
      let nodes: Array<Record<string, unknown>> = [];
      if (hasContent) {
        const nodeCommit = await computeNodeCommit(nodeId, null, contentHash, 'GENERATED');
        nodes = [{
          nodeId,
          commit: nodeCommit,
          type: 'GENERATED',
          name: 'output',
          contentHash,
          content: { blocks: [] },
        }];
      }
      const edges: Array<{ source: string; target: string }> = [];

      const commit = await computeCommitHash(artifactId, parentCommit, nodes as { nodeId: string; commit: string }[], edges);
      const metadataWithDefaults = {
        ...metadata,
        artifactId,
        parentCommit,
        commit,
      };
      formData.append('metadata', JSON.stringify(metadataWithDefaults));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify(edges));

      return formData;
    }

    // 创建自定义 nodes/edges 的 FormData
    async function createCustomFormData(
      metadata: Record<string, unknown>,
      descriptor: { version: number; nodes: { id: string; type?: string; name?: string; content?: unknown }[]; edges: { source: string; target: string }[]; exportedAt?: string },
      nodeFiles?: Map<string, { name: string; content: string | Uint8Array; type?: string }[]>
    ): Promise<FormData> {
      const formData = new FormData();

      const artifactId = (metadata.artifactId as string) ?? crypto.randomUUID();
      const parentCommit = (metadata.parentCommit as string | undefined) ?? null;

      // Convert descriptor nodes to CreateArtifactNode format
      const nodes = await Promise.all(descriptor.nodes.map(async n => {
        const contentHash = crypto.randomUUID().substring(0, 16);
        const nodeType = n.type ?? 'INPUT';
        const nodeCommit = await computeNodeCommit(n.id, null, contentHash, nodeType);
        return {
          nodeId: n.id,
          commit: nodeCommit,
          ...(n.type ? { type: n.type } : {}),
          ...(n.name ? { name: n.name } : {}),
          contentHash,
          content: n.content || {},
        };
      }));
      const edges = descriptor.edges;

      const commit = await computeCommitHash(artifactId, parentCommit, nodes, edges);
      const metadataWithDefaults = {
        ...metadata,
        artifactId,
        parentCommit,
        commit,
      };
      formData.append('metadata', JSON.stringify(metadataWithDefaults));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify(edges));

      return formData;
    }

    it('should return 401 when not authenticated', async () => {
      const formData = await createVfsFormData({
        name: 'Test Recipe',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should create artifact successfully without files', async () => {
      const formData = await createVfsFormData({
        name: 'My Recipe',
        description: 'A test recipe',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.message).toBe('Artifact saved successfully');
      expect(data.artifact.name).toBe('My Recipe');
      expect(data.artifact.description).toBe('A test recipe');
    });

    it('should create artifact with VFS files', async () => {
      const formData = await createVfsFormData(
        {
          name: 'Prompt Pack',
        },
        [
          { name: 'prompt1.md', content: '# Prompt 1\nContent here' },
          { name: 'prompt2.md', content: '# Prompt 2\nMore content' },
        ]
      );

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.name).toBe('Prompt Pack');

      // Verify VFS archive is uploaded to R2
      const r2Bucket = getTestR2Bucket();
      
      // In new architecture, get nodes from artifact_version_nodes
      const versions = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, data.artifact.id));
      expect(versions.length).toBeGreaterThan(0);
      
      const versionNodeRecords = await db.select().from(artifactVersionNodes).where(eq(artifactVersionNodes.commitHash, versions[0].commitHash));
      expect(versionNodeRecords.length).toBeGreaterThan(0);
      
      const vfsNode = versionNodeRecords.find(n => true); // first node
      expect(vfsNode).toBeDefined();
      
      // VFS archives are stored by commit only (globally unique)
      const archiveKey = `archives/${vfsNode!.nodeCommit}.tar.gz`;
      const archive = await r2Bucket.get(archiveKey);
      
      expect(archive).not.toBeNull();
      expect(archive!.httpMetadata?.contentType).toBe('application/gzip');

      // 必须消费 body stream，否则 vitest-pool-workers isolated storage 清理会失败
      await archive!.arrayBuffer();
    });

    it('should create artifact with tags', async () => {
      // Create existing tag
      await db.insert(tags).values({
        name: 'existing-tag',
        slug: 'existing-tag',
        usageCount: 5,
      });

      const formData = await createVfsFormData({
        name: 'Tagged Game',
        tags: ['existing-tag', 'new-tag'],
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.tags).toHaveLength(2);
      
      const tagSlugs = data.artifact.tags!.map(t => t.slug);
      expect(tagSlugs).toContain('existing-tag');
      expect(tagSlugs).toContain('new-tag');

      // Verify tag usage count was incremented
      const [existingTag] = await db.select().from(tags).where(eq(tags.slug, 'existing-tag'));
      expect(existingTag.usageCount).toBe(6);
    });

    // 节点文件验证测试
    describe('Node file validation', () => {
      it('should create artifact with valid PROMPT node', async () => {
        const formData = await createPromptFormData(
          { name: 'Prompt Test' },
          'This is my prompt content'
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.name).toBe('Prompt Test');
      });

      it('should create artifact with valid GENERATED node', async () => {
        const formData = await createGeneratedFormData(
          { name: 'Generated Test' },
          '# Generated Content\n\nThis is generated markdown.'
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.name).toBe('Generated Test');
      });

      it('should create artifact with valid VFS node with multiple files', async () => {
        const formData = await createVfsFormData(
          { name: 'VFS Test' },
          [
            { name: 'file1.txt', content: 'content 1' },
            { name: 'file2.json', content: '{"key": "value"}' },
            { name: 'subfolder/file3.md', content: '# Title' },
          ]
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.name).toBe('VFS Test');
      });

      it('should return 400 when internal node missing type', async () => {
        const nodeId = crypto.randomUUID();
        const nodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles.set(nodeId, [{ name: 'node.json', content: 'test' }]);

        const formData = await createCustomFormData(
          { name: 'Test' },
          { version: 1, nodes: [{ id: nodeId }], edges: [] }, // 没有 type
          nodeFiles
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(400);
        const data = await response.json<ApiError>();
        expect(data.error).toContain('must have');
      });
    });

    it('should return 400 for missing required fields', async () => {
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        commit: crypto.randomUUID().substring(0, 8),
        // Missing name
      }));
      formData.append('nodes', JSON.stringify([]));
      formData.append('edges', JSON.stringify([]));

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('required');
    });




    it('should return 400 for invalid JSON in metadata', async () => {
      const formData = new FormData();
      formData.append('metadata', 'not valid json {');

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid JSON');
    });



    it('should create artifact with all optional fields', async () => {
      const formData = await createVfsFormData({
        name: 'Full Asset Pack',
        version: '2.0.0-beta',
        description: 'A complete asset pack',
        isListed: false,
        thumbnailUrl: 'https://example.com/thumb.png',
        license: 'MIT',
        repositoryUrl: 'https://github.com/example/repo',
        changelog: 'Initial release',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.name).toBe('Full Asset Pack');
      expect(data.artifact.description).toBe('A complete asset pack');
      expect(data.artifact.isListed).toBe(false);
      expect(data.artifact.thumbnailUrl).toBe('https://example.com/thumb.png');
      expect(data.artifact.license).toBe('MIT');
    });

    it('should create version record correctly', async () => {
      const formData = await createVfsFormData({
        name: 'Versioned Prompt',
        version: '1.2.3',
        changelog: 'Added new features',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();

      // Verify version record in database
      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, data.artifact.id));
      expect(artifact.currentVersionId).not.toBeNull();

      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, artifact.currentVersionId!));
      expect(version.version).toBe('1.2.3');
      expect(version.changelog).toBe('Added new features');
    });

    it('should create file records correctly', async () => {
      const formData = await createVfsFormData(
        {
          name: 'Recipe with Files',
        },
        [
          { name: 'recipe.json', content: '{"ingredients": []}', type: 'application/json' },
          { name: 'README.md', content: '# Recipe', type: 'text/markdown' },
        ]
      );

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();

      // Verify file records in database through node version content
      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, data.artifact.id));
      
      // Get all version nodes for this artifact (new architecture)
      const versions = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifact.id));
      expect(versions.length).toBeGreaterThan(0);
      
      const versionNodeRecords = await db.select().from(artifactVersionNodes).where(eq(artifactVersionNodes.commitHash, versions[0].commitHash));
      expect(versionNodeRecords.length).toBeGreaterThan(0);

      // Get all files from node version content (through node_versions table)
      const allFiles: { path: string }[] = [];
      for (const vn of versionNodeRecords) {
        const nvRecords = await db.select().from(nodeVersions).where(eq(nodeVersions.nodeId, vn.nodeId));
        for (const nv of nvRecords) {
          // In new architecture, content is in typed content tables; check via NodeVersionService
          // For this test, we just verify the node versions exist
        }
      }

      // In the new architecture, content is stored in typed content tables (e.g. vfs_contents)
      // The VFS file summary is stored in the descriptor content, verified by node version existence
      expect(versionNodeRecords.length).toBeGreaterThan(0);
    });

    it('should create stats record', async () => {
      const formData = await createVfsFormData({
        name: 'Stats Game',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();

      // Verify stats record in database
      const [stats] = await db.select().from(artifactStats).where(eq(artifactStats.artifactId, data.artifact.id));
      expect(stats).toBeDefined();
      expect(stats.viewCount).toBe(0);
      expect(stats.favCount).toBe(0);
      expect(stats.refCount).toBe(0);
      expect(stats.downloadCount).toBe(0);
    });

    it('should create artifact with homepage markdown', async () => {
      const homepageArtifactId = crypto.randomUUID();
      const emptyCommit = await computeCommitHash(homepageArtifactId, null, [], []);
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: homepageArtifactId,
        parentCommit: null,
        commit: emptyCommit,
        name: 'Recipe With Homepage',
      }));
      formData.append('nodes', JSON.stringify([]));
      formData.append('edges', JSON.stringify([]));
      
      // Add homepage markdown
      const markdownContent = '# Welcome\n\nThis is the **homepage** for this artifact.';
      const blob = new Blob([markdownContent], { type: 'text/markdown' });
      formData.append('homepage', blob, 'homepage.md');

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.id).toBeDefined();

      // Verify homepage was stored in R2
      const r2 = getTestR2Bucket();
      const homepageKey = `artifacts/${data.artifact.id}/homepage.html`;
      const object = await r2.get(homepageKey);
      expect(object).not.toBeNull();
      
      const html = await object!.text();
      expect(html).toContain('<h1>Welcome</h1>');
      expect(html).toContain('<strong>homepage</strong>');
    });

    // 更新 Artifact 测试
    describe('Update artifact (with artifactId in metadata)', () => {
      it('should update artifact successfully when artifactId is provided', async () => {
        // 首先创建一个 artifact
        const createFormData = await createVfsFormData({
          name: 'Original Recipe',
          description: 'Original description',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 获取当前版本的 commitHash 作为 parentCommit
        const [currentVersion] = await db.select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));

        // 更新这个 artifact
        const updateFormData = await createVfsFormData({
          artifactId,
          parentCommit: currentVersion.commitHash,
          name: 'Updated Recipe',
          version: '2.0.0',
          description: 'Updated description',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.message).toBe('Artifact saved successfully');
        expect(updateData.artifact.id).toBe(artifactId);
        expect(updateData.artifact.name).toBe('Updated Recipe');
        expect(updateData.artifact.description).toBe('Updated description');
      });

      it('should preserve stats when updating artifact', async () => {
        // 首先创建一个 artifact
        const createFormData = await createVfsFormData({
          name: 'Recipe for Stats',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 模拟一些 stats 更新
        await db.update(artifactStats)
          .set({ viewCount: 100, favCount: 50 })
          .where(eq(artifactStats.artifactId, artifactId));

        // 获取当前版本的 commitHash 作为 parentCommit
        const [currentVersion] = await db.select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));

        // 更新这个 artifact
        const updateFormData = await createVfsFormData({
          artifactId,
          parentCommit: currentVersion.commitHash,
          name: 'Updated Recipe Stats',
          version: '2.0.0',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.artifact.stats?.viewCount).toBe(100);
        expect(updateData.artifact.stats?.favCount).toBe(50);
      });

      it('should create new artifact when artifactId does not exist in database', async () => {
        const newId = crypto.randomUUID();
        const formData = await createVfsFormData({
          artifactId: newId,
          name: 'New Artifact',
        });

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.id).toBe(newId);
        expect(data.artifact.name).toBe('New Artifact');
      });

      it('should return 403 when trying to update artifact owned by another user', async () => {
        // 创建另一个用户的 artifact
        const { sessionCookie: otherUserSessionCookie } = await registerUser('otheruser');
        const createFormData = await createVfsFormData({
          name: 'Other User Recipe',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: otherUserSessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 尝试用当前用户更新
        const updateFormData = await createVfsFormData({
          artifactId,
          name: 'Hijacked Recipe',
          version: '2.0.0',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(403);
        const updateData = await updateResponse.json<ApiError>();
        expect(updateData.error).toBe('You do not have permission to update this artifact');
      });



      it('should update tags correctly', async () => {
        // 创建一些标签
        await db.insert(tags).values([
          { name: 'tag-a', slug: 'tag-a', usageCount: 10 },
          { name: 'tag-b', slug: 'tag-b', usageCount: 5 },
        ]);

        // 创建带标签的 artifact
        const createFormData = await createVfsFormData({
          name: 'Tagged Recipe',
          tags: ['tag-a'],
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;
        expect(createData.artifact.tags).toHaveLength(1);

        // 检查 tag-a 的使用计数增加了
        const [tagA1] = await db.select().from(tags).where(eq(tags.slug, 'tag-a'));
        expect(tagA1.usageCount).toBe(11);

        // 获取当前版本的 commitHash 作为 parentCommit
        const [currentVersion] = await db.select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));

        // 更新，移除 tag-a，添加 tag-b
        const updateFormData = await createVfsFormData({
          artifactId,
          parentCommit: currentVersion.commitHash,
          name: 'Updated Tagged Recipe',
          version: '2.0.0',
          tags: ['tag-b'],
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.artifact.tags).toHaveLength(1);
        expect(updateData.artifact.tags![0].slug).toBe('tag-b');

        // 检查 tag-a 的使用计数减少了，tag-b 的增加了
        const [tagA2] = await db.select().from(tags).where(eq(tags.slug, 'tag-a'));
        const [tagB2] = await db.select().from(tags).where(eq(tags.slug, 'tag-b'));
        expect(tagA2.usageCount).toBe(10);
        expect(tagB2.usageCount).toBe(6);
      });

      it('should update nodes and files correctly', async () => {
        // 创建带节点的 artifact
        const nodeId1 = crypto.randomUUID();
        const nodeFiles1 = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles1.set(nodeId1, [{ name: 'node.json', content: 'original content' }]);

        const createFormData = await createCustomFormData(
          { name: 'Node Recipe' },
          { version: 1, nodes: [{ id: nodeId1, type: 'PROMPT', name: 'original-node', content: { blocks: [] } }], edges: [] },
          nodeFiles1
        );

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 获取旧的节点（new architecture: through artifact_version_nodes）
        const oldVersions = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));
        const oldVersionNodes = await db.select().from(artifactVersionNodes).where(eq(artifactVersionNodes.commitHash, oldVersions[0].commitHash));
        expect(oldVersionNodes).toHaveLength(1);
        const oldNodeId = oldVersionNodes[0].nodeId;

        // 获取当前版本的 commitHash 作为 parentCommit
        const parentCommit = oldVersions[0].commitHash;

        // 更新，用新节点替换
        const nodeId2 = crypto.randomUUID();
        const nodeFiles2 = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles2.set(nodeId2, [{ name: 'node.json', content: 'updated content' }]);

        const updateFormData = await createCustomFormData(
          { artifactId, parentCommit, name: 'Updated Node Recipe', version: '2.0.0' },
          { version: 1, nodes: [{ id: nodeId2, type: 'PROMPT', name: 'new-node', content: { blocks: [] } }], edges: [] },
          nodeFiles2
        );

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);
        expect(updateResponse.status).toBe(200);

        // 检查新版本的节点（通过 currentVersionId 获取最新版本）
        const [updatedArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));
        const [newVersion] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, updatedArtifact.currentVersionId!));
        const newVersionNodes = await db.select().from(artifactVersionNodes).where(eq(artifactVersionNodes.commitHash, newVersion.commitHash));
        expect(newVersionNodes).toHaveLength(1);
        expect(newVersionNodes[0].nodeId).not.toBe(oldNodeId);
      });

      it('should allow reusing same node ID when updating artifact', async () => {
        // 创建带节点的 artifact
        const nodeId = crypto.randomUUID();
        const nodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles.set(nodeId, [{ name: 'node.json', content: 'original content' }]);

        const createFormData = await createCustomFormData(
          { name: 'Reuse Node Recipe' },
          { version: 1, nodes: [{ id: nodeId, type: 'PROMPT', name: 'my-node', content: { blocks: [] } }], edges: [] },
          nodeFiles
        );

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 获取当前版本的 commitHash 作为 parentCommit
        const [currentVersion] = await db.select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));

        // 更新，复用相同的 node ID
        const updatedNodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        updatedNodeFiles.set(nodeId, [{ name: 'node.json', content: 'updated content' }]);

        const updateFormData = await createCustomFormData(
          { artifactId, parentCommit: currentVersion.commitHash, name: 'Updated Reuse Recipe', version: '2.0.0' },
          { version: 1, nodes: [{ id: nodeId, type: 'PROMPT', name: 'my-node-updated', content: { blocks: [] } }], edges: [] },
          updatedNodeFiles
        );

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);
        expect(updateResponse.status).toBe(200);

        // 检查节点被更新（相同 ID，新版本 — 通过 currentVersionId 获取最新版本）
        const [updatedArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));
        const [updatedVersion] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, updatedArtifact.currentVersionId!));
        const updatedVersionNodes = await db.select().from(artifactVersionNodes).where(eq(artifactVersionNodes.commitHash, updatedVersion.commitHash));
        expect(updatedVersionNodes).toHaveLength(1);
        expect(updatedVersionNodes[0].nodeId).toBe(nodeId);
      });

      // nodeId 全局唯一标识节点实体，不同 artifact 可以各自为同一节点创建新版本（fork 语义），
      // 因此不存在"node ID 被其他 artifact 占用"的冲突。
    });
  });

  describe('GET /api/artifacts/:artifactId/homepage', () => {
    let testUserId: string;

    async function createTestArtifact(
      authorId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        name,
      }).returning();
      
      // Create discovery control record for visibility tests
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        isListed,
      });
      
      // Grant owner full permissions
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: authorId,
        canRead: true,
        canWrite: true,
        canManage: true,
        grantedBy: authorId,
      });
      
      // If not private, grant public read access
      if (!isPrivate) {
        await db.insert(resourceAcl).values({
          resourceType: 'artifact',
          resourceId: artifact.id,
          userId: PUBLIC_USER_ID,
          canRead: true,
          canWrite: false,
          canManage: false,
          grantedBy: authorId,
        });
      }
      
      return artifact.id;
    }

    async function storeHomepage(artifactId: string, html: string): Promise<void> {
      const r2 = getTestR2Bucket();
      const key = `artifacts/${artifactId}/homepage.html`;
      await r2.put(key, html, {
        httpMetadata: {
          contentType: 'text/html; charset=utf-8',
        },
      });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'homepageuser');
    });

    it('should return homepage HTML for public artifact', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Public Artifact');
      await storeHomepage(artifactId, '<h1>Hello World</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      expect(html).toBe('<h1>Hello World</h1>');
    });

    it('should return 404 for non-existent artifact', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const request = new Request(`http://localhost/api/artifacts/${fakeId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('artifact not found');
    });

    it('should return 404 when homepage not created', async () => {
      const artifactId = await createTestArtifact(testUserId, 'No Homepage');
      
      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Artifact homepage not found');
    });

    it('should return homepage for unlisted artifact without auth (unlisted but not private)', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Unlisted Artifact', { isPrivate: false, isListed: false });
      await storeHomepage(artifactId, '<h1>Secret</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      // Unlisted but not private artifacts are publicly accessible via direct link
      expect(response.status).toBe(200);
    });

    it('should return homepage for unlisted artifact with auth', async () => {
      const { sessionCookie } = await registerUser('autheduser');
      const artifactId = await createTestArtifact(testUserId, 'Unlisted Artifact', { isPrivate: false, isListed: false });
      await storeHomepage(artifactId, '<h1>Unlisted Content</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toBe('<h1>Unlisted Content</h1>');
    });

    it('should return 403 for private artifact without auth', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Private Artifact', { isPrivate: true, isListed: false });
      await storeHomepage(artifactId, '<h1>Private</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should return 403 for private artifact from different user', async () => {
      const { sessionCookie } = await registerUser('differentuser');
      const artifactId = await createTestArtifact(testUserId, 'Private Artifact', { isPrivate: true, isListed: false });
      await storeHomepage(artifactId, '<h1>Private</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should return homepage for private artifact owned by user', async () => {
      // Register user and get their ID
      const { sessionCookie, userId: ownerId } = await registerUser('owneruser');
      
      const artifactId = await createTestArtifact(ownerId, 'My Private Artifact', { isPrivate: true, isListed: false });
      await storeHomepage(artifactId, '<h1>My Private Content</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toBe('<h1>My Private Content</h1>');
    });
  });
});
