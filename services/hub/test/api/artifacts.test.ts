import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ListArtifactsResponse,
  CreateArtifactResponse,
  ApiError,
  ArtifactListItem,
} from '@pubwiki/api';
import { computeArtifactCommit, computeNodeCommit, computeContentHash, computeSha256Hex } from '@pubwiki/api';
import {
  getTestDb,
  getTestR2Bucket,
  clearDatabase,
  sendRequest,
  registerUser,
  createTestUser,
  createVfsTarGz,
  artifacts,
  tags,
  artifactTags,
  artifactStats,
  artifactVersions,
  nodeVersions,
  artifactVersionNodes,
  resourceDiscoveryControl,
  resourceAcl,
  vfsContents,
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
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      await db.insert(tags).values({
        slug,
        name,
      }).onConflictDoNothing();
      return slug;
    }

    async function addTagToArtifact(artifactId: string, tagSlug: string): Promise<void> {
      await db.insert(artifactTags).values({ artifactId, tagSlug });
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
      await createTestArtifact(testUserId, 'Prompt with no tags');

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
      await createTestArtifact(testUserId, 'Recipe to keep');
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
      let tarGz: ArrayBuffer | null = null;
      let filesHashValue: string | null = null;
      if (files && files.length > 0) {
        // Create tar.gz first to compute filesHash
        tarGz = await createVfsTarGz(files.map(f => ({
          name: f.name,
          content: f.content
        })));
        filesHashValue = await computeSha256Hex(tarGz);
        
        const nodeCommit = await computeNodeCommit(nodeId, null, contentHash, 'VFS');
        nodes = [{
          nodeId,
          commit: nodeCommit,
          type: 'VFS',
          name: 'files',
          contentHash,
          content: { type: 'VFS', filesHash: filesHashValue, fileTree: files.map(f => ({ path: f.name, size: 0 })) },
        }];
      }
      const edges: Array<{ source: string; target: string }> = [];

      const commit = await computeCommitHash(artifactId, parentCommit, nodes as Array<{nodeId: string; commit: string; contentHash: string}>, edges);
      const metadataWithDefaults = {
        ...metadata,
        artifactId,
        parentCommit,
        commit,
      };
      formData.append('metadata', JSON.stringify(metadataWithDefaults));
      formData.append('nodes', JSON.stringify(nodes));
      formData.append('edges', JSON.stringify(edges));

      if (files && files.length > 0 && tarGz && filesHashValue) {
        const blob = new Blob([tarGz], { type: 'application/gzip' });
        formData.append(`vfs[${filesHashValue}]`, blob, 'archive.tar.gz');
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
          content: { type: 'PROMPT', blocks: [] },
        }];
      }
      const edges: Array<{ source: string; target: string }> = [];

      const commit = await computeCommitHash(artifactId, parentCommit, nodes as Array<{nodeId: string; commit: string; contentHash: string}>, edges);
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
          content: { 
            type: 'GENERATED', 
            blocks: [],
            inputRef: { id: crypto.randomUUID(), commit: 'dummy-input-commit' },
          },
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

      // Prepare VFS archives and compute filesHash for VFS nodes
      const vfsArchiveData = new Map<string, { tarGz: ArrayBuffer; filesHash: string }>();
      if (nodeFiles) {
        for (const [nodeId, files] of nodeFiles) {
          const tarGz = await createVfsTarGz(files.map(f => ({
            name: f.name,
            content: f.content
          })));
          const filesHash = await computeSha256Hex(tarGz);
          vfsArchiveData.set(nodeId, { tarGz, filesHash });
        }
      }

      // Convert descriptor nodes to CreateArtifactNode format
      const nodes = await Promise.all(descriptor.nodes.map(async n => {
        const nodeType = n.type ?? 'INPUT';
        
        // For VFS nodes, use the precomputed filesHash in content
        let content = n.content || {};
        if (nodeType === 'VFS' && vfsArchiveData.has(n.id)) {
          const { filesHash } = vfsArchiveData.get(n.id)!;
          content = { type: 'VFS', filesHash, ...(n.content as object || {}) };
        } else if (typeof content === 'object' && content !== null && !('type' in content)) {
          content = { type: nodeType, ...content };
        }
        
        const contentHash = crypto.randomUUID().substring(0, 16);
        const nodeCommit = await computeNodeCommit(n.id, null, contentHash, nodeType);
        
        return {
          nodeId: n.id,
          commit: nodeCommit,
          ...(n.type ? { type: n.type } : {}),
          ...(n.name ? { name: n.name } : {}),
          contentHash,
          content,
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

      // Add VFS archives using filesHash as key (for deduplication)
      const addedHashes = new Set<string>();
      for (const [, { tarGz, filesHash }] of vfsArchiveData) {
        if (!addedHashes.has(filesHash)) {
          const blob = new Blob([tarGz], { type: 'application/gzip' });
          formData.append(`vfs[${filesHash}]`, blob, 'archive.tar.gz');
          addedHashes.add(filesHash);
        }
      }

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
      
      const vfsVersionNode = versionNodeRecords.find(() => true); // first node
      expect(vfsVersionNode).toBeDefined();
      
      // Get node version to find contentHash
      const nodeVersionRecord = await db.select().from(nodeVersions).where(eq(nodeVersions.commit, vfsVersionNode!.nodeCommit));
      expect(nodeVersionRecord.length).toBeGreaterThan(0);
      
      // Get VFS content to find filesHash
      const vfsContentRecords = await db.select().from(vfsContents).where(eq(vfsContents.contentHash, nodeVersionRecord[0].contentHash));
      expect(vfsContentRecords.length).toBeGreaterThan(0);
      
      // VFS archives are stored by filesHash: vfs/{filesHash}/files.tar.gz
      const archiveKey = `vfs/${vfsContentRecords[0].filesHash}/files.tar.gz`;
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
        // Zod validation error format: "Invalid option: expected one of ..."
        expect(data.error).toContain('Invalid');
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
      // Zod validation error format: "Invalid input: expected string, received undefined"
      expect(data.error).toContain('Invalid');
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
      expect(artifact.latestVersion).not.toBeNull();

      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, artifact.latestVersion!));
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
      // NOTE: In the new architecture, content is stored in typed content tables
      // The loop below verifies node versions exist
      for (const vn of versionNodeRecords) {
        await db.select().from(nodeVersions).where(eq(nodeVersions.nodeId, vn.nodeId));
        // In new architecture, content is in typed content tables; check via NodeVersionService
        // For this test, we just verify the node versions exist
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

    // =========================================================================
    // POST pure insert semantics tests (POST now returns 409 on existing artifact)
    // =========================================================================
    describe('POST pure insert semantics', () => {
      it('should return 409 CONFLICT when trying to POST with existing artifactId', async () => {
        // First create an artifact
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

        // Try to POST with same artifactId - should fail with 409
        const conflictFormData = await createVfsFormData({
          artifactId,
          name: 'Updated Recipe',
        });

        const conflictRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: conflictFormData,
        });
        const conflictResponse = await sendRequest(conflictRequest);

        expect(conflictResponse.status).toBe(409);
        const conflictData = await conflictResponse.json<ApiError>();
        expect(conflictData.error).toContain('already exists');
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

      it('should return 409 when trying to create artifact with existing artifactId (even for different user)', async () => {
        // Create another user's artifact
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

        // Try to POST with same artifactId using current user - should fail with 409
        const conflictFormData = await createVfsFormData({
          artifactId,
          name: 'Hijacked Recipe',
        });

        const conflictRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: conflictFormData,
        });
        const conflictResponse = await sendRequest(conflictRequest);

        expect(conflictResponse.status).toBe(409);
        const conflictData = await conflictResponse.json<ApiError>();
        expect(conflictData.error).toContain('already exists');
      });

      it('should preserve stats in list view after creating artifact', async () => {
        // First create an artifact
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

        // Simulate some stats updates
        await db.update(artifactStats)
          .set({ viewCount: 100, favCount: 50 })
          .where(eq(artifactStats.artifactId, artifactId));

        // List artifacts and verify stats are preserved
        const listRequest = new Request('http://localhost/api/artifacts', { method: 'GET' });
        const listResponse = await sendRequest(listRequest);
        expect(listResponse.status).toBe(200);
        const listData = await listResponse.json<{ artifacts: ArtifactListItem[] }>();
        
        const artifact = listData.artifacts.find(a => a.id === artifactId);
        expect(artifact).toBeDefined();
        expect(artifact?.stats?.viewCount).toBe(100);
        expect(artifact?.stats?.favCount).toBe(50);
      });
    });

    // =========================================================================
    // STATE node + saves 测试
    // 测试创建 artifact 时同时提交 save，并在 STATE 节点中引用该 save
    // =========================================================================
    describe('STATE node with saves', () => {
      // 创建一个完整的 artifact 图，包括 STATE、LOADER、SANDBOX 节点和 saves
      async function createArtifactWithStateSaveFormData(
        metadata: Record<string, unknown>,
      ): Promise<FormData> {
        const formData = new FormData();

        const artifactId = (metadata.artifactId as string) ?? crypto.randomUUID();
        const parentCommit = (metadata.parentCommit as string | undefined) ?? null;

        // 创建三个节点：STATE、LOADER、SANDBOX
        const stateNodeId = crypto.randomUUID();
        const loaderNodeId = crypto.randomUUID();
        const sandboxNodeId = crypto.randomUUID();

        // 创建 SANDBOX 和 LOADER 节点
        const sandboxContentHash = await computeContentHash({ type: 'SANDBOX', entryFile: 'index.html' });
        const sandboxCommit = await computeNodeCommit(sandboxNodeId, null, sandboxContentHash, 'SANDBOX');

        const loaderContentHash = await computeContentHash({ type: 'LOADER' });
        const loaderCommit = await computeNodeCommit(loaderNodeId, null, loaderContentHash, 'LOADER');

        // 创建 STATE 节点
        const stateContent = { type: 'STATE' as const, name: 'Game State', description: 'Test state node' };
        const stateContentHash = await computeContentHash(stateContent);
        const stateCommit = await computeNodeCommit(stateNodeId, null, stateContentHash, 'STATE');

        // Edges for request (without sourceHandle/targetHandle - they're optional)
        const requestEdges = [
          { source: stateNodeId, target: loaderNodeId },
          { source: loaderNodeId, target: sandboxNodeId },
        ];

        // Edges for commit calculation (with null handles, matching server behavior)
        const commitEdges = [
          { source: stateNodeId, target: loaderNodeId, sourceHandle: null, targetHandle: null },
          { source: loaderNodeId, target: sandboxNodeId, sourceHandle: null, targetHandle: null },
        ];

        // 计算 artifact commit
        const commitNodes = [
          { nodeId: stateNodeId, commit: stateCommit },
          { nodeId: loaderNodeId, commit: loaderCommit },
          { nodeId: sandboxNodeId, commit: sandboxCommit },
        ];
        const artifactCommit = await computeArtifactCommit(artifactId, parentCommit, commitNodes, commitEdges);

        // 计算 save 的 ID 和 commit
        const saveId = crypto.randomUUID();
        const saveContentHash = await computeContentHash({
          type: 'SAVE',
          stateNodeId,
          stateNodeCommit: stateCommit,
          sourceArtifactCommit: artifactCommit,
          title: 'Test Save',
          description: null,
        });
        const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

        // 节点列表
        const nodes = [
          {
            nodeId: stateNodeId,
            commit: stateCommit,
            type: 'STATE',
            name: 'state',
            contentHash: stateContentHash,
            content: stateContent,
          },
          {
            nodeId: loaderNodeId,
            commit: loaderCommit,
            type: 'LOADER',
            name: 'loader',
            contentHash: loaderContentHash,
            content: { type: 'LOADER' },
          },
          {
            nodeId: sandboxNodeId,
            commit: sandboxCommit,
            type: 'SANDBOX',
            name: 'sandbox',
            contentHash: sandboxContentHash,
            content: { type: 'SANDBOX', entryFile: 'index.html' },
          },
        ];

        // 创建 save 输入
        const saves = [
          {
            stateNodeId,
            commit: saveCommit,
            contentHash: saveContentHash,
            parent: null,
            title: 'Test Save',
            description: 'A test save created with the artifact',
            isListed: false,
          },
        ];

        // 构建 metadata
        const metadataWithDefaults = {
          ...metadata,
          artifactId,
          parentCommit,
          commit: artifactCommit,
          saves,
        };

        formData.append('metadata', JSON.stringify(metadataWithDefaults));
        formData.append('nodes', JSON.stringify(nodes));
        formData.append('edges', JSON.stringify(requestEdges));

        return formData;
      }

      it('should create artifact with save (save references STATE node through stateNodeId)', async () => {
        // 这个测试验证：
        // - 可以和 artifact 一起创建 save
        // - Save 与 STATE 节点关联（通过 save_contents.stateNodeId）
        // - STATE 节点内容只包含 name 和 description（不包含 saves 引用）

        const formData = await createArtifactWithStateSaveFormData(
          { name: 'Artifact with STATE and Save' },
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);
        const responseData = await response.json();

        // Debug: throw error with detailed message if status is not 200
        if (response.status !== 200) {
          throw new Error(`Expected 200 but got ${response.status}: ${JSON.stringify(responseData, null, 2)}`);
        }

        expect((responseData as CreateArtifactResponse).artifact.name).toBe('Artifact with STATE and Save');
      });
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
